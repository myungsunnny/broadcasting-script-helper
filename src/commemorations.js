// 계기교육 후보: 날짜가 해마다 같은 기념일
// AI가 날짜를 짐작하지 않도록 여기 목록에서 방송일 이후 다가오는 날만 골라 알려 준다.
// 학교에서 챙기는 날이 더 있으면 [월, 일, '이름'] 형식으로 더하면 된다.

import { addDays, toDate, weekday } from './dates.js';
import { getNextWeekEvents } from './weekly-plan.js';

const DAYS = [
  [2, 28, '2·28 민주운동 기념일'],
  [3, 1, '삼일절'],
  [3, 15, '3·15 의거 기념일'],
  [3, 22, '세계 물의 날'],
  [4, 5, '식목일'],
  [4, 7, '보건의 날'],
  [4, 11, '대한민국 임시정부 수립 기념일'],
  [4, 19, '4·19 혁명 기념일'],
  [4, 20, '장애인의 날'],
  [4, 21, '과학의 날'],
  [4, 22, '지구의 날'],
  [5, 5, '어린이날'],
  [5, 8, '어버이날'],
  [5, 15, '스승의 날'],
  [5, 18, '5·18 민주화운동 기념일'],
  [5, 25, '실종아동의 날'],
  [5, 31, '바다의 날'],
  [6, 5, '환경의 날'],
  [6, 6, '현충일'],
  [6, 10, '6·10 민주항쟁 기념일'],
  [6, 25, '6·25 전쟁일'],
  [7, 17, '제헌절'],
  [8, 15, '광복절'],
  [8, 29, '경술국치일'],
  [9, 7, '푸른 하늘의 날'],
  [10, 1, '국군의 날'],
  [10, 2, '노인의 날'],
  [10, 3, '개천절'],
  [10, 9, '한글날'],
  [10, 15, '세계 손 씻기의 날'],
  [10, 16, '세계 식량의 날'],
  [10, 21, '경찰의 날'],
  [10, 24, '국제연합일(유엔의 날)'],
  [10, 25, '독도의 날'],
  [11, 3, '학생독립운동기념일'],
  [11, 9, '소방의 날'],
  [11, 11, '농업인의 날'],
  [11, 17, '순국선열의 날'],
  [12, 3, '세계 장애인의 날'],
  [12, 10, '세계 인권의 날']
];

// 날짜와 상관없이 그 달에 어울리는 계기교육 주제 (기념일이 없을 때도 고를 수 있게)
const SEASONAL = {
  1: ['겨울철 안전(빙판길·동상 예방)', '감기·독감 예방', '새해 다짐 세우기'],
  2: ['새 학년 준비', '겨울철 화재 예방'],
  3: ['새 학기 친구 사귀기', '학교폭력 예방', '등하굣길 교통안전'],
  4: ['봄철 미세먼지 대처', '등하굣길 교통안전', '생명 존중'],
  5: ['가족 사랑과 감사하는 마음', '식중독 예방'],
  6: ['나라 사랑', '물놀이 안전', '환경 보호 실천'],
  7: ['여름 방학 안전', '폭염 대비 건강 수칙', '물놀이 안전'],
  8: ['2학기 준비', '여름철 건강 관리'],
  9: ['추석 예절', '독서의 계절, 책 읽기', '바른 생활 습관'],
  10: ['한글 사랑, 바른 언어 사용', '가을철 야외 활동 안전', '사이버 예절'],
  11: ['겨울철 화재 예방', '감기·독감 예방', '사이버 예절(정보윤리)'],
  12: ['겨울 방학 안전', '나눔과 봉사', '인권 존중']
};

// 방송일(포함)부터 며칠 뒤까지의 기념일을 후보로 볼지
export const LOOKAHEAD_DAYS = 14;

/** 방송일부터 LOOKAHEAD_DAYS일 안에 있는 기념일 [{ date, weekday, name }] (가까운 순) */
export function upcomingCommemorations(broadcastDate) {
  const end = addDays(broadcastDate, LOOKAHEAD_DAYS);
  const years = [...new Set([broadcastDate, end].map(d => Number(d.slice(0, 4))))];
  return years
    .flatMap(y => DAYS.map(([m, d, name]) => ({
      date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, name
    })))
    .filter(c => c.date >= broadcastDate && c.date <= end)
    .map(c => ({ ...c, weekday: weekday(c.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 계기교육 주제 목록 (방송일보다 지난 날은 넣지 않는다)
 *  - kind '기념일': 방송일부터 2주 안의 기념일 (dday: 방송일로부터 며칠 뒤)
 *  - kind '학교': 다음 주 학교 주간계획에 있는 교육주간·캠페인
 *  - kind '계절': 그 달에 어울리는 주제
 * 반환: [{ label, kind, date?, dday? }]  label이 AI에 그대로 주제로 전달된다.
 */
export async function getSpecialTopics(env, broadcastDate, { fresh = false } = {}) {
  const dayMs = 24 * 60 * 60 * 1000;
  const topics = upcomingCommemorations(broadcastDate).map(c => ({
    label: `${c.name} (${Number(c.date.slice(5, 7))}월 ${Number(c.date.slice(8))}일 ${c.weekday}요일)`,
    kind: '기념일',
    date: c.date,
    dday: Math.round((toDate(c.date) - toDate(broadcastDate)) / dayMs)
  }));
  try {
    const { events } = await getNextWeekEvents(env, broadcastDate, { fresh });
    for (const e of events) {
      if (/주간|의 날|기념|캠페인/.test(e.text)) topics.push({ label: e.text.replace(/\([^)]*\)\s*$/, '').trim(), kind: '학교', date: e.date });
    }
  } catch {
    // 주간계획을 못 읽어도 나머지 주제로 고를 수 있다.
  }
  // 방송은 다음 주를 내다보므로 일주일 뒤가 속한 달의 주제를 쓴다. (10/30 방송 → 11월 주제)
  for (const t of SEASONAL[Number(addDays(broadcastDate, 7).slice(5, 7))] || []) topics.push({ label: t, kind: '계절' });
  return topics;
}
