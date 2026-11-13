// 방송부 대본 도우미 - 화면 스크립트

const SECTIONS = [
  { key: 'greeting', name: '인사말',      hint: '방송을 시작하는 인사와 자기소개' },
  { key: 'events',   name: '학교 행사',   hint: '2단계에서 고른 다음 주 행사를 소개해요' },
  { key: 'idiom',    name: '사자성어',    hint: '사자성어의 뜻과 생활 속 예시' },
  { key: 'special',  name: '계기교육',    hint: '2단계에서 고른 주제를 소개해요' },
  { key: 'closing',  name: '마무리 인사', hint: '즐거운 주말 인사와 끝인사' }
];
// 4단계에서 한 번 눌러 AI에게 다시 부탁하는 버튼
const QUICK_ASKS = ['더 짧게', '더 길게', '더 쉽게', '더 재미있게'];
const META_FIELDS = ['broadcast_date', 'title', 'status', 'memo'];
const CHARS_PER_SECOND = 5; // 초등 아나운서 낭독 속도(대략)

const state = { user: null, config: null, scripts: [], home: null, homeLoaded: false, homeReq: null, homeSeq: 0, current: null, dirty: false, historyRow: null, step: 1, tab: 'greeting', editSeq: 0, inboxSeq: 0 };

/* ───────────── 공통 도구 ───────────── */

const $ = id => document.getElementById(id);
/** Phosphor 아이콘 (fill: 채운 모양) */
const icon = (name, fill = false) => `<i class="${fill ? 'ph-fill' : 'ph'} ph-${name}" aria-hidden="true"></i>`;
const spinner = () => '<span class="spin">' + icon('spinner-gap') + '</span>';
/** 불러오는 동안 보여 줄 회색 줄 (실제 목록 모양과 비슷하게) */
const skeleton = (rows, label) => `<div class="skel-wrap" aria-label="${label}" role="status">${'<div class="skel"></div>'.repeat(rows)}<span class="muted small">${label}</span></div>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error(data.error || '로그인이 필요해요.'); }
  if (!res.ok) { const err = new Error(data.error || `오류 (${res.status})`); err.status = res.status; throw err; }
  return data;
}

function toast(msg) {
  const t = $('toast');
  // 창(dialog)이 열려 있으면 그 안에 띄워야 어두운 배경 위로 보인다.
  const host = document.querySelector('dialog[open]') || document.body;
  if (t.parentElement !== host) host.appendChild(t);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function showOnly(id) {
  ['loginView', 'homeView', 'listView', 'boardView', 'inboxView', 'editView', 'readView', 'accountsView', 'helpView', 'calendarView', 'practiceView'].forEach(v => $(v).classList.toggle('hidden', v !== id));
  // 연습 모드는 메뉴 없는 전체 화면. 다른 화면으로 가면 타이머·화면 꺼짐 방지를 멈춘다.
  document.body.classList.toggle('practicing', id === 'practiceView');
  if (id !== 'practiceView') stopPractice();
  window.scrollTo(0, 0);
}

/* ───────────── 메뉴 · 내 계정 목록 ───────────── */

/** 지금 화면에 해당하는 메뉴를 빨강(넓은 화면은 밑줄, 좁은 화면은 채운 아이콘)으로 표시한다. key가 없으면 표시 없음 */
function setMenu(key) {
  document.querySelectorAll('#mainNav a[data-menu]').forEach(a => {
    const on = a.dataset.menu === key;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    const i = a.querySelector('i');
    i.classList.toggle('ph-fill', on);
    i.classList.toggle('ph', !on);
  });
}

/** 로그인했고 비밀번호를 바꿀 필요가 없을 때만 메뉴를 보인다. */
function syncNav() {
  const show = !!state.user && !state.user.mustChange;
  $('mainNav').classList.toggle('hidden', !show);
  document.body.classList.toggle('has-nav', show);
}

function toggleUserMenu(open = $('userPop').classList.contains('hidden')) {
  $('userPop').classList.toggle('hidden', !open);
  $('btnUser').setAttribute('aria-expanded', open);
  if (open) $('userPop').querySelector('.btn-menu:not(.hidden)')?.focus();
}

function navigate(query, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', '/' + query);
  route();
}

/** 편집 화면을 떠나기 전에 고친 내용을 저장한다. (자동 저장이라 묻지 않는다) */
function confirmLeave() {
  if (state.dirty && !state.conflict) saveNow();
  return true;
}

function readTimeText(chars) {
  const sec = Math.round(chars / CHARS_PER_SECOND);
  return sec < 60 ? `약 ${sec}초` : `약 ${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

/* ───────────── 시작 · 로그인 ───────────── */

async function init() {
  buildSections();
  bindEvents();
  const { user, config } = await api('/api/me');
  state.config = config;
  $('schoolName').textContent = config.school;
  document.title = `방송부 · ${config.school}`;
  config.statuses.forEach(s => { $('statusFilter').add(new Option(s, s)); $('f-status').add(new Option(s, s)); });
  const warn = [];
  if (!config.aiReady) warn.push('Gemini API 키가 설정되지 않아 AI 기능을 쓸 수 없어요.');
  if (!config.planReady) warn.push('학교 주간계획 주소가 설정되지 않아 행사 소개를 자동으로 만들 수 없어요.');
  if (warn.length) {
    $('setupNotice').innerHTML = icon('warning-circle') + '<span>' + warn.join('<br>') + '<br>선생님이 배포가이드를 보고 설정해 주세요.</span>';
    $('setupNotice').classList.remove('hidden');
  }
  setUser(user);
  route();
}

function setUser(user) {
  state.user = user;
  // 다른 사람으로 바뀌면 받던 홈 응답은 버린다.
  state.homeSeq++;
  state.home = null;
  state.homeLoaded = false;
  state.homeReq = null;
  $('userBox').classList.toggle('hidden', !user);
  toggleUserMenu(false);
  if (user) $('userName').textContent = `${user.name}${user.role === 'teacher' ? ' 선생님' : ''}`;
  $('btnAccounts').classList.toggle('hidden', user?.role !== 'teacher');
  $('btnPassword').classList.toggle('hidden', user?.role !== 'student');
  state.inboxSeq++; // 받던 배지·알림 응답은 버린다
  setInboxBadge(0);
  syncNav();
}

function showLogin() {
  setUser(null);
  showOnly('loginView');
  $('loginName').focus();
}

async function doLogin(e) {
  e.preventDefault();
  try {
    const password = $('loginPw').value;
    const { user } = await api('/api/login', { method: 'POST', body: { name: $('loginName').value, password } });
    $('loginPw').value = '';
    setUser(user);
    // 임시 비밀번호로 처음 들어왔으면 방금 입력한 비밀번호를 '지금 비밀번호' 칸에 채워 준다.
    if (user.mustChange) $('pwCurrent').value = password;
    route();
  } catch (err) { alert(err.message); }
}

async function doLogout() {
  if (!confirmLeave()) return;
  await api('/api/logout', { method: 'POST' });
  showLogin();
}

/* ───────────── 화면 이동 ───────────── */

function route() {
  const params = new URLSearchParams(location.search);
  toggleUserMenu(false);
  syncNav();
  setMenu(null);
  // 연습에서 뒤로 가면 다음 화면을 받기 전에 타이머·키·Wake Lock부터 멈춘다.
  if (!params.get('practice')) stopPractice();
  // 사용법은 로그인하지 않아도 볼 수 있다.
  if (params.has('help')) return showHelp();
  if (!state.user) return showLogin();
  if (state.user.mustChange) {
    showOnly(null); // 뒤 화면은 비우고 비밀번호 바꾸기 창만
    return openPasswordDialog(true);
  }
  if (!params.has('inbox')) refreshInboxBadge(); // 알림 화면은 목록 응답으로 배지를 맞춘다
  if (params.has('accounts') && state.user.role === 'teacher') return showAccounts();
  if (params.has('calendar')) { setMenu('calendar'); return showCalendar(params.get('date')); }
  if (params.has('board')) return showBoard(params.get('post'));
  if (params.has('inbox')) return showInbox();
  if (params.has('scripts')) return showList();
  // 대본 편집·방송용 보기는 '대본' 메뉴에 속한다.
  if (params.has('new')) { setMenu('scripts'); return newScript(); }
  if (params.get('id')) { setMenu('scripts'); return openScript(params.get('id'), params.get('tab')); }
  if (params.get('practice')) { setMenu('scripts'); return showPractice(params.get('practice')); }
  if (location.search) history.replaceState(null, '', '/'); // 학생의 ?accounts 같은 주소는 홈으로
  return showHome();
}

/* ───────────── 홈 · 게시판 · 알림 ───────────── */

/** 대본 목록을 받아 둔다. (대본 목록 화면용) */
async function loadScripts() {
  state.scripts = await api('/api/scripts');
  return state.scripts;
}

/**
 * 홈 묶음(/api/home)을 받는다. 늦게 온 예전 응답은 무시하고(요청 순번),
 * 실패하면 토스트 + 각 카드에 "불러오지 못했어요". 돌려주는 약속은 이번 주 버튼이 기다릴 때 쓴다.
 */
function loadHome() {
  const seq = ++state.homeSeq;
  state.homeLoaded = false;
  const req = api('/api/home');
  state.homeReq = req;
  req.then(data => {
    if (seq !== state.homeSeq) return;
    state.home = data;
    state.homeLoaded = true;
    renderHome();
  }, err => {
    if (seq !== state.homeSeq) return;
    state.homeReq = null; // 다음에 누르면 새로 받는다
    toast('홈을 불러오지 못했어요: ' + err.message);
    renderHomeError();
  });
  return req;
}

async function showHome() {
  showOnly('homeView');
  setMenu('home');
  const u = state.user;
  $('homeGreeting').textContent = u.role === 'teacher' ? `안녕하세요, ${u.name} 선생님` : `안녕하세요, ${u.name}님`;
  const now = new Date();
  $('homeDate').textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 ${'일월화수목금토'[now.getDay()]}요일`;
  // 처음 온 학생에게는 사용법 안내를 띄운다. (닫거나 사용법을 한 번 보면 다시 안 뜸)
  let seen = false;
  try { seen = !!localStorage.getItem(HELP_SEEN); } catch {}
  $('firstHelp').classList.toggle('hidden', seen || u.role === 'teacher');
  // 선생님: 검토 기다리는 대본 / 학생: 내 할 일
  const isTeacher = u.role === 'teacher';
  $('reviewCard').classList.toggle('hidden', !isTeacher);
  $('todoCard').classList.toggle('hidden', isTeacher);
  $('btnHomeNotice').classList.toggle('hidden', !isTeacher);
  state.home = null;
  renderThisWeek();
  ['reviewList', 'todoList', 'noticeList', 'upcomingList'].forEach(id => { $(id).innerHTML = skeleton(2, '불러오는 중…'); });
  ['reviewCount', 'todoCount'].forEach(id => $(id).classList.add('hidden'));
  try { await loadHome(); } catch { /* loadHome이 알린다 */ }
}

/** 홈 목록의 한 줄: 날짜 칸 + 제목·설명 + 오른쪽 칩. query로 실제 주소와 앱 안 이동을 함께 건다. */
function homeRow({ query, date, title, sub, chip = '' }) {
  return `
    <a class="upcoming-item" href="/${esc(query)}" data-go="${esc(query)}">
      <span class="up-date"><b>${Number(date.slice(8))}</b><span>${'일월화수목금토'[parseYmd(date).getDay()]}</span></span>
      <span class="grow"><b>${esc(title)}</b>${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}</span>
      ${chip ? `<span class="up-chips">${chip}</span>` : ''}
    </a>`;
}

/** 오늘·내일은 말로, 나머지는 '11월 6일' */
function homeDay(date) {
  const today = state.home?.today || localToday();
  const diff = Math.round((parseYmd(date) - parseYmd(today)) / 86400000);
  return diff === 0 ? '오늘' : diff === 1 ? '내일' : `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;
}

const scriptQuery = id => '?id=' + encodeURIComponent(id);
const statusBadge = s => `<span class="badge badge-${esc(s)}">${esc(s)}</span>`;

function setCount(id, n, label) {
  $(id).textContent = n;
  $(id).setAttribute('aria-label', `${label} ${n}개`);
  $(id).classList.toggle('hidden', !n);
}

function renderHome() {
  const h = state.home;
  // 창을 금요일 넘어 열어 두었어도 ?new 기본 방송일이 서버의 이번 주 금요일과 같게
  state.config.nextFriday = h.thisWeek.date;
  renderThisWeek();

  if (h.reviewQueue) {
    setCount('reviewCount', h.reviewQueue.length, '검토 기다리는 대본');
    $('reviewList').innerHTML = h.reviewQueue.length ? h.reviewQueue.map(s => homeRow({
      query: scriptQuery(s.id),
      date: s.broadcast_date,
      title: s.title || `${md(s.broadcast_date)} 대본`,
      sub: `${homeDay(s.broadcast_date)} 방송 · ${s.announcers || s.created_by || '-'}`,
      chip: statusBadge(s.status)
    })).join('')
      : '<div class="muted small up-empty">검토를 기다리는 대본이 없어요.</div>';
  }

  setCount('todoCount', h.todo.length, '내 할 일');
  $('todoList').innerHTML = h.todo.length ? h.todo.map(t => t.kind === 'notice'
    ? homeRow({
      query: postQuery(t.id),
      date: t.date,
      title: `공지 읽기: ${t.title}`,
      sub: '고정 공지를 아직 안 읽었어요',
      chip: '<span class="badge badge-new">새</span>'
    })
    : t.kind === 'comments'
    ? homeRow({
      query: `${scriptQuery(t.id)}&tab=${encodeURIComponent(t.section)}`,
      date: t.date,
      title: `선생님 의견 ${t.count}개 반영하기`,
      sub: `${md(t.date)} 대본${t.title ? ' · ' + t.title : ''}`,
      chip: `<span class="badge badge-comment">${icon('chat-circle-text')}의견 ${Number(t.count)}</span>`
    })
    : t.kind === 'script'
    ? homeRow({
      query: scriptQuery(t.id),
      date: t.date,
      title: `${md(t.date)} 대본 마저 쓰기`,
      sub: `${homeDay(t.date)} 방송${t.title ? ' · ' + t.title : ''}`,
      chip: statusBadge(t.status)
    })
    : homeRow({
      query: `?calendar&date=${t.date}`,
      date: t.date,
      title: `${homeDay(t.date)}${t.time ? ' ' + t.time : ''} ${t.title}`,
      sub: t.members.length ? `함께: ${t.members.join(', ')}` : '',
      chip: `<span class="cat cat-${esc(t.category)}">${esc(t.category)}</span>`
    })).join('')
    : `<div class="muted small up-empty">오늘은 할 일이 없어요. <a href="/?scripts" class="link-btn" data-go="?scripts">대본 목록을 둘러볼까요?</a></div>`;

  // 새 공지: 고정 공지 먼저, 그다음 최근 공지. 학생은 안 읽은 공지에 '새', 선생님은 읽음 수.
  $('noticeList').innerHTML = h.notices.length ? h.notices.map(n => homeRow({
    query: postQuery(n.id),
    date: n.created_at.slice(0, 10),
    title: n.title,
    sub: `${n.pinned ? '고정 · ' : ''}${n.created_by} · ${homeDay(n.created_at.slice(0, 10))}`,
    chip: noticeChip(n)
  })).join('')
    : `<div class="muted small up-empty">${state.user.role === 'teacher' ? '아직 공지가 없어요. 공지 쓰기로 방송부에 알려 보세요.' : '아직 공지가 없어요.'}</div>`;

  $('upcomingList').innerHTML = h.upcoming.length ? h.upcoming.map(e => homeRow({
    query: `?calendar&date=${e.date}`,
    date: e.date,
    title: e.label,
    sub: `${homeDay(e.date)}${e.time ? ' ' + e.time : ''}${e.members.length ? ', ' + e.members.join(', ') : ''}`,
    chip: `${e.hasScript ? `<span class="cat cat-script">${icon('microphone')}대본</span>` : ''}<span class="cat cat-${esc(e.category)}">${esc(e.category)}</span>`
  })).join('')
    : '<div class="muted small up-empty">다가오는 일정이 없어요. 캘린더에서 연습이나 회의 일정을 넣어 보세요.</div>';
}

function renderHomeError() {
  const msg = '<div class="muted small up-empty">불러오지 못했어요. 잠시 뒤 다시 열어 보세요.</div>';
  ['reviewList', 'todoList', 'noticeList', 'upcomingList'].forEach(id => { $(id).innerHTML = msg; });
}

/* ───────────── 게시판: 선생님 공지 + 부원 메모 ─────────────
   목록에서 글을 누르면 그 자리에서 펼쳐지고 주소가 ?board&post=<id>로 바뀐다.
   학생이 공지를 펼치면 읽음으로 기록하고, 선생님은 공지마다 읽은/안 읽은 부원을 본다.
   고치기·지우기 버튼은 서버가 알려 준 canEdit/canDelete대로만 보인다(서버도 다시 확인). */

const postQuery = id => '?board&post=' + encodeURIComponent(id);
/** 공지 옆 칩: 선생님은 읽음 수, 학생은 안 읽었으면 '새' */
const noticeChip = n => n.readCount !== undefined
  ? `<span class="badge" aria-label="읽음 ${n.readCount}명, 전체 ${n.total}명">읽음 ${n.readCount}/${n.total}</span>`
  : n.unread ? '<span class="badge badge-new">새</span>' : '';

state.board = { kind: '', posts: [], more: false, failed: false, extra: null, open: null, readsOpen: null, reads: {}, seq: 0, editing: null, newKind: 'memo' };

const allPosts = () => state.board.extra ? [state.board.extra, ...state.board.posts] : state.board.posts;
const findPost = id => allPosts().find(p => p.id === id);
const boardVisible = () => !$('boardView').classList.contains('hidden');

async function showBoard(postId) {
  showOnly('boardView');
  setMenu('board');
  const isTeacher = state.user.role === 'teacher';
  $('btnNewNotice').classList.toggle('hidden', !isTeacher);
  // 강조 버튼은 하나만: 선생님은 '공지 쓰기', 학생은 '메모 쓰기'
  $('btnNewMemo').className = isTeacher ? 'btn-ghost' : 'btn-primary';
  const b = state.board;
  b.open = postId || null;
  b.extra = null;
  b.readsOpen = null;
  if (postId) b.kind = ''; // 주소로 연 글은 '전체'에서 찾는다
  renderBoardTabs();
  await loadBoard();
  if (postId && boardVisible()) await revealPost(postId);
}

function renderBoardTabs() {
  document.querySelectorAll('#boardTabs [data-kind]').forEach(btn => {
    const on = btn.dataset.kind === state.board.kind;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on);
  });
}

