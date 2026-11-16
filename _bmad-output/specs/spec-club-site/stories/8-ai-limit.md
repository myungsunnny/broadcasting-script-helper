---
title: '스토리 8: AI 사용량 제한 (학생 하루 30번)'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '9efa2744e2faeb7e9f2b8715846077f613e1b4ac'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 학생이 AI 버튼을 제한 없이 누를 수 있어 Gemini 무료 한도가 금방 닳고, 장난으로 여러 번 눌러도 막을 방법이 없다.

**Approach:** 학생마다 한국 시간 하루 단위로 AI 요청 수를 DB(`ai_usage`)에 세어, 한도(`AI_DAILY_LIMIT`, 기본 30)에 닿으면 쉬운 말로 거절한다(429). 화면 AI 버튼 옆에 "오늘 AI 27번 남음"을 보여 준다. 선생님은 세지도 막지도 않는다.

**결정:**
- 1번 = `/api/ai/section` 요청 1번(구성 하나). 전체 초안 만들기는 구성 5개라 5번을 쓴다.
- 하루 = 한국 시간 자정 기준(`todayKST()`).
- 세는 방법: 한 문장으로 하나 올리고 한도면 안 올린다(`INSERT … ON CONFLICT DO UPDATE SET count = count + 1 WHERE count < 한도 RETURNING count`). 동시에 눌러도 31번째는 안 된다.
- Gemini 쪽 실패(바쁨·시간 초과 등 AI 오류)면 그 1번을 되돌린다. 학생 잘못이 아니므로 횟수를 잃지 않는다.
- 한도는 `wrangler.jsonc` `vars.AI_DAILY_LIMIT`(공개 값 `"30"`). 숫자가 아니거나 없으면 30.
- 7일 지난 기록은 셀 때 함께 지운다. 학생 계정을 지우면 그 학생 기록도 같이 지운다.
- 다 쓰면 AI 버튼(전체 초안, 구성별 부탁하기·처음부터 다시)을 막고 안내를 보인다. 직접 쓰기는 그대로 된다.
- 남은 횟수가 5 미만이면 전체 초안 버튼에 "남은 횟수가 부족해요" 안내를 보이고 누를 수 없게 한다. 구성별 쓰기는 된다.

## Boundaries & Constraints

**Always:** 기존 표·열은 그대로(새 표 추가만). `CREATE TABLE IF NOT EXISTS`로 두 번 실행해도 안전. 화면 문구는 해요체, 5번 이하이면 `--warn` 색. 거절 문구: "오늘 AI를 다 썼어요. 내일 다시 쓸 수 있어요. 급하면 선생님께 말씀드려요."

**Never:** 선생님 계정 제한, 새 라이브러리, 비밀값을 `wrangler.jsonc`에 쓰기, 원격 DB에 직접 실행.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 첫 요청 | 오늘 기록 없음, 한도 30 | 기록 1, 응답 `aiLeft: 29` | 없음 |
| 마지막 1번 | 오늘 29번 씀 | 성공, `aiLeft: 0` | 없음 |
| 31번째 | 오늘 30번 씀 | 429 + 거절 문구, Gemini 부르지 않음, 기록 30 그대로 | 화면은 버튼 막기 |
| AI 실패 | Gemini 오류 | 오류 그대로 전달, 기록 1 되돌림 | 화면은 기존 오류 안내 |
| 선생님 | 교사 로그인 | 기록 없음, `aiLeft` 없음 | 없음 |
| 날짜 바뀜 | 어제 30번, 오늘 첫 요청 | 오늘 새로 1 | 없음 |
| 한도 값 이상 | `AI_DAILY_LIMIT` 없음/`"abc"` | 30으로 셈 | 없음 |

</frozen-after-approval>

## Code Map

