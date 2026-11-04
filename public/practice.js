// 낭독 연습 모드의 화면 없는 계산 (app.js보다 먼저 불러온다. 시험: test/practice.test.js)

/** "이름: 대사" 한 줄 (formatSpeech와 같이 쓴다) */
const SPEAKER_RE = /^\s*([^:：]{1,20}?)\s*[:：]\s*(.*)$/;

/** 초 → '0:42', '12:05' */
function clockText(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 실제가 예상의 80% 이하면 '조금 천천히', 120% 이상이면 '조금 빠르게', 그 사이는 '알맞아요'. 예상 0초·안 잰 구성(실제 0)이면 '' */
function paceHint(actual, expected) {
  if (!(expected > 0) || !(actual > 0)) return '';
  const r = actual / expected;
  return r <= 0.8 ? '조금 천천히' : r >= 1.2 ? '조금 빠르게' : '알맞아요';
}

/**
 * 줄마다 말하는 아나운서 이름. 'names'에 있는 이름으로 시작하는 줄은 그 사람,
 * '함께' 줄·이름 없는 줄은 앞 줄을 따른다(맨 앞은 null).
 */
function lineOwners(text, names) {
  let owner = null;
  return String(text ?? '').split('\n').map(line => {
    const who = line.match(SPEAKER_RE)?.[1].trim();
    if (who && who !== '함께' && names.includes(who)) owner = who;
    return owner;
  });
}
