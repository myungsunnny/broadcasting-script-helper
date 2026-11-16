// AI 사용량 제한(src/ai-usage.js + /api/ai/section, /api/me) 시험: npm test
// notify.test.js처럼 node:sqlite(메모리 DB)에 schema.sql을 올리고 D1 모양 어댑터로 감싼 뒤 실제 Worker fetch로 확인한다.
// Gemini는 globalThis.fetch를 가짜로 바꿔 부른 횟수만 센다.

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';
import { todayKST, addDays } from '../src/dates.js';
import { aiLimit } from '../src/ai-usage.js';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* 이 Node에서는 못 씀 */ }
const skip = DatabaseSync ? false : 'node:sqlite를 쓸 수 없는 Node 버전';

const plain = rows => rows.map(r => ({ ...r }));

/** D1 모양 어댑터 */
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

const today = todayKST();
const realFetch = globalThis.fetch;
let geminiCalls = 0;
let geminiFails = false;

/** 가짜 Gemini: 성공이면 '안녕하세요', 실패면 다시 해도 소용없는 400(바로 끝남) */
function fakeGemini() {
  geminiCalls = 0;
  geminiFails = false;
  globalThis.fetch = async () => {
    geminiCalls++;
    if (geminiFails) return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '안녕하세요' }] } }] }), { status: 200 });
  };
}
afterEach(() => { globalThis.fetch = realFetch; });

async function setup(extraEnv = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES ('s1', 'ise', '이서', ?, 0, 1, '2026-01-01 00:00:00')")
    .run(await hashPassword('1234'));
  const env = { DB: d1(db), TEACHER_PASSWORD: 'teach', SESSION_SECRET: 'test-secret', GEMINI_API_KEY: 'fake', AI_DAILY_LIMIT: '30', ASSETS: { fetch: () => new Response('') }, ...extraEnv };
  const call = async (cookie, method, path, body) => {
    const res = await worker.fetch(new Request('https://x.test' + path, {
      method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env);
    return { status: res.status, data: await res.json() };
  };
  const loginAs = async (name, password) => {
    const res = await worker.fetch(new Request('https://x.test/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password })
    }), env);
    assert.equal(res.status, 200);
    return res.headers.get('Set-Cookie').split(';')[0];
  };
  const t = await loginAs('김선생', 'teach');
  const s = await loginAs('ise', '1234');
  const ask = cookie => call(cookie, 'POST', '/api/ai/section', { section: 'greeting', date: addDays(today, 3) });
  const count = (day = today) => db.prepare('SELECT count FROM ai_usage WHERE user_uid = ? AND day = ?').get('s1', day)?.count;
  const setCount = (n, day = today) => db.prepare('INSERT OR REPLACE INTO ai_usage (user_uid, day, count) VALUES (?, ?, ?)').run('s1', day, n);
  return { db, call, t, s, ask, count, setCount };
}

test('첫 요청: 기록 1, aiLeft 29, /api/me도 29', { skip }, async () => {
  const { call, s, ask, count } = await setup();
  assert.equal((await call(s, 'GET', '/api/me')).data.config.aiLeft, 30);
  fakeGemini();
  const res = await ask(s);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { text: '안녕하세요', aiLeft: 29 });
  assert.equal(count(), 1);
  assert.equal((await call(s, 'GET', '/api/me')).data.config.aiLeft, 29);
});

test('마지막 1번은 성공(aiLeft 0), 31번째는 429 + 거절 문구, Gemini 안 부름, 기록 30 그대로', { skip }, async () => {
  const { s, ask, count, setCount } = await setup();
  setCount(29);
  fakeGemini();
  const last = await ask(s);
  assert.equal(last.status, 200);
  assert.equal(last.data.aiLeft, 0);
  assert.equal(geminiCalls, 1);
  const over = await ask(s);
  assert.equal(over.status, 429);
  assert.equal(over.data.error, '오늘 AI를 다 썼어요. 내일 다시 쓸 수 있어요. 급하면 선생님께 말씀드려요.');
  assert.equal(geminiCalls, 1);
  assert.equal(count(), 30);
});

test('동시에 눌러도 한도를 넘지 않는다', { skip }, async () => {
  const { s, ask, count, setCount } = await setup();
  setCount(28);
  fakeGemini();
  const results = await Promise.all([ask(s), ask(s), ask(s), ask(s)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 200, 429, 429]);
  assert.equal(count(), 30);
});

test('AI 실패: 오류는 그대로 전달, 쓴 1번은 되돌림', { skip }, async () => {
  const { s, ask, count, setCount } = await setup();
  setCount(5);
  fakeGemini();
  geminiFails = true;
  const res = await ask(s);
  assert.equal(res.status, 500);
  assert.match(res.data.error, /AI 호출 실패/);
  assert.equal(count(), 5);
});

test('입력 오류(400)는 세지 않는다', { skip }, async () => {
  const { call, s, count } = await setup();
  fakeGemini();
  assert.equal((await call(s, 'POST', '/api/ai/section', { section: 'nope', date: today })).status, 400);
  assert.equal(count(), undefined);
  assert.equal(geminiCalls, 0);
});

test('선생님: 기록 없음, aiLeft 없음, 한도와 상관없이 됨', { skip }, async () => {
  const { db, call, t, ask } = await setup({ AI_DAILY_LIMIT: '1' });
  assert.equal('aiLeft' in (await call(t, 'GET', '/api/me')).data.config, false);
  fakeGemini();
  for (let i = 0; i < 3; i++) {
    const res = await ask(t);
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { text: '안녕하세요' });
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get().n, 0);
});

test('날짜 바뀜: 어제 30번이어도 오늘은 새로 1, 7일 지난 기록은 셀 때 지움', { skip }, async () => {
  const { s, ask, count, setCount } = await setup();
  setCount(30, addDays(today, -1));
  setCount(4, addDays(today, -8));
  fakeGemini();
  const res = await ask(s);
  assert.equal(res.status, 200);
  assert.equal(res.data.aiLeft, 29);
  assert.equal(count(), 1);
  assert.equal(count(addDays(today, -1)), 30);
  assert.equal(count(addDays(today, -8)), undefined);
});

test('한도 값이 없거나 숫자가 아니면 30', () => {
  assert.equal(aiLimit({}), 30);
  assert.equal(aiLimit({ AI_DAILY_LIMIT: 'abc' }), 30);
  assert.equal(aiLimit({ AI_DAILY_LIMIT: '0' }), 30);
  assert.equal(aiLimit({ AI_DAILY_LIMIT: '12' }), 12);
});

test('ai_usage 표가 아직 없어도 /api/me는 200, aiLeft 없음', { skip }, async () => {
  const { db, call, s } = await setup();
  db.exec('DROP TABLE ai_usage');
  const res = await call(s, 'GET', '/api/me');
  assert.equal(res.status, 200);
  assert.equal('aiLeft' in res.data.config, false);
});

test('학생 계정을 지우면 그 학생 AI 기록도 지움', { skip }, async () => {
  const { t, call, count, setCount } = await setup();
  setCount(3);
  assert.equal((await call(t, 'DELETE', '/api/users/s1')).status, 200);
  assert.equal(count(), undefined);
});
