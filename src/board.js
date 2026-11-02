// 게시판: 선생님 공지 + 부원 메모, 공지 읽음 확인
// 공지 쓰기·고정은 선생님만, 메모는 누구나 쓴다.
// 고치기: 선생님은 선생님이 쓴 글, 학생은 자기 메모만. 지우기: 선생님은 아무 글, 학생은 자기 메모만.
// 읽음 기록은 학생이 공지를 펼칠 때 남기고, 선생님은 사용 중인 학생 중 누가 읽었는지 본다.

import { nowKST } from './dates.js';

export const KINDS = ['notice', 'memo'];
const PAGE_SIZE = 20;
const MAX_PINNED = 3;
const MAX_TITLE = 60;
const MAX_BODY = 2000;
const HOME_RECENT = 3; // 홈 '새 공지'의 고정 아닌 최근 공지 수

export class BoardError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isTeacher = user => user?.role === 'teacher';

/** 선생님이 쓴 글 = 학생 계정 id가 빈칸인 글 */
const byTeacher = post => !post.created_by_uid;
const isOwnMemo = (post, user) => post.kind === 'memo' && !!user?.uid && post.created_by_uid === user.uid;

export function canEdit(post, user) {
  return isTeacher(user) ? byTeacher(post) : isOwnMemo(post, user);
}

export function canDelete(post, user) {
  return isTeacher(user) || isOwnMemo(post, user);
}

function clean(input) {
  const title = String(input?.title ?? '').trim().slice(0, MAX_TITLE);
  if (!title) throw new BoardError(400, '제목을 써 주세요.');
  const body = String(input?.body ?? '').slice(0, MAX_BODY);
  return { title, body };
}

/**
 * 글을 읽는 SELECT 앞부분과 바인드 값.
 * 학생: 공지마다 내가 읽었는지(unread). 선생님: 사용 중인 학생 중 읽은 수(readCount).
 */
function selectPosts(user) {
  if (isTeacher(user)) {
    return {
      sql: `SELECT p.*, (SELECT COUNT(*) FROM post_reads r JOIN users u ON u.id = r.user_uid
              WHERE r.post_id = p.id AND u.active = 1) AS readCount FROM posts p`,
      args: []
    };
  }
  return {
    sql: 'SELECT p.*, (r.post_id IS NULL) AS unread FROM posts p LEFT JOIN post_reads r ON r.post_id = p.id AND r.user_uid = ?',
    args: [user?.uid || '']
  };
}

const totalStatement = env => env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1');

/** DB 행을 화면에 줄 글로 정리한다. total: 사용 중인 학생 수(선생님만) */
export function toPost(row, user, total = 0) {
  const post = {
    id: row.id, kind: row.kind, title: row.title, body: row.body,
    pinned: !!row.pinned,
    created_by: row.created_by, created_by_uid: row.created_by_uid, created_at: row.created_at,
    updated_by: row.updated_by, updated_at: row.updated_at
  };
  if (post.kind === 'notice') {
    if (isTeacher(user)) { post.readCount = Number(row.readCount) || 0; post.total = total; }
    else post.unread = !!row.unread;
  }
  post.canEdit = canEdit(post, user);
  post.canDelete = canDelete(post, user);
  return post;
}

const ORDER = 'ORDER BY p.created_at DESC, p.id DESC';

/**
 * 목록. 첫 쪽은 고정 공지 전부 + 나머지 최신순 20개, before가 있으면 그 글보다 오래된 고정 아닌 글 20개.
 * kind가 notice/memo가 아니면 전체. 반환 { posts, more }
 */
export async function listPosts(env, user, { kind, before } = {}) {
  const k = KINDS.includes(kind) ? kind : '';
  const sel = selectPosts(user);
  const kindSql = k ? ' AND p.kind = ?' : '';
  const kindArgs = k ? [k] : [];
  const statements = [];

  let pinnedIndex = -1;
  if (before) {
    const anchor = await env.DB.prepare('SELECT id, created_at FROM posts WHERE id = ?').bind(String(before)).first();
    if (!anchor) return { posts: [], more: false };
    statements.push(env.DB.prepare(
      `${sel.sql} WHERE p.pinned = 0${kindSql} AND (p.created_at < ? OR (p.created_at = ? AND p.id < ?)) ${ORDER} LIMIT ?`
    ).bind(...sel.args, ...kindArgs, anchor.created_at, anchor.created_at, anchor.id, PAGE_SIZE + 1));
  } else {
    statements.push(env.DB.prepare(
      `${sel.sql} WHERE p.pinned = 0${kindSql} ${ORDER} LIMIT ?`
    ).bind(...sel.args, ...kindArgs, PAGE_SIZE + 1));
    if (k !== 'memo') {
      pinnedIndex = statements.length;
      statements.push(env.DB.prepare(`${sel.sql} WHERE p.pinned = 1 ${ORDER}`).bind(...sel.args));
    }
  }
  const totalIndex = isTeacher(user) ? statements.push(totalStatement(env)) - 1 : -1;

  const results = await env.DB.batch(statements);
  const rest = results[0].results;
  const pinned = pinnedIndex >= 0 ? results[pinnedIndex].results : [];
  const total = totalIndex >= 0 ? Number(results[totalIndex].results[0]?.n) || 0 : 0;
  return {
    posts: [...pinned, ...rest.slice(0, PAGE_SIZE)].map(r => toPost(r, user, total)),
    more: rest.length > PAGE_SIZE
  };
}

async function getRow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first();
  if (!row) throw new BoardError(404, '글을 찾을 수 없어요.');
  return row;
}

