// 알림 모아보기
// 원인 동작(공지 작성, 의견 작성, 상태 변경, 일정 저장)이 notifyStatements()가 돌려준 문장을 자기 저장 batch에 함께 넣는다.
// 받는 사람은 서버가 정한다: 학생 uid, 또는 선생님 공용 'teacher'(교사 쿠키에는 uid가 없어 선생님끼리 읽음을 함께 쓴다).
// 읽음 처리는 언제나 recipient 조건을 붙여서 남의 알림은 바뀌지 않는다.

import { addDays, nowKST, todayKST } from './dates.js';
import { isMyScript } from './home.js';

export const TEACHER = 'teacher';
const KEEP_DAYS = 90;
const LIST_LIMIT = 50;
const MAX_TEXT = 200;

/** 서버 알림 글에 쓰는 구성 이름 (화면 SECTIONS와 같은 이름) */
export const SECTION_NAMES = { greeting: '인사말', events: '학교 행사', idiom: '사자성어', special: '계기교육', closing: '마무리 인사' };

/** 'YYYY-MM-DD' → '11/6' */
export const md = date => `${Number(String(date).slice(5, 7))}/${Number(String(date).slice(8, 10))}`;

/** 이 사용자가 받는 알림의 recipient 값 */
export const recipientOf = user => (user?.role === 'teacher' ? TEACHER : String(user?.uid || ''));

/** 이보다 앞서 만든 알림은 지우고 보여 주지 않는다 (created_at 'YYYY-MM-DD HH:MM:SS'와 글자 비교) */
const cutoff = () => addDays(todayKST(), -KEEP_DAYS);

/** 사용 중인 학생 계정 [{ id, name }] */
export async function activeStudents(env) {
  const { results } = await env.DB.prepare('SELECT id, name FROM users WHERE active = 1').all();
  return results;
}

/** 그 대본의 '내 대본' 학생 uid들 (만든 사람 또는 아나운서) */
export async function myScriptStudents(env, script) {
  return (await activeStudents(env)).filter(u => isMyScript(script, u)).map(u => u.id);
}

/**
 * 원인 동작 batch에 붙일 문장: 90일 지난 알림 정리 + 받는 사람마다 INSERT.
 * 받는 사람이 없으면 [] (정리도 하지 않는다).
 */
export function notifyStatements(env, { recipients, kind, refId, refDate = '', text }) {
  const list = [...new Set((recipients || []).filter(Boolean))];
  if (!list.length) return [];
  const now = nowKST();
  const line = String(text).slice(0, MAX_TEXT);
  return [
    env.DB.prepare('DELETE FROM notifications WHERE created_at < ?').bind(cutoff()),
    ...list.map(r => env.DB.prepare(
      'INSERT INTO notifications (recipient, kind, ref_id, ref_date, text, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(r, kind, String(refId), String(refDate || ''), line, now))
  ];
}

/** 공지·대본·일정을 지울 때 그 알림도 지우는 문장. kinds: 그 대상에 붙는 알림 종류 */
export const deleteNotificationsStatement = (env, kinds, refId) => env.DB.prepare(
  `DELETE FROM notifications WHERE ref_id = ? AND kind IN (${kinds.map(() => '?').join(', ')})`
).bind(String(refId), ...kinds);

/** 학생 계정을 지울 때 그 학생 알림을 지우는 문장 */
export const deleteRecipientStatement = (env, uid) =>
  env.DB.prepare('DELETE FROM notifications WHERE recipient = ?').bind(String(uid));

const unreadStatement = (env, r) => env.DB.prepare(
  "SELECT COUNT(*) AS n FROM notifications WHERE recipient = ? AND read_at = '' AND created_at >= ?"
).bind(r, cutoff());

/** 내 알림: 최근 90일, 최신 50개 + 안 읽은 수 + 서버 지금 시각(몇 분 전 계산용) */
export async function listNotifications(env, user) {
  const r = recipientOf(user);
  const [items, unread] = await env.DB.batch([
    env.DB.prepare(
      'SELECT id, kind, ref_id, ref_date, text, created_at, read_at FROM notifications WHERE recipient = ? AND created_at >= ? ORDER BY id DESC LIMIT ?'
    ).bind(r, cutoff(), LIST_LIMIT),
    unreadStatement(env, r)
  ]);
  return { items: items.results, unread: Number(unread.results[0]?.n) || 0, now: nowKST() };
}

/** 메뉴 배지용 안 읽은 수 */
export async function unreadCount(env, user) {
  const row = await unreadStatement(env, recipientOf(user)).first();
  return { unread: Number(row?.n) || 0 };
}

/** 알림 하나 읽음. 남의 알림이거나 이미 읽었으면 아무것도 바뀌지 않는다. */
export async function markNotificationRead(env, user, id) {
  await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND recipient = ? AND read_at = ''")
    .bind(nowKST(), Number(id), recipientOf(user)).run();
  return { ok: true };
}

/** 내 안 읽은 알림 모두 읽음 */
export async function markAllNotificationsRead(env, user) {
  await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE recipient = ? AND read_at = ''")
    .bind(nowKST(), recipientOf(user)).run();
  return { ok: true };
}
