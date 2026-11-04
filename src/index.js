// 방송부 대본 도우미 - Cloudflare Worker (API 서버)
// 화면 파일은 public/ 폴더에서 Cloudflare가 바로 내려주고, /api/* 만 여기서 처리한다.

import { login, logoutCookie, currentUser, changePassword } from './auth.js';
import { listUsers, createUsers, updateUser, resetPassword, deleteUser } from './users.js';
import { generateSection, SECTIONS } from './ai.js';
import { getNextWeekEvents } from './weekly-plan.js';
import { getSpecialTopics } from './commemorations.js';
import { isValidDate, nextFriday, nowKST, todayKST } from './dates.js';
import { getHome } from './home.js';
import { BoardError, listPosts, getPost, createPost, updatePost, deletePost, markRead, postReads } from './board.js';
import { CommentError, listComments, createComment, resolveComment, deleteComment, deleteCommentsStatement, OPEN_COMMENTS_SQL } from './comments.js';
import { TEACHER, md, myScriptStudents, notifyStatements, deleteNotificationsStatement, listNotifications, unreadCount, markNotificationRead, markAllNotificationsRead } from './notify.js';
import { CalendarError, listCalendar, upcomingEvents, createEvent, updateEvent, deleteEvent, listMembers } from './calendar.js';

const STATUSES = ['작성중', '검토요청', '완료'];
const TEXT_FIELDS = ['title', 'announcers', 'memo', ...SECTIONS];
const MAX_TEXT = 5000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

async function readBody(request) {
  try { return await request.json(); } catch { throw new HttpError(400, '요청 형식이 올바르지 않습니다.'); }
}

/* ───────────── 대본 ───────────── */

/** 화면에서 고른 행사 목록 [{ date, weekday, text }] 을 검사한다. */
function cleanEvents(list) {
  if (!Array.isArray(list)) return undefined;
  return list.slice(0, 30)
    .filter(e => e && isValidDate(e.date) && String(e.text || '').trim())
    .map(e => ({ date: e.date, weekday: String(e.weekday || '').slice(0, 1), text: String(e.text).trim().slice(0, 300) }));
}

/** 대본에 저장하는 선택: { events: [...], special: '계기교육 주제', idiom: '사자성어 주제' } (JSON 문자열) */
function cleanChoices(v) {
  let c = {};
  try { c = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}); } catch { c = {}; }
  const out = {};
  const events = cleanEvents(c.events);
  if (events) out.events = events;
  if (c.special) out.special = String(c.special).slice(0, 200);
  if (c.idiom) out.idiom = String(c.idiom).slice(0, 200);
  return JSON.stringify(out);
}

function cleanScript(input) {
  const out = {};
  for (const f of TEXT_FIELDS) out[f] = String(input[f] ?? '').slice(0, MAX_TEXT);
  out.broadcast_date = input.broadcast_date;
  out.announcer_count = Number(input.announcer_count) === 2 ? 2 : 1;
  out.choices = cleanChoices(input.choices);
  out.status = STATUSES.includes(input.status) ? input.status : STATUSES[0];
  if (!isValidDate(out.broadcast_date)) throw new HttpError(400, '방송일을 올바르게 입력해 주세요.');
  return out;
}

function checkStatusPermission(user, newStatus, oldStatus) {
  if (user.role === 'teacher') return;
  if (newStatus === '완료' && oldStatus !== '완료') throw new HttpError(403, "'완료'는 선생님만 정할 수 있어요.");
  if (oldStatus === '완료') throw new HttpError(403, '완료된 대본은 선생님만 고칠 수 있어요. 선생님께 상태를 바꿔 달라고 요청하세요.');
}

const SCRIPT_NOTICE_KINDS = ['comment', 'done', 'review'];

/**
 * 상태가 바뀔 때 알림 (저장 batch에 함께 넣는다)
 * - 학생이 '검토요청'으로 바꾸거나 그 상태로 만들면 선생님 공용 알림
 * - '완료'가 되면(이미 완료였으면 없음) 그 대본의 '내 대본' 학생에게
 */
