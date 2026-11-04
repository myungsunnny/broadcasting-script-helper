// 게시판(src/board.js) 시험: npm test
// home.test.js처럼 D1 대신 SQL 문장을 보고 정해 둔 행을 돌려주는 가짜 env.DB를 쓴다.
// 권한, 고정 3개, 글자 자르기, 지우기 batch, 목록 쪽 나누기, 읽음 명단 정리를 확인한다.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardError, listPosts, getPost, createPost, updatePost, deletePost, markRead, postReads, canEdit, canDelete } from '../src/board.js';
import { deleteUser } from '../src/users.js';

const teacher = { name: '김선생', role: 'teacher' };
const student = { name: '이서', role: 'student', uid: 'u1' };
const other = { name: '박하늘', role: 'student', uid: 'u2' };

const post = (id, extra = {}) => ({
  id, kind: 'memo', title: '글 ' + id, body: '', pinned: 0, created_by: '이서', created_by_uid: 'u1',
  created_at: '2026-11-01 09:00:00', updated_by: '이서', updated_at: '2026-11-01 09:00:00', ...extra
});
const teacherNotice = (id, extra = {}) => post(id, { kind: 'notice', created_by: '김선생', created_by_uid: '', ...extra });

/**
 * handler(sql, args) → 행 배열. 실행한 문장은 env.executed에, batch 하나는 env.batches에 남는다.
 * 기본: 'SELECT * FROM posts WHERE id = ?' 는 rows.posts에서 id로 찾는다.
 */
function fakeEnv(handler = () => [], posts = []) {
  const executed = [];
  const batches = [];
  const rowsFor = (sql, args) => {
    if (sql.startsWith('SELECT * FROM posts WHERE id = ?') || sql.startsWith('SELECT id, created_at FROM posts WHERE id = ?')) {
      return posts.filter(p => p.id === args[0]);
    }
    return handler(sql, args) || [];
  };
  const stmt = (sql, args) => ({
    sql, args,
    first: async () => { executed.push({ sql, args }); return rowsFor(sql, args)[0] ?? null; },
    all: async () => { executed.push({ sql, args }); return { results: rowsFor(sql, args) }; },
    run: async () => { executed.push({ sql, args }); return {}; }
  });
  return {
    executed, batches,
    DB: {
      prepare: sql => ({ ...stmt(sql, []), bind: (...args) => stmt(sql, args) }),
      batch: async stmts => {
        batches.push(stmts.map(s => ({ sql: s.sql, args: s.args })));
        return stmts.map(s => { executed.push({ sql: s.sql, args: s.args }); return { results: rowsFor(s.sql, s.args) }; });
      }
    }
  };
}

async function rejects(promise, status, message) {
  await assert.rejects(promise, err => {
    assert.ok(err instanceof BoardError, 'BoardError여야 해요: ' + err);
    assert.equal(err.status, status);
    if (message) assert.equal(err.message, message);
    return true;
  });
}

const inserts = env => env.executed.filter(e => e.sql.includes('INSERT INTO posts'));

/* ── 쓰기 ── */

test('학생이 공지를 쓰면 403, 메모는 쓸 수 있음', async () => {
  const env = fakeEnv();
  await rejects(createPost(env, student, { kind: 'notice', title: '공지' }), 403);
  assert.equal(inserts(env).length, 0);

  const env2 = fakeEnv((sql, args) => sql.includes('WHERE p.id = ?') ? [post(args.at(-1), { unread: 1 })] : []);
  const memo = await createPost(env2, student, { kind: 'memo', title: '케이블 위치', body: '서랍 안' });
  const ins = inserts(env2)[0];
  assert.equal(ins.args[1], 'memo');
  assert.equal(ins.args[6], 'u1'); // created_by_uid
  assert.equal(memo.canEdit, true);
  assert.equal('unread' in memo, false); // 메모에는 읽음 표시 없음
});

