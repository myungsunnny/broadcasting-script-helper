// 학교 주간계획(구글 스프레드시트)에서 다음 주 행사를 읽는다.
//
// 삼호중앙초 주간계획 형식
//  - 한 주가 탭 하나: '10월 4주', '11월 1주', '11월 2주', … ('… 완료'가 붙은 탭도 있음)
//  - 첫 줄 제목: '2026년 11월 1주 주간 계획'  → 연도·월
//  - 머리글 행: 일 | 요일 | 교육활동 및 행사 | (빈 열: ※ 교직원 복무, 보결 …)
//  - 일 열은 '2', '26', '12/1'처럼 날(또는 월/일)만 적혀 있다.
//
// 시트는 '링크가 있는 모든 사용자 – 뷰어'로 공유되어 있어야 한다.
// 머리글이 있는 열(교육활동 및 행사)만 읽고, 머리글이 빈 열(교직원 복무·보결 명단)은 읽지 않는다.

import { addDays, fmt, nextWeekRange, nowKST, parseLooseDate, toDate, WEEKDAYS } from './dates.js';

// 학생에게 소개할 필요가 없는 교직원 일정 (AI에 보내기 전에 뺀다). 필요하면 낱말을 더하거나 빼세요.
const STAFF_ONLY = /※|▣|보결|교직원|직원|연수|기획\s*회의|부장\s*회의|협의회|실천연구|출결|상담\s*마감|복무|출장/;

