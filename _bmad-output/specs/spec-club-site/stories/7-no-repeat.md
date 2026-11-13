---
title: '스토리 7: 사자성어·계기교육 중복 방지'
type: 'feature'
created: '2026-11-13'
status: 'done'
baseline_commit: 'b43d4ba94e2d1fefdad7732acac70300206c3641'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 같은 학년도에 이미 방송한 사자성어·계기교육 주제를 AI가 또 고르거나 학생이 모르고 다시 고른다. AI가 스스로 고른 사자성어는 어디에도 남지 않아 다음 대본이 피할 수 없다.

**Approach:** 같은 학년도(3월 1일~이듬해 2월 말) 다른 대본의 `choices.idiom`·`choices.special`을 모아(DB 변경 없음), 주제를 비운 AI 생성에는 "이미 썼으니 고르지 마" 목록을 붙이고 AI가 고른 주제를 첫 줄 `주제: …`로 받아 `choices`에 기록한다. 2단계 화면에는 이미 쓴 주제에 '이미 씀 · 9/12'를 붙인다. 고르는 것은 막지 않는다.

**결정:**
- 학년도: 방송일이 3~12월이면 그해 3/1~이듬해 2월 말, 1~2월이면 전해 3/1~그해 2월 말 (`schoolYearRange`).
- 같은 주제인지: 괄호 안 글자와 띄어쓰기를 빼고 비교한다. 예: `한글날 (10월 9일 목요일)` = `한글날`, `유비무환(有備無患)` = `유비무환`.
- 지금 고치는 대본 자신의 주제는 '이미 씀'에 넣지 않는다(`exclude=<대본 id>`).
- AI 피하기 목록은 주제를 비웠을 때만, 최근 40개까지. 계기교육 후보에서는 이미 쓴 것을 빼되, 다 빠지면 그대로 둔다.
- AI가 고른 주제는 화면에 채운다: 사자성어는 주제 칸에, 계기교육은 '직접 정하기'(목록에 같은 것이 있으면 그 항목)에. 그래서 같은 대본을 다시 쓸 때도 같은 주제가 유지된다. 다른 주제로 바꾸려면 칸을 비우면 된다.
- 첫 줄이 `주제: …` 형식이 아니면 주제 없이 대본 전체를 돌려준다(대본 쓰기는 실패하지 않는다).

## Boundaries & Constraints

**Always:** 학생·선생님 모두. 고르기는 막지 않고 알리기만. 화면 문구는 해요체, `--warn`은 안내, 회색 배지는 '이미 씀'. 글자는 `esc()`. 사용법 2단계에 한 줄.

**Never:** DB·`schema.sql` 변경, 새 라이브러리, 학생 입력 차단.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 학년도 경계 | 2027-02-26 / 2026-03-06 / 2027-03-05 | 2026-03-01~2027-02-28 / 같음 / 2027-03-01~2028-02-29 | 없음 |
| 쓴 주제 모으기 | 다른 대본 2개 같은 사자성어 | 가장 이른 날 하나만 | `choices` JSON 깨짐은 건너뜀 |
| AI 첫 줄 | `주제: 유비무환\n\n이어서…` | `{ text: '이어서…', topic: '유비무환' }` | 형식 틀림/본문 없음이면 `{ text: 전체 }` |
| 2단계 계기교육 | 한글날을 9/12 대본에 씀 | 한글날 옆 '이미 씀 · 9/12' | 불러오기 실패면 표시 없이 그대로 |
| 직접 입력 | 사자성어 칸에 쓴 것 입력 | 칸 아래 "9월 12일 방송에서 이미 썼어요. 그래도 쓸까요?" | 막지 않음 |

</frozen-after-approval>

## Code Map

- `src/dates.js` -- `schoolYearRange(date)`.
- `src/used-topics.js`(새) -- `topicKey`, `collectUsed(rows)`, `getUsedTopics(env, date, excludeId)`, `avoidRule(list)`, `splitTopicLine(text)`.
- `src/ai.js` -- 주제를 비운 `idiom`/`special`에 피하기 목록 + 첫 줄 규칙, 후보에서 쓴 것 빼기, `{ text, topic }` 반환.
- `src/index.js` -- `GET /api/topics/used?date=&exclude=`, `/api/ai/section`이 `script_id`를 받아 넘기고 `{ text, topic }`을 돌려줌.
- `public/app.js` -- 2단계 불러올 때 쓴 주제도 받기, '이미 씀' 배지, 사자성어 쓴 목록·직접 입력 안내, AI가 돌려준 `topic`을 화면에 채우기.
- `public/index.html`·`style.css` -- 사자성어 안내 자리, 회색 배지, 사용법 한 줄.
- `test/used-topics.test.js`(새) -- 위 순수 함수 시험.

## Tasks & Acceptance

**Execution:**
- [x] 서버: `schoolYearRange`, `used-topics.js`, `ai.js`, 라우트 + 시험
- [x] 화면: 배지·안내·`topic` 채우기 + 사용법

**Acceptance Criteria:**
- Given 같은 학년도 다른 대본에 '한글날'과 '유비무환'을 씀, when 새 대본 2단계를 연다, then 한글날 항목에 '이미 씀 · 날짜', 사자성어 칸 아래 쓴 목록이 보인다.
- Given 사자성어 칸을 비우고 AI로 쓴다, when 끝나면, then 칸에 AI가 고른 사자성어가 채워지고 저장된 `choices.idiom`에 남는다.
- Given AI 응답 첫 줄이 형식과 다름, when 쓴다, then 대본은 그대로 들어가고 오류가 없다.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `npm test`, `npm run check`, `node --check public/app.js` -- expected: 성공

## Implementation Notes

- 학생 화면에서 쓴 주제 목록을 불러오지 못하면(`/api/topics/used` 실패) 표시 없이 예전처럼 쓴다. AI 쪽도 읽기 실패면 피하기 목록 없이 쓴다.
- 화면의 `topicKey`는 서버 `src/used-topics.js`와 같은 한 줄을 복사해 두었다. 규칙을 바꾸면 둘 다 바꾼다.
- AI가 고른 계기교육 주제가 목록 이름과 글자가 조금 다르면(예: `세계 손 씻기의 날` vs 목록의 `세계 손 씻기의 날 (10월 15일 목요일)`) '직접 정하기'에 들어간다. 비교는 괄호를 빼고 하므로 중복 표시는 그대로 된다.
- 확인: 로컬 서버에서 임시 선생님 계정으로 대본 3개(9/11 유비무환·한글날, 지난 학년도 2/27, 10/2 새 대본)를 만들어 '이미 씀 · 9/11' 배지, 사자성어·직접 입력 안내, 지난 학년도·자기 대본 제외를 봤다. AI 응답은 가짜 응답으로 바꿔 주제가 칸에 채워지는 것만 봤다(실제 Gemini 호출은 못 함).