test('제목 60자·본문 2000자로 자르고, 빈 제목은 400, 잘못된 종류는 400', async () => {
  const env = fakeEnv((sql, args) => sql.includes('WHERE p.id = ?') ? [teacherNotice(args.at(-1))] : []);
  await createPost(env, teacher, { kind: 'notice', title: '  ' + 'ㄱ'.repeat(80) + '  ', body: '가\n'.repeat(1500) });
  const [, , title, body, pinned, by, uid] = inserts(env)[0].args;
  assert.equal(title.length, 60);
  assert.equal(body.length, 2000);
  assert.ok(body.includes('\n')); // 줄바꿈 유지
  assert.equal(pinned, 0);
  assert.equal(by, '김선생');
  assert.equal(uid, '');

  await rejects(createPost(fakeEnv(), teacher, { kind: 'notice', title: '   ' }), 400, '제목을 써 주세요.');
  await rejects(createPost(fakeEnv(), student, { kind: 'diary', title: '제목' }), 400);
});

test('고정은 공지만, 4번째 고정은 400 "고정 공지는 3개까지예요."', async () => {
  const pinnedCount = n => (sql, args) => {
    if (sql.includes('COUNT(*) AS n FROM posts WHERE pinned = 1')) return [{ n }];
    if (sql.includes('WHERE p.id = ?')) return [teacherNotice(args.at(-1), { pinned: 1 })];
    return [];
  };
  const full = fakeEnv(pinnedCount(3));
  await rejects(createPost(full, teacher, { kind: 'notice', title: '네 번째', pinned: true }), 400, '고정 공지는 3개까지예요.');
  assert.equal(inserts(full).length, 0);

  const ok = fakeEnv(pinnedCount(2));
  await createPost(ok, teacher, { kind: 'notice', title: '세 번째', pinned: true });
  assert.equal(inserts(ok)[0].args[4], 1);

  // 메모는 고정을 보내도 고정되지 않는다 (개수도 세지 않음)
  const memo = fakeEnv(pinnedCount(3));
  await createPost(memo, teacher, { kind: 'memo', title: '선생님 메모', pinned: true });
  assert.equal(inserts(memo)[0].args[4], 0);
});

/* ── 고치기·지우기 권한 ── */

test('권한 표: 선생님은 선생님 글만 고침, 아무 글이나 지움 / 학생은 자기 메모만', () => {
  const myMemo = post('m1');
  const otherMemo = post('m2', { created_by: '박하늘', created_by_uid: 'u2' });
  const tMemo = post('m3', { created_by: '김선생', created_by_uid: '' });
  const notice = teacherNotice('n1');
  assert.deepEqual([myMemo, otherMemo, tMemo, notice].map(p => [canEdit(p, teacher), canDelete(p, teacher)]),
    [[false, true], [false, true], [true, true], [true, true]]);
  assert.deepEqual([myMemo, otherMemo, tMemo, notice].map(p => [canEdit(p, student), canDelete(p, student)]),
    [[true, true], [false, false], [false, false], [false, false]]);
});

test('남의 메모를 고치거나 지우면 403, 선생님도 학생 메모는 못 고침', async () => {
  const posts = [post('m1')];
  await rejects(updatePost(fakeEnv(() => [], posts), other, 'm1', { title: '바꿈' }), 403);
  await rejects(deletePost(fakeEnv(() => [], posts), other, 'm1'), 403);
  await rejects(updatePost(fakeEnv(() => [], posts), teacher, 'm1', { title: '바꿈' }), 403);
  await rejects(updatePost(fakeEnv(), teacher, 'none', { title: '바꿈' }), 404);
});

test('고치기: 종류는 그대로, 공지 고정 바꾸기, 읽음 기록은 건드리지 않음', async () => {
  const posts = [teacherNotice('n1'), post('m1')];
  const env = fakeEnv((sql, args) => {
    if (sql.includes('COUNT(*) AS n FROM posts WHERE pinned = 1')) return [{ n: 1 }];
    if (sql.includes('WHERE p.id = ?')) return posts.filter(p => p.id === args.at(-1));
    return [];
  }, posts);
  await updatePost(env, teacher, 'n1', { kind: 'memo', title: '새 제목', body: '내용', pinned: true });
  const upd = env.executed.find(e => e.sql.startsWith('UPDATE posts'));
  assert.deepEqual(upd.args.slice(0, 4), ['새 제목', '내용', 1, '김선생']);
  assert.ok(!upd.sql.includes('kind'));
  assert.ok(env.executed.some(e => e.sql.includes('COUNT(*) AS n FROM posts WHERE pinned = 1') && e.args[0] === 'n1'));
  assert.equal(env.executed.some(e => e.sql.includes('post_reads') && !e.sql.startsWith('SELECT')), false);

  // 학생이 자기 메모를 고칠 때 pinned를 보내도 고정되지 않는다
  await updatePost(env, student, 'm1', { title: '메모', pinned: true });
  const upd2 = env.executed.filter(e => e.sql.startsWith('UPDATE posts')).at(-1);
  assert.equal(upd2.args[2], 0);
});