/** 목록을 받는다. append면 '더 보기'(마지막 고정 아닌 글보다 오래된 20개) */
async function loadBoard(append = false) {
  const b = state.board;
  const seq = ++b.seq;
  const params = new URLSearchParams();
  if (b.kind) params.set('kind', b.kind);
  if (append) {
    const last = b.posts.filter(p => !p.pinned).at(-1);
    if (!last) return;
    params.set('before', last.id);
  } else {
    $('postList').innerHTML = skeleton(3, '글을 불러오는 중…');
    $('btnMorePosts').classList.add('hidden');
  }
  $('btnMorePosts').disabled = true;
  try {
    const r = await api('/api/posts' + (params.toString() ? '?' + params : ''));
    if (seq !== b.seq) return;
    b.posts = append ? [...b.posts, ...r.posts.filter(p => !b.posts.some(x => x.id === p.id))] : r.posts;
    b.more = r.more;
    b.failed = false;
    if (b.extra && b.posts.some(p => p.id === b.extra.id)) b.extra = null;
  } catch (err) {
    if (seq !== b.seq) return;
    toast('게시판을 불러오지 못했어요: ' + err.message);
    if (!append) { b.posts = []; b.more = false; b.failed = true; }
  } finally {
    if (seq === b.seq) $('btnMorePosts').disabled = false;
  }
  renderBoard();
}

/** 주소로 연 글: 목록에 없으면 하나만 받아 맨 위에 보여 준다. 없는 글이면 토스트 후 ?board */
async function revealPost(id) {
  const b = state.board;
  if (!findPost(id)) {
    try {
      const post = await api('/api/posts/' + encodeURIComponent(id));
      if (b.open !== id || !boardVisible()) return;
      b.extra = post;
    } catch (err) {
      if (b.open !== id) return;
      toast(err.status === 404 ? '글을 찾을 수 없어요. 지워졌을 수 있어요.' : '글을 불러오지 못했어요: ' + err.message);
      b.open = null;
      history.replaceState(null, '', '/?board');
      renderBoard();
      return;
    }
  }
  renderBoard();
  markPostRead(id);
  document.querySelector(`#postList [data-post="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderBoard() {
  const b = state.board;
  $('btnMorePosts').classList.toggle('hidden', !b.more);
  const list = allPosts();
  if (!list.length) {
    $('postList').innerHTML = b.failed
      ? '<div class="card empty-card"><p class="muted">게시판을 불러오지 못했어요. 잠시 뒤 다시 열어 보세요.</p></div>'
      : `<div class="card empty-card"><span class="login-mark">${icon('push-pin', true)}</span>
          <p class="muted">${b.kind === 'notice' ? '아직 공지가 없어요.'
            : b.kind === 'memo' ? '아직 메모가 없어요. 방송부에 알리고 싶은 것을 메모로 남겨 보세요.'
            : '아직 글이 없어요. 방송부에 알리고 싶은 것을 메모로 남겨 보세요.'}</p></div>`;
    return;
  }
  $('postList').innerHTML = list.map(renderPost).join('');
}

function renderPost(p) {
  const b = state.board;
  const open = b.open === p.id;
  const id = esc(p.id);
  const isNotice = p.kind === 'notice';
  const teacherView = p.readCount !== undefined;
  const author = `${p.created_by}${p.created_by_uid ? '' : ' 선생님'}`;
  const head = `
    <button type="button" class="post-row" data-toggle="${id}" aria-expanded="${open}">
      ${p.pinned ? `<span class="post-pin" title="맨 위에 고정">${icon('push-pin', true)}<span class="sr-only">고정</span></span>` : ''}
      <span class="cat cat-${isNotice ? 'notice' : 'memo'}">${isNotice ? '공지' : '메모'}</span>
      <span class="grow post-head"><b class="post-title">${esc(p.title)}</b><span class="muted small">${esc(author)} · ${md(p.created_at.slice(0, 10))}</span></span>
      ${isNotice ? noticeChip(p) : ''}
      <span class="post-caret">${icon(open ? 'caret-up' : 'caret-down')}</span>
    </button>`;
  if (!open) return `<article class="post-item${p.pinned ? ' pinned' : ''}" data-post="${id}">${head}</article>`;
  const edited = p.updated_at !== p.created_at;
  return `
  <article class="post-item open${p.pinned ? ' pinned' : ''}" data-post="${id}">
    ${head}
    <div class="post-body">
      ${p.body.trim() ? `<p class="post-text">${esc(p.body)}</p>` : '<p class="muted small">내용 없이 제목만 있어요.</p>'}
      <p class="muted small post-meta">${esc(p.created_at.slice(0, 16))}${edited ? ` · ${esc(p.updated_by)}님이 ${esc(p.updated_at.slice(5, 16))}에 고침` : ''}</p>
      ${teacherView || p.canEdit || p.canDelete ? `<div class="post-actions">
        ${teacherView ? `<button type="button" class="btn-soft btn-sm" data-reads="${id}" aria-expanded="${b.readsOpen === p.id}">${icon('users-three')}읽음 ${p.readCount} / ${p.total}</button>` : ''}
        <span class="grow"></span>
        ${p.canEdit ? `<button type="button" class="btn-ghost btn-sm" data-edit-post="${id}">${icon('pencil-simple')}고치기</button>` : ''}
        ${p.canDelete ? `<button type="button" class="btn-danger btn-sm" data-delete-post="${id}">${icon('trash')}지우기</button>` : ''}
      </div>` : ''}
      ${teacherView && b.readsOpen === p.id ? renderReads(p.id) : ''}
    </div>
  </article>`;
}

/** 선생님 읽음 명단: 읽은 부원 / 아직 안 읽은 부원 이름 칩 두 줄 */
function renderReads(id) {
  const r = state.board.reads[id];
  if (!r) return `<div class="post-reads" aria-live="polite">${skeleton(1, '명단을 불러오는 중…')}</div>`;
  if (r.error) return `<div class="post-reads muted small" aria-live="polite">명단을 불러오지 못했어요: ${esc(r.error)}</div>`;
  const tags = names => names.length
    ? names.map(n => `<span class="member-tag">${esc(n)}</span>`).join('')
    : '<span class="muted small">없어요</span>';
  return `<div class="post-reads" aria-live="polite">
    <div class="reads-row"><b class="small">읽은 부원 ${r.read.length}</b><div class="reads-tags">${tags(r.read)}</div></div>
    <div class="reads-row"><b class="small">아직 안 읽은 부원 ${r.unread.length}</b><div class="reads-tags">${tags(r.unread)}</div></div>
  </div>`;
}

function togglePost(id) {
  const b = state.board;
  b.open = b.open === id ? null : id;
  b.readsOpen = null;
  history.replaceState(null, '', '/' + (b.open ? postQuery(b.open) : '?board'));
  renderBoard();
  if (b.open) markPostRead(b.open);
}

/** 학생이 안 읽은 공지를 펼치면 읽음 기록 ('새' 칩은 바로 지운다) */
async function markPostRead(id) {
  const p = findPost(id);
  if (!p || p.kind !== 'notice' || !p.unread || state.user.role === 'teacher') return;
  p.unread = false;
  renderBoard();
  try { await api(`/api/posts/${encodeURIComponent(id)}/read`, { method: 'POST' }); }
  catch (err) { p.unread = true; renderBoard(); toast('읽음 기록을 남기지 못했어요: ' + err.message); }
}

async function toggleReads(id) {
  const b = state.board;
  b.readsOpen = b.readsOpen === id ? null : id;
  if (!b.readsOpen) return renderBoard();
  b.reads[id] = null; // 열 때마다 새로 받는다
  renderBoard();
  try {
    const r = await api(`/api/posts/${encodeURIComponent(id)}/reads`);
    b.reads[id] = r;
    const p = findPost(id);
    if (p) { p.readCount = r.read.length; p.total = r.read.length + r.unread.length; }
  } catch (err) {
    b.reads[id] = { error: err.message };
  }
  if (boardVisible()) renderBoard();
}

/* ── 글 쓰기·고치기 창 ── */

function updatePostCount() {
  $('postBodyCount').textContent = `${$('postBody').value.length} / 2000`;
}

function openPostDialog(kind, post = null) {
  const b = state.board;
  b.editing = post;
  b.newKind = post ? post.kind : kind;
  const isNotice = b.newKind === 'notice';
  $('postDialogTitle').innerHTML = post
    ? icon('pencil-simple') + (isNotice ? '공지 고치기' : '메모 고치기')
    : isNotice ? icon('megaphone') + '공지 쓰기' : icon('note-pencil') + '메모 쓰기';
  $('postTitle').value = post?.title || '';
  $('postBody').value = post?.body || '';
  $('postPinRow').classList.toggle('hidden', !isNotice);
  $('postPinned').checked = !!post?.pinned;
  $('btnSavePost').textContent = post ? '고치기' : '올리기';
  updatePostCount();
  $('postDialog').showModal();
  $('postTitle').focus();
}

async function savePost(e) {
  e.preventDefault();
  const b = state.board;
  const editing = b.editing;
  const body = { title: $('postTitle').value.trim(), body: $('postBody').value, pinned: $('postPinned').checked };
  if (!body.title) return $('postTitle').focus();
  if (!editing) body.kind = b.newKind;
  $('btnSavePost').disabled = true;
  try {
    const saved = await api(editing ? '/api/posts/' + encodeURIComponent(editing.id) : '/api/posts', { method: editing ? 'PUT' : 'POST', body });
    $('postDialog').close();
    toast(editing ? '글을 고쳤어요.' : saved.kind === 'notice' ? '공지를 올렸어요.' : '메모를 올렸어요.');
    if (boardVisible()) {
      if (!editing && b.kind && b.kind !== saved.kind) { b.kind = ''; renderBoardTabs(); }
      if (b.extra?.id === saved.id) b.extra = saved;
      b.open = saved.id;
      b.readsOpen = null;
      history.replaceState(null, '', '/' + postQuery(saved.id));
      await loadBoard();
      // '더 보기'로 받은 글을 고쳤으면 첫 쪽에 없으니 맨 위에 따로 보여 준다.
      if (!findPost(saved.id)) { b.extra = saved; renderBoard(); }
    } else if (!$('homeView').classList.contains('hidden')) {
      loadHome();
    }
  } catch (err) {
    toast(err.message); // 창은 그대로 두어 고쳐서 다시 올릴 수 있게
  } finally {
    $('btnSavePost').disabled = false;
  }
}

async function removePost(id) {
  const b = state.board;
  const p = findPost(id);
  if (!p || !confirm(`'${p.title}' 글을 지울까요? 되돌릴 수 없어요.`)) return;
  try {
    await api('/api/posts/' + encodeURIComponent(id), { method: 'DELETE' });
    toast('글을 지웠어요.');
    if (b.open === id) { b.open = null; history.replaceState(null, '', '/?board'); }
    if (b.extra?.id === id) b.extra = null;
    await loadBoard();
  } catch (err) {
    toast(err.message);
    if (err.status === 404) { // 다른 사람이 먼저 지웠으면 목록을 새로 받는다
      if (b.open === id) { b.open = null; history.replaceState(null, '', '/?board'); }
      if (b.extra?.id === id) b.extra = null;
      await loadBoard();
    }
  }
}

/* ───────────── 알림 ─────────────
   메뉴 배지는 화면을 옮길 때마다 안 읽은 수를 새로 받는다(늦게 온 예전 응답은 무시). 실시간 갱신은 없다.
   알림을 누르면 읽음 처리를 마친 뒤 그 화면으로 간다. */

const INBOX_ICONS = { notice: 'push-pin', comment: 'chat-circle-text', done: 'check-circle', calendar: 'calendar-dots', review: 'paper-plane-right' };

function setInboxBadge(n) {
  const b = $('inboxBadge');
  // 화면 읽기 프로그램은 span의 aria-label을 안 읽을 수 있어 숨은 글자로 뜻을 붙인다
  b.innerHTML = `<span class="sr-only">안 읽은 알림 </span>${n > 99 ? '99+' : n}<span class="sr-only">개</span>`;
  b.classList.toggle('hidden', !n);
}

async function refreshInboxBadge() {
  const seq = ++state.inboxSeq;
  try {
    const { unread } = await api('/api/notifications/count');
    if (seq === state.inboxSeq) setInboxBadge(unread);
  } catch { /* 배지는 다음 이동 때 다시 받는다 */ }
}

/** 알림이 가리키는 화면 주소 */
function inboxQuery(n) {
  if (n.kind === 'notice') return postQuery(n.ref_id);
  if (n.kind === 'calendar') return `?calendar&date=${encodeURIComponent(n.ref_date)}`;
  if (n.kind === 'comment' && n.ref_date) return `${scriptQuery(n.ref_id)}&tab=${encodeURIComponent(n.ref_date)}`;
  return scriptQuery(n.ref_id);
}

/** 서버 시각 기준 '방금 / n분 전 / n시간 전 / 어제 / 11/6' */
function timeAgo(at, now) {
  const t = s => Date.parse(s.replace(' ', 'T'));
  const min = Math.floor((t(now) - t(at)) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (min < 24 * 60 && at.slice(0, 10) === now.slice(0, 10)) return `${Math.floor(min / 60)}시간 전`;
  const days = Math.round((t(now.slice(0, 10)) - t(at.slice(0, 10))) / 86400000);
  return days === 1 ? '어제' : md(at.slice(0, 10));
}

async function showInbox() {
  showOnly('inboxView');
  setMenu('inbox');
  $('inboxList').innerHTML = skeleton(3, '알림을 불러오는 중…');
  $('btnReadAll').disabled = true;
  const seq = ++state.inboxSeq;
  let data;
  try { data = await api('/api/notifications'); }
  catch (err) {
    if (seq !== state.inboxSeq) return;
    toast('알림을 불러오지 못했어요: ' + err.message);
    $('inboxList').innerHTML = '<div class="card empty-card"><p class="muted">알림을 불러오지 못했어요. 잠시 뒤 다시 열어 보세요.</p></div>';
    return;
  }
  if (seq !== state.inboxSeq) return;
  setInboxBadge(data.unread);
  $('btnReadAll').disabled = !data.unread;
  $('inboxList').innerHTML = data.items.length ? data.items.map(n => {
    const unread = !n.read_at;
    const q = inboxQuery(n);
    return `<a class="inbox-item${unread ? ' unread' : ''}" href="/${esc(q)}" data-notif="${esc(n.id)}" data-q="${esc(q)}">
      <span class="inbox-dot" aria-hidden="true"></span>
      <span class="inbox-icon">${icon(INBOX_ICONS[n.kind] || 'bell')}</span>
      <span class="grow inbox-text">${unread ? '<span class="sr-only">안 읽음: </span>' : ''}${esc(n.text)}</span>
      <span class="muted small inbox-time">${esc(timeAgo(n.created_at, data.now))}</span>
    </a>`;
  }).join('')
    : `<div class="card empty-card"><span class="login-mark">${icon('bell', true)}</span><p class="muted">새 소식이 없어요.</p></div>`;
}

/** 알림 하나 누름: 안 읽었으면 읽음 처리를 마치고 이동 */
async function openNotification(a) {
  if (a.classList.contains('unread')) {
    try { await api(`/api/notifications/${encodeURIComponent(a.dataset.notif)}/read`, { method: 'POST' }); }
    catch (err) { toast('읽음 표시를 남기지 못했어요: ' + err.message); }
  }
  navigate(a.dataset.q);
}

async function readAllNotifications() {
  $('btnReadAll').disabled = true;
  try { await api('/api/notifications/read-all', { method: 'POST' }); setInboxBadge(0); toast('모두 읽음으로 바꿨어요.'); }
  catch (err) { toast(err.message); }
  if (!$('inboxView').classList.contains('hidden')) showInbox();
}

/* ───────────── 방송부 일정 캘린더 ─────────────
   한 달 달력 + 고른 날의 일정 목록. 대본이 있는 날에는 대본도 함께 보여 준다.
   부원 누구나 일정을 넣고 고치며, 지난 일정에는 '기록'을 남긴다. */

const pad2 = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const localToday = () => ymd(new Date());
const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dayLabel = s => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${'일월화수목금토'[d.getDay()]})`; };

state.cal = { month: null, selected: null, events: [], scripts: [], members: null };

async function showCalendar(date) {
  showOnly('calendarView');
  $('btnMorningDuty').classList.toggle('hidden', state.user.role !== 'teacher');
  const sel = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (state.cal.selected || localToday());
  state.cal.selected = sel;
  state.cal.month = sel.slice(0, 7);
  await loadCalendar();
}

/** 달력에 보이는 6주(42일) 범위의 일정과 대본을 불러온다. */
async function loadCalendar() {
  const [y, m] = state.cal.month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - first.getDay());
  const end = new Date(start); end.setDate(start.getDate() + 41);
  state.cal.range = { start: ymd(start), end: ymd(end) };
  $('calTitle').textContent = `${y}년 ${m}월`;
  renderCalendar(); // 불러오는 동안 빈 달력부터
  try {
    const r = await api(`/api/calendar?from=${state.cal.range.start}&to=${state.cal.range.end}`);
    state.cal.events = r.events;
    state.cal.scripts = r.scripts;
  } catch (err) {
    toast('일정을 불러오지 못했어요: ' + err.message);
  }
  renderCalendar();
  renderDay();
}

