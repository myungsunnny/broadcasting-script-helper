// 아침방송 담당 지정(PUT /api/calendar/morning + 아침방송 일정 권한) 시험: npm test
// notify.test.js처럼 node:sqlite(메모리 DB) + D1 모양 어댑터 + 실제 Worker fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';
import { todayKST, addDays, toDate } from '../src/dates.js';

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

// 다음 주 월요일
const mon = addDays(todayKST(), 8 - (toDate(todayKST()).getUTCDay() || 7));
const tue = addDays(mon, 1);

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const hash = await hashPassword('1234');
  const user = db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES (?, ?, ?, ?, 0, 1, '2026-01-01 00:00:00')");
  user.run('s1', 'ise', '이서', hash);
  user.run('s2', 'haneul', '박하늘', hash);
  const env = { DB: d1(db), TEACHER_PASSWORD: 'teach', SESSION_SECRET: 'test-secret', ASSETS: { fetch: () => new Response('') } };
  const call = async (cookie, method, path, body) => {
    const res = await worker.fetch(new Request('https://x.test' + path, {
      method, headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env);
    return { status: res.status, data: await res.json() };
  };
  const loginAs = async (name, password) => {
    const res = await worker.fetch(new Request('https://x.test/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, password })
    }), env);
    return res.headers.get('Set-Cookie').split(';')[0];
  };
  const t = await loginAs('김선생', 'teach');
  const s = await loginAs('ise', '1234');
  const events = () => plain(db.prepare("SELECT * FROM calendar_events WHERE category = '아침방송' ORDER BY date").all());
  const notes = () => plain(db.prepare('SELECT * FROM notifications ORDER BY id').all());
  const put = (cookie, duty, start = mon) => call(cookie, 'PUT', '/api/calendar/morning', { start, duty });
  return { db, call, t, s, events, notes, put };
}

test('새로 정함: 날마다 일정 1개, 그 학생에게 calendar 알림', { skip }, async () => {
  const { t, events, notes, put } = await setup();
  const r = await put(t, { [mon]: '이서', [tue]: '박하늘' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map(e => [e.date, e.title, e.members]), [[mon, '아침방송', ['이서']], [tue, '아침방송', ['박하늘']]]);
  assert.equal(events().length, 2);
  assert.deepEqual(notes().map(n => [n.recipient, n.kind, n.ref_date]), [['s1', 'calendar', mon], ['s2', 'calendar', tue]]);
});

test('바꿈: members만 바뀌고 새 학생에게만 알림, 그대로면 알림 없음', { skip }, async () => {
  const { t, events, notes, put } = await setup();
  await put(t, { [mon]: '이서' });
  const id = events()[0].id;
  await put(t, { [mon]: '이서' });
  assert.equal(notes().length, 1);
  await put(t, { [mon]: '박하늘' });
  assert.deepEqual(events().map(e => [e.id, e.members]), [[id, '["박하늘"]']]);
  assert.deepEqual(notes().map(n => n.recipient), ['s1', 's2']);
});

test('비움: 그날 아침방송 일정과 알림 삭제, 다른 날은 그대로', { skip }, async () => {
  const { t, events, notes, put } = await setup();
  await put(t, { [mon]: '이서', [tue]: '박하늘' });
  await put(t, { [mon]: '' });
  assert.deepEqual(events().map(e => e.date), [tue]);
  assert.deepEqual(notes().map(n => n.recipient), ['s2']);
});

test('학생은 담당 지정·아침방송 일정 만들기·고치기·지우기 모두 403', { skip }, async () => {
  const { call, t, s, events, put } = await setup();
  const msg = '아침방송 담당은 선생님만 정할 수 있어요.';
  assert.deepEqual(await put(s, { [mon]: '이서' }), { status: 403, data: { error: msg } });
  assert.equal((await call(s, 'POST', '/api/calendar', { date: mon, title: '아침방송', category: '아침방송' })).status, 403);
  await put(t, { [mon]: '이서' });
  const e = events()[0];
  const ev = { ...e, members: ['이서'] };
  assert.equal((await call(s, 'PUT', '/api/calendar/' + e.id, { ...ev, category: '연습' })).status, 403);
  assert.equal((await call(s, 'DELETE', '/api/calendar/' + e.id)).status, 403);
  // 보통 일정을 아침방송으로 바꾸기도 막힘
  const other = (await call(s, 'POST', '/api/calendar', { date: mon, title: '연습', category: '연습' })).data;
  assert.equal((await call(s, 'PUT', '/api/calendar/' + other.id, { ...other, category: '아침방송' })).status, 403);
  assert.equal(events().length, 1);
});

test('잘못된 주: 월요일 아님, 날짜 아님, 그 주 월~금 밖이면 400', { skip }, async () => {
  const { t, events, put } = await setup();
  assert.equal((await put(t, { [tue]: '이서' }, tue)).status, 400);
  assert.equal((await put(t, {}, 'abc')).status, 400);
  assert.equal((await put(t, { [addDays(mon, 5)]: '이서' })).status, 400);
  assert.equal((await put(t, { [mon]: '이서', [addDays(mon, -1)]: '박하늘' })).status, 400);
  assert.equal(events().length, 0);
});
