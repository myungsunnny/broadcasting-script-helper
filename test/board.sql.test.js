// 게시판 SQL을 진짜 SQLite로 돌려 보는 시험: npm test
// node:sqlite(메모리 DB)에 schema.sql을 올리고, D1처럼 생긴 작은 어댑터(prepare/bind/first/all/run/batch)로 감싼다.
// 가짜 행으로는 못 잡는 SQL 실수(읽음 판정, 사용 중인 학생만 세기, 더 보기 비교)를 확인한다.
// node:sqlite가 없는 Node(플래그가 필요한 버전)에서는 건너뛴다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { listPosts, getPost } from '../src/board.js';
import { getHome } from '../src/home.js';

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

const teacher = { name: '김선생', role: 'teacher' };
const s1 = { name: '이서', role: 'student', uid: 's1' };
const s2 = { name: '박하늘', role: 'student', uid: 's2' };

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const user = db.prepare("INSERT INTO users (id, login_id, name, password_hash, must_change, active, created_at) VALUES (?, ?, ?, 'x', 0, ?, '2026-01-01 00:00:00')");
  user.run('s1', 's1', '이서', 1);
  user.run('s2', 's2', '박하늘', 1);
  user.run('s3', 's3', '그만둔학생', 0); // 사용 중지: 읽어도 세지 않음
  const post = db.prepare(`INSERT INTO posts (id, kind, title, body, pinned, created_by, created_by_uid, created_at, updated_by, updated_at)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`);
  const add = (id, kind, pinned, at, by = '김선생', uid = '') => post.run(id, kind, '글 ' + id, pinned, by, uid, at, by, at);
  // 고정 아닌 글 22개: p00(가장 오래됨) ~ p21(최신). p01과 p02는 같은 시각(정렬 경계 19/20번째에 걸림)
  for (let i = 0; i < 22; i++) {
    const min = i === 1 ? 2 : i;
    const kind = i % 2 ? 'notice' : 'memo';
    add('p' + String(i).padStart(2, '0'), kind, 0, `2026-10-01 09:${String(min).padStart(2, '0')}:00`,
      kind === 'memo' ? '이서' : '김선생', kind === 'memo' ? 's1' : '');
  }
  add('pin', 'notice', 1, '2026-09-01 09:00:00');
  const read = db.prepare("INSERT INTO post_reads (post_id, user_uid, read_at) VALUES (?, ?, '2026-10-02 09:00:00')");
  read.run('pin', 's1');
  read.run('pin', 's3');
  read.run('p21', 's1');
  return { DB: d1(db) };
}

test('학생 unread는 내 읽음 기록만 본다', { skip }, async () => {
  const env = setup();
  const mine = await listPosts(env, s1, {});
  const other = await listPosts(env, s2, {});
  const pick = (list, id) => list.posts.find(p => p.id === id);
  assert.equal(pick(mine, 'pin').unread, false);
  assert.equal(pick(other, 'pin').unread, true);
  assert.equal(pick(mine, 'p21').unread, false);
  assert.equal(pick(mine, 'p19').unread, true);
  assert.equal('unread' in pick(mine, 'p20'), false); // 메모
});

test('선생님 readCount·total은 사용 중인 학생만 센다', { skip }, async () => {
  const env = setup();
  const { posts } = await listPosts(env, teacher, {});
  const pin = posts.find(p => p.id === 'pin');
  assert.deepEqual([pin.readCount, pin.total], [1, 2]); // s3(사용 중지)의 읽음은 빠짐
  const one = await getPost(env, teacher, 'pin');
  assert.deepEqual([one.readCount, one.total], [1, 2]);
});

test('첫 쪽은 고정 먼저 + 20개, before로 이어 받으면 빠짐·겹침 없음 (같은 시각 포함)', { skip }, async () => {
  const env = setup();
  const first = await listPosts(env, s1, {});
  assert.equal(first.posts[0].id, 'pin');
  const rest1 = first.posts.filter(p => !p.pinned);
  assert.equal(rest1.length, 20);
  assert.equal(first.more, true);
  assert.equal(rest1.at(-1).id, 'p02'); // 같은 시각인 p02/p01 중 id 큰 쪽이 먼저
  const second = await listPosts(env, s1, { before: rest1.at(-1).id });
  assert.deepEqual(second.posts.map(p => p.id), ['p01', 'p00']);
  assert.equal(second.more, false);
  const all = [...rest1, ...second.posts].map(p => p.id);
  assert.equal(new Set(all).size, 22);
});

test('홈 새 공지에는 공지만 (메모 제외), 고정 먼저', { skip }, async () => {
  const env = setup();
  const home = await getHome(env, s2);
  assert.ok(home.notices.length > 0);
  assert.ok(home.notices.every(n => n.kind === 'notice'));
  assert.deepEqual(home.notices.map(n => n.id), ['pin', 'p21', 'p19', 'p17']);
  assert.ok(home.todo.some(t => t.kind === 'notice' && t.id === 'pin')); // s2는 고정 공지를 안 읽음
});