function itemsOn(date) {
  return {
    scripts: state.cal.scripts.filter(s => s.date === date),
    events: state.cal.events.filter(e => e.date === date)
  };
}

function renderCalendar() {
  const { start } = state.cal.range;
  const today = localToday();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = parseYmd(start); d.setDate(d.getDate() + i);
    const date = ymd(d);
    const { scripts, events } = itemsOn(date);
    const chips = [
      ...scripts.slice(0, 1).map(() => `<span class="cal-item cat-script">${icon('microphone')}<span>대본</span></span>`),
      ...events.map(e => `<span class="cal-item cat-${esc(e.category)}"><span>${esc(e.label)}</span></span>`)
    ];
    const shown = chips.slice(0, 3).join('');
    const more = chips.length > 3 ? `<span class="cal-more">+${chips.length - 3}</span>` : '';
    const cls = ['cal-day',
      date.slice(0, 7) !== state.cal.month ? 'other' : '',
      date === today ? 'today' : '',
      date === state.cal.selected ? 'selected' : '',
      d.getDay() === 0 ? 'sun' : d.getDay() === 6 ? 'sat' : ''].join(' ');
    const count = scripts.length + events.length;
    cells.push(`<button type="button" class="${cls}" data-date="${date}" aria-label="${dayLabel(date)}${count ? `, 일정 ${count}개` : ''}">
      <span class="d-num">${d.getDate()}</span><span class="cal-items">${shown}${more}</span>
      ${count ? `<span class="cal-count">${count}</span>` : ''}</button>`);
  }
  $('calGrid').innerHTML = cells.join('');
}

function renderDay() {
  const date = state.cal.selected;
  const today = localToday();
  $('dayTitle').innerHTML = `${icon('calendar-blank')}${dayLabel(date)}${date === today ? ' <span class="badge badge-new">오늘</span>' : ''}`;
  const { scripts, events } = itemsOn(date);
  const isTeacher = state.user.role === 'teacher';
  const scriptRows = scripts.map(s => `
    <a class="day-item script-item" href="/?id=${encodeURIComponent(s.id)}" data-script="${esc(s.id)}">
      <span class="cat cat-script">${icon('microphone')}대본</span>
      <span class="grow"><b>${esc(s.title) || '금요방송 대본'}</b><span class="muted small"> ${esc(s.announcers)}</span></span>
      <span class="badge badge-${esc(s.status)}">${esc(s.status)}</span>
    </a>`);
  const eventRows = events.map(e => {
    const past = e.date <= today;
    const canDelete = isTeacher || (state.user.uid && e.created_by_uid === state.user.uid);
    const canEdit = isTeacher || e.category !== '아침방송'; // 아침방송 담당은 선생님만 고친다
    return `
    <article class="day-item event-item" data-event="${esc(e.id)}">
      <div class="event-top">
        <span class="cat cat-${esc(e.category)}">${esc(e.category)}</span>
        ${e.time ? `<span class="event-time">${icon('clock')}${esc(e.time)}</span>` : ''}
        <b class="grow">${esc(e.label)}</b>
        ${canEdit ? `<button type="button" class="btn-ghost btn-sm" data-edit="${esc(e.id)}">${icon('pencil-simple')}<span class="hide-sm">고치기</span></button>` : ''}
      </div>
      ${e.members.length ? `<div class="event-members">${icon('users-three')}${e.members.map(m => `<span class="member-tag">${esc(m)}</span>`).join('')}</div>` : ''}
      ${e.note ? `<p class="event-note">${esc(e.note)}</p>` : ''}
      ${e.record
        ? `<div class="event-record">${icon('notebook')}<div><b>기록</b><p>${esc(e.record)}</p></div></div>`
        : past && canEdit ? `<button type="button" class="btn-soft btn-sm" data-record="${esc(e.id)}">${icon('notebook')}기록 남기기</button>` : ''}
      <div class="muted small event-meta">${esc(e.created_by)}님이 만듦${e.updated_by !== e.created_by ? `, ${esc(e.updated_by)}님이 고침` : ''}${canDelete ? '' : ''}</div>
    </article>`;
  });
  $('dayList').innerHTML = [...scriptRows, ...eventRows].join('') ||
    `<div class="day-empty muted">${icon('calendar-blank')}이날은 아직 일정이 없어요. <b>이날 일정 추가</b>를 눌러 넣어 보세요.</div>`;
}

function selectDay(date) {
  state.cal.selected = date;
  history.replaceState(null, '', `/?calendar&date=${date}`);
  if (date.slice(0, 7) !== state.cal.month) {
    state.cal.month = date.slice(0, 7);
    return loadCalendar();
  }
  renderCalendar();
  renderDay();
}

function moveMonth(delta) {
  const [y, m] = state.cal.month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.cal.month = ymd(d).slice(0, 7);
  state.cal.selected = ymd(d);
  loadCalendar();
}

/* ── 일정 넣기·고치기 창 ── */

async function loadMembers() {
  if (state.cal.members) return state.cal.members;
  try { state.cal.members = await api('/api/members'); } catch { state.cal.members = []; }
  return state.cal.members;
}

function setCategory(cat) {
  document.querySelectorAll('#evCategory [data-cat]').forEach(b => {
    const on = b.dataset.cat === cat;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', on);
  });
  state.cal.category = cat;
}

function renderMemberPicks(selected) {
  const names = [...new Set([...(state.cal.members || []), ...selected])];
  $('evMembers').innerHTML = names.length
    ? names.map(n => `<button type="button" class="member-pick${selected.includes(n) ? ' on' : ''}" data-member="${esc(n)}" aria-pressed="${selected.includes(n)}">${esc(n)}</button>`).join('')
    : '<span class="muted small">학생 계정이 아직 없어요.</span>';
}

function updateRecordVisibility() {
  const d = $('evDate').value;
  const show = (d && d <= localToday()) || $('evRecord').value.trim();
  $('evRecordField').classList.toggle('hidden', !show);
}

async function openEventDialog(ev, date, { focusRecord = false } = {}) {
  state.cal.editing = ev || null;
  $('eventDialogTitle').innerHTML = (ev ? icon('pencil-simple') + '일정 고치기' : icon('calendar-plus') + '일정 추가');
  $('evTitle').value = ev?.title || '';
  $('evDate').value = ev?.date || date || state.cal.selected || localToday();
  $('evTime').value = ev?.time || '';
  $('evNote').value = ev?.note || '';
  $('evRecord').value = ev?.record || '';
  setCategory(ev?.category || '연습');
  $('evCategory').closest('.field').classList.toggle('hidden', ev?.category === '아침방송'); // 담당 창에서만 만드는 종류
  const canDelete = ev && (state.user.role === 'teacher' || (state.user.uid && ev.created_by_uid === state.user.uid));
  $('btnDeleteEvent').classList.toggle('hidden', !canDelete);
  updateRecordVisibility();
  renderMemberPicks(ev?.members || []);
  $('eventDialog').showModal();
  (focusRecord ? $('evRecord') : $('evTitle')).focus();
  await loadMembers();
  renderMemberPicks(selectedMembers().length ? selectedMembers() : (ev?.members || []));
}

const selectedMembers = () => [...document.querySelectorAll('#evMembers .member-pick.on')].map(b => b.dataset.member);

async function saveEvent(e) {
  e.preventDefault();
  const body = {
    title: $('evTitle').value.trim(),
    date: $('evDate').value,
    time: $('evTime').value,
    category: state.cal.category,
    members: selectedMembers(),
    note: $('evNote').value.trim(),
    record: $('evRecord').value.trim()
  };
  if (!body.title) return $('evTitle').focus();
  $('btnSaveEvent').disabled = true;
  try {
    const ev = state.cal.editing;
    await api(ev ? '/api/calendar/' + ev.id : '/api/calendar', { method: ev ? 'PUT' : 'POST', body });
    $('eventDialog').close();
    toast(ev ? '일정을 고쳤어요.' : '일정을 넣었어요.');
    state.cal.selected = body.date;
    state.cal.month = body.date.slice(0, 7);
    await loadCalendar();
  } catch (err) {
    alert(err.message);
  } finally {
    $('btnSaveEvent').disabled = false;
  }
}

async function removeEvent() {
  const ev = state.cal.editing;
  if (!ev || !confirm(`'${ev.title}' 일정을 지울까요? 되돌릴 수 없어요.`)) return;
  try {
    await api('/api/calendar/' + ev.id, { method: 'DELETE' });
    $('eventDialog').close();
    toast('일정을 지웠어요.');
    await loadCalendar();
  } catch (err) { alert(err.message); }
}

/* ── 아침방송 담당 창 (선생님) ──
   고른 날이 있는 주의 월~금 담당을 한 명씩 골라 한 번에 저장한다. */

async function openDutyDialog() {
  const d = parseYmd(state.cal.selected || localToday());
  d.setDate(d.getDate() - (d.getDay() + 6) % 7); // 그 주 월요일 (토·일은 지나간 월요일)
  state.cal.dutyStart = ymd(d);
  $('dutyDialog').showModal();
  await loadDuty();
}

function dutyDays() {
  const d = parseYmd(state.cal.dutyStart);
  return [0, 1, 2, 3, 4].map(n => { const x = new Date(d); x.setDate(d.getDate() + n); return ymd(x); });
}

