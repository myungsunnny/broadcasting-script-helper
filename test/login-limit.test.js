// 로그인 시도 제한(src/login-limit.js + /api/login) 시험: npm test
// ai-usage.test.js처럼 node:sqlite(메모리 DB)에 schema.sql을 올리고 D1 모양 어댑터로 감싼 뒤 실제 Worker fetch로 확인한다.
// 시간은 login_fails에 오래된 at을 직접 넣어 흉내 낸다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';
import { LOGIN_LIMIT_MESSAGE, ipKey } from '../src/login-limit.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* 이 Node에서는 못 씀 */ }
const skip = DatabaseSync ? false : 'node:sqlite를 쓸 수 없는 Node 버전';

const plain = rows => rows.map(r => ({ ...r }));
function d1(db) {
  const stmt = (sql, args) => ({
    sql, args,
    first: async () => { const r = db.prepare(sql).get(...args); return r ? { ...r } : null; },
    all: async () => ({ results: plain(db.prepare(sql).all(...args)) }),
    run: async () => { db.prepare(sql).run(...args); return {}; }
  });
  return {
    prepare: sql => ({ ...stmt(sql, []), bind: (...args) => stmt(sql, args) }),
    batch: async stmts => stmts.map(s => /^\s*SELECT/i.test(s.sql)
      ? { results: plain(db.prepare(s.sql).all(...s.args)) }
      : (db.prepare(s.sql).run(...s.args), { results: [] }))
  };
}

const WRONG = '아이디 또는 비밀번호가 맞지 않아요.';
const MIN = 60 * 1000;

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const hash = await hashPassword('1234');
  for (const [id, loginId] of [['s1', 'ise'], ['s2', 'jun']]) {
    db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES (?, ?, ?, ?, 0, 1, '2026-01-01 00:00:00')")
      .run(id, loginId, loginId, hash);
  }
  const env = { DB: d1(db), TEACHER_PASSWORD: 'teach', SESSION_SECRET: 'test-secret', ASSETS: { fetch: () => new Response('') } };
  const login = async (name, password, ip = '1.2.3.4') => {
    const res = await worker.fetch(new Request('https://x.test/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
      body: JSON.stringify({ name, password })
    }), env);
    return { status: res.status, data: await res.json(), cookie: (res.headers.get('Set-Cookie') || '').split(';')[0] };
  };
  const fails = key => db.prepare('SELECT COUNT(*) AS n FROM login_fails WHERE key = ?').get(key).n;
  const addFail = (key, at) => db.prepare('INSERT INTO login_fails (key, at) VALUES (?, ?)').run(key, at);
  return { db, env, login, fails, addFail };
}

test('1~4번 틀리면 401, 기록이 늘어남 / 5번 틀린 뒤엔 맞는 비밀번호도 429, 기록 그대로', { skip }, async () => {
  const { login, fails } = await setup();
  for (let i = 1; i <= 5; i++) {
    const r = await login('ise', '0000');
    assert.equal(r.status, 401);
    assert.equal(r.data.error, WRONG);
    assert.equal(fails('id:ise'), i);
  }
  const blocked = await login('ise', '1234');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, LOGIN_LIMIT_MESSAGE);
  assert.equal(fails('id:ise'), 5);
  assert.equal(fails('ip:1.2.3.4'), 5);
});

test('10분 지난 실패만 있으면 다시 시도 가능, 오래된 기록은 지워짐', { skip }, async () => {
  const { login, fails, addFail } = await setup();
  for (let i = 0; i < 5; i++) addFail('id:ise', Date.now() - 11 * MIN);
  assert.equal((await login('ise', '0000')).status, 401);
  assert.equal(fails('id:ise'), 1);
  assert.equal((await login('ise', '1234')).status, 200);
});

test('3번 틀린 뒤 성공하면 그 아이디 기록 0, 주소 기록은 남음', { skip }, async () => {
  const { login, fails } = await setup();
  for (let i = 0; i < 3; i++) await login('ise', '0000');
  assert.equal((await login('ise', '1234')).status, 200);
  assert.equal(fails('id:ise'), 0);
  assert.equal(fails('ip:1.2.3.4'), 3);
});

