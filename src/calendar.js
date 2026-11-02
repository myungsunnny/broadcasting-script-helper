// 방송부 일정 캘린더
// 로그인한 부원은 누구나 일정을 보고, 넣고, 고칠 수 있다. 지우기는 만든 사람과 선생님만.
// 대본(scripts)의 방송일도 함께 돌려줘서 달력에 "대본" 표시가 나오게 한다.

import { isValidDate, nowKST } from './dates.js';

export const CATEGORIES = ['방송', '연습', '회의', '기타'];
const MAX_TEXT = 2000;

export class CalendarError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseMembers(v) {
  try { return JSON.parse(v || '[]'); } catch { return []; }
}

export const toEvent = row => ({ ...row, members: parseMembers(row.members) });

function clean(input) {
  const date = String(input.date || '');
  if (!isValidDate(date)) throw new CalendarError(400, '날짜를 골라 주세요.');
  const title = String(input.title || '').trim().slice(0, 60);
  if (!title) throw new CalendarError(400, '일정 이름을 써 주세요.');
  const time = /^\d{2}:\d{2}$/.test(input.time || '') ? input.time : '';
  const members = (Array.isArray(input.members) ? input.members : [])
    .map(m => String(m || '').trim().slice(0, 20)).filter(Boolean).slice(0, 20);
  return {
    date, time, title,
    category: CATEGORIES.includes(input.category) ? input.category : '기타',
    members: JSON.stringify([...new Set(members)]),
    note: String(input.note || '').slice(0, MAX_TEXT),
    record: String(input.record || '').slice(0, MAX_TEXT)
  };
}

/** from~to 사이의 일정과 대본 방송일 */
export async function listCalendar(env, from, to) {
  if (!isValidDate(from) || !isValidDate(to)) throw new CalendarError(400, '날짜 범위가 올바르지 않습니다.');
  const [events, scripts] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM calendar_events WHERE date BETWEEN ? AND ? ORDER BY date, time = \'\' DESC, time, created_at')
      .bind(from, to),
    env.DB.prepare('SELECT id, broadcast_date AS date, title, status, announcers FROM scripts WHERE broadcast_date BETWEEN ? AND ? ORDER BY broadcast_date, updated_at DESC')
      .bind(from, to)
  ]);
  return { events: events.results.map(toEvent), scripts: scripts.results };
}

/** 오늘부터 다가오는 일정 몇 개를 읽는 문장 (홈 묶음 batch에서도 쓴다) */
export function upcomingStatement(env, today, limit = 5) {
  return env.DB.prepare(
    'SELECT * FROM calendar_events WHERE date >= ? ORDER BY date, time = \'\' DESC, time LIMIT ?'
  ).bind(today, limit);
}

/** 오늘부터 다가오는 일정 몇 개 */
export async function upcomingEvents(env, today, limit = 5) {
  const { results } = await upcomingStatement(env, today, limit).all();
  return results.map(toEvent);
}

async function getEvent(env, id) {
  const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
  if (!row) throw new CalendarError(404, '일정을 찾을 수 없어요.');
  return row;
}

export async function createEvent(env, user, input) {
  const e = clean(input);
  const id = crypto.randomUUID().slice(0, 8);
  const now = nowKST();
  await env.DB.prepare(
    `INSERT INTO calendar_events (id, date, time, title, category, members, note, record, created_by, created_by_uid, created_at, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, e.date, e.time, e.title, e.category, e.members, e.note, e.record, user.name, user.uid || '', now, user.name, now).run();
  return toEvent(await getEvent(env, id));
}

export async function updateEvent(env, user, id, input) {
  await getEvent(env, id);
  const e = clean(input);
  await env.DB.prepare(
    `UPDATE calendar_events SET date = ?, time = ?, title = ?, category = ?, members = ?, note = ?, record = ?, updated_by = ?, updated_at = ?
     WHERE id = ?`
  ).bind(e.date, e.time, e.title, e.category, e.members, e.note, e.record, user.name, nowKST(), id).run();
  return toEvent(await getEvent(env, id));
}

export async function deleteEvent(env, user, id) {
  const row = await getEvent(env, id);
  const isOwner = user.uid ? row.created_by_uid === user.uid : false;
  if (user.role !== 'teacher' && !isOwner) throw new CalendarError(403, '일정은 만든 사람이나 선생님만 지울 수 있어요.');
  await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
  return { ok: true };
}

/** 함께하는 사람으로 고를 수 있는 부원 이름 (사용 중인 학생 계정) */
export async function listMembers(env) {
  const { results } = await env.DB.prepare('SELECT name FROM users WHERE active = 1 ORDER BY name').all();
  return results.map(r => r.name);
}