const sheetBase = id => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}`;

// 같은 시트를 여러 학생이 연달아 열 때를 위해 잠깐(60초) 저장해 두고 쓴다.
// '학교 행사 다시 확인'을 누르면(fresh) 저장분을 건너뛰고 구글 시트를 바로 읽는다.
const CACHE_SECONDS = 60;

async function fetchText(url, fresh = false) {
  const res = await fetch(url, fresh
    ? { cache: 'no-store', redirect: 'follow' }
    : { cf: { cacheTtl: CACHE_SECONDS }, redirect: 'follow' });
  if (!res.ok) throw new Error(`주간계획 시트를 열 수 없습니다 (${res.status}). '링크가 있는 모든 사용자 – 뷰어'로 공유되어 있는지 확인해 주세요.`);
  const text = await res.text();
  if (/accounts\.google\.com|ServiceLogin/.test(res.url)) {
    throw new Error("주간계획 시트가 비공개입니다. '링크가 있는 모든 사용자 – 뷰어'로 공유해 주세요.");
  }
  return text;
}

/** 시트의 탭 목록 [{ name, gid }] */
async function listTabs(sheetId, fresh) {
  const html = await fetchText(`${sheetBase(sheetId)}/htmlview`, fresh);
  const tabs = [...html.matchAll(/items\.push\(\{name: "((?:[^"\\]|\\.)*)",[^}]*?gid: "(\d+)"/g)]
    .map(m => ({ name: JSON.parse(`"${m[1]}"`), gid: m[2] }));
  if (!tabs.length) throw new Error('주간계획 시트의 탭 목록을 읽지 못했습니다.');
  return tabs;
}

/** 따옴표와 줄바꿈을 처리하는 작은 CSV 파서 */
export function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/**
 * '2', '26', '12/1', '2026-11-02' 같은 날짜 칸을 'YYYY-MM-DD'로 바꾼다.
 * 날만 적힌 경우 탭 제목의 연·월 앞뒤 한 달 중 요일 칸과 요일이 맞는 날짜를 고른다.
 */
function resolveDate(cell, weekdayCell, year, month) {
  const s = String(cell || '').trim();
  const full = parseLooseDate(s, year);
  let candidates;
  if (/^\d{1,2}$/.test(s)) {
    candidates = [-1, 0, 1].map(off => fmt(new Date(Date.UTC(year, month - 1 + off, Number(s)))))
      .filter(d => Number(d.slice(8)) === Number(s));
  } else if (full && /^\d{1,2}\s*[.\/월]/.test(s)) {
    candidates = [-1, 0, 1].map(off => `${year + off}${full.slice(4)}`);
  } else {
    return full;
  }
  const wd = String(weekdayCell || '').trim().charAt(0);
  if (WEEKDAYS.includes(wd)) {
    const hit = candidates.find(d => WEEKDAYS[toDate(d).getUTCDay()] === wd);
    if (hit) return hit;
  }
  return candidates.find(d => d.slice(5, 7) === String(month).padStart(2, '0')) || candidates[0] || null;
}

/** 탭 하나(CSV 행들)에서 [{ date, weekday, text }] 를 뽑는다. */
export function extractEvents(rows, fallbackYear) {
  const title = rows.slice(0, 3).flat().join(' ');
  const ym = title.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  const year = ym ? Number(ym[1]) : fallbackYear;
  const month = ym ? Number(ym[2]) : null;

  const isDateHeader = c => /^(일|날짜|일자)$/.test(c.trim()) || /날짜|일자/.test(c);
  const headerIdx = rows.findIndex(r => r.some(isDateHeader));
  if (headerIdx === -1) return [];
  const header = rows[headerIdx].map(h => h.trim());
  const dateCol = header.findIndex(isDateHeader);
  const weekdayCol = header.findIndex(h => h === '요일');
  const contentCols = header.map((h, i) => (h && i !== dateCol && i !== weekdayCol ? i : -1)).filter(i => i >= 0);

  const events = [];
  for (const row of rows.slice(headerIdx + 1)) {
    const date = month
      ? resolveDate(row[dateCol], row[weekdayCol], year, month)
      : parseLooseDate(row[dateCol], year);
    if (!date) continue;
    for (const col of contentCols) {
      for (let line of String(row[col] || '').split('\n')) {
        line = line.trim().replace(/^\d+\s*[.)]\s*/, '').replace(/^[◈◎]\s*/, '');
        if (line && !STAFF_ONLY.test(line)) {
          events.push({ date, weekday: WEEKDAYS[toDate(date).getUTCDay()], text: line });
        }
      }
    }
  }
  return events;
}

/** 다음 주 월~금과 겹칠 수 있는 탭만 고른다 ('11월 1주' 같은 이름 기준). */
function candidateTabs(tabs, start, end) {
  const months = new Set([start, end, addDays(end, 7)].map(d => Number(d.slice(5, 7))));
  const named = tabs.filter(t => /(\d{1,2})\s*월\s*\d\s*주/.test(t.name));
  if (!named.length) return tabs.slice(0, 12);
  return named.filter(t => months.has(Number(t.name.match(/(\d{1,2})\s*월/)[1])));
}

/**
 * fresh: true면 저장분 없이 구글 시트를 지금 바로 읽는다.
 * 반환의 checkedAt은 시트를 확인한 시각(한국 시간 HH:MM)이다.
 */
export async function getNextWeekEvents(env, broadcastDate, { fresh = false } = {}) {
  const range = nextWeekRange(broadcastDate);
  const checkedAt = nowKST().slice(11, 16);
  const sheetId = env.PLAN_SHEET_ID;
  if (!sheetId) {
    return { ...range, checkedAt, events: [], warning: '주간계획 시트(PLAN_SHEET_ID 비밀값)가 설정되지 않았습니다.' };
  }
  const tabs = candidateTabs(await listTabs(sheetId, fresh), range.start, range.end);
  const year = Number(range.start.slice(0, 4));
  const perTab = await Promise.all(tabs.map(async t => {
    const csv = await fetchText(`${sheetBase(sheetId)}/export?format=csv&gid=${t.gid}`, fresh);
    return extractEvents(parseCSV(csv), year);
  }));

  const seen = new Set();
  const events = perTab.flat()
    .filter(e => e.date >= range.start && e.date <= range.end)
    .filter(e => !seen.has(e.date + e.text) && seen.add(e.date + e.text))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { ...range, checkedAt, events };
}