test('지우기: 글과 읽음 기록·알림을 같은 batch로', async () => {
  const env = fakeEnv(() => [], [teacherNotice('n1'), post('m1')]);
  await deletePost(env, teacher, 'n1');
  assert.equal(env.batches.length, 1);
  assert.deepEqual(env.batches[0], [
    { sql: 'DELETE FROM post_reads WHERE post_id = ?', args: ['n1'] },
    { sql: 'DELETE FROM notifications WHERE ref_id = ? AND kind IN (?)', args: ['n1', 'notice'] },
    { sql: 'DELETE FROM posts WHERE id = ?', args: ['n1'] }
  ]);
  await deletePost(env, student, 'm1'); // 자기 메모
  assert.equal(env.batches.length, 2);
  await rejects(deletePost(env, teacher, 'none'), 404);
});

test('deleteUser: 그 학생의 공지 읽음 기록·알림을 같은 batch로 지움', async () => {
  const env = fakeEnv();
  await deleteUser(env, 'u1');
  assert.deepEqual(env.batches, [[
    { sql: 'DELETE FROM post_reads WHERE user_uid = ?', args: ['u1'] },
    { sql: 'DELETE FROM notifications WHERE recipient = ?', args: ['u1'] },
    { sql: 'DELETE FROM users WHERE id = ?', args: ['u1'] }
  ]]);
});

/* ── 읽음 ── */

test('읽음 기록: 학생이 공지를 열면 INSERT OR IGNORE(두 번 열어도 하나), 메모는 기록 안 함, 선생님은 403', async () => {
  const env = fakeEnv(() => [], [teacherNotice('n1'), post('m1')]);
  await markRead(env, student, 'n1');
  await markRead(env, student, 'n1');
  const ins = env.executed.filter(e => e.sql.includes('post_reads'));
  assert.equal(ins.length, 2);
  assert.ok(ins.every(e => e.sql.startsWith('INSERT OR IGNORE INTO post_reads') && e.args[0] === 'n1' && e.args[1] === 'u1'));

  const memoEnv = fakeEnv(() => [], [post('m1')]);
  assert.deepEqual(await markRead(memoEnv, student, 'm1'), { ok: true, recorded: false });
  assert.equal(memoEnv.executed.some(e => e.sql.includes('post_reads')), false);

  await rejects(markRead(env, teacher, 'n1'), 403);
  await rejects(markRead(fakeEnv(), student, 'none'), 404);
});

test('읽음 명단: 선생님만, 사용 중인 학생을 읽음/안 읽음으로 나눔', async () => {
  const env = fakeEnv(sql => sql.includes('FROM users u LEFT JOIN post_reads')
    ? [{ name: '김방송', read_at: '2026-11-02 10:00:00' }, { name: '박하늘', read_at: null }, { name: '이서', read_at: '2026-11-02 11:00:00' }]
    : [], [teacherNotice('n1')]);
  assert.deepEqual(await postReads(env, teacher, 'n1'), { read: ['김방송', '이서'], unread: ['박하늘'] });
  assert.ok(env.executed.some(e => e.sql.includes('WHERE u.active = 1')));
  await rejects(postReads(env, student, 'n1'), 403);
});

/* ── 목록 ── */

const many = (n, prefix = 'r') => Array.from({ length: n }, (_, i) =>
  post(prefix + i, { created_at: `2026-10-${String(30 - i).padStart(2, '0')} 09:00:00` }));

