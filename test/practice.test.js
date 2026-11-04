// 낭독 연습 모드 계산(public/practice.js) 시험: npm test
// 브라우저용 일반 script라서 vm으로 불러 전역 함수를 꺼낸다. (vm 쪽 배열은 [...]로 이쪽 배열로 바꿔 비교)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
vm.runInContext(readFileSync(new URL('../public/practice.js', import.meta.url), 'utf8') +
  '\n;globalThis.out = { clockText, paceHint, lineOwners };', ctx);
const { clockText, paceHint, lineOwners } = ctx.out;

test('clockText: 분:초, 반올림, 음수·잘못된 값은 0:00', () => {
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(42), '0:42');
  assert.equal(clockText(49.6), '0:50');
  assert.equal(clockText(725), '12:05');
  assert.equal(clockText(-3), '0:00');
  assert.equal(clockText(undefined), '0:00');
});

test('paceHint: 80% 이하 천천히, 120% 이상 빠르게, 사이는 알맞아요, 예상 0이면 없음', () => {
  assert.equal(paceHint(40, 50), '조금 천천히');   // 정확히 80%
  assert.equal(paceHint(10, 50), '조금 천천히');
  assert.equal(paceHint(41, 50), '알맞아요');
  assert.equal(paceHint(50, 50), '알맞아요');
  assert.equal(paceHint(59, 50), '알맞아요');
  assert.equal(paceHint(60, 50), '조금 빠르게');   // 정확히 120%
  assert.equal(paceHint(0, 0), '');
  assert.equal(paceHint(0, 50), '');               // 안 재고 넘긴 구성
  assert.equal(paceHint(30, 0), '');
});

test('lineOwners: 이름 줄은 그 사람, 함께·이름 없는 줄은 앞 줄을 따르고 맨 앞은 null', () => {
  const names = ['김방송', '이하늘'];
  const text = [
    '안녕하세요.',          // 맨 앞, 이름 없음
    '김방송: 안녕하세요',
    '이어서 소개해요.',     // 앞 줄(김방송)
    '이하늘： 저는 이하늘',  // 전각 콜론
    '함께: 반가워요!',       // 앞 줄(이하늘)
    '',
    '박모름: 명단에 없음',   // 명단에 없는 이름은 앞 줄
    ' 김방송 : 끝'
  ].join('\n');
  assert.deepEqual([...lineOwners(text, names)], [null, '김방송', '김방송', '이하늘', '이하늘', '이하늘', '이하늘', '김방송']);
  assert.deepEqual([...lineOwners('그냥 한 줄', [])], [null]);
});
