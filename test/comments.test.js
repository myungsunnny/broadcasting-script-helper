// 검토 댓글(src/comments.js + index.js 경로) 시험: npm test
// board.sql.test.js처럼 node:sqlite(메모리 DB)에 schema.sql을 올리고 D1 모양 어댑터로 감싼 뒤,
// 실제 Worker fetch로 로그인 쿠키를 받아 권한·자르기·반영·삭제 batch·목록 수·홈 할 일을 확인한다.
// node:sqlite가 없는 Node(플래그가 필요한 버전)에서는 건너뛴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../src/index.js';
import { hashPassword } from '../src/auth.js';
import { todayKST, addDays } from '../src/dates.js';

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

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const hash = await hashPassword('1234');
  const user = db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES (?, ?, ?, ?, 0, 1, '2026-01-01 00:00:00')");
  user.run('s1', 'ise', '이서', hash);
  user.run('s2', 'haneul', '박하늘', hash);
  const script = db.prepare(`INSERT INTO scripts (id, broadcast_date, title, announcers, status, created_by, created_at, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, '2026-11-01 09:00:00', ?, '2026-11-01 09:00:00')`);
  script.run('mine', addDays(today, 3), '내 대본', '이서', '검토요청', '박하늘', '박하늘');
  script.run('draft', addDays(today, 1), '작성 중', '', '작성중', '이서', '이서');
  script.run('done', addDays(today, 2), '완료 대본', '이서', '완료', '이서', '이서');
  script.run('other', addDays(today, 1), '남의 대본', '김방송', '검토요청', '김방송', '김방송');
  const env = { DB: d1(db), TEACHER_PASSWORD: 'teach', SESSION_SECRET: 'test-secret', ASSETS: { fetch: () => new Response('') } };

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
  const s2 = await loginAs('haneul', '1234');
  const count = (sql, ...args) => Number(db.prepare(sql).get(...args).n);
  return { db, env, call, t, s, s2, count };
}

test('선생님 의견 남기기: 201, 1000자 자르기, 대본 상태는 그대로', { skip }, async () => {
  const { call, t, db } = await setup();
  const r = await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '  행사 날짜를 다시 확인해요.\n둘째 줄  ' });
  assert.equal(r.status, 201);
  assert.equal(r.data.section, 'events');
  assert.equal(r.data.body, '행사 날짜를 다시 확인해요.\n둘째 줄');
  assert.equal(r.data.created_by, '김선생');
  assert.equal(r.data.resolved_by, '');
  const long = await call(t, 'POST', '/api/scripts/mine/comments', { section: 'greeting', body: '가'.repeat(1500) });
  assert.equal(long.data.body.length, 1000);
  assert.equal(db.prepare("SELECT status FROM scripts WHERE id = 'mine'").get().status, '검토요청');
});

test('의견 남기기 오류: 학생 403, 없는 대본 404, 구성 틀림·빈 본문 400', { skip }, async () => {
  const { call, t, s, count } = await setup();
  assert.equal((await call(s, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '학생 의견' })).status, 403);
  assert.equal((await call(t, 'POST', '/api/scripts/nope/comments', { section: 'events', body: '의견' })).status, 404);
  assert.equal((await call(t, 'POST', '/api/scripts/mine/comments', { section: 'memo', body: '의견' })).status, 400);
  assert.equal((await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '   ' })).status, 400);
  assert.equal((await call(t, 'GET', '/api/scripts/nope/comments')).status, 404);
  assert.equal(count('SELECT COUNT(*) AS n FROM script_comments'), 0);
  assert.equal((await call('', 'GET', '/api/scripts/mine/comments')).status, 401);
});

test('반영했어요: 학생 이름 기록, 다시 눌러도 처음 기록 그대로, 완료 대본도 됨, 없는 댓글 404', { skip }, async () => {
  const { call, t, s, s2 } = await setup();
  const c = (await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '고쳐요' })).data;
  const r1 = await call(s, 'POST', `/api/comments/${c.id}/resolve`);
  assert.equal(r1.status, 200);
  assert.equal(r1.data.resolved_by, '이서');
  assert.ok(r1.data.resolved_at);
  const r2 = await call(s2, 'POST', `/api/comments/${c.id}/resolve`);
  assert.equal(r2.status, 200);
  assert.equal(r2.data.resolved_by, '이서');
  assert.equal(r2.data.resolved_at, r1.data.resolved_at);

  const d = (await call(t, 'POST', '/api/scripts/done/comments', { section: 'closing', body: '완료 대본 의견' })).data;
  assert.equal((await call(s, 'POST', `/api/comments/${d.id}/resolve`)).data.resolved_by, '이서');
  assert.equal((await call(s, 'POST', '/api/comments/nope/resolve')).status, 404);
});