async function loadDuty() {
  const days = dutyDays();
  const start = state.cal.dutyStart;
  $('dutyRange').textContent = `${dayLabel(days[0]).split(' (')[0]} ~ ${dayLabel(days[4]).split(' (')[0]}`;
  $('dutyRows').innerHTML = '';
  $('btnSaveDuty').disabled = true;
  let current = {};
  try {
    const [r] = await Promise.all([api(`/api/calendar?from=${days[0]}&to=${days[4]}`), loadMembers()]);
    for (const e of r.events) if (e.category === '아침방송' && !current[e.date]) current[e.date] = e.members[0] || '';
  } catch (err) { toast('담당을 불러오지 못했어요: ' + err.message); return; }
  if (state.cal.dutyStart !== start) return; // 그사이 다른 주로 옮김
  $('dutyRows').innerHTML = days.map(date => {
    const now = current[date] || '';
    const names = [...new Set([...state.cal.members, ...(now ? [now] : [])])];
    return `<div class="field duty-row"><label for="duty-${date}">${dayLabel(date)}</label>
      <select id="duty-${date}" data-duty="${date}">
        <option value="">담당 없음</option>
        ${names.map(n => `<option value="${esc(n)}"${n === now ? ' selected' : ''}>${esc(n)}</option>`).join('')}
      </select></div>`;
  }).join('');
  $('btnSaveDuty').disabled = false;
}

function moveDutyWeek(delta) {
  const d = parseYmd(state.cal.dutyStart);
  d.setDate(d.getDate() + delta * 7);
  state.cal.dutyStart = ymd(d);
  loadDuty();
}

async function saveDuty(e) {
  e.preventDefault();
  const duty = {};
  document.querySelectorAll('#dutyRows [data-duty]').forEach(s => { duty[s.dataset.duty] = s.value; });
  $('btnSaveDuty').disabled = true;
  try {
    await api('/api/calendar/morning', { method: 'PUT', body: { start: state.cal.dutyStart, duty } });
    $('dutyDialog').close();
    toast('아침방송 담당을 저장했어요.');
    await loadCalendar();
  } catch (err) {
    alert(err.message);
  } finally {
    $('btnSaveDuty').disabled = false;
  }
}

/* ───────────── 사용법 ───────────── */

const HELP_SEEN = 'helpSeen';

function markHelpSeen() {
  try { localStorage.setItem(HELP_SEEN, '1'); } catch {}
  $('firstHelp').classList.add('hidden');
}

function showHelp() {
  showOnly('helpView');
  const isTeacher = state.user?.role === 'teacher';
  document.querySelectorAll('#helpView .teacher-only').forEach(el => el.classList.toggle('hidden', !isTeacher));
  $('btnHelpStart').innerHTML = state.user
    ? icon('house') + '홈으로 가기'
    : icon('sign-in') + '로그인하러 가기';
  markHelpSeen();
}

/** 앱 안에서 사용법으로 왔으면 보던 화면으로, 주소로 바로 왔으면 첫 화면으로 */
function leaveHelp() {
  if (state.helpFromApp) { state.helpFromApp = false; history.back(); }
  else navigate('');
}

function openHelp() {
  if (!confirmLeave()) return;
  state.helpFromApp = true;
  navigate('?help');
}

/* ───────────── 비밀번호 바꾸기 (학생) ───────────── */

function openPasswordDialog(forced = false) {
  $('mustChangeNotice').classList.toggle('hidden', !forced);
  $('btnClosePassword').classList.toggle('hidden', forced);
  $('passwordDialog').dataset.forced = forced ? '1' : '';
  if (!forced) $('pwCurrent').value = '';
  $('pwNext').value = $('pwNext2').value = '';
  $('passwordDialog').showModal();
  (forced && $('pwCurrent').value ? $('pwNext') : $('pwCurrent')).focus();
}

async function submitPassword(e) {
  e.preventDefault();
  if ($('pwNext').value !== $('pwNext2').value) return alert('새 비밀번호 두 칸이 서로 달라요.');
  try {
    await api('/api/password', { method: 'POST', body: { current: $('pwCurrent').value, next: $('pwNext').value } });
    $('pwCurrent').value = '';
    $('passwordDialog').close();
    toast('비밀번호를 바꿨어요. 다음부터 새 비밀번호로 들어와요.');
    if (state.user.mustChange) { state.user.mustChange = false; route(); }
  } catch (err) { alert(err.message); }
}

/* ───────────── 학생 계정 관리 (선생님) ───────────── */

async function showAccounts() {
  showOnly('accountsView');
  $('userBody').innerHTML = '<tr><td colspan="5" class="muted">불러오는 중…</td></tr>';
  try {
    const users = await api('/api/users');
    $('userCount').textContent = `(${users.filter(u => u.active).length}명 사용 중)`;
    $('userBody').innerHTML = users.length ? users.map(u => `
      <tr class="${u.active ? '' : 'inactive'}" data-uid="${esc(u.id)}">
        <td>${esc(u.name)}</td>
        <td>${esc(u.login_id)}</td>
        <td>${u.active ? (u.must_change ? '<span class="badge badge-검토요청">첫 로그인 전</span>' : '<span class="badge badge-완료">사용 중</span>') : '<span class="badge">사용 중지</span>'}</td>
        <td class="muted">${esc(u.last_login_at) || '-'}</td>
        <td class="actions">
          <button data-act="rename">이름 바꾸기</button>
          <button data-act="reset">비밀번호 초기화</button>
          <button data-act="toggle">${u.active ? '사용 중지' : '다시 사용'}</button>
          <button data-act="delete" class="btn-danger">삭제</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="5" class="muted">아직 학생 계정이 없어요. 위에서 이름을 입력해 만들어 주세요.</td></tr>';
    state.users = users;
  } catch (err) { $('userBody').innerHTML = `<tr><td colspan="5">${esc(err.message)}</td></tr>`; }
}

function showIssued(list) {
  $('issuedBody').innerHTML = list.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.login_id)}</td><td>${esc(u.password)}</td></tr>`).join('');
  $('issuedBox').classList.remove('hidden');
  $('issuedBox').scrollIntoView({ behavior: 'smooth' });
}

async function addUsers() {
  const names = $('newNames').value.split('\n').map(s => s.trim()).filter(Boolean);
  if (!names.length) return alert('학생 이름을 입력해 주세요.');
  try {
    const created = await api('/api/users', { method: 'POST', body: { users: names.map(name => ({ name })) } });
    $('newNames').value = '';
    showIssued(created);
    toast(`${created.length}명의 계정을 만들었어요.`);
    showAccounts().then(() => $('issuedBox').scrollIntoView());
  } catch (err) { alert(err.message); }
}

async function userAction(act, uid) {
  const u = state.users.find(x => x.id === uid);
  if (!u) return;
  try {
    if (act === 'rename') {
      const name = prompt('새 이름 (대본과 화면에 보이는 이름)', u.name);
      if (name === null) return;
      const loginId = prompt('아이디 (로그인할 때 쓰는 이름)', u.login_id);
      if (loginId === null) return;
      await api('/api/users/' + uid, { method: 'PUT', body: { name, login_id: loginId } });
      toast('바꿨어요.');
    } else if (act === 'reset') {
      if (!confirm(`${u.name} 학생의 비밀번호를 새 임시 비밀번호로 바꿀까요?`)) return;
      showIssued([await api(`/api/users/${uid}/reset`, { method: 'POST' })]);
    } else if (act === 'toggle') {
      await api('/api/users/' + uid, { method: 'PUT', body: { active: !u.active } });
      toast(u.active ? `${u.name} 학생은 이제 로그인할 수 없어요.` : `${u.name} 학생이 다시 로그인할 수 있어요.`);
    } else if (act === 'delete') {
      if (!confirm(`${u.name} 학생 계정을 삭제할까요?\n이 학생이 쓴 대본은 그대로 남아요. 되돌릴 수 없어요.`)) return;
      await api('/api/users/' + uid, { method: 'DELETE' });
      toast('계정을 삭제했어요.');
    }
    await showAccounts();
  } catch (err) { alert(err.message); }
}

/* ───────────── 목록 ───────────── */

async function showList() {
  showOnly('listView');
  setMenu('scripts');
  $('listBox').innerHTML = '<div class="card muted">불러오는 중…</div>';
  try {
    await loadScripts();
    renderList();
  } catch (err) { $('listBox').innerHTML = `<div class="card">${esc(err.message)}</div>`; }
}

/** 이번 주(다음 금요일) 대본이 이미 있으면 그 대본 요약 (홈 묶음 기준) */
const thisWeekScript = () => state.home?.thisWeek?.script || null;

/** 홈의 큰 빨강 '이번 주 대본' 버튼 문구 */
function renderThisWeek() {
  const tw = thisWeekScript();
  const date = state.home?.thisWeek?.date || state.config.nextFriday;
  $('thisWeekTitle').textContent = tw ? '이번 주 대본 이어서 만들기' : '이번 주 대본 만들기';
  $('thisWeekSub').textContent = tw
    ? `${md(date)}(금) 방송 · 지금 상태: ${tw.status}`
    : `${md(date)}(금) 방송 · AI와 함께 차근차근 만들어요`;
}

function renderList() {
  const q = $('search').value.trim();
  const st = $('statusFilter').value;
  const list = state.scripts.filter(s => (!st || s.status === st) &&
    (!q || `${s.title} ${s.announcers} ${s.created_by}`.includes(q)));
  $('listBox').innerHTML = list.length ? list.map(s => `
    <a class="card list-item" href="/?id=${encodeURIComponent(s.id)}" data-id="${esc(s.id)}">
      <div class="list-date">${md(s.broadcast_date)}<span class="small muted">${esc(s.broadcast_date.slice(0, 4))}</span></div>
      <div class="grow">
        <div>${esc(s.title) || '(제목 없음)'}</div>
        <div class="muted small list-meta">${icon('microphone')}${esc(s.announcers) || '-'}<span class="sep"></span>${esc(s.updated_by)} ${esc(s.updated_at.slice(5, 16))}</div>
      </div>
      <span class="list-chips">
        ${s.open_comments ? `<span class="badge badge-comment" aria-label="반영 안 된 선생님 의견 ${Number(s.open_comments)}개">${icon('chat-circle-text')}의견 ${Number(s.open_comments)}</span>` : ''}
        <span class="badge badge-${esc(s.status)}">${esc(s.status)}</span>
      </span>
    </a>`).join('')
    : `<div class="card muted">${state.scripts.length ? '찾는 대본이 없어요.' : '아직 만든 대본이 없어요. 홈의 이번 주 대본 버튼이나 다른 날 대본을 눌러 시작해요!'}</div>`;
}

/* ───────────── 편집 ───────────── */

/** 4단계: 구성 탭과, 탭마다 대본 칸 + AI에게 다시 부탁하는 버튼 */
function buildSections() {
  $('sectionTabs').innerHTML = SECTIONS.map((s, i) => `
    <button type="button" data-tab="${s.key}"><span class="tab-dot" id="dot-${s.key}">${i + 1}</span>${s.name}<span class="cm-badge hidden" id="cmb-${s.key}"></span></button>`).join('');
  $('sectionsBox').innerHTML = SECTIONS.map((s, i) => `
    <div class="card sec-card hidden" data-sec="${s.key}">
      <div class="section-head">
        <span class="section-num">${i + 1}</span><h3>${s.name}</h3>
        <span class="char-count" id="count-${s.key}"></span>
      </div>
      <div class="muted small section-hint">${s.hint}</div>
      <div class="cm-box" id="cm-${s.key}"></div>
      <textarea id="f-${s.key}" class="script-text" placeholder="여기에 대본이 들어가요. 3단계에서 AI 초안을 만들거나 직접 써요."></textarea>
      <div class="sec-status" id="status-${s.key}"></div>
      <div class="redo">
        <span class="small muted redo-label">${icon('sparkle')}AI에게 부탁하기</span>
        ${QUICK_ASKS.map(q => `<button type="button" class="chip" data-quick="${q}" data-key="${s.key}">${q}</button>`).join('')}
        <button type="button" class="chip" data-ai="${s.key}">처음부터 다시</button>
      </div>
      <div class="redo-custom">
        <input class="ai-req" id="req-${s.key}" placeholder="직접 부탁하기 (예: 퀴즈를 하나 넣어 줘)">
        <button type="button" data-ask="${s.key}">부탁하기</button>
      </div>
      <div class="cm-form hidden" id="cmf-${s.key}">
        <label for="cmi-${s.key}">${icon('chat-circle-text')}${s.name}에 의견 남기기</label>
        <div class="cm-form-row">
          <textarea id="cmi-${s.key}" class="cm-input" rows="1" maxlength="1000" placeholder="고칠 점을 써 주세요"></textarea>
          <button type="button" class="btn-primary" data-cm-add="${s.key}">${icon('paper-plane-right')}남기기</button>
        </div>
      </div>
      <div class="sec-nav">
        ${i > 0 ? `<button type="button" data-tab="${SECTIONS[i - 1].key}">← ${SECTIONS[i - 1].name}</button>` : ''}
        <span class="grow"></span>
        ${i < SECTIONS.length - 1 ? `<button type="button" data-tab="${SECTIONS[i + 1].key}">${SECTIONS[i + 1].name} →</button>` : ''}
      </div>
    </div>`).join('');
}

function showTab(key) {
  state.tab = key;
  document.querySelectorAll('[data-sec]').forEach(c => c.classList.toggle('hidden', c.dataset.sec !== key));
  document.querySelectorAll('#sectionTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === key));
}

function updateCounts() {
  let total = 0;
  SECTIONS.forEach(s => {
    const n = $('f-' + s.key).value.replace(/\s/g, '').length;
    total += n;
    $('count-' + s.key).textContent = n ? `${n}자 · ${readTimeText(n)}` : '';
    $('dot-' + s.key).classList.toggle('done', n > 0);
  });
  $('readTime').textContent = total ? ` · 읽는 시간 ${readTimeText(total)}` : '';
  document.querySelectorAll('.btn-practice').forEach(b => {
    b.disabled = !total;
    b.querySelector('span').textContent = total ? '연습하기' : '대본을 먼저 써요';
    b.setAttribute('aria-label', b.querySelector('span').textContent);
  });
}

/* ── 검토 댓글 (선생님 의견) ──
   구성 탭마다 반영 안 된 의견 수 배지, 탭 내용 위에 의견 카드(반영 안 된 것 먼저, 반영한 것은 흐리게 접힘).
   선생님은 탭 아래 입력칸으로 의견을 남기고 지울 수 있다. '반영했어요'는 누구나, 완료된 대본에서도 된다.
   아직 저장 안 된 새 대본에는 입력칸을 숨긴다(첫 저장 뒤 보임). */

state.comments = { scriptId: null, list: [], seq: 0 };

const isTeacherUser = () => state.user?.role === 'teacher';
const cmWhen = at => `${md(at.slice(0, 10))} ${at.slice(11, 16)}`;

/** 편집 화면에 대본을 채울 때: 그 대본의 의견을 새로 받는다. id가 없으면(새 대본) 비운다. */
function startComments(id) {
  const c = state.comments;
  c.seq++;
  c.scriptId = id || null;
  c.list = [];
  renderComments();
  if (id) loadComments(id);
}

/** 늦게 온 예전 응답(다른 대본, 예전 요청)은 무시한다. */
async function loadComments(id) {
  const c = state.comments;
  const seq = ++c.seq;
  try {
    const list = await api('/api/scripts/' + encodeURIComponent(id) + '/comments');
    if (seq !== c.seq || c.scriptId !== id) return;
    c.list = list;
    renderComments();
  } catch (err) {
    if (seq !== c.seq || c.scriptId !== id) return;
    toast('선생님 의견을 불러오지 못했어요: ' + err.message);
  }
}

/** 본문은 esc() 뒤 줄바꿈을 그대로 보인다(.cm-text가 pre-wrap). */
function commentCard(cm, done) {
  const id = esc(cm.id);
  const teacher = isTeacherUser();
  return `
    <article class="cm-card${done ? ' done' : ''}">
      <div class="cm-head small">
        ${icon('chat-circle-text')}<b>${esc(/선생님$/.test(cm.created_by) ? cm.created_by : cm.created_by + ' 선생님')}</b><span class="muted">· ${esc(cmWhen(cm.created_at))}</span>
      </div>
      <p class="cm-text">${esc(cm.body)}</p>
      <div class="cm-actions">
        ${done
          ? `<span class="cm-resolved small">${icon('check-circle', true)}반영함 · ${esc(cm.resolved_by)} ${esc(md(cm.resolved_at.slice(0, 10)))}</span>`
          : `<button type="button" class="btn-soft btn-sm" data-cm-resolve="${id}">${icon('check')}반영했어요</button>`}
        <span class="grow"></span>
        ${teacher ? `<button type="button" class="btn-ghost btn-sm" data-cm-delete="${id}">${icon('trash')}지우기</button>` : ''}
      </div>
    </article>`;
}

function renderComments() {
  const c = state.comments;
  const canWrite = isTeacherUser() && !!c.scriptId;
  SECTIONS.forEach(s => {
    const list = c.list.filter(x => x.section === s.key);
    const open = list.filter(x => !x.resolved_by);
    const done = list.filter(x => x.resolved_by);
    const box = $('cm-' + s.key);
    const wasOpen = !!box.querySelector('details[open]');
    box.innerHTML = open.map(x => commentCard(x, false)).join('') + (done.length ? `
      <details class="cm-done"${wasOpen ? ' open' : ''}>
        <summary class="small">${icon('check-circle')}반영한 의견 ${done.length}개</summary>
        ${done.map(x => commentCard(x, true)).join('')}
      </details>` : '');
    const badge = $('cmb-' + s.key);
    badge.textContent = open.length ? `의견 ${open.length}` : '';
    badge.setAttribute('aria-label', `반영 안 된 의견 ${open.length}개`);
    badge.classList.toggle('hidden', !open.length);
    $('cmf-' + s.key).classList.toggle('hidden', !canWrite);
  });
}

async function addComment(key) {
  const input = $('cmi-' + key);
  const body = input.value.trim();
  if (!body) return input.focus();
  const id = state.comments.scriptId;
  if (!id) return;
  const btn = document.querySelector(`[data-cm-add="${key}"]`);
  btn.disabled = true;
  try {
    const saved = await api('/api/scripts/' + encodeURIComponent(id) + '/comments', { method: 'POST', body: { section: key, body } });
    if (state.comments.scriptId !== id) return;
    input.value = '';
    state.comments.list.push(saved);
    sortComments();
    renderComments();
    toast('의견을 남겼어요.');
    loadComments(id); // 처음 받던 목록 응답이 늦게 와서 새 의견을 덮지 않게 새로 받는다
  } catch (err) { alert(err.message); } finally { btn.disabled = false; }
}

/** 서버와 같은 순서: 반영 안 된 것 먼저, 그다음 오래된 순 (같은 시각이면 받은 순서 그대로, sort는 안정 정렬) */
function sortComments() {
  state.comments.list.sort((a, b) =>
    (!!a.resolved_by - !!b.resolved_by) || a.created_at.localeCompare(b.created_at));
}

function replaceComment(saved) {
  const list = state.comments.list;
  const i = list.findIndex(x => x.id === saved.id);
  if (i >= 0) list[i] = saved;
  sortComments();
  renderComments();
}

async function resolveComment(cid, btn) {
  btn.disabled = true;
  try {
    replaceComment(await api('/api/comments/' + encodeURIComponent(cid) + '/resolve', { method: 'POST' }));
    toast('반영했어요. 선생님 화면에도 반영함으로 보여요.');
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
    if (err.status === 404 && state.comments.scriptId) loadComments(state.comments.scriptId);
  }
}

async function removeComment(cid) {
  if (!confirm('이 의견을 지울까요? 되돌릴 수 없어요.')) return;
  try {
    await api('/api/comments/' + encodeURIComponent(cid), { method: 'DELETE' });
    state.comments.list = state.comments.list.filter(x => x.id !== cid);
    renderComments();
    toast('의견을 지웠어요.');
  } catch (err) {
    alert(err.message);
    if (err.status === 404 && state.comments.scriptId) loadComments(state.comments.scriptId);
  }
}

/* ── 4단계 마법사 ── */

const hasScriptText = () => SECTIONS.some(s => $('f-' + s.key).value.trim());

function goStep(n) {
  if (state.dirty) saveNow();
  state.step = n;
  document.querySelectorAll('#editView .step').forEach(el => el.classList.toggle('hidden', Number(el.dataset.step) !== n));
  document.querySelectorAll('#stepper [data-step]').forEach(b => {
    const s = Number(b.dataset.step);
    b.classList.toggle('on', s === n);
    b.classList.toggle('done', s < n);
  });
  $('btnPrev').classList.toggle('invisible', n === 1);
  $('btnNext').classList.toggle('hidden', n === 4);
  $('btnRead').classList.toggle('hidden', n !== 4);
  $('btnPractice').classList.toggle('hidden', n !== 4);
  $('btnReview').classList.toggle('hidden', n !== 4 || state.user.role === 'teacher' || state.locked);
  if (n === 3) {
    $('btnAll').innerHTML = icon('sparkle') + (hasScriptText() ? '초안 다시 만들기' : '대본 초안 만들기');
    $('aiAfterNote').textContent = hasScriptText() ? '다시 만들면 지금 쓴 내용이 AI가 다듬은 내용으로 바뀌어요.' : '';
  }
  if (n === 4) showTab(state.tab || 'greeting');
  window.scrollTo(0, 0);
}

function nextStep() {
  if (state.step === 1 && !getAnnouncers().every(Boolean)) {
    alert('아나운서 이름을 써 주세요. 인사말에 들어가요.');
    (getAnnouncers()[0] ? $('f-ann2') : $('f-ann1')).focus();
    return;
  }
  goStep(Math.min(4, state.step + 1));
}

function updateMetaText() {
  const d = $('f-broadcast_date').value;
  $('dateText').textContent = d ? `${md(d)}(${weekdayOf(d)})` : '방송일 미정';
  $('titleText').textContent = $('f-title').value || '';
}

const weekdayOf = d => '일월화수목금토'[new Date(d + 'T00:00:00').getDay()];

/* ── 자동 저장 ──
   고칠 때마다 잠시 뒤 저장하고, 단계를 옮기거나 AI 초안이 나오면 바로 저장한다. */

let saveTimer = null;
let saving = false;
let saveAgain = false;

function setSaveState(text, iconName, tone = '') {
  $('saveState').className = 'save-state ' + tone;
  $('saveState').innerHTML = text ? (iconName ? icon(iconName) : '') + esc(text) : '';
}

function markDirty() {
  if (state.locked) return;
  state.dirty = true;
  state.editSeq++;
  if (state.conflict) return;
  setSaveState('고치는 중…', 'pencil-simple');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 2500);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (state.locked || state.conflict || !state.dirty) return true;
  if (saving) { saveAgain = true; return true; }
  const d = collect();
  if (!d.broadcast_date) return false;
  const seq = state.editSeq;
  saving = true;
  setSaveState('저장 중…', 'cloud-arrow-up');
  try {
    let saved;
    const wasNew = !state.current?.id;
    if (!wasNew) {
      saved = await api('/api/scripts/' + state.current.id, { method: 'PUT', body: { ...d, base_updated_at: state.current.updated_at } });
    } else {
      saved = await api('/api/scripts', { method: 'POST', body: d });
      history.replaceState(null, '', '/?id=' + encodeURIComponent(saved.id));
    }
    state.current = saved;
    // 새 대본이 처음 저장되면 선생님 의견 칸이 보인다.
    // (저장 응답 전에 다른 대본을 열었으면 그 대본의 의견 칸은 건드리지 않는다)
    if (wasNew && !state.comments.scriptId) { state.comments.scriptId = saved.id; renderComments(); }
    if (state.editSeq === seq) state.dirty = false;
    else saveAgain = true; // 저장하는 사이에 또 고쳤으면 한 번 더 저장
    rememberAnnouncers();
    $('metaInfo').textContent = `처음 작성 ${saved.created_by} · 마지막 수정 ${saved.updated_at} (${saved.updated_by})`;
    $('btnHistory').classList.remove('hidden');
    $('btnShare').classList.remove('hidden');
    setSaveState(`자동 저장됨 ${saved.updated_at.slice(11, 16)}`, 'cloud-check', 'ok');
    return true;
  } catch (err) {
    setSaveState('저장 안 됨', 'warning-circle', 'bad');
    if (err.status === 409) {
      // 다른 사람이 먼저 고쳤으면 덮어쓰지 않고 멈춘다.
      state.conflict = true;
      alert(err.message + '\n\n내가 고친 내용은 복사해 두고, 새로고침해서 다시 고쳐 주세요.');
    } else {
      toast('저장하지 못했어요: ' + err.message);
    }
    return false;
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; saveNow(); }
  }
}

