// Gemini로 대본 구성(섹션)별 초안을 만든다.

import { getNextWeekEvents } from './weekly-plan.js';
import { getSpecialTopics } from './commemorations.js';
import { nextWeekRange } from './dates.js';
import { getUsedTopics, topicKey, avoidRule, splitTopicLine } from './used-topics.js';

export const SECTIONS = ['greeting', 'events', 'idiom', 'special', 'closing'];

const SYSTEM_PROMPT = `너는 초등학교 방송부 학생들의 대본 작성을 돕는 선생님이야.
대본은 초등학생 아나운서가 소리 내어 읽을 문장이므로,
- 짧고 쉬운 문장과 존댓말("~습니다", "~요")을 사용하고
- 전교생(1~6학년)이 이해할 수 있는 낱말을 쓰며
- 마크다운 기호(#, *, - 등)나 이모지는 쓰지 말고 소리 내어 읽을 문장만 써.
- 확실하지 않은 사실(날짜, 역사적 사실, 통계)은 지어내지 마.
방송은 인사말 → 다음 주 학교 행사 → 사자성어 → 계기교육 → 마무리 인사 순서로 이어지는 한 편이야.
매번 그중 한 구성만 쓰니, 요청받은 구성의 내용만 써.`;

// 인사말과 마무리 사이에 들어가는 구성은 인사 없이 바로 본론으로 들어간다.
const MIDDLE_SECTION_RULE = `
[주의] 이 구성은 방송 중간 순서야. "안녕하세요", "여러분 반갑습니다" 같은 인사, 아나운서 자기소개, "고맙습니다"·"즐거운 주말 보내세요" 같은 끝인사는 절대 넣지 마.
"이어서 ○○ 시간입니다"처럼 앞 순서에서 자연스럽게 넘어오는 말로 시작하고, 다음 순서로 넘어가는 짧은 말로 끝내 줘.`;
const MIDDLE_SECTIONS = ['events', 'idiom', 'special'];

const API = 'https://generativelanguage.googleapis.com/v1beta';
// 한 번 시도할 때 기다리는 시간. 모델이 붐비면 오래 붙잡지 않고 다음 시도로 넘어간다.
// (Cloudflare는 Gemini가 100초 넘게 응답이 없으면 524로 끊는다)
const AI_TIMEOUT_MS = 40 * 1000;
const TOO_SLOW = 'AI 응답이 너무 오래 걸려요. 잠시 후 다시 시도해 주세요.';
const BUSY = 'AI가 지금 너무 바빠요. 1~2분 뒤에 다시 시도해 주세요.';

class GeminiError extends Error {
  constructor(message, retryable) { super(message); this.retryable = retryable; }
}

// 이 API 키로 쓸 수 있는 예비 모델 목록 (Worker가 살아 있는 동안 1시간 기억)
let fallbackCache = { at: 0, models: [] };

/** 기본 모델이 바쁠 때 쓸 다른 Flash 모델을 Google에서 받아 온 목록에서 고른다. */
async function fallbackModels(env, primary) {
  if (Date.now() - fallbackCache.at < 60 * 60 * 1000) return fallbackCache.models;
  let models = [];
  try {
    const res = await fetch(`${API}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
      signal: AbortSignal.timeout(10 * 1000)
    });
    const body = await res.json();
    const version = name => parseFloat((name.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]) || 0;
    models = (body.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => m.name.replace(/^models\//, ''))
      .filter(n => /^gemini-.*flash/.test(n) && n !== primary)
      .filter(n => !/image|tts|audio|live|embed|exp|computer|robotics|native/.test(n))
      // 가벼운 Lite 모델이 덜 붐비므로 먼저, 그다음 정식(비 preview) 모델, 최신 버전 순으로 시도한다.
      .sort((a, b) => (b.includes('lite') - a.includes('lite')) ||
        (a.includes('preview') - b.includes('preview')) || version(b) - version(a))
      .slice(0, 4);
  } catch {
    // 목록을 못 받아도 기본 모델 재시도는 계속한다.
  }
  fallbackCache = { at: Date.now(), models };
  return models;
}

async function requestGemini(env, model, prompt, withThinkingConfig) {
  // 최신 모델은 생각(thinking)에도 출력 토큰을 쓰므로 여유 있게 잡는다.
  const generationConfig = { maxOutputTokens: 8192 };
  // 방송 대본은 깊은 추론이 필요 없으므로 생각을 짧게 해서 응답 시간을 줄인다.
  if (withThinkingConfig) generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  return fetch(`${API}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig
    })
  });
}

