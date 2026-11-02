// 홈 묶음(src/home.js) 시험: npm test
// D1 대신 SQL 문장을 보고 정해 둔 행을 돌려주는 작은 가짜 env.DB를 쓴다.
// (SQL의 날짜·상태 거르기는 DB 몫이라, 여기서는 JS가 하는 판정·정렬·묶기만 확인한다.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMyScript, getHome } from '../src/home.js';
import { addDays, nextFriday, todayKST } from '../src/dates.js';

const today = todayKST();
const tomorrow = addDays(today, 1);
const friday = nextFriday(today);

/** rows: { week, upcoming, scriptDates, review, drafts, soon } → 각 문장이 돌려줄 행 */
function fakeEnv(rows = {}) {
  const pick = sql => {
    if (sql.includes('DISTINCT broadcast_date')) return rows.scriptDates || [];
    if (sql.includes('broadcast_date = ?')) return rows.week || [];
    if (sql.includes("'검토요청'")) return rows.review || [];
    if (sql.includes("'작성중'")) return rows.drafts || [];
    if (sql.includes('calendar_events WHERE date BETWEEN')) return rows.soon || [];
    if (sql.includes('calendar_events WHERE date >= ?')) return rows.upcoming || [];
    throw new Error('예상하지 못한 SQL: ' + sql);
  };
  const executed = [];
  return {
    executed,
    DB: {
      prepare: sql => ({ bind: (...args) => ({ sql, args }) }),
      batch: async stmts => stmts.map(s => { executed.push(s.sql); return { results: pick(s.sql) }; })
    }
  };
}

const ev = (id, date, time, members, extra = {}) =>
  ({ id, date, time, title: '일정 ' + id, category: '연습', members: JSON.stringify(members), ...extra });
const draft = (id, date, created_by, announcers) =>
  ({ id, broadcast_date: date, title: '대본 ' + id, created_by, announcers, status: '작성중' });

const student = { name: '이서', role: 'student', uid: 'u1' };
const teacher = { name: '김선생', role: 'teacher' };

test('isMyScript: 쉼표로 나눈 아나운서 중 하나, 앞뒤 공백 무시', () => {
  assert.equal(isMyScript({ created_by: '박하늘', announcers: '김방송,  이서 ' }, student), true);
  assert.equal(isMyScript({ created_by: '박하늘', announcers: ' 이서' }, student), true);
});

test('isMyScript: 만든 사람이 나면 내 대본', () => {
  assert.equal(isMyScript({ created_by: ' 이서 ', announcers: '' }, student), true);
});

test('isMyScript: 이름 일부만 같으면 아님 (이서 vs 이서준)', () => {
  assert.equal(isMyScript({ created_by: '이서준', announcers: '이서준, 김방송' }, student), false);
  assert.equal(isMyScript({ created_by: '박하늘', announcers: '이서준' }, student), false);
});

test('isMyScript: 이름이 비어 있으면 아무것도 내 대본이 아님', () => {
  assert.equal(isMyScript({ created_by: '', announcers: '' }, { name: '  ' }), false);
  assert.equal(isMyScript({ created_by: '', announcers: ', ,' }, { name: '' }), false);
  assert.equal(isMyScript(null, student), false);
});

test('getHome 학생: 내 대본·내 일정만, 날짜 → 대본 먼저 → 시간 순, 최대 5개, reviewQueue 없음', async () => {
  const env = fakeEnv({
    drafts: [
      draft('s-tom', tomorrow, '이서', ''),
      draft('s-other', today, '이서준', '이서준'),     // 이름 일부만 같음: 빠짐
      draft('s-today', today, '박하늘', '김방송, 이서'),
      draft('s-later', addDays(today, 5), '박하늘', '이서'),
      draft('s-later2', addDays(today, 6), '이서', '')
    ],
    soon: [
      ev('e-today-1500', today, '15:00', ['이서', '김방송']),
      ev('e-today-allday', today, '', ['이서']),
      ev('e-not-mine', today, '09:00', ['이서준']),
      ev('e-tom-0800', tomorrow, '08:00', [' 이서 '])
    ]
  });
  const home = await getHome(env, student);
  assert.equal('reviewQueue' in home, false);
  assert.equal(env.executed.some(sql => sql.includes("'검토요청'")), false);
  assert.deepEqual(home.todo.map(t => t.id), ['s-today', 'e-today-allday', 'e-today-1500', 's-tom', 'e-tom-0800']);
  assert.equal(home.todo.length, 5); // s-later, s-later2 는 5개 제한으로 빠짐
  const e1500 = home.todo.find(t => t.id === 'e-today-1500');
  assert.deepEqual(e1500.members, ['김방송']); // 나는 '함께'에서 빠짐
  assert.equal(e1500.kind, 'event');
  assert.equal(home.todo[0].kind, 'script');
  assert.deepEqual(home.notices, []);
});

test('getHome 선생님: reviewQueue 있음, todo 비어 있음', async () => {
  const queue = [
    { id: 'r1', broadcast_date: today, title: '검토 1', status: '검토요청' },
    { id: 'r2', broadcast_date: friday, title: '검토 2', status: '검토요청' }
  ];
  const env = fakeEnv({ review: queue, drafts: [draft('x', today, '김선생', '')] });
  const home = await getHome(env, teacher);
  assert.deepEqual(home.reviewQueue, queue);
  assert.deepEqual(home.todo, []);
  assert.equal(env.executed.some(sql => sql.includes("'작성중'")), false);
});

test('thisWeek: 다음 금요일 대본이 없으면 script null, 있으면 {id,title,status}', async () => {
  const none = await getHome(fakeEnv(), student);
  assert.deepEqual(none.thisWeek, { date: friday, script: null });

  const some = await getHome(fakeEnv({
    week: [{ id: 'w1', broadcast_date: friday, title: '금요방송', status: '검토요청', updated_at: 'x' }]
  }), student);
  assert.deepEqual(some.thisWeek, { date: friday, script: { id: 'w1', title: '금요방송', status: '검토요청' } });
});

test('upcoming: 대본이 있는 날짜에만 hasScript, members는 배열로', async () => {
  const home = await getHome(fakeEnv({
    upcoming: [ev('u1', today, '', ['이서']), ev('u2', friday, '08:40', [])],
    scriptDates: [{ date: friday }]
  }), student);
  assert.deepEqual(home.upcoming.map(e => [e.id, e.hasScript]), [['u1', today === friday], ['u2', true]]);
  assert.deepEqual(home.upcoming[0].members, ['이서']);
});