async function requestReview() {
  if (state.locked) return;
  $('f-status').value = '검토요청';
  markDirty();
  if (await saveNow()) {
    toast('선생님께 검토를 요청했어요!');
    updateReviewButton();
  }
}

function updateReviewButton() {
  const asked = $('f-status').value === '검토요청';
  $('btnReview').innerHTML = asked ? icon('check-circle', true) + '<span>검토 요청함</span>' : icon('hand-waving') + '<span>검토 요청</span>';
  $('btnReview').classList.toggle('btn-primary', !asked);
  $('btnReview').classList.toggle('btn-soft', asked);
}

/* ── 아나운서 (1명 또는 2명) ── */

const splitNames = str => String(str || '').split(/\s*,\s*/).filter(Boolean);

function setAnnouncers(count, names) {
  state.annCount = Number(count) === 2 ? 2 : 1;
  $('f-ann1').value = names[0] || '';
  $('f-ann2').value = names[1] || '';
  $('f-ann1').placeholder = state.annCount === 2 ? '첫 번째 아나운서 이름' : '아나운서 이름';
  $('f-ann2').classList.toggle('hidden', state.annCount !== 2);
  document.querySelectorAll('.seg [data-count]').forEach(b => {
    const on = Number(b.dataset.count) === state.annCount;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
}

function getAnnouncers() {
  return [$('f-ann1').value.trim(), $('f-ann2').value.trim()].slice(0, state.annCount);
}

/** 다음 새 대본에 쓰도록 마지막으로 정한 아나운서를 이 브라우저에 기억한다. */
function rememberAnnouncers() {
  try { localStorage.setItem('lastAnnouncers', JSON.stringify({ count: state.annCount, names: getAnnouncers() })); } catch {}
}

function changeAnnouncerCount(count) {
  if (Number(count) === state.annCount) return;
  setAnnouncers(count, [$('f-ann1').value, $('f-ann2').value]);
  markDirty();
  if (SECTIONS.some(s => $('f-' + s.key).value.trim())) {
    toast(`이미 쓴 대본은 그대로예요. AI로 다시 쓰면 ${state.annCount}명 진행 형식으로 바뀌어요.`);
  }
}

function fill(data) {
  state.current = data;
  META_FIELDS.forEach(k => $('f-' + k).value = data[k] || '');
  const names = splitNames(data.announcers);
  setAnnouncers(data.announcer_count || (names.length > 1 ? 2 : 1), names);
  SECTIONS.forEach(s => {
    $('f-' + s.key).value = data[s.key] || '';
    $('req-' + s.key).value = '';
    $('status-' + s.key).textContent = '';
  });
  $('f-status').value = data.status || state.config.statuses[0];
  $('metaInfo').textContent = data.id ? `처음 작성 ${data.created_by} · 마지막 수정 ${data.updated_at} (${data.updated_by})` : '새 대본';
  const isTeacher = state.user.role === 'teacher';
  document.querySelectorAll('.teacher-only').forEach(el => el.classList.toggle('hidden', !isTeacher));
  $('btnDelete').classList.toggle('hidden', !data.id || !isTeacher);
  $('btnHistory').classList.toggle('hidden', !data.id);
  $('btnShare').classList.toggle('hidden', !data.id);
  $('metaBox').classList.add('hidden');
  updateMetaText();

  // 완료된 대본은 학생에게 읽기 전용
  state.locked = !isTeacher && data.status === '완료';
  $('lockedNotice').classList.toggle('hidden', !state.locked);
  document.querySelectorAll('#editView textarea, #editView input, #btnAll, .chip, [data-ask]')
    .forEach(el => { if ('readOnly' in el && el.tagName !== 'BUTTON') el.readOnly = state.locked; else el.disabled = state.locked; });

  // 선생님 메모가 있으면 맨 위에 보여 준다.
  $('memoBanner').classList.toggle('hidden', !data.memo);
  $('memoBanner').innerHTML = data.memo ? `${icon('chat-circle-text')}<span><b>메모</b> ${esc(data.memo)}</span>` : '';

  SECTIONS.forEach(s => { $('cmi-' + s.key).value = ''; });
  startComments(data.id);

  state.choices = parseChoices(data.choices);
  $('topic-idiom').value = state.choices.idiom || '';
  loadPickers();
  updateCounts();
  updateReviewButton();
  state.dirty = false;
  state.conflict = false;
  clearTimeout(saveTimer);
  setSaveState(data.id ? '저장됨' : '', 'cloud-check', 'ok');
}

function collect() {
  const d = {};
  META_FIELDS.forEach(k => d[k] = $('f-' + k).value.trim());
  d.announcer_count = state.annCount;
  d.announcers = getAnnouncers().filter(Boolean).join(', ');
  d.choices = JSON.stringify(currentChoices());
  SECTIONS.forEach(s => d[s.key] = $('f-' + s.key).value.trim());
  return d;
}

function newScript() {
  const date = state.config.nextFriday;
  const [, m, day] = date.split('-').map(Number);
  const nth = ['첫째', '둘째', '셋째', '넷째', '다섯째'][Math.ceil(day / 7) - 1];
  let last = null;
  try { last = JSON.parse(localStorage.getItem('lastAnnouncers')); } catch {}
  const names = last?.names?.length ? last.names : (state.user.role === 'student' ? [state.user.name] : []);
  fill({ broadcast_date: date, title: `${m}월 ${nth} 주 금요방송`, announcer_count: last?.count || 1, announcers: names.join(', ') });
  state.tab = 'greeting';
  showOnly('editView');
  goStep(1);
  // '다른 날 대본'이면 방송일부터 고르게 한다.
  if (new URLSearchParams(location.search).get('new') === 'other') {
    $('metaBox').classList.remove('hidden');
    $('f-broadcast_date').focus();
  }
}

/** tab: 홈 '선생님 의견' 줄에서 오면 의견이 있는 첫 구성 탭(&tab=events)을 바로 연다. */
async function openScript(id, tab) {
  try {
    fill(await api('/api/scripts/' + encodeURIComponent(id)));
    const pickTab = SECTIONS.some(s => s.key === tab);
    state.tab = pickTab ? tab : 'greeting';
    showOnly('editView');
    // 이미 대본 내용이 있으면 바로 고치는 단계로, 없으면 처음부터
    goStep(pickTab || hasScriptText() ? 4 : 1);
  } catch (err) {
    alert(err.message);
    navigate('?scripts', true);
  }
}

async function removeScript() {
  if (!confirm('이 대본을 정말 삭제할까요? 수정 기록까지 모두 지워지고 되돌릴 수 없어요.')) return;
  try {
    await api('/api/scripts/' + state.current.id, { method: 'DELETE' });
    state.dirty = false;
    toast('삭제했어요.');
    navigate('?scripts');
  } catch (err) { alert(err.message); }
}

/* ───────────── 주간계획 · AI ───────────── */

/* ── 행사·계기교육 고르기 ──
   편집 화면을 열면 주간계획(다음 주 학생 행사)과 계기교육 주제 목록을 불러와 고르게 한다.
   고른 것은 대본의 choices에 저장되어, 선생님이 미리 골라 두면 학생에게도 그대로 보인다. */

const md = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const evKey = e => `${e.date}|${e.text}`;

function parseChoices(v) {
  let c = {};
  try { c = typeof v === 'string' ? JSON.parse(v || '{}') : (v || {}); } catch {}
  return { events: Array.isArray(c.events) ? c.events : [], special: c.special || '', idiom: c.idiom || '' };
}

/* ── 이미 쓴 주제 (CAP-7): 같은 학년도 다른 대본에서 쓴 사자성어·계기교육. 알려만 주고 막지 않는다. ── */
// 서버 src/used-topics.js의 topicKey와 같게 유지한다. (괄호 안·띄어쓰기는 빼고 비교)
const topicKey = s => String(s || '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '');
const usedFind = (list, topic) => topicKey(topic) ? (state.used?.[list] || []).find(u => topicKey(u.topic) === topicKey(topic)) : undefined;
const usedBadge = u => u ? ` <span class="badge">이미 씀 · ${md(u.date)}</span>` : '';
const usedWarn = u => u ? `${icon('info')} ${Number(u.date.slice(5, 7))}월 ${Number(u.date.slice(8))}일 방송에서 이미 썼어요. 그래도 쓸까요?` : '';

function renderIdiomUsed() {
  const list = state.used?.idioms || [];
  $('idiom-used').innerHTML = list.length
    ? '<span class="muted small">올해 쓴 사자성어</span> ' + list.map(u => `<span class="badge">${esc(u.topic)} · ${md(u.date)}</span>`).join(' ')
    : '';
  updateUsedWarn();
}

function updateUsedWarn() {
  $('idiom-warn').innerHTML = usedWarn(usedFind('idioms', $('topic-idiom').value));
  if (!$('special-warn')) return;
  const custom = document.querySelector('input[name="topicPick"]:checked')?.value === '__custom';
  $('special-warn').innerHTML = custom ? usedWarn(usedFind('specials', $('topic-special').value)) : '';
}

let pickerSeq = 0;
/**
 * 주간계획 행사와 계기교육 주제를 불러온다.
 * fresh: '학교 행사 다시 확인' 버튼. 서버의 저장분을 건너뛰고 구글 시트를 지금 바로 읽은 뒤,
 *        전에 보던 목록과 비교해 새로 생긴 행사를 표시한다.
 */
async function loadPickers({ fresh = false } = {}) {
  const date = $('f-broadcast_date').value;
  const seq = ++pickerSeq;
  const prevKeys = fresh && state.eventInfo?.events ? new Set(state.eventInfo.events.map(evKey)) : null;
  if (!date) {
    state.eventOpts = state.topicOptions = state.used = null;
    $('pick-events').innerHTML = $('pick-topics').innerHTML = '<span class="muted small">방송일을 먼저 정해 주세요.</span>';
    renderIdiomUsed();
    return;
  }
  if (fresh) {
    // 목록은 그대로 두고 버튼만 '확인 중'으로
    const btn = document.querySelector('[data-pick="reload"]');
    if (btn) { btn.disabled = true; btn.innerHTML = spinner() + '시트 확인 중…'; }
  } else {
    state.eventOpts = state.topicOptions = state.used = null;
    renderIdiomUsed();
    $('pick-events').innerHTML = skeleton(4, '주간계획에서 다음 주 행사를 불러오는 중…');
    $('pick-topics').innerHTML = skeleton(4, '계기교육 주제를 찾는 중…');
  }
  const q = '?date=' + encodeURIComponent(date) + (fresh ? '&fresh=1' : '');
  const usedQ = '?date=' + encodeURIComponent(date) + '&exclude=' + encodeURIComponent(state.current?.id || '');
  const [ev, tp, used] = await Promise.allSettled([api('/api/events' + q), api('/api/topics' + q), api('/api/topics/used' + usedQ)]);
  if (seq !== pickerSeq) return; // 그사이 방송일이 바뀌었으면 버린다
  state.used = used.status === 'fulfilled' ? used.value : null; // 못 불러오면 표시 없이 그대로 쓴다
  state.eventInfo = ev.status === 'fulfilled' ? ev.value : { events: [], error: ev.reason.message };
  state.topicOptions = tp.status === 'fulfilled' ? tp.value : [];

  state.newEventKeys = new Set();
  if (prevKeys && !state.eventInfo.error) {
    const nowKeys = new Set(state.eventInfo.events.map(evKey));
    state.newEventKeys = new Set([...nowKeys].filter(k => !prevKeys.has(k)));
    const gone = [...prevKeys].filter(k => !nowKeys.has(k)).length;
    const parts = [];
    if (state.newEventKeys.size) parts.push(`새 행사 ${state.newEventKeys.size}개`);
    if (gone) parts.push(`없어진 행사 ${gone}개`);
    toast(parts.length ? `주간계획이 바뀌었어요: ${parts.join(', ')}` : '주간계획을 다시 확인했어요. 바뀐 행사는 없어요.');
  } else if (fresh && state.eventInfo.error) {
    toast('주간계획을 확인하지 못했어요: ' + state.eventInfo.error);
  }
  renderEventPicker();
  renderTopicPicker();
  renderIdiomUsed();
}

function renderEventPicker() {
  const info = state.eventInfo || { events: [] };
  const chosen = new Set(state.choices.events.map(evKey));
  const opts = [...info.events];
  // 시트가 바뀌어 목록에서 사라졌어도 저장해 둔 선택은 보여 준다.
  state.choices.events.forEach(e => { if (!opts.some(o => evKey(o) === evKey(e))) opts.push({ ...e, saved: true }); });
  opts.sort((a, b) => a.date.localeCompare(b.date));
  state.eventOpts = opts;
  const range = info.start ? `다음 주 ${md(info.start)}~${md(info.end)}` : '';
  const isNew = e => state.newEventKeys?.has(evKey(e));
  $('pick-events').innerHTML = `
    <div class="refresh-bar">
      <div class="refresh-info">
        <span class="pick-range">${range ? icon('calendar-blank') + range : ''}</span>
        <span class="muted small">${info.checkedAt ? `${info.checkedAt}에 주간계획을 확인했어요` : ''}</span>
      </div>
      <button type="button" class="btn-soft btn-sm" data-pick="reload">${icon('arrow-clockwise')}학교 행사 다시 확인</button>
    </div>
    <div class="pick-head">
      <span class="muted small">시트를 고쳤다면 위 버튼을 눌러요.</span><span class="grow"></span>
      <button type="button" data-pick="all">모두 선택</button><button type="button" data-pick="none">모두 해제</button>
    </div>
    ${info.error ? `<div class="small" style="color:var(--danger)">${esc(info.error)}</div>` : ''}
    ${info.warning ? `<div class="small muted">${esc(info.warning)}</div>` : ''}
    ${opts.length ? opts.map((e, i) => `
      <label class="pick-item${isNew(e) ? ' is-new' : ''}"><input type="checkbox" data-ev="${i}" ${chosen.has(evKey(e)) ? 'checked' : ''}>
        <span class="pick-date">${md(e.date)}(${esc(e.weekday)})</span>
        <span>${esc(e.text)}${isNew(e) ? ' <span class="badge badge-new">새로 생김</span>' : ''}${e.saved ? ' <span class="badge">지금 시트에는 없어요</span>' : ''}</span></label>`).join('')
      : (info.error ? '' : '<div class="small muted">다음 주 주간계획에 학생 행사가 없어요.</div>')}
    <div class="muted small pick-count" id="evCount"></div>`;
  updateEventCount();
}

function readChosenEvents() {
  if (!state.eventOpts) return state.choices.events;
  return [...document.querySelectorAll('[data-ev]')].filter(c => c.checked).map(c => {
    const o = state.eventOpts[c.dataset.ev];
    return { date: o.date, weekday: o.weekday, text: o.text };
  });
}

function updateEventCount() {
  const n = readChosenEvents().length;
  if ($('evCount')) $('evCount').textContent = n ? `${n}개 골랐어요` : '고른 행사가 없어요. 대본에 넣을 행사를 체크해 주세요.';
}

function renderTopicPicker() {
  const opts = state.topicOptions || [];
  const cur = state.choices.special;
  const isCustom = cur && !opts.some(t => t.label === cur);
  const radio = (value, html, checked) =>
    `<label class="pick-item"><input type="radio" name="topicPick" value="${esc(value)}" ${checked ? 'checked' : ''}><span>${html}</span></label>`;
  const group = (kind, title) => {
    const list = opts.filter(t => t.kind === kind);
    return list.length ? `<div class="pick-group">${title}</div>` + list.map(t => radio(t.label,
      `${esc(t.label)}${t.dday !== undefined ? ` <span class="badge badge-검토요청">${t.dday === 0 ? '오늘' : 'D-' + t.dday}</span>` : ''}${usedBadge(usedFind('specials', t.label))}`,
      t.label === cur)).join('') : '';
  };
  $('pick-topics').innerHTML = `
    <div class="pick-head"><span class="muted small">방송일보다 지난 기념일은 빠져 있어요</span></div>
    ${radio('', icon('sparkle') + ' AI가 다가오는 기념일 중에서 골라 줘', !cur)}
    ${group('기념일', '다가오는 기념일 (2주 안)')}
    ${group('학교', '우리 학교 주간계획')}
    ${group('계절', '이맘때 어울리는 주제')}
    <div class="pick-group">직접 정하기</div>
    <label class="pick-item"><input type="radio" name="topicPick" value="__custom" ${isCustom ? 'checked' : ''}>
      <input id="topic-special" class="pick-custom" placeholder="예: 학교폭력 예방" value="${isCustom ? esc(cur) : ''}"></label>
    <div class="small used-warn" id="special-warn" role="status"></div>`;
  updateUsedWarn();
}

function chosenTopic() {
  const r = document.querySelector('input[name="topicPick"]:checked');
  if (!r) return state.choices.special;
  return r.value === '__custom' ? $('topic-special').value.trim() : r.value;
}

function currentChoices() {
  return { events: readChosenEvents(), special: chosenTopic(), idiom: $('topic-idiom').value.trim() };
}

/** AI에 보낼 행사: 고른 것이 있으면 그것, 없으면 물어보고 전부(undefined), 취소하면 false */
function eventsForAI() {
  const sel = readChosenEvents();
  if (sel.length) return sel;
  if (confirm('소개할 행사를 고르지 않았어요.\n다음 주 행사를 모두 넣어 쓸까요?\n(취소를 누르면 2단계에서 고를 수 있어요)')) return undefined;
  goStep(2);
  return false;
}

function aiInput(key) {
  return {
    section: key,
    date: $('f-broadcast_date').value,
    announcers: getAnnouncers(),
    announcer_count: state.annCount,
    topic: key === 'special' ? chosenTopic() : ($('topic-' + key)?.value.trim() || ''),
    request: $('req-' + key).value.trim(),
    draft: $('f-' + key).value.trim(),
    script_id: state.current?.id || ''
  };
}

/** 아나운서 이름이 비어 있으면 AI가 '아나운서1' 같은 자리 표시를 쓰므로 먼저 물어본다. */
function namesReady() {
  if (getAnnouncers().every(Boolean)) return true;
  if (confirm("아나운서 이름이 비어 있어요. 이름 대신 '아나운서1'처럼 써도 될까요?\n(취소를 누르고 이름을 먼저 써 주세요)")) return true;
  (getAnnouncers()[0] ? $('f-ann2') : $('f-ann1')).focus();
  return false;
}

/**
 * 한 구성을 AI로 쓴다.
 *  interactive: 4단계에서 학생이 직접 누른 경우(확인 창·오류 창을 띄움). 전체 초안에서는 false.
 *  fresh: '처음부터 다시'. 지금 쓴 내용을 참고하지 않고 새로 쓴다.
 */
async function aiSection(key, { interactive = true, selectedEvents, fresh = false } = {}) {
  if (state.locked) return;
  if (interactive && !namesReady()) return;
  const input = aiInput(key);
  if (fresh) input.draft = '';
  if (key === 'events') {
    // 전체 초안에서는 미리 정한 행사를, 한 구성만 쓸 때는 여기서 고른 행사를 쓴다.
    const sel = interactive ? eventsForAI() : selectedEvents;
    if (sel === false) return;
    input.selectedEvents = sel;
  }
  if (interactive && fresh && $('f-' + key).value.trim() &&
      !confirm('지금 쓴 내용 대신 AI가 처음부터 새로 써요. 괜찮아요?')) return;
  const card = document.querySelector(`[data-sec="${key}"]`);
  card.classList.add('busy');
  $('status-' + key).innerHTML = spinner() + 'AI가 쓰고 있어요… (30초쯤 걸려요)';
  try {
    const { text, topic } = await api('/api/ai/section', { method: 'POST', body: input });
    $('f-' + key).value = text;
    // AI가 고른 주제를 2단계 칸에 채워 저장한다. 다음 대본이 이 주제를 피할 수 있다.
    if (topic && key === 'idiom') { $('topic-idiom').value = topic; updateUsedWarn(); }
    if (topic && key === 'special') { state.choices.special = topic; renderTopicPicker(); }
    $('req-' + key).value = '';
    $('status-' + key).innerHTML = interactive ? icon('check-circle', true) + '새로 썼어요. 소리 내어 읽어 보세요!' : '';
    updateCounts();
    markDirty();
    return true;
  } catch (err) {
    $('status-' + key).textContent = '';
    if (interactive) alert('AI가 쓰지 못했어요: ' + err.message);
    else throw err;
  } finally {
    card.classList.remove('busy');
  }
}

/** 3단계 진행 표시: wait / run / done / fail */
function renderProgress(states) {
  const label = { wait: [icon('circle-dashed'), '기다리는 중'], run: [spinner(), '쓰는 중…'], done: [icon('check-circle', true), '완성!'], fail: [icon('warning-circle', true), '못 썼어요'] };
  $('aiProgress').innerHTML = SECTIONS.map((s, i) => {
    const [icon, text] = label[states[i]];
    return `<li class="p-${states[i]}"><span class="p-icon">${icon}</span><b>${s.name}</b><span class="muted small">${text}</span></li>`;
  }).join('');
}

async function aiAll() {
  if (state.locked) return;
  if (!$('f-broadcast_date').value) return alert('방송일을 먼저 정해 주세요.');
  if (!namesReady()) return goStep(1);
  const selectedEvents = eventsForAI();
  if (selectedEvents === false) return;
  if (hasScriptText() && !confirm('지금 쓴 내용이 AI가 다듬은 내용으로 바뀌어요. 계속할까요?')) return;
  const btn = $('btnAll');
  btn.disabled = true;
  btn.innerHTML = spinner() + 'AI가 쓰고 있어요…';
  $('btnNext').disabled = $('btnPrev').disabled = true;
  const states = SECTIONS.map(() => 'wait');
  renderProgress(states);
  // AI 서버가 붐빌 때 한꺼번에 몰리지 않도록 두 개씩만 동시에 요청한다.
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < SECTIONS.length) {
      const i = next++;
      states[i] = 'run';
      renderProgress(states);
      try {
        await aiSection(SECTIONS[i].key, { interactive: false, selectedEvents });
        states[i] = 'done';
      } catch (err) {
        states[i] = 'fail';
        errors.push(`${SECTIONS[i].name}: ${err.message}`);
      }
      renderProgress(states);
    }
  };
  await Promise.all([worker(), worker()]);
  btn.disabled = false;
  $('btnNext').disabled = $('btnPrev').disabled = false;
  btn.innerHTML = icon('sparkle') + '초안 다시 만들기';
  await saveNow();
  if (!errors.length) {
    toast('초안 완성! 이제 소리 내어 읽으며 고쳐 봐요.');
    state.tab = 'greeting';
    setTimeout(() => goStep(4), 900);
  } else if (errors.length < SECTIONS.length) {
    $('aiAfterNote').textContent = '못 쓴 구성은 4단계에서 [처음부터 다시]를 눌러 다시 써 보세요.';
    alert('일부를 만들지 못했어요.\n' + errors.join('\n'));
  } else {
    $('aiAfterNote').textContent = 'AI가 지금 바빠요. 1~2분 뒤에 다시 눌러 주세요.';
    alert('AI가 대본을 만들지 못했어요.\n' + errors[0]);
  }
}

/* ───────────── 방송용 보기 · 공유 ───────────── */

/** "이름: 대사" 줄의 이름에 아나운서별 색 이름표를 붙인다. */
function formatSpeech(text, names) {
  return String(text).split('\n').map(line => {
    const m = line.match(SPEAKER_RE);
    if (!m) return esc(line);
    const idx = names.indexOf(m[1].trim());
    const cls = m[1].trim() === '함께' ? 'speaker-both' : idx >= 0 ? `speaker-${idx}` : null;
    return cls ? `<span class="speaker ${cls}">${esc(m[1].trim())}</span>${esc(m[2])}` : esc(line);
  }).join('\n');
}

function renderReading(d) {
  const names = splitNames(d.announcers);
  return `<div class="muted small">${esc(d.broadcast_date)} · 아나운서 ${esc(d.announcers) || '-'}</div>
    <div style="font-size:1.2em;font-weight:700">${esc(d.title)}</div>` +
    SECTIONS.map((s, i) => `<h2>${i + 1}. ${s.name}</h2><p>${d[s.key] ? formatSpeech(d[s.key], names) : '<span class="empty">(비어 있음)</span>'}</p>`).join('');
}

function scriptText(d) {
  return `${d.title}\n방송일: ${d.broadcast_date} · 아나운서: ${d.announcers}\n\n` +
    SECTIONS.map((s, i) => `[${i + 1}. ${s.name}]\n${d[s.key]}`).join('\n\n');
}

function copy(text, msg) {
  navigator.clipboard.writeText(text).then(() => toast(msg), () => prompt('아래 내용을 복사하세요', text));
}

function changeFont(delta) {
  const cur = parseInt(getComputedStyle($('readBox')).getPropertyValue('--read-size')) || 22;
  const next = Math.min(40, Math.max(14, cur + delta));
  $('readBox').style.setProperty('--read-size', next + 'px');
  try { localStorage.setItem('readSize', next); } catch {}
}

/* ───────────── 낭독 연습 모드 (?practice=<id>) ─────────────
   빈 구성은 건너뛰고 구성을 하나씩 큰 글씨로 보여 주며 구성마다 따로 시간을 잰다.
   끝 화면에 구성별 실제/예상/차이와 합계. 결과는 저장하지 않는다.
   단계(stage): pick(2인 이상이면 나 고르기) → run → end, 내용이 없으면 empty */

const PRACTICE_SIZE = 'practiceSize';
let practiceSeq = 0;
state.practice = null;
state.practiceDraft = null; // 편집 화면에서 들어올 때 지금 화면의 내용

const practiceNow = () => performance.now() / 1000;

/** 편집 화면·방송용 보기의 [연습하기]: 저장한 뒤 지금 화면의 내용으로 연습한다. */
async function startPractice() {
  if (state.dirty) await saveNow();
  // 저장이 안 됐으면(실패·저장 중) 돌아올 때 고친 내용을 잃으니 시작하지 않는다.
  if (state.dirty) return toast('저장한 뒤에 연습할 수 있어요. 잠시 뒤 다시 눌러 주세요.');
  const id = state.current?.id;
  if (!id) return toast('대본을 먼저 저장해 주세요. 방송일이 있어야 저장돼요.');
  state.practiceDraft = { id, data: collect() };
  navigate('?practice=' + encodeURIComponent(id));
}

async function showPractice(id) {
  stopPractice();
  const seq = ++practiceSeq;
  const draft = state.practiceDraft?.id === id ? state.practiceDraft : null;
  state.practiceDraft = null;
  let data = draft?.data;
  if (!data) {
    try { data = await api('/api/scripts/' + encodeURIComponent(id)); }
    catch (err) {
      if (seq !== practiceSeq) return;
      alert(err.message);
      return navigate('?scripts', true);
    }
    if (seq !== practiceSeq) return; // 그사이 다른 화면으로 갔다
  }
  const names = splitNames(data.announcers);
  const items = SECTIONS.filter(s => String(data[s.key] || '').trim()).map(s => {
    const text = String(data[s.key]).trim();
    return { name: s.name, text, expected: text.replace(/\s/g, '').length / CHARS_PER_SECOND };
  });
  let size = 32;
  try { size = Number(localStorage.getItem(PRACTICE_SIZE)) || 32; } catch {}
  state.practice = {
    id, names, items, i: 0, times: items.map(() => 0), running: false, startAt: 0, wake: null,
    me: names.length > 1 ? null : '', // null: 아직 안 고름, '': 강조 없음(1인·둘 다)
    stage: !items.length ? 'empty' : names.length > 1 ? 'pick' : 'run',
    tick: setInterval(practiceClock, 250)
  };
  $('practiceView').style.setProperty('--pr-size', Math.min(56, Math.max(20, size)) + 'px');
  showOnly('practiceView');
  renderPractice();
  practiceWake();
}

/** 다른 화면으로 갈 때(showOnly) 부른다: 타이머·Wake Lock 정리 */
function stopPractice() {
  practiceSeq++; // 받는 중인 대본 응답도 버린다
  const P = state.practice;
  if (!P) return;
  $('prLive').textContent = '';
  clearInterval(P.tick);
  P.wake?.release().catch(() => {});
  state.practice = null;
}

/** 화면 꺼짐 방지: 지원하는 브라우저만, 실패는 조용히 무시. 탭을 다시 보면 새로 건다. */
async function practiceWake() {
  const P = state.practice;
  if (!P || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (state.practice === P) { P.wake?.release().catch(() => {}); P.wake = lock; }
    else lock.release().catch(() => {});
  } catch { /* 지원 안 함·거절 */ }
}

const practiceElapsed = k => {
  const P = state.practice;
  return P.times[k] + (P.running && k === P.i ? practiceNow() - P.startAt : 0);
};

/** 지금 구성에 흐른 시간을 쌓는다(재는 중이면 이어서 잰다). */
function practiceFlush() {
  const P = state.practice;
  if (!P.running) return;
  const t = practiceNow();
  P.times[P.i] += t - P.startAt;
  P.startAt = t;
}

function practiceClock() {
  const P = state.practice;
  const el = $('prClock');
  if (P && el) el.textContent = clockText(practiceElapsed(P.i));
}

function practiceToggle() {
  const P = state.practice;
  practiceFlush();
  P.running = !P.running;
  P.startAt = practiceNow();
  renderPractice();
}

/** 다음(+1)/이전(-1). 첫 구성에서 이전은 무시, 마지막에서 다음은 끝 화면. */
function practiceMove(d) {
  const P = state.practice;
  if (d < 0 && P.i === 0) return;
  practiceFlush();
  if (d > 0 && P.i === P.items.length - 1) { P.running = false; P.stage = 'end'; }
  else P.i += d;
  renderPractice();
}

function practiceRestart() {
  const P = state.practice;
  Object.assign(P, { i: 0, times: P.items.map(() => 0), running: false, stage: P.me === null ? 'pick' : 'run' });
  renderPractice();
}

function practiceFont(delta) {
  const view = $('practiceView');
  const next = Math.min(56, Math.max(20, (parseInt(view.style.getPropertyValue('--pr-size')) || 32) + delta));
  view.style.setProperty('--pr-size', next + 'px');
  try { localStorage.setItem(PRACTICE_SIZE, next); } catch {}
}

const leavePractice = () => navigate(scriptQuery(state.practice.id), true);

/** 줄마다 내 줄(진하게)·남의 줄(흐리게). 강조 없음이면 보통. */
function practiceText(item) {
  const P = state.practice;
  const owners = lineOwners(item.text, P.names);
  return formatSpeech(item.text, P.names).split('\n').map((html, k) => {
    const cls = !P.me || !owners[k] ? '' : owners[k] === P.me ? ' mine' : ' other';
    return `<p class="pr-line${cls}">${html || '&nbsp;'}</p>`;
  }).join('');
}

const diffText = sec => { const r = Math.round(sec); return (r < 0 ? '-' : '+') + clockText(Math.abs(r)); };
const hintBadge = (actual, expected) => {
  const h = paceHint(actual, expected);
  return h ? `<span class="badge ${h === '알맞아요' ? 'badge-완료' : 'badge-검토요청'}">${h}</span>` : '';
};

function renderPractice() {
  const P = state.practice;
  const view = $('practiceView');
  const focused = view.contains(document.activeElement) ? document.activeElement.dataset.pr : null;
  const head = (title, font = false) => `
    <div class="pr-head">
      <button type="button" class="btn-ghost" data-pr="exit">${icon('x')}끝내기</button>
      <h2 class="pr-title display">${title}</h2>
      ${font ? `<div class="seg font-seg" role="group" aria-label="글자 크기">
        <button type="button" data-pr="smaller" aria-label="글자 작게">가-</button>
        <button type="button" data-pr="bigger" aria-label="글자 크게">가+</button>
      </div>` : '<span class="pr-head-end"></span>'}
    </div>`;
  const back = `<button type="button" class="btn-primary btn-lg" data-pr="exit">${icon('arrow-left')}대본으로 돌아가기</button>`;

  if (P.stage === 'empty') {
    view.innerHTML = head('낭독 연습') + `<div class="pr-body pr-center">
      <span class="login-mark">${icon('timer', true)}</span>
      <p class="pr-msg">연습할 내용이 없어요</p>${back}</div>`;
  } else if (P.stage === 'pick') {
    view.innerHTML = head('낭독 연습') + `<div class="pr-body pr-center">
      <p class="pr-msg">나는 누구예요?</p>
      <div class="pr-picks">
        ${P.names.map((n, k) => `<button type="button" class="btn-lg" data-pr="me" data-me="${k}">${icon('user')}${esc(n)}</button>`).join('')}
        <button type="button" class="btn-lg" data-pr="me" data-me="">${icon('users')}둘 다</button>
      </div>
      <p class="muted small">고른 사람의 대사는 진하게, 다른 사람의 대사는 흐리게 보여요.</p></div>`;
  } else if (P.stage === 'run') {
    const it = P.items[P.i];
    const last = P.i === P.items.length - 1;
    view.innerHTML = head(`${esc(it.name)} <span class="pr-count">(${P.i + 1}/${P.items.length})</span>`, true) + `
      <div class="pr-body"><div class="pr-text">${practiceText(it)}</div></div>
      <div class="pr-foot">
        <div class="pr-time${P.running ? ' running' : ''}">
          ${P.running ? `<span class="pr-live">${icon('record', true)}재는 중</span>` : ''}
          <b id="prClock">${clockText(practiceElapsed(P.i))}</b><span class="muted"> / 예상 ${clockText(it.expected)}</span>
        </div>
        <div class="pr-buttons">
          <button type="button" data-pr="prev"${P.i === 0 ? ' disabled' : ''}>${icon('caret-left')}이전</button>
          <button type="button" class="btn-primary" data-pr="toggle">${P.running ? icon('pause', true) + '멈춤' : icon('play', true) + '시작'}</button>
          <button type="button" data-pr="next">${last ? icon('flag-checkered') + '마치기' : '다음' + icon('caret-right')}</button>
        </div>
        <p class="muted small pr-keys">스페이스 시작/멈춤 · 화살표 이전/다음 · Esc 끝내기</p>
      </div>`;
  } else {
    const total = P.times.reduce((a, b) => a + b, 0);
    const expected = P.items.reduce((a, it) => a + it.expected, 0);
    const row = (name, a, e, tag = 'td') => `<tr><${tag === 'th' ? 'th scope="row"' : 'td'}>${name}</${tag}><td>${clockText(a)}</td><td>${clockText(e)}</td>
      <td>${diffText(a - e)} ${hintBadge(a, e)}</td></tr>`;
    view.innerHTML = head('연습 끝') + `<div class="pr-body"><div class="pr-end card">
      <table class="table pr-table">
        <thead><tr><th>구성</th><th>실제</th><th>예상</th><th>차이</th></tr></thead>
        <tbody>${P.items.map((it, k) => row(esc(it.name), P.times[k], it.expected)).join('')}</tbody>
        <tfoot>${row('합계', total, expected, 'th')}</tfoot>
      </table>
      <p class="muted small">결과는 저장하지 않아요. 예상 시간은 글자 수로 어림한 거예요.</p>
      <div class="pr-end-actions">
        <button type="button" class="btn-ghost btn-lg" data-pr="again">${icon('arrow-counter-clockwise')}다시 연습</button>
        ${back}
      </div></div></div>`;
  }
  // 화면 읽기 프로그램에 구성이 바뀐 것을 알린다(다시 그리지 않는 바깥 칸)
  $('prLive').textContent = view.querySelector('.pr-title').textContent;
  // 다시 그려도 누르던 버튼에 초점을 둔다(키보드 사용자). 처음이면 주요 버튼에.
  const target = (focused && view.querySelector(`[data-pr="${focused}"]:not(:disabled)`)) ||
    view.querySelector('[data-pr="toggle"], [data-pr="me"], .btn-primary[data-pr="exit"]');
  target?.focus();
}

function practiceClick(e) {
  const b = e.target.closest('[data-pr]');
  const P = state.practice;
  if (!b || !P) return;
  const act = b.dataset.pr;
  if (act === 'exit') return leavePractice();
  if (act === 'smaller' || act === 'bigger') return practiceFont(act === 'bigger' ? 4 : -4);
  if (act === 'me') { P.me = b.dataset.me === '' ? '' : P.names[b.dataset.me]; P.stage = 'run'; return renderPractice(); }
  if (act === 'toggle') return practiceToggle();
  if (act === 'prev') return practiceMove(-1);
  if (act === 'next') return practiceMove(1);
  if (act === 'again') return practiceRestart();
}

/** 스페이스 = 시작/멈춤, → 다음, ← 이전, Esc = 끝내기 */
function practiceKey(e) {
  const P = state.practice;
  if (!P || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.key === 'Escape') { e.preventDefault(); return leavePractice(); }
  if (P.stage !== 'run') return;
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) practiceToggle(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); practiceMove(1); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); practiceMove(-1); }
}