test('목록 첫 쪽: 고정 공지 전부 + 나머지 20개, more 여부', async () => {
  const pinned = [teacherNotice('p1', { pinned: 1, unread: 1 }), teacherNotice('p2', { pinned: 1, unread: 0 })];
  const env = fakeEnv(sql => sql.includes('p.pinned = 1') ? pinned : many(21));
  const { posts, more } = await listPosts(env, student, {});
  assert.equal(posts.length, 22);
  assert.deepEqual(posts.slice(0, 2).map(p => [p.id, p.pinned, p.unread]), [['p1', true, true], ['p2', true, false]]);
  assert.equal(more, true);
  assert.equal(posts[2].canEdit, true); // 내 메모
  // 학생은 내 uid로 읽음을 확인
  assert.ok(env.executed.every(e => !e.sql.includes('FROM posts p') || e.args[0] === 'u1'));

  const few = await listPosts(fakeEnv(sql => sql.includes('p.pinned = 1') ? [] : many(20)), student, {});
  assert.equal(few.more, false);
  assert.equal(few.posts.length, 20);
});

test('목록: 잘못된 kind는 전체, memo는 고정 공지를 읽지 않음, 선생님은 readCount·total', async () => {
  const bad = fakeEnv(() => []);
  await listPosts(bad, student, { kind: 'x' });
  assert.ok(bad.executed.every(e => !e.sql.includes('p.kind = ?')));
  assert.ok(bad.executed.some(e => e.sql.includes('p.pinned = 1')));

  const memo = fakeEnv(() => []);
  await listPosts(memo, student, { kind: 'memo' });
  assert.equal(memo.executed.some(e => e.sql.includes('p.pinned = 1')), false);
  assert.ok(memo.executed.some(e => e.sql.includes('p.kind = ?') && e.args.includes('memo')));

  const t = fakeEnv(sql => {
    if (sql.includes('FROM users WHERE active = 1')) return [{ n: 15 }];
    if (sql.includes('p.pinned = 1')) return [teacherNotice('p1', { pinned: 1, readCount: 12 })];
    return [post('m1')];
  });
  const { posts } = await listPosts(t, teacher, {});
  assert.deepEqual([posts[0].readCount, posts[0].total, 'unread' in posts[0]], [12, 15, false]);
  assert.equal('readCount' in posts[1], false); // 메모
  assert.deepEqual([posts[1].canEdit, posts[1].canDelete], [false, true]);
});

test('더 보기: before 글보다 오래된 고정 아닌 글, 없는 id면 빈 목록', async () => {
  const anchor = post('a1', { created_at: '2026-10-10 09:00:00' });
  const env = fakeEnv(() => many(3, 'o'), [anchor]);
  const page = await listPosts(env, student, { before: 'a1' });
  assert.equal(page.posts.length, 3);
  assert.equal(page.more, false);
  const q = env.executed.find(e => e.sql.includes('p.created_at < ?'));
  assert.ok(q.sql.includes('p.pinned = 0'));
  assert.deepEqual(q.args.slice(1), ['2026-10-10 09:00:00', '2026-10-10 09:00:00', 'a1', 21]);
  assert.equal(env.executed.some(e => e.sql.includes('p.pinned = 1')), false);

  assert.deepEqual(await listPosts(fakeEnv(), student, { before: 'none' }), { posts: [], more: false });
});

test('getPost: 선생님은 사용 중인 학생 수(batch 결과)를 total로, 없는 id는 404', async () => {
  const env = fakeEnv(sql => {
    if (sql.includes('FROM users WHERE active = 1')) return [{ n: 7 }];
    if (sql.includes('WHERE p.id = ?')) return [teacherNotice('n1', { readCount: 3 })];
    return [];
  });
  const p = await getPost(env, teacher, 'n1');
  assert.deepEqual([p.readCount, p.total], [3, 7]);
  assert.equal(env.batches.length, 1);
  assert.equal(env.batches[0].length, 2);
  await rejects(getPost(fakeEnv(), teacher, 'none'), 404);
  await rejects(getPost(fakeEnv(), student, 'none'), 404);
});