async function statusNotices(env, user, id, s, oldStatus, createdBy) {
  if (s.status === oldStatus) return [];
  if (s.status === '검토요청' && user.role !== 'teacher') {
    return notifyStatements(env, {
      recipients: [TEACHER], kind: 'review', refId: id,
      text: `${user.name}님이 ${md(s.broadcast_date)} 대본 검토를 요청했어요${s.title ? ` (${s.title})` : ''}`
    });
  }
  if (s.status === '완료') {
    return notifyStatements(env, {
      recipients: await myScriptStudents(env, { created_by: createdBy, announcers: s.announcers }), kind: 'done', refId: id,
      text: `${md(s.broadcast_date)} 대본이 완료되었어요${s.title ? ` (${s.title})` : ''}`
    });
  }
  return [];
}

async function listScripts(env, url) {
  const q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || '';
  // open_comments: 반영 안 된 검토 댓글 수 (목록의 '의견 n' 칩)
  let sql = `SELECT id, broadcast_date, title, announcers, announcer_count, status, created_by, updated_by, updated_at, ${OPEN_COMMENTS_SQL} FROM scripts WHERE 1=1`;
  const args = [];
  if (status) { sql += ' AND status = ?'; args.push(status); }
  if (q) { sql += ' AND (title LIKE ? OR announcers LIKE ? OR created_by LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY broadcast_date DESC, updated_at DESC LIMIT 200';
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  return results;
}

async function getScript(env, id) {
  const row = await env.DB.prepare('SELECT * FROM scripts WHERE id = ?').bind(id).first();
  if (!row) throw new HttpError(404, '대본을 찾을 수 없습니다.');
  return row;
}

async function createScript(env, user, input) {
  const s = cleanScript(input);
  checkStatusPermission(user, s.status, null);
  const id = crypto.randomUUID().slice(0, 8);
  const now = nowKST();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scripts (id, broadcast_date, title, announcers, announcer_count, status, ${SECTIONS.join(', ')}, memo, choices, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${SECTIONS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?, ?)`
    ).bind(id, s.broadcast_date, s.title, s.announcers, s.announcer_count, s.status, ...SECTIONS.map(k => s[k]), s.memo, s.choices, user.name, now, user.name, now),
    ...await statusNotices(env, user, id, s, null, user.name)
  ]);
  return getScript(env, id);
}

async function updateScript(env, user, id, input) {
  const old = await getScript(env, id);
  // 여러 명이 동시에 고칠 때 덮어쓰기 방지
  if (input.base_updated_at && input.base_updated_at !== old.updated_at) {
    throw new HttpError(409, `${old.updated_by}님이 ${old.updated_at}에 먼저 수정했어요. 새로고침해서 최신 내용을 확인해 주세요.`);
  }
  const s = cleanScript(input);
  checkStatusPermission(user, s.status, old.status);
  const now = nowKST();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO script_history (script_id, snapshot, saved_by, saved_at) VALUES (?, ?, ?, ?)')
      .bind(id, JSON.stringify(old), old.updated_by, old.updated_at),
    env.DB.prepare(
      `UPDATE scripts SET broadcast_date = ?, title = ?, announcers = ?, announcer_count = ?, status = ?, ${SECTIONS.map(k => `${k} = ?`).join(', ')},
       memo = ?, choices = ?, updated_by = ?, updated_at = ? WHERE id = ?`
    ).bind(s.broadcast_date, s.title, s.announcers, s.announcer_count, s.status, ...SECTIONS.map(k => s[k]), s.memo, s.choices, user.name, now, id),
    ...await statusNotices(env, user, id, s, old.status, old.created_by)
  ]);
  return getScript(env, id);
}

async function deleteScript(env, user, id) {
  if (user.role !== 'teacher') throw new HttpError(403, '대본 삭제는 선생님만 할 수 있어요.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM script_history WHERE script_id = ?').bind(id),
    deleteCommentsStatement(env, id),
    deleteNotificationsStatement(env, SCRIPT_NOTICE_KINDS, id),
    env.DB.prepare('DELETE FROM scripts WHERE id = ?').bind(id)
  ]);
  return { ok: true };
}

/* ───────────── 라우터 ───────────── */

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname === '/api/login' && method === 'POST') {
    const { name, password } = await readBody(request);
    const result = await login(env, name, password);
    if (!result) throw new HttpError(401, '아이디 또는 비밀번호가 맞지 않아요.');
    return json({ user: result.user }, 200, { 'Set-Cookie': result.cookie });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': logoutCookie() });
  }

  const user = await currentUser(request, env);
  if (pathname === '/api/me') {
    return json({
      user,
      config: {
        school: env.SCHOOL_NAME || '우리학교',
        statuses: STATUSES,
        nextFriday: nextFriday(),
        aiReady: !!env.GEMINI_API_KEY,
        planReady: !!env.PLAN_SHEET_ID
      }
    });
  }
  if (!user) throw new HttpError(401, '로그인이 필요해요.');

  if (pathname === '/api/password' && method === 'POST') {
    const { current, next } = await readBody(request);
    try { await changePassword(env, user, current, next); } catch (err) { throw new HttpError(400, err.message); }
    return json({ ok: true });
  }
  // 임시 비밀번호로 들어온 학생은 비밀번호를 바꾸기 전까지 다른 기능을 쓸 수 없다.
  if (user.mustChange) throw new HttpError(403, '먼저 내 비밀번호로 바꿔 주세요.');

  // 홈(첫 화면) 묶음: 이번 주 대본, 내 할 일, 다가오는 일정, 공지, (선생님) 검토 기다리는 대본
  if (pathname === '/api/home' && method === 'GET') return json(await getHome(env, user));

  if (pathname.startsWith('/api/users')) {
    if (user.role !== 'teacher') throw new HttpError(403, '학생 계정 관리는 선생님만 할 수 있어요.');
    try {
      if (pathname === '/api/users') {
        if (method === 'GET') return json(await listUsers(env));
        if (method === 'POST') return json(await createUsers(env, (await readBody(request)).users || []), 201);
      }
      const um = pathname.match(/^\/api\/users\/([\w-]+)(\/reset)?$/);
      if (um && um[2] && method === 'POST') return json(await resetPassword(env, um[1]));
      if (um && !um[2] && method === 'PUT') return json(await updateUser(env, um[1], await readBody(request)));
      if (um && !um[2] && method === 'DELETE') return json(await deleteUser(env, um[1]));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message);
    }
  }

  if (pathname === '/api/scripts') {
    if (method === 'GET') return json(await listScripts(env, url));
    if (method === 'POST') return json(await createScript(env, user, await readBody(request)), 201);
  }

  let m = pathname.match(/^\/api\/scripts\/([\w-]+)$/);
  if (m) {
    if (method === 'GET') return json(await getScript(env, m[1]));
    if (method === 'PUT') return json(await updateScript(env, user, m[1], await readBody(request)));
    if (method === 'DELETE') return json(await deleteScript(env, user, m[1]));
  }

  // ── 검토 댓글 (선생님 의견, 반영했어요) ──
  const sc = pathname.match(/^\/api\/scripts\/([\w-]+)\/comments$/);
  const rc = pathname.match(/^\/api\/comments\/([\w-]+)(\/resolve)?$/);
  if (sc || rc) {
    try {
      if (sc && method === 'GET') return json(await listComments(env, sc[1]));
      if (sc && method === 'POST') return json(await createComment(env, user, sc[1], await readBody(request)), 201);
      if (rc && rc[2] && method === 'POST') return json(await resolveComment(env, user, rc[1]));
      if (rc && !rc[2] && method === 'DELETE') return json(await deleteComment(env, user, rc[1]));
    } catch (err) {
      if (err instanceof CommentError) throw new HttpError(err.status, err.message);
      throw err;
    }
  }

  m = pathname.match(/^\/api\/scripts\/([\w-]+)\/history$/);
  if (m && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT id, saved_by, saved_at FROM script_history WHERE script_id = ? ORDER BY id DESC LIMIT 50'
    ).bind(m[1]).all();
    return json(results);
  }

  m = pathname.match(/^\/api\/history\/(\d+)$/);
  if (m && method === 'GET') {
    const row = await env.DB.prepare('SELECT * FROM script_history WHERE id = ?').bind(m[1]).first();
    if (!row) throw new HttpError(404, '기록을 찾을 수 없습니다.');
    return json({ ...row, snapshot: JSON.parse(row.snapshot) });
  }

  // ── 방송부 일정 캘린더 ──
  if (pathname.startsWith('/api/calendar') || pathname === '/api/members') {
    try {
      if (pathname === '/api/members' && method === 'GET') return json(await listMembers(env));
      if (pathname === '/api/calendar/upcoming' && method === 'GET') return json(await upcomingEvents(env, todayKST()));
      if (pathname === '/api/calendar') {
        if (method === 'GET') return json(await listCalendar(env, url.searchParams.get('from'), url.searchParams.get('to')));
        if (method === 'POST') return json(await createEvent(env, user, await readBody(request)), 201);
      }
      const cm = pathname.match(/^\/api\/calendar\/([\w-]+)$/);
      if (cm && method === 'PUT') return json(await updateEvent(env, user, cm[1], await readBody(request)));
      if (cm && method === 'DELETE') return json(await deleteEvent(env, user, cm[1]));
    } catch (err) {
      if (err instanceof CalendarError) throw new HttpError(err.status, err.message);
      throw err;
    }
  }

  // ── 게시판 (공지 + 메모, 공지 읽음 확인) ──
  if (pathname === '/api/posts' || pathname.startsWith('/api/posts/')) {
    try {
      if (pathname === '/api/posts') {
        if (method === 'GET') {
          return json(await listPosts(env, user, { kind: url.searchParams.get('kind') || '', before: url.searchParams.get('before') || '' }));
        }
        if (method === 'POST') return json(await createPost(env, user, await readBody(request)), 201);
      }
      const pm = pathname.match(/^\/api\/posts\/([\w-]+)(?:\/(read|reads))?$/);
      if (pm && !pm[2]) {
        if (method === 'GET') return json(await getPost(env, user, pm[1]));
        if (method === 'PUT') return json(await updatePost(env, user, pm[1], await readBody(request)));
        if (method === 'DELETE') return json(await deletePost(env, user, pm[1]));
      }
      if (pm && pm[2] === 'read' && method === 'POST') return json(await markRead(env, user, pm[1]));
      if (pm && pm[2] === 'reads' && method === 'GET') return json(await postReads(env, user, pm[1]));
    } catch (err) {
      if (err instanceof BoardError) throw new HttpError(err.status, err.message);
      throw err;
    }
  }

  // ── 알림 (내 것만: 받는 사람은 서버가 로그인 정보로 정한다) ──
  if (pathname === '/api/notifications' && method === 'GET') return json(await listNotifications(env, user));
  if (pathname === '/api/notifications/count' && method === 'GET') return json(await unreadCount(env, user));
  if (pathname === '/api/notifications/read-all' && method === 'POST') return json(await markAllNotificationsRead(env, user));
  m = pathname.match(/^\/api\/notifications\/(\d+)\/read$/);
  if (m && method === 'POST') return json(await markNotificationRead(env, user, m[1]));

  if (pathname === '/api/events' && method === 'GET') {
    const date = url.searchParams.get('date');
    if (!isValidDate(date)) throw new HttpError(400, '방송일을 올바르게 입력해 주세요.');
    // fresh=1: '학교 행사 다시 확인' 버튼. 저장분 없이 시트를 지금 바로 읽는다.
    return json(await getNextWeekEvents(env, date, { fresh: url.searchParams.get('fresh') === '1' }));
  }

  if (pathname === '/api/topics' && method === 'GET') {
    const date = url.searchParams.get('date');
    if (!isValidDate(date)) throw new HttpError(400, '방송일을 올바르게 입력해 주세요.');
    return json(await getSpecialTopics(env, date, { fresh: url.searchParams.get('fresh') === '1' }));
  }

  if (pathname === '/api/ai/section' && method === 'POST') {
    const body = await readBody(request);
    if (!SECTIONS.includes(body.section)) throw new HttpError(400, '알 수 없는 구성입니다.');
    if (!isValidDate(body.date)) throw new HttpError(400, '방송일을 먼저 입력해 주세요.');
    const text = await generateSection(env, {
      section: body.section,
      date: body.date,
      announcers: (Array.isArray(body.announcers) ? body.announcers : [])
        .slice(0, Number(body.announcer_count) === 2 ? 2 : 1)
        .map(n => String(n || '').trim().slice(0, 20)),
      topic: String(body.topic || '').slice(0, 200),
      request: String(body.request || '').slice(0, 500),
      draft: String(body.draft || '').slice(0, MAX_TEXT),
      selectedEvents: body.section === 'events' ? cleanEvents(body.selectedEvents) : undefined
    });
    return json({ text });
  }

  throw new HttpError(404, '없는 주소입니다.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      return json({ error: err.message || '서버 오류가 발생했어요.' }, status);
    }
  }
};
