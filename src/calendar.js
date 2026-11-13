// 방송부 일정 캘린더
// 로그인한 부원은 누구나 일정을 보고, 넣고, 고칠 수 있다. 지우기는 만든 사람과 선생님만.
// 대본(scripts)의 방송일도 함께 돌려줘서 달력에 "대본" 표시가 나오게 한다.
// '아침방송' 일정은 담당 지정이라 선생님만 만들고 고치고 지운다 (setMorningDuty로 한 주씩).

import { isValidDate, nowKST, addDays, toDate } from './dates.js';
import { activeStudents, notifyStatements, deleteNotificationsStatement, md } from './notify.js';

export const CATEGORIES = ['방송', '연습', '회의', '기타', '아침방송'];
const MORNING = '아침방송';
const MAX_TEXT = 2000;

export class CalendarError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** 학생이 아침방송 일정을 건드리면 403 (이전·새 종류 어느 쪽이든) */
function guardMorning(user, ...categories) {
  if (user.role !== 'teacher' && categories.includes(MORNING)) throw new CalendarError(403, '아침방송 담당은 선생님만 정할 수 있어요.');
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

/** 새로 '함께하는 부원'이 된 이름과 같은 사용 중인 학생에게 알림 (저장한 본인 제외) */
async function memberNotices(env, user, id, e, oldMembers = []) {
  const before = new Set(oldMembers.map(m => String(m).trim()));
  const added = new Set(JSON.parse(e.members).filter(m => !before.has(m)));
  if (!added.size) return [];
  const who = user.role === 'teacher' ? `${user.name} 선생님이` : `${user.name}님이`;
  return notifyStatements(env, {
    recipients: (await activeStudents(env)).filter(u => added.has(String(u.name).trim()) && u.id !== user.uid).map(u => u.id),
    kind: 'calendar', refId: id, refDate: e.date,
    text: `${who} ${md(e.date)} ${e.title} 일정에 나를 넣었어요`
  });
}

async function getEvent(env, id) {
  const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
  if (!row) throw new CalendarError(404, '일정을 찾을 수 없어요.');
  return row;
}

export async function createEvent(env, user, input) {
  const e = clean(input);
  guardMorning(user, e.category);
  const id = crypto.randomUUID().slice(0, 8);
  const now = nowKST();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO calendar_events (id, date, time, title, category, members, note, record, created_by, created_by_uid, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, e.date, e.time, e.title, e.category, e.members, e.note, e.record, user.name, user.uid || '', now, user.name, now),
    ...await memberNotices(env, user, id, e)
  ]);
  return toEvent(await getEvent(env, id));
}

export async function updateEvent(env, user, id, input) {
  const old = await getEvent(env, id);
  const e = clean(input);
  guardMorning(user, old.category, e.category);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE calendar_events SET date = ?, time = ?, title = ?, category = ?, members = ?, note = ?, record = ?, updated_by = ?, updated_at = ?
       WHERE id = ?`
    ).bind(e.date, e.time, e.title, e.category, e.members, e.note, e.record, user.name, nowKST(), id),
    ...await memberNotices(env, user, id, e, parseMembers(old.members)),
    // 날짜를 옮기면 이미 보낸 알림도 새 날짜로 열리게
    env.DB.prepare("UPDATE notifications SET ref_date = ? WHERE kind = 'calendar' AND ref_id = ?").bind(e.date, id)
  ]);
  return toEvent(await getEvent(env, id));
}

export async function deleteEvent(env, user, id) {
  const row = await getEvent(env, id);
  guardMorning(user, row.category);
  const isOwner = user.uid ? row.created_by_uid === user.uid : false;
  if (user.role !== 'teacher' && !isOwner) throw new CalendarError(403, '일정은 만든 사람이나 선생님만 지울 수 있어요.');
  await env.DB.batch([
    deleteNotificationsStatement(env, ['calendar'], id),
    env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id)
  ]);
  return { ok: true };
}

/**
 * 한 주(월~금) 아침방송 담당을 한 번에 정한다. duty = { 'YYYY-MM-DD': '이름' }, 이름 ''은 그날 담당 지우기.
 * duty에 없는 날은 그대로 둔다. 하루 한 개만 남기고, 새로 담당이 된 학생에게만 알림.
 */
export async function setMorningDuty(env, user, start, duty) {
  guardMorning(user, MORNING);
  if (!isValidDate(start) || toDate(start).getUTCDay() !== 1) throw new CalendarError(400, '주의 시작은 월요일이어야 해요.');
  const days = [0, 1, 2, 3, 4].map(n => addDays(start, n));
  if (!duty || typeof duty !== 'object' || Array.isArray(duty) || Object.keys(duty).some(d => !days.includes(d))) {
    throw new CalendarError(400, '그 주 월요일부터 금요일까지만 정할 수 있어요.');
  }
  const { results } = await env.DB.prepare(
    'SELECT * FROM calendar_events WHERE category = ? AND date BETWEEN ? AND ? ORDER BY date, created_at'
  ).bind(MORNING, days[0], days[4]).all();
  const now = nowKST();
  const stmts = [];
  for (const [date, raw] of Object.entries(duty)) {
    const name = String(raw ?? '').trim().slice(0, 20);
    const [row, ...extra] = results.filter(r => r.date === date);
    // 하루 한 개: 비우면 전부, 아니면 겹친 행만 지운다
    for (const r of name ? extra : results.filter(r => r.date === date)) {
      stmts.push(deleteNotificationsStatement(env, ['calendar'], r.id), env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(r.id));
    }
    if (!name) continue;
    const e = { date, title: MORNING, members: JSON.stringify([name]) };
    if (!row) {
      const id = crypto.randomUUID().slice(0, 8);
      stmts.push(env.DB.prepare(
        `INSERT INTO calendar_events (id, date, time, title, category, members, note, record, created_by, created_by_uid, created_at, updated_by, updated_at)
         VALUES (?, ?, '', ?, ?, ?, '', '', ?, ?, ?, ?, ?)`
      ).bind(id, date, MORNING, MORNING, e.members, user.name, user.uid || '', now, user.name, now), ...await memberNotices(env, user, id, e));
    } else if (row.members !== e.members) {
      stmts.push(env.DB.prepare('UPDATE calendar_events SET members = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .bind(e.members, user.name, now, row.id), ...await memberNotices(env, user, row.id, e, parseMembers(row.members)));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return (await listCalendar(env, days[0], days[4])).events.filter(x => x.category === MORNING);
}

/** 함께하는 사람으로 고를 수 있는 부원 이름 (사용 중인 학생 계정) */
export async function listMembers(env) {
  const { results } = await env.DB.prepare('SELECT name FROM users WHERE active = 1 ORDER BY name').all();
  return results.map(r => r.name);
}
