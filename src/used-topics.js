// 같은 학년도에 이미 쓴 사자성어·계기교육 주제 (CAP-7). DB 변경 없이 scripts.choices에서 읽는다.

import { schoolYearRange } from './dates.js';

// AI 피하기 목록에 넣는 최대 개수 (프롬프트가 너무 길어지지 않게)
const MAX_AVOID = 40;

/** 같은 주제인지 비교하는 열쇠: 괄호 안 글자와 띄어쓰기를 뺀다. 화면(app.js)의 topicKey와 같게 유지한다. */
export function topicKey(s) {
  return String(s || '').replace(/[(（][^)）]*[)）]/g, '').replace(/\s+/g, '');
}

/** rows: [{ broadcast_date, choices }] (방송일 순) → { idioms: [{topic, date}], specials: [...] } 같은 주제는 가장 이른 날 하나만 */
export function collectUsed(rows) {
  const out = { idioms: [], specials: [] };
  const seen = { idioms: new Set(), specials: new Set() };
  for (const r of rows) {
    let c;
    try { c = JSON.parse(r.choices || '{}'); } catch { continue; }
    for (const [field, list] of [['idiom', 'idioms'], ['special', 'specials']]) {
      const key = topicKey(c[field]);
      if (!key || seen[list].has(key)) continue;
      seen[list].add(key);
      out[list].push({ topic: String(c[field]), date: r.broadcast_date });
    }
  }
  return out;
}

/** 방송일이 속한 학년도의 다른 대본(excludeId 빼고)에서 쓴 주제 */
export async function getUsedTopics(env, date, excludeId = '') {
  const { start, end } = schoolYearRange(date);
  const { results } = await env.DB.prepare(
    'SELECT broadcast_date, choices FROM scripts WHERE broadcast_date BETWEEN ? AND ? AND id != ? ORDER BY broadcast_date'
  ).bind(start, end, excludeId).all();
  return collectUsed(results);
}

/** 주제를 정하지 않았을 때 AI에 붙이는 규칙: 이미 쓴 주제 피하기 + 첫 줄에 고른 주제 쓰기 */
export function avoidRule(kind, used) {
  const list = used.slice(-MAX_AVOID).map(u => u.topic);
  return (list.length ? `\n\n[이미 쓴 ${kind}] 이번 학년도에 이미 방송했으니 아래는 고르지 마.\n${list.map(t => `- ${t}`).join('\n')}` : '') +
    `\n\n[형식] 첫 줄에는 "주제: (고른 ${kind})"만 쓰고, 다음 줄부터 대본을 써.`;
}

/** AI 응답의 첫 줄 '주제: …'을 떼어 { text, topic }. 형식이 다르면 { text } 그대로 (대본은 버리지 않는다) */
export function splitTopicLine(raw) {
  const m = String(raw).match(/^\s*\**\s*주제\s*[:：]\s*(.+?)\s*\**\s*(?:\r?\n|$)([\s\S]*)$/);
  const text = m?.[2].trim();
  return m && text ? { text, topic: m[1].slice(0, 200) } : { text: raw };
}