/** 모델 하나로 한 번 시도한다. 실패하면 다음 시도로 넘어가도 되는지(retryable)를 담아 던진다. */
async function tryModel(env, model, prompt) {
  let res, body;
  try {
    res = await requestGemini(env, model, prompt, true);
    body = await res.json().catch(() => ({}));
    // 생각 수준 설정을 지원하지 않는 모델이면 설정 없이 한 번 더 시도한다.
    if (res.status === 400 && /thinking/i.test(body.error?.message || '')) {
      res = await requestGemini(env, model, prompt, false);
      body = await res.json().catch(() => ({}));
    }
  } catch (err) {
    if (err.name === 'TimeoutError') throw new GeminiError(TOO_SLOW, true);
    throw new GeminiError('AI 서버에 연결하지 못했어요: ' + err.message, true);
  }
  if (!res.ok) {
    const msg = body.error?.message || String(res.status);
    if (res.status === 524) throw new GeminiError(TOO_SLOW, true);
    if (res.status === 429 || res.status >= 500 || /high demand|overloaded/i.test(msg)) throw new GeminiError(BUSY, true);
    // 이 키로 쓸 수 없는 모델(404, '더 이상 제공되지 않음')이면 다른 모델로 넘어간다.
    if (res.status === 404 || /no longer available|not found/i.test(msg)) throw new GeminiError('AI 호출 실패: ' + msg, true);
    throw new GeminiError('AI 호출 실패: ' + msg, false); // 키 오류 등은 다시 해도 소용없다.
  }
  const text = (body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  if (!text) throw new GeminiError('AI가 답변을 만들지 못했습니다. 다시 시도해 주세요.', true);
  return text;
}

// 기본 모델이 바쁘다고 확인되면 잠시 동안은 기본 모델을 건너뛰고 예비 모델부터 쓴다.
const PRIMARY_BUSY_MS = 5 * 60 * 1000;
let primaryBusyUntil = 0;

/** 기본 모델 → (잠깐 쉬고) 기본 모델 → 예비 모델 순서로 시도한다. 기본 모델이 최근 바빴다면 예비 모델부터. */
async function callGemini(env, prompt) {
  if (!env.GEMINI_API_KEY) throw new Error('Gemini API 키(GEMINI_API_KEY)가 설정되지 않았습니다.');
  const primary = env.GEMINI_MODEL || 'gemini-3.8-flash';
  const skipPrimary = Date.now() < primaryBusyUntil;
  const plan = skipPrimary ? [...await fallbackModels(env, primary), primary] : [primary, primary];
  let lastError;
  for (let i = 0; ; i++) {
    if (i === 2 && !skipPrimary) plan.push(...await fallbackModels(env, primary));
    if (i >= plan.length) break;
    if (i === 1 && !skipPrimary) await new Promise(r => setTimeout(r, 2000));
    try {
      const text = await tryModel(env, plan[i], prompt);
      console.log(`Gemini ${plan[i]} 성공`);
      if (plan[i] === primary) primaryBusyUntil = 0;
      return text;
    } catch (err) {
      lastError = err;
      console.warn(`Gemini ${plan[i]} 실패: ${err.message}`);
      if (!err.retryable) break;
      if (plan[i] === primary) primaryBusyUntil = Date.now() + PRIMARY_BUSY_MS;
      // 기본 모델이 시간 초과였다면 같은 모델을 다시 기다리지 않고 예비 모델로 넘어간다.
      if (i === 0 && !skipPrimary && err.message === TOO_SLOW) i = 1;
    }
  }
  throw lastError;
}

// 구성별 분량. 대본 길이를 바꾸고 싶으면 여기만 고치면 된다. (초등 아나운서 낭독 속도로 전체 약 5~7분)
const LENGTH = {
  greeting: { one: '6~8문장', two: '10~14줄' },
  events:   { one: '행사마다 2~3문장', two: '행사마다 두 사람이 2~3줄씩 주고받기' },
  idiom:    { one: '10~12문장', two: '14~18줄' },
  special:  { one: '12~15문장', two: '16~20줄' },
  closing:  { one: '4~6문장', two: '6~8줄' }
};

function sectionPrompt(section, ctx) {
  const date = ctx.date;
  const two = ctx.speakers.length === 2;
  const len = `\n분량: ${LENGTH[section][two ? 'two' : 'one']}. 너무 짧게 줄이지 말고 이 분량을 꼭 채워 줘.`;
  switch (section) {
    case 'greeting':
      return `${date} 금요일 방송의 시작 인사말을 써 줘. 학교 이름은 "${ctx.school}"이야.
요즘 계절과 날씨 이야기, 이번 주 학교생활을 돌아보는 말, 오늘 방송 순서(다음 주 행사, 사자성어, 계기교육) 안내를 넣어 줘.
` + (two
        ? `두 아나운서가 차례로 자기 이름을 넣어 자기소개를 꼭 해 줘. 예: "${ctx.speakers[0]}: 안녕하세요, ${ctx.school} 방송부 아나운서 ${ctx.speakers[0]}입니다." 다음 줄 "${ctx.speakers[1]}: 아나운서 ${ctx.speakers[1]}입니다."`
        : `아나운서 이름을 넣은 자기소개를 꼭 해 줘. 예: "안녕하세요, ${ctx.school} 방송부 아나운서 ${ctx.speakers[0]}입니다."`) + len;
    case 'events': {
      const list = ctx.events.length
        ? ctx.events.map(e => `- ${e.date}(${e.weekday}) ${e.text}`).join('\n')
        : '(주간계획에 등록된 행사 없음)';
      return `다음 주(${ctx.start} ~ ${ctx.end}) 학교 행사를 학생들에게 소개하는 대본을 써 줘.
아래 목록의 행사를 빠짐없이, 목록에 없는 행사는 넣지 말고 요일 순서대로 소개해. 행사마다 언제, 누가(몇 학년), 어디서 하는지와 어떤 활동인지, 학생이 준비하거나 지켜야 할 점을 친절하게 풀어서 알려 줘.
교직원 회의·출장처럼 학생과 관계없는 일은 빼 줘. 행사가 없으면 "다음 주에는 특별한 행사가 없습니다"라고 말하고 다음 주도 즐겁게 보내자는 말로 마무리해 줘.
마지막에 다음 주 행사를 한 번 짧게 정리해 줘.${len}

[주간계획]
${list}`;
    }
    case 'idiom':
      return `${date} 무렵의 계절과 학교생활에 어울리는 사자성어 하나를 골라 소개하는 대본을 써 줘.
순서: 오늘의 사자성어 소개 → 한 글자씩 한자 뜻풀이 → 전체 뜻 → 유래나 관련 이야기(확실한 것만) → 초등학생이 학교에서 겪을 만한 예시 → 우리가 실천할 다짐.${ctx.topic ? ` 원하는 주제: ${ctx.topic}` : ''}${len}`;
    case 'special': {
      let choose;
      if (ctx.topic) {
        choose = `주제는 반드시 "${ctx.topic}"(으)로 해 줘. 주제에 날짜가 적혀 있으면 그 날짜를 그대로 써서 앞으로 다가오는 날로 소개해 줘.`;
      } else if (ctx.candidates.length) {
        choose = `방송일은 ${date}이야. 아래 [다가오는 계기교육 후보] 중에서 하나만 골라 줘. 방송일보다 이미 지난 기념일은 절대 다루지 마.
날짜는 목록에 적힌 날짜만 쓰고, "다음 주 ○요일은 ○○입니다"처럼 앞으로 다가오는 날로 소개해 줘.

[다가오는 계기교육 후보]
${ctx.candidates.map(c => `- ${c}`).join('\n')}`;
      } else {
        choose = `방송일(${date})부터 2주 안에는 정해진 기념일이 없어. 날짜가 정해진 기념일은 다루지 말고, 이 계절에 맞는 안전·건강·생활 주제(예: 계절별 안전, 감염병 예방, 바른 언어 사용) 하나를 골라 줘.`;
      }
      return `계기교육 시간 대본을 써 줘. ${choose}
순서: 오늘의 주제 소개 → 그날이 생긴 까닭과 의미(확실한 사실만) → 초등학생이 알아 두면 좋은 내용 → 우리가 실천할 수 있는 일 두세 가지 → 다짐.${len}`;
    }
    case 'closing':
      return `금요일 방송을 마치는 마무리 인사를 써 줘. 오늘 방송 내용을 짧게 되짚고, 한 주 동안 수고했다는 말, 주말 안전 당부와 즐거운 주말 인사, 다음 주에 다시 만나자는 내용을 넣어 줘. ` +
        `"지금까지 아나운서 ${ctx.speakers.join(', ')}였습니다"처럼 아나운서 이름을 꼭 넣어 줘(이름 받침에 맞게 '였습니다/이었습니다'를 골라 써).` +
        (two ? ' 마지막 인사는 두 사람이 함께 말하는 줄("함께: 고맙습니다!")로 끝내도 좋아.' : '') + len;
    default:
      throw new Error('알 수 없는 구성입니다: ' + section);
  }
}

/**
 * 계기교육 후보: 방송일 이후 2주 안의 기념일 + 다음 주 학교 주간계획에 있는 교육주간·캠페인.
 * 방송일보다 지난 날은 넣지 않는다.
 */
async function specialCandidates(env, date, used) {
  // 주제를 고르지 않았을 때는 날짜가 정해진 후보(기념일·학교 계획)만 AI에 준다.
  const all = (await getSpecialTopics(env, date)).filter(t => t.kind !== '계절').map(t => t.label);
  // 이번 학년도에 이미 쓴 주제는 빼되, 다 빠지면 그대로 둔다.
  const usedKeys = new Set(used.map(u => topicKey(u.topic)));
  const fresh = all.filter(l => !usedKeys.has(topicKey(l)));
  return fresh.length ? fresh : all;
}

/** 아나운서 수에 맞춰 대본 형식을 알려 준다. */
function speakerGuide(speakers) {
  if (speakers.length === 2) {
    const [a, b] = speakers;
    return `\n\n[진행 방식]
아나운서 두 명(${a}, ${b})이 번갈아 말하는 대화 형식으로 써 줘.
- 모든 줄은 "${a}: " 또는 "${b}: "처럼 말하는 사람 이름과 쌍점으로 시작해.
- 두 사람이 같이 말하는 줄은 "함께: "로 시작해.
- 두 사람의 분량이 비슷하도록 한두 문장씩 주고받아 줘.`;
  }
  return `\n\n[진행 방식]\n아나운서 한 명(${speakers[0]})이 혼자 진행해. 이름표 없이 읽을 문장만 써.`;
}

/**
 * input: { section, date, announcers: ['이름1', '이름2'], topic, request, draft, selectedEvents? }
 * selectedEvents: 화면에서 고른 행사 [{ date, weekday, text }] (행사 구성에서만 씀)
 * announcers 길이가 아나운서 수(1 또는 2)다. 이름이 비어 있으면 '아나운서1'처럼 자리 표시를 쓴다.
 * scriptId: 지금 대본 id (이미 쓴 주제에서 자기 자신을 뺀다)
 * 반환: { text, topic? }  topic은 사자성어·계기교육 주제를 AI가 골랐을 때만
 */
export async function generateSection(env, input) {
  const names = input.announcers?.length ? input.announcers : [''];
  const speakers = names.map((n, i) => n || `아나운서${names.length === 2 ? i + 1 : ''}`);
  const ctx = { ...input, speakers, school: env.SCHOOL_NAME || '우리학교', events: [], candidates: [] };
  if (input.section === 'events') {
    // 화면에서 고른 행사가 있으면 그것만, 없으면 주간계획의 학생 행사 전부를 쓴다.
    Object.assign(ctx, Array.isArray(input.selectedEvents)
      ? { ...nextWeekRange(input.date), events: input.selectedEvents }
      : await getNextWeekEvents(env, input.date));
  }
  // 사자성어·계기교육 주제를 비웠으면 이번 학년도에 쓴 주제를 피하고, 고른 주제를 첫 줄로 받는다.
  const pickTopic = ['idiom', 'special'].includes(input.section) && !input.topic;
  let used = { idioms: [], specials: [] };
  if (pickTopic) {
    try { used = await getUsedTopics(env, input.date, input.scriptId || ''); } catch (err) { console.warn('쓴 주제 읽기 실패: ' + err.message); }
  }
  if (input.section === 'special' && !input.topic) ctx.candidates = await specialCandidates(env, input.date, used.specials);

  let prompt = sectionPrompt(input.section, ctx) + speakerGuide(speakers);
  if (MIDDLE_SECTIONS.includes(input.section)) prompt += '\n' + MIDDLE_SECTION_RULE;
  if (pickTopic) prompt += input.section === 'idiom' ? avoidRule('사자성어', used.idioms) : avoidRule('계기교육 주제', used.specials);
  if (input.draft) prompt += `\n\n[학생이 쓴 초안]\n${input.draft}\n초안의 내용과 말투를 최대한 살려서 다듬어 줘.`;
  if (input.request) prompt += `\n\n[추가 요청]\n${input.request}`;
  const text = await callGemini(env, prompt);
  return pickTopic ? splitTopicLine(text) : { text };
}