/** 글 하나 (주소로 바로 연 글이 목록에 없을 때) */
export async function getPost(env, user, id) {
  const sel = selectPosts(user);
  const statements = [env.DB.prepare(`${sel.sql} WHERE p.id = ?`).bind(...sel.args, id)];
  if (isTeacher(user)) statements.push(totalStatement(env));
  const [rowRes, totalRes] = await env.DB.batch(statements);
  const row = rowRes.results[0];
  if (!row) throw new BoardError(404, '글을 찾을 수 없어요.');
  return toPost(row, user, Number(totalRes?.results[0]?.n) || 0);
}

/** 고정 공지가 이미 3개면 400. exceptId: 고치는 글은 빼고 센다. */
async function checkPinLimit(env, exceptId = '') {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE pinned = 1 AND id != ?').bind(exceptId).first();
  if ((Number(row?.n) || 0) >= MAX_PINNED) throw new BoardError(400, '고정 공지는 3개까지예요.');
}

export async function createPost(env, user, input) {
  const kind = input?.kind;
  if (!KINDS.includes(kind)) throw new BoardError(400, '글 종류를 골라 주세요.');
  if (kind === 'notice' && !isTeacher(user)) throw new BoardError(403, '공지는 선생님만 쓸 수 있어요.');
  const { title, body } = clean(input);
  const pinned = kind === 'notice' && input.pinned ? 1 : 0;
  if (pinned) await checkPinLimit(env);
  const id = crypto.randomUUID().slice(0, 8);
  const now = nowKST();
  await env.DB.prepare(
    `INSERT INTO posts (id, kind, title, body, pinned, created_by, created_by_uid, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, kind, title, body, pinned, user.name, user.uid || '', now, user.name, now).run();
  return getPost(env, user, id);
}

/** 고치기: 종류는 바꾸지 않고, 읽음 기록도 그대로 둔다. */
export async function updatePost(env, user, id, input) {
  const row = await getRow(env, id);
  if (!canEdit(row, user)) {
    throw new BoardError(403, isTeacher(user) ? '학생 메모는 고칠 수 없어요. 지우기만 할 수 있어요.' : '내가 쓴 메모만 고칠 수 있어요.');
  }
  const { title, body } = clean(input);
  let pinned = row.pinned ? 1 : 0;
  if (row.kind === 'notice' && input?.pinned !== undefined) pinned = input.pinned ? 1 : 0;
  if (pinned && !row.pinned) await checkPinLimit(env, id);
  await env.DB.prepare('UPDATE posts SET title = ?, body = ?, pinned = ?, updated_by = ?, updated_at = ? WHERE id = ?')
    .bind(title, body, pinned, user.name, nowKST(), id).run();
  return getPost(env, user, id);
}

/** 지우기: 글과 그 글의 읽음 기록을 같은 batch로 */
export async function deletePost(env, user, id) {
  const row = await getRow(env, id);
  if (!canDelete(row, user)) throw new BoardError(403, '내가 쓴 메모만 지울 수 있어요.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM post_reads WHERE post_id = ?').bind(id),
    env.DB.prepare('DELETE FROM posts WHERE id = ?').bind(id)
  ]);
  return { ok: true };
}

/** 학생이 공지를 펼치면 읽음 기록 (이미 있으면 그대로). 메모는 기록하지 않는다. */
export async function markRead(env, user, id) {
  if (isTeacher(user) || !user?.uid) throw new BoardError(403, '읽음 기록은 학생만 남겨요.');
  const row = await getRow(env, id);
  if (row.kind !== 'notice') return { ok: true, recorded: false };
  await env.DB.prepare('INSERT OR IGNORE INTO post_reads (post_id, user_uid, read_at) VALUES (?, ?, ?)')
    .bind(id, user.uid, nowKST()).run();
  return { ok: true, recorded: true };
}

/** 선생님: 사용 중인 학생 중 읽은/안 읽은 이름 */
export async function postReads(env, user, id) {
  if (!isTeacher(user)) throw new BoardError(403, '읽음 확인은 선생님만 볼 수 있어요.');
  await getRow(env, id);
  const { results } = await env.DB.prepare(
    `SELECT u.name, r.read_at FROM users u LEFT JOIN post_reads r ON r.user_uid = u.id AND r.post_id = ?
     WHERE u.active = 1 ORDER BY u.name`
  ).bind(id).all();
  return {
    read: results.filter(r => r.read_at).map(r => r.name),
    unread: results.filter(r => !r.read_at).map(r => r.name)
  };
}

/* ── 홈 '새 공지' ── */

/** 홈 묶음 batch에 넣을 문장: 고정 공지(최대 3), 고정 아닌 최근 공지 3개, (선생님) 사용 중인 학생 수 */
export function noticeStatements(env, user) {
  const sel = selectPosts(user);
  const statements = [
    env.DB.prepare(`${sel.sql} WHERE p.kind = 'notice' AND p.pinned = 1 ${ORDER} LIMIT ?`).bind(...sel.args, MAX_PINNED),
    env.DB.prepare(`${sel.sql} WHERE p.kind = 'notice' AND p.pinned = 0 ${ORDER} LIMIT ?`).bind(...sel.args, HOME_RECENT)
  ];
  if (isTeacher(user)) statements.push(totalStatement(env));
  return statements;
}

/** noticeStatements 결과(같은 순서)를 홈 공지 목록으로: 고정 먼저, 그다음 최근 */
export function toNotices(user, results) {
  const [pinnedRes, recentRes, totalRes] = results;
  const total = Number(totalRes?.results[0]?.n) || 0;
  return [...pinnedRes.results, ...recentRes.results].map(r => toPost(r, user, total));
}
