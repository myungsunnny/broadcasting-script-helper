// 알림(src/notify.js + 원인 동작 연결 + /api/notifications*) 시험: npm test
// comments.test.js처럼 node:sqlite(메모리 DB)에 schema.sql을 올리고 D1 모양 어댑터로 감싼 뒤,
// 실제 Worker fetch로 받는 사람, 읽음(내 것만), 모두 읽음, 90일 정리, 지울 때 함께 지움을 확인한다.
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
const date = addDays(today, 3);
const md = d => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const hash = await hashPassword('1234');
  const user = db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES (?, ?, ?, ?, 0, ?, '2026-01-01 00:00:00')");
  user.run('s1', 'ise', '이서', hash, 1);
  user.run('s2', 'haneul', '박하늘', hash, 1);
  user.run('s3', 'off', '쉬는학생', hash, 0); // 사용 중지
  db.prepare(`INSERT INTO scripts (id, broadcast_date, title, announcers, status, created_by, created_at, updated_by, updated_at)
    VALUES ('mine', ?, '학교 소식', '이서', '작성중', '박하늘', '2026-11-01 09:00:00', '박하늘', '2026-11-01 09:00:00')`).run(date);
  db.prepare(`INSERT INTO scripts (id, broadcast_date, title, announcers, status, created_by, created_at, updated_by, updated_at)
    VALUES ('nobody', ?, '', '김방송', '작성중', '김방송', '2026-11-01 09:00:00', '김방송', '2026-11-01 09:00:00')`).run(date);
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
  const t2 = await loginAs('박선생', 'teach');
  const s = await loginAs('ise', '1234');
  const s2 = await loginAs('haneul', '1234');
  const rows = (where = '1=1', ...args) => plain(db.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY id`).all(...args));
  const script = async (cookie, id) => (await call(cookie, 'GET', '/api/scripts/' + id)).data;
  const save = async (cookie, id, patch) => {
    const cur = await script(cookie, id);
    return call(cookie, 'PUT', '/api/scripts/' + id, { ...cur, ...patch, base_updated_at: cur.updated_at });
  };
  return { db, call, t, t2, s, s2, rows, save };
}

test('새 공지: 사용 중인 학생마다 notice 알림, 배지 +1, 메모는 알림 없음', { skip }, async () => {
  const { call, t, s, s2, rows } = await setup();
  const p = (await call(t, 'POST', '/api/posts', { kind: 'notice', title: '리허설 안내' })).data;
  assert.deepEqual(rows().map(r => [r.recipient, r.kind, r.ref_id, r.text]), [
    ['s1', 'notice', p.id, '새 공지: 리허설 안내'], ['s2', 'notice', p.id, '새 공지: 리허설 안내']
  ]);
  assert.deepEqual((await call(s, 'GET', '/api/notifications/count')).data, { unread: 1 });
  await call(s2, 'POST', '/api/posts', { kind: 'memo', title: '케이블' });
  assert.equal(rows().length, 2);
  // 선생님은 공지 알림을 받지 않는다
  assert.deepEqual((await call(t, 'GET', '/api/notifications/count')).data, { unread: 0 });
});

test('의견: 그 대본 내 대본 학생에게 comment(ref_date=구성), 해당 학생 없으면 알림 없음', { skip }, async () => {
  const { call, t, rows } = await setup();
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '날짜 확인' });
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'closing', body: '끝인사' });
  const r = rows();
  // 만든 사람 박하늘(s2) + 아나운서 이서(s1), 의견 하나에 알림 하나
  assert.deepEqual(r.map(x => [x.recipient, x.kind, x.ref_id, x.ref_date]).sort(), [
    ['s1', 'comment', 'mine', 'closing'], ['s1', 'comment', 'mine', 'events'],
    ['s2', 'comment', 'mine', 'closing'], ['s2', 'comment', 'mine', 'events']
  ]);
  assert.ok(r.some(x => x.text === `${md(date)} 대본에 선생님 의견이 달렸어요 (학교 행사)`));
  await call(t, 'POST', '/api/scripts/nobody/comments', { section: 'events', body: '아무도 없음' });
  assert.equal(rows().length, 4);
});

test('검토 요청: 학생이 바꾸면 teacher review, 선생님이 바꾸면 없음, 학생이 검토요청으로 새로 만들어도 review', { skip }, async () => {
  const { call, t, t2, s, rows, save } = await setup();
  assert.equal((await save(s, 'mine', { status: '검토요청' })).status, 200);
  assert.deepEqual(rows().map(r => [r.recipient, r.kind, r.ref_id]), [['teacher', 'review', 'mine']]);
  await save(s, 'mine', { title: '그대로 검토요청' }); // 상태 그대로면 다시 안 감
  assert.equal(rows().length, 1);
  await save(t, 'nobody', { status: '검토요청' });
  assert.equal(rows().length, 1);
  const created = (await call(s, 'POST', '/api/scripts', { broadcast_date: date, status: '검토요청', title: '새 대본' })).data;
  assert.deepEqual(rows("ref_id = ?", created.id).map(r => r.kind), ['review']);
  // 교사 공용: 다른 선생님도 같은 알림을 보고, 한 명이 읽으면 함께 읽음
  const list = (await call(t2, 'GET', '/api/notifications')).data;
  assert.equal(list.unread, 2);
  await call(t, 'POST', `/api/notifications/${list.items[0].id}/read`);
  assert.equal((await call(t2, 'GET', '/api/notifications/count')).data.unread, 1);
});

test('완료: 내 대본 학생에게 done, 이미 완료면 없음', { skip }, async () => {
  const { t, rows, save } = await setup();
  await save(t, 'mine', { status: '완료' });
  assert.deepEqual(rows().map(r => [r.recipient, r.kind, r.text]).sort(), [
    ['s1', 'done', `${md(date)} 대본이 완료되었어요 (학교 소식)`], ['s2', 'done', `${md(date)} 대본이 완료되었어요 (학교 소식)`]
  ]);
  await save(t, 'mine', { memo: '다시 저장' });
  assert.equal(rows().length, 2);
});

test('일정: 새 members 학생에게 calendar(본인 제외), 원래 있던 이름은 다시 안 감', { skip }, async () => {
  const { call, s, t, rows } = await setup();
  const e = (await call(s, 'POST', '/api/calendar', { date, title: '연습', category: '연습', members: ['이서', '박하늘', '쉬는학생', '없는이름'] })).data;
  assert.deepEqual(rows().map(r => [r.recipient, r.kind, r.ref_id, r.ref_date, r.text]), [
    ['s2', 'calendar', e.id, date, `이서님이 ${md(date)} 연습 일정에 나를 넣었어요`]
  ]);
  await call(t, 'PUT', '/api/calendar/' + e.id, { ...e, members: ['박하늘'] });
  assert.equal(rows().length, 1);
  await call(t, 'PUT', '/api/calendar/' + e.id, { ...e, members: ['박하늘', '이서'] });
  assert.deepEqual(rows().map(r => r.recipient), ['s2', 's1']);
  assert.match(rows().at(-1).text, /^김선생 선생님이/);
  const moved = addDays(date, 1);
  await call(t, 'PUT', '/api/calendar/' + e.id, { ...e, date: moved, members: ['박하늘', '이서'] });
  assert.deepEqual(rows().map(r => r.ref_date), [moved, moved]); // 날짜를 옮기면 알림도 새 날짜로 열림
});

test('목록·읽음·모두 읽음: 내 것만, 남의 알림은 그대로 200, 로그인 안 하면 401', { skip }, async () => {
  const { call, t, s, s2, rows } = await setup();
  await call(t, 'POST', '/api/posts', { kind: 'notice', title: '하나' });
  await call(t, 'POST', '/api/posts', { kind: 'notice', title: '둘' });
  const list = (await call(s, 'GET', '/api/notifications')).data;
  assert.deepEqual(Object.keys(list).sort(), ['items', 'now', 'unread']);
  assert.equal(list.unread, 2);
  assert.deepEqual(list.items.map(i => i.text), ['새 공지: 둘', '새 공지: 하나']); // 최신 먼저
  assert.ok(list.items.every(i => rows('id = ?', i.id)[0].recipient === 's1'));

  const theirs = rows("recipient = 's2'")[0];
  assert.equal((await call(s, 'POST', `/api/notifications/${theirs.id}/read`)).status, 200);
  assert.equal(rows('id = ?', theirs.id)[0].read_at, '');

  assert.equal((await call(s, 'POST', `/api/notifications/${list.items[0].id}/read`)).status, 200);
  assert.notEqual(rows('id = ?', list.items[0].id)[0].read_at, '');
  assert.equal((await call(s, 'GET', '/api/notifications/count')).data.unread, 1);

  assert.equal((await call(s, 'POST', '/api/notifications/read-all')).status, 200);
  assert.equal((await call(s, 'GET', '/api/notifications/count')).data.unread, 0);
  assert.equal((await call(s2, 'GET', '/api/notifications/count')).data.unread, 2);

  assert.equal((await call('', 'GET', '/api/notifications')).status, 401);
  assert.equal((await call('', 'POST', '/api/notifications/read-all')).status, 401);
});

test('목록은 최근 90일·최신 50개, 알림을 넣을 때 90일 지난 행 삭제', { skip }, async () => {
  const { db, call, t, s, rows } = await setup();
  const ins = db.prepare("INSERT INTO notifications (recipient, kind, ref_id, text, created_at) VALUES ('s1', 'notice', 'x', ?, ?)");
  ins.run('오래됨', addDays(today, -91) + ' 09:00:00');
  for (let i = 0; i < 55; i++) ins.run('최근 ' + i, today + ' 00:00:00');
  const list = (await call(s, 'GET', '/api/notifications')).data;
  assert.equal(list.items.length, 50);
  assert.equal(list.items.some(i => i.text === '오래됨'), false);
  assert.equal(list.unread, 55);
  await call(t, 'POST', '/api/posts', { kind: 'notice', title: '정리' });
  assert.equal(rows("text = '오래됨'").length, 0);
});

test('지우기: 공지·대본·일정·학생 계정을 지우면 그 알림도 지움', { skip }, async () => {
  const { call, t, s, rows } = await setup();
  const p = (await call(t, 'POST', '/api/posts', { kind: 'notice', title: '지울 공지' })).data;
  await call(t, 'POST', '/api/scripts/mine/comments', { section: 'events', body: '의견' });
  const e = (await call(s, 'POST', '/api/calendar', { date, title: '회의', members: ['박하늘'] })).data;
  assert.equal(rows().length, 5);
  await call(t, 'DELETE', '/api/posts/' + p.id);
  assert.equal(rows('ref_id = ?', p.id).length, 0);
  await call(t, 'DELETE', '/api/scripts/mine');
  assert.equal(rows("ref_id = 'mine'").length, 0);
  await call(t, 'DELETE', '/api/calendar/' + e.id);
  assert.equal(rows().length, 0);
  await call(t, 'POST', '/api/posts', { kind: 'notice', title: '다시' });
  await call(t, 'DELETE', '/api/users/s1');
  assert.deepEqual(rows().map(r => r.recipient), ['s2']);
});