- `migrations/0009_ai_usage.sql`(새), `schema.sql` 끝 -- `ai_usage(user_uid TEXT, day TEXT, count INTEGER, PK(user_uid, day))`. `user_uid`는 `String(user.uid)`.
- `src/ai-usage.js`(새) -- `aiLimit(env)`, `useAi(env, user)`(올리기·429용 오류·오래된 기록 정리, 남은 수 반환), `refundAi(env, user)`, `aiLeft(env, user)`(학생만, 선생님은 `undefined`).
- `src/index.js` -- `/api/me` `config.aiLeft`; `/api/ai/section`에서 `generateSection` 앞에 `useAi`, 실패 시 `refundAi` 후 다시 던짐, 성공 응답에 `aiLeft`. 기존 `HttpError`·`json()` 그대로.
- `src/ai.js` -- `generateSection`이 던지는 오류. 입력 검사(400)는 세기 전에 끝나므로 되돌릴 필요 없음. 고치지 않는다.
- `src/users.js` `deleteUser` -- batch에 `DELETE FROM ai_usage WHERE user_uid = ?` 추가.
- `wrangler.jsonc` `vars` -- `"AI_DAILY_LIMIT": "30"`.
- `public/app.js` -- `state.config.aiLeft` 저장, `renderAiLeft()`로 `.ai-left` 글자·버튼 막기, `aiSection` 성공 시 `aiLeft` 갱신, 429면 `aiLeft = 0`. `aiAll`은 남은 수 5 미만이면 시작 안 함.
- `public/index.html` 3단계 카드, `app.js` 구성 카드 `.redo` -- `<span class="ai-left">` 자리. `style.css` -- `.ai-left`, `.ai-left.low`(`--warn`).
- `test/ai-usage.test.js`(새) -- `notify.test.js`의 node:sqlite + D1 어댑터 방식으로 위 표를 시험(Gemini는 `fetch` 가짜로).

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0009_ai_usage.sql`, `schema.sql`, `wrangler.jsonc` -- 표·한도 추가
- [x] `src/ai-usage.js`, `src/index.js`, `src/users.js` -- 세기·거절·되돌리기·삭제 정리
- [x] `test/ai-usage.test.js` -- 표의 경우들 시험
- [x] `public/app.js`, `index.html`, `style.css` -- 남은 횟수 표시·버튼 막기, 사용법 FAQ 한 줄

**Acceptance Criteria:**
- Given 학생이 오늘 30번 썼음, when AI 버튼 화면을 연다, then "오늘 AI를 다 썼어요…" 안내가 보이고 AI 버튼은 눌리지 않으며 직접 쓰기는 된다.
- Given 학생이 3번 남음, when 3단계를 연다, then 전체 초안 버튼에 "남은 횟수가 부족해요"가 보이고 4단계 구성별 쓰기는 된다.
- Given 선생님 로그인, when AI를 쓴다, then 남은 횟수 표시가 없고 제한이 없다.

## Implementation Notes

- 새 파일 `src/ai-usage.js`: `aiLimit`, `useAi`(남은 수 / 다 쓰면 null / 선생님 undefined), `refundAi`, `aiLeft`. 거절 문구는 `AI_LIMIT_MESSAGE`.
- `/api/me`의 `aiLeft`는 실패해도 빠지기만 한다(표가 아직 없을 때 학생 로그인 화면이 깨지지 않게). `/api/ai/section`은 표가 없으면 500 — 그래서 배포 전에 0009를 꼭 먼저 실행한다.
- 화면: `renderAiLeft()`가 `.ai-left` 글자와 버튼 막기를 맞춘다. 대본을 열 때(`fill`) `/api/me`로 남은 수를 다시 받는다. 전체 초안 중 429가 나오면 남은 구성은 부르지 않는다. 두 응답 순서가 바뀌어도 남은 수는 작은 쪽을 쓴다.
- 사용법 FAQ는 한도 숫자를 쓰지 않는다(`AI_DAILY_LIMIT`를 바꿔도 맞게).
- 확인: `npm test` 74개 통과(새 시험 10개), `npm run check` 통과. 화면·실제 로그인은 이 폴더에 `.dev.vars`가 없어 확인하지 못했다.

## Spec Change Log

## Review Triage Log

| 찾은 문제 | 판정 | 근거·처리 |
|---|---|---|
| 자정 직전 시작·직후 실패면 되돌리기가 새 날에 들어감 | low, 거절 | 30초 창에서만 생기고 0 아래로 안 내려가 해가 거의 없음. 고치려면 매개변수 추가 |
| AI 오류가 아닌 실패도 되돌림 | false | `generateSection` 오류는 키 없음·Gemini 오류뿐, 입력 오류는 세기 전에 400 |
| 페이지를 밤새 열어 두면 다음 날도 막혀 있음 | low, 거절 | 대본을 다시 열면 `/api/me`로 다시 받음 |
| 전체 초안이 429 뒤에도 계속 요청 | low, 고침 | 429면 남은 구성 건너뜀 |
| `renderAiLeft`가 다른 이유로 막힌 버튼을 풀 수 있음 | false | 버튼을 막는 다른 이유는 `state.locked`뿐이고 함께 계산함. 전체 초안 중에는 그리지 않음 |
| 응답 순서가 바뀌면 남은 수가 커 보임 | low, 고침 | 숫자면 작은 쪽 유지 |
| FAQ·주석에 30/5 숫자 고정 | low, 고침 | FAQ에서 숫자 뺌(5는 구성 수라 그대로) |
| 거절 문구가 화면·서버에 두 벌 | low, 거절 | 화면 문구는 서버 응답 전 안내용으로 필요 |
| 매 요청마다 오래된 기록 지우기(전체 훑기) | false | 표가 학생 수×7일 정도로 작음 |
| 동시 시험이 진짜 동시가 아님 | low, 거절 | 31번째 시험이 `WHERE count < ?` 막기를 직접 확인 |
| `/api/me` 표 없음 대비가 시험 안 됨 | medium, 고침 | 표를 지우고 200·`aiLeft` 없음 시험 추가 |
| `/api/ai/section` 표 없으면 500 | false | 의도한 동작. 배포 전 0009 실행이 규칙 |
| 구성 카드 남은 수에 화면 읽기 알림 없음 | low, 거절 | 3단계 카드는 `aria-live`, 막힌 이유는 글자로 보임 |
| SQL 주석 두 파일이 조금 다름 | low, 거절 | 표 정의는 같음 |
| 되돌리기까지 실패하는 경우 시험 없음 | medium, 미룸 | deferred-work |
| 화면 막기 로직 자동 시험 없음 | medium, 미룸 | deferred-work, 실제 로그인 확인으로 대신 |
| 남은 수 1~4면 버튼이 막혀 안내 창이 안 뜸 | low, 거절 | 같은 안내가 버튼 아래 글자로 보임 |

## Verification

**Commands:**
- `npm test`, `npm run check`, `node --check public/app.js` -- expected: 성공

**Manual checks:**
- 이 작업 폴더에는 `.dev.vars`가 없어 실제 로그인 확인은 메인 세션(main 폴더)에서 한다.