test('선생님 비밀번호를 이름 바꿔 가며 30번 틀리면(같은 주소) 31번째 429', { skip }, async () => {
  const { login } = await setup();
  for (let i = 0; i < 30; i++) assert.equal((await login(`선생${i}`, 'nope')).status, 401);
  const r = await login('선생99', 'teach');
  assert.equal(r.status, 429);
  assert.equal(r.data.error, LOGIN_LIMIT_MESSAGE);
  // 다른 주소에서는 그대로 된다
  assert.equal((await login('선생99', 'teach', '5.6.7.8')).status, 200);
});

test('한 아이디가 막혀도 다른 아이디는 로그인됨, 없는 아이디도 같은 문구로 센다', { skip }, async () => {
  const { login, fails } = await setup();
  for (let i = 0; i < 5; i++) await login('ise', '0000');
  assert.equal((await login('ise', '1234')).status, 429);
  assert.equal((await login('jun', '1234')).status, 200);
  const r = await login('없는사람', '0000');
  assert.equal(r.status, 401);
  assert.equal(r.data.error, WRONG);
  assert.equal(fails('id:없는사람'), 1);
});

test('주소가 없으면(로컬) 주소 기준은 건너뜀', { skip }, async () => {
  const { login, db } = await setup();
  await login('ise', '0000', '');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM login_fails WHERE key LIKE 'ip:%'").get().n, 0);
});

test('login_fails 표가 없어도 로그인은 그대로 (200/401), 서버 기록에 오류', { skip }, async () => {
  const { login, db } = await setup();
  db.exec('DROP TABLE login_fails');
  const origError = console.error;
  let logged = 0;
  console.error = () => { logged++; };
  try {
    assert.equal((await login('ise', '0000')).status, 401);
    assert.equal((await login('ise', '1234')).status, 200);
    assert.equal((await login('김선생', 'teach')).status, 200);
  } finally { console.error = origError; }
  assert.ok(logged > 0);
});

test('동시에 10번 틀린 비밀번호를 보내도 아이디 기록은 5를 넘지 않고, 나머지는 429', { skip }, async () => {
  const { login, fails } = await setup();
  const results = await Promise.all(Array.from({ length: 10 }, () => login('ise', '0000')));
  const n401 = results.filter(r => r.status === 401).length;
  const n429 = results.filter(r => r.status === 429).length;
  assert.equal(n401 + n429, 10);
  assert.ok(n401 <= 5);
  assert.ok(n429 >= 5);
  assert.equal(fails('id:ise'), n401);
});

test('성공한 로그인은 주소 수에 들어가지 않는다', { skip }, async () => {
  const { login, fails } = await setup();
  assert.equal((await login('ise', '0000')).status, 401);
  for (let i = 0; i < 3; i++) assert.equal((await login('jun', '1234')).status, 200);
  assert.equal((await login('김선생', 'teach')).status, 200);
  assert.equal(fails('ip:1.2.3.4'), 1);
});

test('선생님이 비밀번호를 초기화하면 막힌 학생이 바로 들어올 수 있다', { skip }, async () => {
  const { env, login, fails } = await setup();
  for (let i = 0; i < 5; i++) await login('ise', '0000');
  assert.equal((await login('ise', '1234')).status, 429);
  const t = await login('김선생', 'teach', '9.9.9.9');
  const res = await worker.fetch(new Request('https://x.test/api/users/s1/reset', { method: 'POST', headers: { Cookie: t.cookie } }), env);
  assert.equal(res.status, 200);
  const { password } = await res.json();
  assert.equal(fails('id:ise'), 0);
  assert.equal((await login('ise', password)).status, 200);
});

test('IPv6는 같은 /64 안이면 같은 주소로 센다', { skip }, async () => {
  assert.equal(ipKey('2001:db8:1:2::5'), ipKey('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd'));
  assert.notEqual(ipKey('2001:db8:1:2::5'), ipKey('2001:db8:1:3::5'));
  assert.equal(ipKey('1.2.3.4'), 'ip:1.2.3.4');
  const { login } = await setup();
  for (let i = 0; i < 30; i++) assert.equal((await login(`선생${i}`, 'nope', `2001:db8:1:2::${i.toString(16)}`)).status, 401);
  assert.equal((await login('선생99', 'teach', '2001:db8:1:2:ffff::1')).status, 429);
  assert.equal((await login('선생99', 'teach', '2001:db8:1:3::1')).status, 200);
});