/* ───────────── 수정 기록 ───────────── */

async function openHistory() {
  $('historyPreview').classList.add('hidden');
  $('historyList').classList.remove('hidden');
  $('historyList').textContent = '불러오는 중…';
  $('historyDialog').showModal();
  try {
    const rows = await api(`/api/scripts/${state.current.id}/history`);
    $('historyList').innerHTML = rows.length
      ? rows.map(r => `<div class="history-item" data-hid="${r.id}"><span>${esc(r.saved_at)}</span><span class="muted">${esc(r.saved_by)}</span></div>`).join('')
      : '<p>아직 수정 기록이 없어요.</p>';
  } catch (err) { $('historyList').textContent = err.message; }
}

async function previewHistory(hid) {
  try {
    state.historyRow = await api('/api/history/' + hid);
    $('historyBody').innerHTML = renderReading(state.historyRow.snapshot);
    $('historyList').classList.add('hidden');
    $('historyPreview').classList.remove('hidden');
  } catch (err) { alert(err.message); }
}

function restoreHistory() {
  const snap = state.historyRow.snapshot;
  // 내용만 편집 칸에 불러오고, 저장은 학생이 직접 누르도록 한다.
  ['title', 'memo', ...SECTIONS.map(s => s.key)].forEach(k => $('f-' + k).value = snap[k] || '');
  const names = splitNames(snap.announcers);
  setAnnouncers(snap.announcer_count || (names.length > 1 ? 2 : 1), names);
  state.choices = parseChoices(snap.choices);
  $('topic-idiom').value = state.choices.idiom || '';
  if (state.eventOpts) renderEventPicker();
  if (state.topicOptions) renderTopicPicker();
  updateCounts();
  updateMetaText();
  markDirty();
  $('historyDialog').close();
  toast(`${snap.updated_at} 내용으로 되돌렸어요.`);
}

