// 검토 댓글: 선생님이 대본의 구성(인사말, 학교 행사 ...)마다 남기는 의견
// 쓰기·지우기는 선생님만(교사 쿠키에는 uid가 없어 선생님끼리는 서로의 댓글도 지운다).
// '반영했어요'는 로그인한 누구나, 완료된 대본에서도 된다. 되돌리기는 없고, 두 번 눌러도 처음 기록을 지킨다.
// 댓글을 남겨도 대본 상태는 바꾸지 않는다.

import { SECTIONS } from './ai.js';
import { nowKST } from './dates.js';

const MAX_BODY = 1000;
const DONE = '완료';

export class CommentError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const isTeacher = user => user?.role === 'teacher';

async function requireScript(env, scriptId) {
  const row = await env.DB.prepare('SELECT id FROM scripts WHERE id = ?').bind(scriptId).first();
  if (!row) throw new CommentError(404, '대본을 찾을 수 없어요.');
}

async function getRow(env, id) {
  const row = await env.DB.prepare('SELECT * FROM script_comments WHERE id = ?').bind(id).first();
  if (!row) throw new CommentError(404, '의견을 찾을 수 없어요.');
  return row;
}

/** 대본의 댓글: 반영 안 된 것 먼저(오래된 순), 그다음 반영한 것(오래된 순) */
export async function listComments(env, scriptId) {
  await requireScript(env, scriptId);
  const { results } = await env.DB.prepare(
    `SELECT * FROM script_comments WHERE script_id = ?
     ORDER BY resolved_by != '', created_at, rowid`
  ).bind(scriptId).all();
  return results;
}

export async function createComment(env, user, scriptId, input) {
  if (!isTeacher(user)) throw new CommentError(403, '의견은 선생님만 남길 수 있어요.');
  const section = input?.section;
  if (!SECTIONS.includes(section)) throw new CommentError(400, '알 수 없는 구성이에요.');
  const body = String(input?.body ?? '').trim().slice(0, MAX_BODY);
  if (!body) throw new CommentError(400, '의견을 써 주세요.');
  await requireScript(env, scriptId);
  const id = crypto.randomUUID().slice(0, 8);
  await env.DB.prepare(
    'INSERT INTO script_comments (id, script_id, section, body, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, scriptId, section, body, user.name, nowKST()).run();
  return getRow(env, id);
}

/** 반영했어요: 아직 아무도 안 눌렀을 때만 기록 (이미 반영했으면 처음 기록 그대로) */
export async function resolveComment(env, user, id) {
  await getRow(env, id);
  await env.DB.prepare(
    "UPDATE script_comments SET resolved_by = ?, resolved_at = ? WHERE id = ? AND resolved_by = ''"
  ).bind(user.name, nowKST(), id).run();
  return getRow(env, id);
}

export async function deleteComment(env, user, id) {
  if (!isTeacher(user)) throw new CommentError(403, '의견은 선생님만 지울 수 있어요.');
  await getRow(env, id);
  await env.DB.prepare('DELETE FROM script_comments WHERE id = ?').bind(id).run();
  return { ok: true };
}

/** 대본 삭제 batch에 넣는 문장 */
export const deleteCommentsStatement = (env, scriptId) =>
  env.DB.prepare('DELETE FROM script_comments WHERE script_id = ?').bind(scriptId);

/** 대본 목록 SELECT에 붙이는 반영 안 된 댓글 수 (scripts 표 이름 그대로 참조) */
export const OPEN_COMMENTS_SQL =
  "(SELECT COUNT(*) FROM script_comments c WHERE c.script_id = scripts.id AND c.resolved_by = '') AS open_comments";

/**
 * 홈 batch용: 반영 안 된 댓글이 있는 '완료' 아닌 대본 중 방송일이 오늘 이후인 것, 방송일 순.
 * n = 반영 안 된 수, sections = 그 댓글들의 구성(쉼표). '내 대본' 거르기는 home.js가 한다.
 */
export const openCommentStatement = (env, today) => env.DB.prepare(
  `SELECT s.id, s.broadcast_date, s.title, s.announcers, s.created_by, s.status,
     COUNT(*) AS n, GROUP_CONCAT(DISTINCT c.section) AS sections
   FROM script_comments c JOIN scripts s ON s.id = c.script_id
   WHERE c.resolved_by = '' AND s.status != ? AND s.broadcast_date >= ?
   GROUP BY s.id ORDER BY s.broadcast_date, s.id`
).bind(DONE, today);

/** sections 문자열에서 탭 순서로 가장 앞 구성 */
export function firstSection(sections) {
  const set = new Set(String(sections || '').split(','));
  return SECTIONS.find(k => set.has(k)) || SECTIONS[0];
}
