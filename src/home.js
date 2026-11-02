// 홈(첫 화면) 묶음 데이터
// 이번 주 대본 요약, 내 할 일, 다가오는 일정, 새 공지(고정 공지 + 최근 공지 3개),
// 선생님이면 검토 기다리는 대본을 한 번에 돌려준다.

import { addDays, nextFriday, todayKST } from './dates.js';
import { toEvent, upcomingStatement } from './calendar.js';
import { noticeStatements, toNotices } from './board.js';

const UPCOMING_LIMIT = 5;
const TODO_LIMIT = 5;
const REVIEW_LIMIT = 10;
const TODO_DAYS = 7; // 오늘부터 7일 안의 '작성중' 내 대본

/**
 * '내 대본' 판정 (한곳에서만 정한다)
 * 만든 사람이 나이거나, 쉼표로 나눈 아나운서 이름 중 하나가 나와 똑같으면(앞뒤 공백 무시) 내 대본.
 */
export function isMyScript(script, user) {
  const name = String(user?.name || '').trim();
  if (!name || !script) return false;
  if (String(script.created_by || '').trim() === name) return true;
  return String(script.announcers || '').split(',').some(a => a.trim() === name);
}

const isMember = (event, name) => event.members.some(m => String(m).trim() === name);

export async function getHome(env, user) {
  const today = todayKST();
  const tomorrow = addDays(today, 1);
  const friday = nextFriday(today);
  const isTeacher = user.role === 'teacher';
  const name = String(user.name || '').trim();

  const upcoming = upcomingStatement(env, today, UPCOMING_LIMIT);
  const notices = noticeStatements(env, user);
  const statements = [
    ...notices,
    env.DB.prepare('SELECT id, broadcast_date, title, status FROM scripts WHERE broadcast_date = ? ORDER BY updated_at DESC LIMIT 1')
      .bind(friday),
    upcoming,
    // 다가오는 일정 5개가 걸친 날짜 범위 안에서 대본이 있는 방송일
    env.DB.prepare(
      `SELECT DISTINCT broadcast_date AS date FROM scripts WHERE broadcast_date >= ? AND broadcast_date <= (
         SELECT MAX(date) FROM (SELECT date FROM calendar_events WHERE date >= ? ORDER BY date LIMIT ?))`
    ).bind(today, today, UPCOMING_LIMIT)
  ];
  if (isTeacher) {
    statements.push(env.DB.prepare(
      `SELECT id, broadcast_date, title, announcers, created_by, status, updated_by, updated_at FROM scripts
       WHERE status = '검토요청' ORDER BY broadcast_date, updated_at LIMIT ?`
    ).bind(REVIEW_LIMIT));
  } else {
    statements.push(
      env.DB.prepare(
        `SELECT id, broadcast_date, title, announcers, created_by, status FROM scripts
         WHERE status = '작성중' AND broadcast_date BETWEEN ? AND ? ORDER BY broadcast_date, updated_at DESC`
      ).bind(today, addDays(today, TODO_DAYS)),
      env.DB.prepare('SELECT * FROM calendar_events WHERE date BETWEEN ? AND ? ORDER BY date, time = \'\' DESC, time, created_at')
        .bind(today, tomorrow)
    );
  }

  const results = await env.DB.batch(statements);
  const noticeResults = results.slice(0, notices.length);
  const [weekRes, upcomingRes, scriptDatesRes, ...rest] = results.slice(notices.length);

  const week = weekRes.results[0];
  const scriptDates = new Set(scriptDatesRes.results.map(r => r.date));
  const home = {
    today,
    thisWeek: { date: friday, script: week ? { id: week.id, title: week.title, status: week.status } : null },
    todo: [],
    upcoming: upcomingRes.results.map(toEvent).map(e => ({ ...e, hasScript: scriptDates.has(e.date) })),
    notices: toNotices(user, noticeResults) // 고정 공지 먼저, 그다음 고정 아닌 최근 공지 3개 (메모는 넣지 않음)
  };

  if (isTeacher) {
    home.reviewQueue = rest[0].results;
    return home;
  }

  const [draftsRes, soonRes] = rest;
  const scripts = draftsRes.results.filter(s => isMyScript(s, user)).map(s => ({
    kind: 'script', id: s.id, date: s.broadcast_date, time: '', title: s.title, status: s.status
  }));
  const events = soonRes.results.map(toEvent).filter(e => isMember(e, name)).map(e => ({
    kind: 'event', id: e.id, date: e.date, time: e.time, title: e.title, category: e.category,
    members: e.members.filter(m => String(m).trim() !== name)
  }));
  // 날짜 빠른 순. 같은 날이면 대본 먼저, 일정은 하루 종일 → 시간 순.
  const dated = [...scripts, ...events].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    (a.kind === b.kind ? 0 : a.kind === 'script' ? -1 : 1) ||
    a.time.localeCompare(b.time)
  );
  // 안 읽은 고정 공지는 대본·일정 뒤에 붙이고, 전체 5개까지.
  const unreadPinned = home.notices.filter(n => n.pinned && n.unread).map(n => ({
    kind: 'notice', id: n.id, title: n.title, date: n.created_at.slice(0, 10)
  }));
  home.todo = [...dated, ...unreadPinned].slice(0, TODO_LIMIT);
  return home;
}