/* ───────────── 이벤트 연결 ───────────── */

function bindEvents() {
  $('loginForm').addEventListener('submit', doLogin);
  // 메뉴: 편집 중이면 저장하고 이동. Ctrl/⌘/Shift 클릭은 브라우저가 새 탭·창으로 연다.
  $('mainNav').addEventListener('click', e => {
    const a = e.target.closest('a[data-menu]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (confirmLeave()) navigate(a.getAttribute('href').slice(1));
  });

  // 내 이름 버튼 → 계정 목록 (바깥 누름·Esc·항목 선택으로 닫힘)
  $('btnUser').addEventListener('click', () => toggleUserMenu());
  document.addEventListener('click', e => {
    if (!$('userPop').classList.contains('hidden') && !$('userBox').contains(e.target)) toggleUserMenu(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('userPop').classList.contains('hidden')) {
      toggleUserMenu(false);
      $('btnUser').focus();
    }
  });
  $('userPop').addEventListener('click', e => { if (e.target.closest('.btn-menu')) toggleUserMenu(false); });
  // Tab으로 목록 밖으로 나가면 닫는다.
  $('userBox').addEventListener('focusout', e => { if (!$('userBox').contains(e.relatedTarget)) toggleUserMenu(false); });
  $('btnLogout').addEventListener('click', doLogout);
  $('menuHelp').addEventListener('click', openHelp);

  // 일정 캘린더
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-go]');
    if (a && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (confirmLeave()) navigate(a.dataset.go); }
  });
  $('calPrev').addEventListener('click', () => moveMonth(-1));
  $('calNext').addEventListener('click', () => moveMonth(1));
  $('calToday').addEventListener('click', () => selectDay(localToday()));
  $('calGrid').addEventListener('click', e => { const d = e.target.closest('[data-date]'); if (d) selectDay(d.dataset.date); });
  $('btnAddEvent').addEventListener('click', () => openEventDialog(null, state.cal.selected));
  $('btnAddEventDay').addEventListener('click', () => openEventDialog(null, state.cal.selected));
  $('dayList').addEventListener('click', e => {
    const s = e.target.closest('[data-script]');
    if (s && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return navigate('?id=' + encodeURIComponent(s.dataset.script)); }
    const ed = e.target.closest('[data-edit], [data-record]');
    if (ed) {
      const ev = state.cal.events.find(x => x.id === (ed.dataset.edit || ed.dataset.record));
      if (ev) openEventDialog(ev, ev.date, { focusRecord: !!ed.dataset.record });
    }
  });
  $('evCategory').addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (b) setCategory(b.dataset.cat); });
  $('evMembers').addEventListener('click', e => {
    const b = e.target.closest('[data-member]');
    if (!b) return;
    b.classList.toggle('on');
    b.setAttribute('aria-pressed', b.classList.contains('on'));
  });
  $('evDate').addEventListener('change', updateRecordVisibility);
  $('eventForm').addEventListener('submit', saveEvent);
  $('btnCloseEvent').addEventListener('click', () => $('eventDialog').close());
  $('btnDeleteEvent').addEventListener('click', removeEvent);
  $('btnMorningDuty').addEventListener('click', openDutyDialog);
  $('dutyPrev').addEventListener('click', () => moveDutyWeek(-1));
  $('dutyNext').addEventListener('click', () => moveDutyWeek(1));
  $('dutyForm').addEventListener('submit', saveDuty);
  $('btnCloseDuty').addEventListener('click', () => $('dutyDialog').close());
  // 게시판
  $('boardTabs').addEventListener('click', e => {
    const t = e.target.closest('[data-kind]');
    if (!t || t.dataset.kind === state.board.kind) return;
    Object.assign(state.board, { kind: t.dataset.kind, open: null, extra: null, readsOpen: null });
    history.replaceState(null, '', '/?board');
    renderBoardTabs();
    loadBoard();
  });
  $('btnMorePosts').addEventListener('click', () => loadBoard(true));
  $('btnNewMemo').addEventListener('click', () => openPostDialog('memo'));
  $('btnNewNotice').addEventListener('click', () => openPostDialog('notice'));
  $('btnHomeNotice').addEventListener('click', () => openPostDialog('notice'));
  $('postList').addEventListener('click', e => {
    const t = e.target.closest('[data-toggle], [data-reads], [data-edit-post], [data-delete-post]');
    if (!t) return;
    if (t.dataset.toggle) return togglePost(t.dataset.toggle);
    if (t.dataset.reads) return toggleReads(t.dataset.reads);
    if (t.dataset.editPost) { const p = findPost(t.dataset.editPost); if (p) openPostDialog(p.kind, p); return; }
    if (t.dataset.deletePost) return removePost(t.dataset.deletePost);
  });
  $('postBody').addEventListener('input', updatePostCount);
  $('postForm').addEventListener('submit', savePost);
  $('btnClosePost').addEventListener('click', () => $('postDialog').close());
  // 창 안으로 옮겨 띄운 토스트는 창이 닫히면 다시 본문으로 (닫힌 창 안에 갇히지 않게)
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('close', () => {
    if ($('toast').parentElement === d) document.body.appendChild($('toast'));
  }));

  $('btnReadAll').addEventListener('click', readAllNotifications);
  $('inboxList').addEventListener('click', e => {
    const a = e.target.closest('a[data-notif]');
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openNotification(a);
  });

  $('btnHelpBack').addEventListener('click', leaveHelp);
  $('btnHelpStart').addEventListener('click', () => navigate(''));
  $('btnHideFirstHelp').addEventListener('click', markHelpSeen);
  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (a && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openHelp(); }
  });
  // 차례 링크는 주소를 바꾸지 않고 그 자리로 부드럽게 이동
  document.querySelector('.help-toc').addEventListener('click', e => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    document.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('btnPassword').addEventListener('click', () => openPasswordDialog(false));
  $('passwordForm').addEventListener('submit', submitPassword);
  $('btnClosePassword').addEventListener('click', () => $('passwordDialog').close());
  // 첫 로그인 때는 Esc로 창을 닫지 못하게 한다.
  $('passwordDialog').addEventListener('cancel', e => { if ($('passwordDialog').dataset.forced) e.preventDefault(); });

  $('btnAccounts').addEventListener('click', () => { if (confirmLeave()) navigate('?accounts'); });
  $('btnAccountsBack').addEventListener('click', () => navigate('')); // 홈으로
  $('btnAddUsers').addEventListener('click', addUsers);
  $('userBody').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) userAction(b.dataset.act, b.closest('[data-uid]').dataset.uid);
  });
  $('btnCloseIssued').addEventListener('click', () => $('issuedBox').classList.add('hidden'));
  $('btnPrintIssued').addEventListener('click', () => {
    document.body.classList.add('print-issued');
    window.print();
    document.body.classList.remove('print-issued');
  });
  $('brandLink').addEventListener('click', e => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    if (state.user && confirmLeave()) navigate('');
  });

  $('search').addEventListener('input', renderList);
  $('statusFilter').addEventListener('change', renderList);
  $('btnThisWeek').addEventListener('click', async () => {
    // 홈 묶음을 아직 못 받았으면 (받는 중이면 그 응답을, 실패했으면 새로) 받고 나서 고른다.
    // 실패하면 토스트만 보이고 새로 만들지 않는다. (이번 주 대본을 두 번 만들지 않도록)
    if (!state.homeLoaded) {
      try { await (state.homeReq || loadHome()); } catch { return; }
      if (!state.homeLoaded || $('homeView').classList.contains('hidden')) return;
    }
    const tw = thisWeekScript();
    navigate(tw ? '?id=' + encodeURIComponent(tw.id) : '?new');
  });
  $('btnNew').addEventListener('click', () => navigate('?new=other'));
  $('listBox').addEventListener('click', e => {
    const a = e.target.closest('[data-id]');
    if (a && !e.ctrlKey && !e.metaKey) { e.preventDefault(); navigate('?id=' + encodeURIComponent(a.dataset.id)); }
  });

  // 편집 화면: 무엇이든 고치면 자동 저장 예약
  $('editView').addEventListener('input', e => {
    if (e.target.matches('.ai-req, .cm-input')) return; // AI에게 부탁할 말·선생님 의견 입력은 대본에 저장하지 않는다
    if (e.target.matches('input, textarea, select')) markDirty();
    if (e.target.matches('textarea')) updateCounts();
    if (e.target.matches('[data-ev]')) updateEventCount();
    if (e.target.matches('#f-title, #f-broadcast_date')) updateMetaText();
    // 직접 입력 칸에 쓰기 시작하면 '직접 정하기'가 골라지게 한다.
    if (e.target.id === 'topic-special') document.querySelector('input[name="topicPick"][value="__custom"]').checked = true;
    if (e.target.matches('#topic-idiom, #topic-special, [name="topicPick"]')) updateUsedWarn();
  });
  $('f-broadcast_date').addEventListener('change', () => {
    // 방송일이 바뀌면 '다음 주'와 다가오는 기념일도 바뀌므로 고른 것을 비우고 다시 불러온다.
    state.choices = { events: [], special: '', idiom: $('topic-idiom').value.trim() };
    loadPickers();
  });
  $('editView').addEventListener('click', e => {
    const step = e.target.closest('#stepper [data-step]');
    if (step) {
      const n = Number(step.dataset.step);
      if (n > 1 && state.step === 1 && !getAnnouncers().every(Boolean)) return nextStep(); // 이름부터
      return goStep(n);
    }
    const tab = e.target.closest('[data-tab]');
    if (tab) return showTab(tab.dataset.tab);
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      $('req-' + quick.dataset.key).value = `${quick.dataset.quick} 고쳐 줘`;
      return aiSection(quick.dataset.key);
    }
    const ask = e.target.closest('[data-ask]');
    if (ask) {
      if (!$('req-' + ask.dataset.ask).value.trim()) return $('req-' + ask.dataset.ask).focus();
      return aiSection(ask.dataset.ask);
    }
    const ai = e.target.closest('[data-ai]');
    if (ai) return aiSection(ai.dataset.ai, { fresh: true });
    // 검토 댓글
    const cm = e.target.closest('[data-cm-add], [data-cm-resolve], [data-cm-delete]');
    if (cm) {
      if (cm.dataset.cmAdd) return addComment(cm.dataset.cmAdd);
      if (cm.dataset.cmResolve) return resolveComment(cm.dataset.cmResolve, cm);
      return removeComment(cm.dataset.cmDelete);
    }
    const pick = e.target.closest('[data-pick]');
    if (pick) {
      if (pick.dataset.pick === 'reload') {
        state.choices = currentChoices(); // 지금 고른 것은 그대로 둔다
        return loadPickers({ fresh: true });
      }
      document.querySelectorAll('[data-ev]').forEach(c => c.checked = pick.dataset.pick === 'all');
      markDirty();
      updateEventCount();
    }
  });
  // 직접 부탁하기 칸에서 Enter를 누르면 바로 부탁한다.
  $('sectionsBox').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('.ai-req') && e.target.value.trim()) {
      e.preventDefault();
      aiSection(e.target.id.replace('req-', ''));
    }
  });
  document.querySelector('.big-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-count]');
    if (b) changeAnnouncerCount(b.dataset.count);
  });
  $('btnEditMeta').addEventListener('click', () => $('metaBox').classList.toggle('hidden'));
  $('btnPrev').addEventListener('click', () => goStep(Math.max(1, state.step - 1)));
  $('btnNext').addEventListener('click', nextStep);
  $('btnReview').addEventListener('click', requestReview);
  $('btnAll').addEventListener('click', aiAll);
  $('btnDelete').addEventListener('click', removeScript);
  $('btnBack').addEventListener('click', () => { if (confirmLeave()) navigate('?scripts'); });
  $('btnShare').addEventListener('click', () => copy(location.origin + '/?id=' + state.current.id, '링크를 복사했어요. 방송부 친구에게 보내 주세요!'));
  $('btnRead').addEventListener('click', () => { $('readBox').innerHTML = renderReading(collect()); showOnly('readView'); });
  $('btnBackToEdit').addEventListener('click', () => showOnly('editView'));
  $('btnCopyText').addEventListener('click', () => copy(scriptText(collect()), '대본을 복사했어요.'));
  $('btnFontUp').addEventListener('click', () => changeFont(2));
  document.querySelectorAll('.btn-practice').forEach(b => b.addEventListener('click', startPractice));
  $('practiceView').addEventListener('click', practiceClick);
  document.addEventListener('keydown', practiceKey);
  document.addEventListener('visibilitychange', () => { if (state.practice && document.visibilityState === 'visible') practiceWake(); });
  $('btnFontDown').addEventListener('click', () => changeFont(-2));
  try { const size = localStorage.getItem('readSize'); if (size) $('readBox').style.setProperty('--read-size', size + 'px'); } catch {}

  $('btnHistory').addEventListener('click', openHistory);
  $('btnCloseHistory').addEventListener('click', () => $('historyDialog').close());
  $('historyList').addEventListener('click', e => { const h = e.target.closest('[data-hid]'); if (h) previewHistory(h.dataset.hid); });
  $('btnHistoryBack').addEventListener('click', () => { $('historyPreview').classList.add('hidden'); $('historyList').classList.remove('hidden'); });
  $('btnRestore').addEventListener('click', restoreHistory);

  window.addEventListener('popstate', () => { if (confirmLeave()) route(); });
  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

init().catch(err => alert('시작하지 못했어요: ' + err.message));
