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

const state = { user: null, config: null, scripts: [], home: null, homeLoaded: false, homeReq: null, homeSeq: 0, current: null, dirty: false, historyRow: null, step: 1, tab: 'greeting', editSeq: 0 };

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
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2800);
}

function showOnly(id) {
  ['loginView', 'homeView', 'listView', 'boardView', 'inboxView', 'editView', 'readView', 'accountsView', 'helpView', 'calendarView'].forEach(v => $(v).classList.toggle('hidden', v !== id));
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
  // 사용법은 로그인하지 않아도 볼 수 있다.
  if (params.has('help')) return showHelp();
  if (!state.user) return showLogin();
  if (state.user.mustChange) {
    showOnly(null); // 뒤 화면은 비우고 비밀번호 바꾸기 창만
    return openPasswordDialog(true);
  }
  if (params.has('accounts') && state.user.role === 'teacher') return showAccounts();
  if (params.has('calendar')) { setMenu('calendar'); return showCalendar(params.get('date')); }
  if (params.has('board')) return showBoard();
  if (params.has('inbox')) return showInbox();
  if (params.has('scripts')) return showList();
  // 대본 편집·방송용 보기는 '대본' 메뉴에 속한다.
  if (params.has('new')) { setMenu('scripts'); return newScript(); }
  if (params.get('id')) { setMenu('scripts'); return openScript(params.get('id')); }
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
  $('todoList').innerHTML = h.todo.length ? h.todo.map(t => t.kind === 'script'
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

  // 공지는 게시판(스토리 3)이 열리면 채운다.
  $('noticeList').innerHTML = h.notices.length ? '' :
    '<div class="muted small up-empty">공지는 게시판이 열리면 여기에 보여요.</div>';

  $('upcomingList').innerHTML = h.upcoming.length ? h.upcoming.map(e => homeRow({
    query: `?calendar&date=${e.date}`,
    date: e.date,
    title: e.title,
    sub: `${homeDay(e.date)}${e.time ? ' ' + e.time : ''}${e.members.length ? ', ' + e.members.join(', ') : ''}`,
    chip: `${e.hasScript ? `<span class="cat cat-script">${icon('microphone')}대본</span>` : ''}<span class="cat cat-${esc(e.category)}">${esc(e.category)}</span>`
  })).join('')
    : '<div class="muted small up-empty">다가오는 일정이 없어요. 캘린더에서 연습이나 회의 일정을 넣어 보세요.</div>';
}

function renderHomeError() {
  const msg = '<div class="muted small up-empty">불러오지 못했어요. 잠시 뒤 다시 열어 보세요.</div>';
  ['reviewList', 'todoList', 'noticeList', 'upcomingList'].forEach(id => { $(id).innerHTML = msg; });
}

function showBoard() {
  showOnly('boardView');
  setMenu('board');
}

function showInbox() {
  showOnly('inboxView');
  setMenu('inbox');
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
      ...events.map(e => `<span class="cal-item cat-${esc(e.category)}"><span>${esc(e.title)}</span></span>`)
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
    return `
    <article class="day-item event-item" data-event="${esc(e.id)}">
      <div class="event-top">
        <span class="cat cat-${esc(e.category)}">${esc(e.category)}</span>
        ${e.time ? `<span class="event-time">${icon('clock')}${esc(e.time)}</span>` : ''}
        <b class="grow">${esc(e.title)}</b>
        <button type="button" class="btn-ghost btn-sm" data-edit="${esc(e.id)}">${icon('pencil-simple')}<span class="hide-sm">고치기</span></button>
      </div>
      ${e.members.length ? `<div class="event-members">${icon('users-three')}${e.members.map(m => `<span class="member-tag">${esc(m)}</span>`).join('')}</div>` : ''}
      ${e.note ? `<p class="event-note">${esc(e.note)}</p>` : ''}
      ${e.record
        ? `<div class="event-record">${icon('notebook')}<div><b>기록</b><p>${esc(e.record)}</p></div></div>`
        : past ? `<button type="button" class="btn-soft btn-sm" data-record="${esc(e.id)}">${icon('notebook')}기록 남기기</button>` : ''}
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
      <span class="badge badge-${esc(s.status)}">${esc(s.status)}</span>
    </a>`).join('')
    : `<div class="card muted">${state.scripts.length ? '찾는 대본이 없어요.' : '아직 만든 대본이 없어요. 홈의 이번 주 대본 버튼이나 다른 날 대본을 눌러 시작해요!'}</div>`;
}

