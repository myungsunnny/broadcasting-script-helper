// 학생 AI 사용량: 한국 시간 하루에 /api/ai/section 요청을 몇 번 썼는지 ai_usage 표에 센다.
// 선생님은 세지도 막지도 않는다(모든 함수가 undefined를 돌려줌).

import { todayKST, addDays } from './dates.js';

const DEFAULT_LIMIT = 30;
const KEEP_DAYS = 7;
export const AI_LIMIT_MESSAGE = '오늘 AI를 다 썼어요. 내일 다시 쓸 수 있어요. 급하면 선생님께 말씀드려요.';

const isStudent = user => user?.role === 'student' && !!user.uid;

/** 하루 한도: wrangler.jsonc vars.AI_DAILY_LIMIT. 양의 정수가 아니면 30. */
export function aiLimit(env) {
  const n = Number(env.AI_DAILY_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIMIT;
}

/**
 * 1번 쓴다. 한 문장으로 올리고 한도면 안 올리므로 동시에 눌러도 한도를 넘지 않는다.
 * 반환: 남은 횟수 / 한도에 닿았으면 null / 선생님이면 undefined
 */
export async function useAi(env, user) {
  if (!isStudent(user)) return undefined;
  const day = todayKST();
  const limit = aiLimit(env);
  await env.DB.prepare('DELETE FROM ai_usage WHERE day < ?').bind(addDays(day, -KEEP_DAYS)).run();
  const row = await env.DB.prepare(
    `INSERT INTO ai_usage (user_uid, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_uid, day) DO UPDATE SET count = count + 1 WHERE count < ?
     RETURNING count`
  ).bind(String(user.uid), day, limit).first();
  return row ? limit - row.count : null;
}

/** AI 쪽 실패로 못 쓴 1번을 되돌린다. */
export async function refundAi(env, user) {
  if (!isStudent(user)) return;
  await env.DB.prepare('UPDATE ai_usage SET count = count - 1 WHERE user_uid = ? AND day = ? AND count > 0')
    .bind(String(user.uid), todayKST()).run();
}

/** 오늘 남은 횟수 (학생만, 선생님·로그인 안 함은 undefined) */
export async function aiLeft(env, user) {
  if (!isStudent(user)) return undefined;
  const row = await env.DB.prepare('SELECT count FROM ai_usage WHERE user_uid = ? AND day = ?')
    .bind(String(user.uid), todayKST()).first();
  return Math.max(0, aiLimit(env) - (row?.count || 0));
}