test('목록 순서: 반영 안 된 것 먼저(오래된 순), 반영한 것은 뒤', { skip }, async () => {
  const { call, t, s, db } = await setup();
  const ins = db.prepare("INSERT INTO script_comments (id, script_id, section, body, created_by, created_at, resolved_by) VALUES (?, 'mine', 'events', 'x', '김선생', ?, ?)");
  ins.run('a', '2026-11-01 09:00:00', '이서');
  ins.run('b', '2026-11-01 10:00:00', '');
  ins.run('c', '2026-11-01 08:00:00', '');
  const r = await call(s, 'GET', '/api/scripts/mine/comments');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.map(c => c.id), ['c', 'b', 'a']);
  assert.equal((await call(t, 'GET', '/api/scripts/mine/comments')).data.length, 3);
});

test('지우기: 학생 403, 선생님은 지움, 없는 댓글 404', { skip }, async () => {
  const { call, t, s, count } = await setup();
  const c = (await call(t, 'POST', '/api/scripts/mine/comments', { section: 'idiom', body: '뜻을 쉽게' })).data;
  assert.equal((await call(s, 'DELETE', `/api/comments/${c.id}`)).status, 403);
  assert.equal(count('SELECT COUNT(*) AS n FROM script_comments'), 1);
  assert.equal((await call(t, 'DELETE', `/api/comments/${c.id}`)).status, 200);
  assert.equal(count('SELECT COUNT(*) AS n FROM script_comments'), 0);
  assert.equal((await call(t, 'DELETE', `/api/comments/${c.id}`)).status, 404);
});

test('대본 삭제: 그 대본 댓글만 같이 지워짐', { skip }, async () => {
  const { call, t, count } = await setup();
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '하나' });
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'special', body: '둘' });
  await call(t, 'POST', '/api/scripts/other/comments', { section: 'events', body: '남의 것' });
  assert.equal((await call(t, 'DELETE', '/api/scripts/mine')).status, 200);
  assert.equal(count("SELECT COUNT(*) AS n FROM script_comments WHERE script_id = 'mine'"), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM script_comments WHERE script_id = 'other'"), 1);
});

test('대본 목록: 줄마다 open_comments (반영 안 된 수만)', { skip }, async () => {
  const { call, t, s } = await setup();
  const a = (await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '하나' })).data;
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'special', body: '둘' });
  await call(s, 'POST', `/api/comments/${a.id}/resolve`);
  const list = (await call(s, 'GET', '/api/scripts')).data;
  const by = Object.fromEntries(list.map(r => [r.id, r.open_comments]));
  assert.deepEqual(by, { mine: 1, draft: 0, done: 0, other: 0 });
  // 검색·상태 거르기와 함께 써도 그대로
  const filtered = (await call(s, 'GET', '/api/scripts?status=' + encodeURIComponent('검토요청') + '&q=' + encodeURIComponent('내'))).data;
  assert.deepEqual(filtered.map(r => [r.id, r.open_comments]), [['mine', 1]]);
});

test('홈 할 일: 내 대본의 반영 안 된 의견이 맨 위, 남의 대본·완료 대본은 안 나옴, 반영하면 사라짐', { skip }, async () => {
  const { call, t, s } = await setup();
  const c1 = (await call(t, 'POST', '/api/scripts/mine/comments', { section: 'special', body: '하나' })).data;
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '둘' });
  await call(t, 'POST', '/api/scripts/draft/comments', { section: 'closing', body: '작성중 대본 의견' });
  await call(t, 'POST', '/api/scripts/done/comments', { section: 'events', body: '완료 대본' });
  await call(t, 'POST', '/api/scripts/other/comments', { section: 'events', body: '남의 대본' });

  const home = (await call(s, 'GET', '/api/home')).data;
  const rows = home.todo.map(x => [x.kind, x.id, x.count, x.section]);
  // 방송일 순: draft(내일) → mine(3일 뒤). draft의 '마저 쓰기' 줄은 겹치지 않게 빠짐.
  assert.deepEqual(rows, [['comments', 'draft', 1, 'closing'], ['comments', 'mine', 2, 'events']]);

  await call(s, 'POST', `/api/comments/${c1.id}/resolve`);
  const after = (await call(s, 'GET', '/api/home')).data;
  assert.deepEqual(after.todo.find(x => x.id === 'mine'), {
    kind: 'comments', id: 'mine', date: addDays(today, 3), time: '', title: '내 대본', status: '검토요청', count: 1, section: 'events'
  });
  const teacherHome = (await call(t, 'GET', '/api/home')).data;
  assert.deepEqual(teacherHome.todo, []);
});

test('홈 할 일: 방송일이 지난 대본(완료 아님)의 의견은 안 나옴', { skip }, async () => {
  const { call, t, s, db } = await setup();
  db.prepare(`INSERT INTO scripts (id, broadcast_date, title, announcers, status, created_by, created_at, updated_by, updated_at)
    VALUES ('past', ?, '지난 대본', '이서', '검토요청', '이서', '2026-01-01 09:00:00', '이서', '2026-01-01 09:00:00')`).run(addDays(today, -7));
  await call(t, 'POST', '/api/scripts/past/comments', { section: 'events', body: '지난 의견' });
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '이번 의견' });
  const home = (await call(s, 'GET', '/api/home')).data;
  assert.equal(home.todo.some(x => x.id === 'past'), false);
  assert.deepEqual(home.todo.filter(x => x.kind === 'comments').map(x => x.id), ['mine']);
});