/* ───────────── 편집 ───────────── */

/** 4단계: 구성 탭과, 탭마다 대본 칸 + AI에게 다시 부탁하는 버튼 */
function buildSections() {
  $('sectionTabs').innerHTML = SECTIONS.map((s, i) => `
    <button type="button" data-tab="${s.key}"><span class="tab-dot" id="dot-${s.key}">${i + 1}</span>${s.name}</button>`).join('');
  $('sectionsBox').innerHTML = SECTIONS.map((s, i) => `
    <div class="card sec-card hidden" data-sec="${s.key}">
      <div class="section-head">
        <span class="section-num">${i + 1}</span><h3>${s.name}</h3>
        <span class="char-count" id="count-${s.key}"></span>
      </div>
      <div class="muted small section-hint">${s.hint}</div>
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
    if (state.current?.id) {
      saved = await api('/api/scripts/' + state.current.id, { method: 'PUT', body: { ...d, base_updated_at: state.current.updated_at } });
    } else {
      saved = await api('/api/scripts', { method: 'POST', body: d });
      history.replaceState(null, '', '/?id=' + encodeURIComponent(saved.id));
    }
    state.current = saved;
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

async function openScript(id) {
  try {
    fill(await api('/api/scripts/' + encodeURIComponent(id)));
    state.tab = 'greeting';
    showOnly('editView');
    // 이미 대본 내용이 있으면 바로 고치는 단계로, 없으면 처음부터
    goStep(hasScriptText() ? 4 : 1);
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
    state.eventOpts = state.topicOptions = null;
    $('pick-events').innerHTML = $('pick-topics').innerHTML = '<span class="muted small">방송일을 먼저 정해 주세요.</span>';
    return;
  }
  if (fresh) {
    // 목록은 그대로 두고 버튼만 '확인 중'으로
    const btn = document.querySelector('[data-pick="reload"]');
    if (btn) { btn.disabled = true; btn.innerHTML = spinner() + '시트 확인 중…'; }
  } else {
    state.eventOpts = state.topicOptions = null;
    $('pick-events').innerHTML = skeleton(4, '주간계획에서 다음 주 행사를 불러오는 중…');
    $('pick-topics').innerHTML = skeleton(4, '계기교육 주제를 찾는 중…');
  }
  const q = '?date=' + encodeURIComponent(date) + (fresh ? '&fresh=1' : '');
  const [ev, tp] = await Promise.allSettled([api('/api/events' + q), api('/api/topics' + q)]);
  if (seq !== pickerSeq) return; // 그사이 방송일이 바뀌었으면 버린다
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
      `${esc(t.label)}${t.dday !== undefined ? ` <span class="badge badge-검토요청">${t.dday === 0 ? '오늘' : 'D-' + t.dday}</span>` : ''}`,
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
      <input id="topic-special" class="pick-custom" placeholder="예: 학교폭력 예방" value="${isCustom ? esc(cur) : ''}"></label>`;
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
    draft: $('f-' + key).value.trim()
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
    const { text } = await api('/api/ai/section', { method: 'POST', body: input });
    $('f-' + key).value = text;
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
    const m = line.match(/^\s*([^:：]{1,20}?)\s*[:：]\s*(.*)$/);
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
    if (e.target.matches('.ai-req')) return; // AI에게 부탁할 말은 저장하지 않는다
    if (e.target.matches('input, textarea, select')) markDirty();
    if (e.target.matches('textarea')) updateCounts();
    if (e.target.matches('[data-ev]')) updateEventCount();
    if (e.target.matches('#f-title, #f-broadcast_date')) updateMetaText();
    // 직접 입력 칸에 쓰기 시작하면 '직접 정하기'가 골라지게 한다.
    if (e.target.id === 'topic-special') document.querySelector('input[name="topicPick"][value="__custom"]').checked = true;
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
  document.querySelector('.seg').addEventListener('click', e => {
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
