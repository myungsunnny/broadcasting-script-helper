// 날짜는 모두 한국 시간 기준 'YYYY-MM-DD' 문자열로 다룬다.

const KST_OFFSET = 9 * 60 * 60 * 1000;

export function todayKST() {
  return new Date(Date.now() + KST_OFFSET).toISOString().slice(0, 10);
}

export function nowKST() {
  // 초 단위까지 남겨야 동시 수정 감지(updated_at 비교)가 정확하다.
  return new Date(Date.now() + KST_OFFSET).toISOString().slice(0, 19).replace('T', ' ');
}

/** 'YYYY-MM-DD' → UTC 자정 Date (요일 계산용) */
export function toDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fmt(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(str, n) {
  const d = toDate(str);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

export const WEEKDAYS = '일월화수목금토';

export function weekday(str) {
  return WEEKDAYS[toDate(str).getUTCDay()];
}

/** 오늘(포함) 이후 첫 금요일 */
export function nextFriday(from = todayKST()) {
  return addDays(from, (5 - toDate(from).getUTCDay() + 7) % 7);
}

/** 방송일 다음 주 월요일~금요일 */
export function nextWeekRange(broadcastDate) {
  const day = toDate(broadcastDate).getUTCDay();
  const monday = addDays(broadcastDate, (8 - day) % 7 || 7);
  return { start: monday, end: addDays(monday, 4) };
}

export function isValidDate(str) {
  return /^\d{4}-\d{2}-\d{2}$/.test(str || '') && !isNaN(toDate(str));
}

/**
 * 주간계획 시트의 다양한 날짜 표기를 'YYYY-MM-DD'로 바꾼다.
 * 예: 2026-11-02, 2026. 11. 2., 11/2, 11/2(월), 11월 2일, 11.2
 */
export function parseLooseDate(value, defaultYear) {
  const s = String(value || '').trim();
  if (!s) return null;
  let m = s.match(/(\d{4})\s*[.\-\/년]\s*(\d{1,2})\s*[.\-\/월]\s*(\d{1,2})/);
  if (!m) {
    const short = s.match(/^(\d{1,2})\s*[.\/월]\s*(\d{1,2})/);
    if (short) m = [null, defaultYear, short[1], short[2]];
  }
  if (!m) return null;
  const str = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  return isValidDate(str) ? str : null;
}

/** 방송일이 속한 학년도(3월 1일 ~ 이듬해 2월 말) { start, end } */
export function schoolYearRange(date) {
  const y = Number(date.slice(0, 4)) - (Number(date.slice(5, 7)) < 3 ? 1 : 0);
  return { start: `${y}-03-01`, end: addDays(`${y + 1}-03-01`, -1) };
}
