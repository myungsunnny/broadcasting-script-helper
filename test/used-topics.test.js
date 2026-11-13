// 중복 방지(CAP-7) 시험: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { schoolYearRange } from '../src/dates.js';
import { topicKey, collectUsed, avoidRule, splitTopicLine, getUsedTopics } from '../src/used-topics.js';

test('schoolYearRange: 3월~이듬해 2월 말, 윤년', () => {
  assert.deepEqual(schoolYearRange('2026-03-06'), { start: '2026-03-01', end: '2027-02-28' });
  assert.deepEqual(schoolYearRange('2026-12-31'), { start: '2026-03-01', end: '2027-02-28' });
  assert.deepEqual(schoolYearRange('2027-02-26'), { start: '2026-03-01', end: '2027-02-28' });
  assert.deepEqual(schoolYearRange('2027-03-05'), { start: '2027-03-01', end: '2028-02-29' });
  assert.deepEqual(schoolYearRange('2028-01-07'), { start: '2027-03-01', end: '2028-02-29' });
});

test('topicKey: 괄호 안과 띄어쓰기를 뺀다', () => {
  assert.equal(topicKey('한글날 (10월 9일 목요일)'), '한글날');
  assert.equal(topicKey('유비무환(有備無患)'), '유비무환');
  assert.equal(topicKey('유비 무환（有備無患）'), '유비무환');
  assert.equal(topicKey(undefined), '');
});

test('collectUsed: 같은 주제는 가장 이른 날 하나, 깨진 JSON·빈 값은 건너뜀', () => {
  const rows = [
    { broadcast_date: '2026-09-12', choices: JSON.stringify({ idiom: '유비무환', special: '한글날 (10월 9일 목요일)' }) },
    { broadcast_date: '2026-09-19', choices: '{깨짐' },
    { broadcast_date: '2026-10-02', choices: JSON.stringify({ idiom: '유비무환(有備無患)', special: '' }) },
    { broadcast_date: '2026-10-09', choices: JSON.stringify({ idiom: '관포지교', events: [] }) }
  ];
  assert.deepEqual(collectUsed(rows), {
    idioms: [{ topic: '유비무환', date: '2026-09-12' }, { topic: '관포지교', date: '2026-10-09' }],
    specials: [{ topic: '한글날 (10월 9일 목요일)', date: '2026-09-12' }]
  });
});

test('getUsedTopics: 학년도 범위와 자기 대본 빼기를 DB에 넘긴다', async () => {
  let args;
  const env = { DB: { prepare: () => ({ bind: (...a) => { args = a; return { all: async () => ({ results: [] }) }; } }) } };
  assert.deepEqual(await getUsedTopics(env, '2027-01-08', 'abc'), { idioms: [], specials: [] });
  assert.deepEqual(args, ['2026-03-01', '2027-02-28', 'abc']);
});

test('avoidRule: 쓴 목록(최근 40개)과 첫 줄 형식', () => {
  const r = avoidRule('사자성어', [{ topic: '유비무환' }]);
  assert.match(r, /- 유비무환/);
  assert.match(r, /첫 줄에는 "주제: \(고른 사자성어\)"/);
  assert.doesNotMatch(avoidRule('사자성어', []), /이미 쓴/);
  const many = Array.from({ length: 45 }, (_, i) => ({ topic: 'T' + i }));
  const r2 = avoidRule('사자성어', many);
  assert.doesNotMatch(r2, /- T4\n/);
  assert.match(r2, /- T5\n/);
  assert.match(r2, /- T44/);
});

test('splitTopicLine: 첫 줄 주제를 떼고, 형식이 틀리면 대본 그대로', () => {
  assert.deepEqual(splitTopicLine('주제: 유비무환\n\n이어서 사자성어 시간입니다.'), { text: '이어서 사자성어 시간입니다.', topic: '유비무환' });
  assert.deepEqual(splitTopicLine('**주제：한글날**\r\n김방송: 이어서…'), { text: '김방송: 이어서…', topic: '한글날' });
  assert.deepEqual(splitTopicLine('이어서 사자성어 시간입니다.'), { text: '이어서 사자성어 시간입니다.' });
  assert.deepEqual(splitTopicLine('주제: 유비무환'), { text: '주제: 유비무환' }); // 본문이 없으면 그대로
  assert.deepEqual(splitTopicLine('이어서\n주제: 나중 줄'), { text: '이어서\n주제: 나중 줄' });
});
