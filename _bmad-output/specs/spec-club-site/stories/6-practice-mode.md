---
title: '스토리 6: 낭독 연습 모드'
type: 'feature'
created: '2026-11-04'
status: 'done'
baseline_commit: 'f434521a2852d2f4a308b3862999030e950948ff'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 아나운서가 대본을 소리 내어 연습할 때 걸린 시간을 재고 예상 시간과 견줄 방법이 없다. 방송용 보기는 한 화면에 다 나와 구성별로 넘기기 어렵다.

**Approach:** `?practice=<id>` 전체 화면(ux-design.md 6절)에서 큰 글씨로 구성을 하나씩 보여 주고 구성별 타이머로 잰 뒤, 끝 화면에서 구성별 실제/예상/차이를 보여 준다. DB·API 변경 없음, 결과는 저장하지 않는다.

**결정 (spec_checkpoint 없음, 개발자가 정함):**
- 들어가는 곳: 4단계 아래 막대와 방송용 보기 머리에 [연습하기]. 편집 중이면 저장 후 지금 화면의 내용으로 연습한다(주소로 바로 열면 서버 내용).
- 빈 구성은 건너뛴다. 모두 비었으면 "연습할 내용이 없어요"와 [대본으로 돌아가기].
- 아나운서 이름이 둘 이상이면 시작 전 [이름1] [이름2] [둘 다]. 내 줄은 진하게, 남의 줄은 흐리게, '함께' 줄과 이름 없는 줄은 앞 줄을 따른다(맨 앞은 보통).
- 예상 시간 = 공백 뺀 글자 수 / `CHARS_PER_SECOND`(`updateCounts`·`readTimeText`와 같은 규칙).
- 안내: 구성마다, 그리고 합계에, 실제가 예상의 80% 이하면 "조금 천천히", 120% 이상이면 "조금 빠르게", 그 사이는 "알맞아요". 예상 0초면 안내 없음.
- [끝내기]·Esc·[대본으로 돌아가기]는 `?id=<id>`로 간다. 다른 화면으로 가면 타이머·Wake Lock을 멈춘다.
- 어두운 배경 고정(다크 토큰 값), 글자 기본 32px(20~56px, 기기에 기억).

## Boundaries & Constraints

**Always:** 학생·선생님 모두 열 수 있음(완료 대본도). 글자는 `esc()`/`formatSpeech`. Phosphor 아이콘 + 글자, 이모지·em-dash 금지, 하단 버튼 56px 이상, 빨강은 진행 중 표시·강조만, `prefers-reduced-motion`. Wake Lock은 `navigator.wakeLock` 있을 때만, 실패는 조용히 무시. 사용법 갱신.

**Never:** 결과 저장, 서버·DB 변경, 새 라이브러리, 소리 녹음.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1인 대본 | 아나운서 1명 | 바로 첫 구성, 강조 없음 | 없음 |
| 2인 대본 | "김방송, 이하늘", 나=김방송 | 김방송 줄 진하게, 이하늘 줄 흐리게 | '둘 다'면 강조 없음 |
| 넘기기 | 시작 후 → | 그 구성 시간 기록, 다음 구성 이어서 잼 | 첫 구성에서 ←는 무시 |
| 마지막에서 다음 | 마지막 구성 | 끝 화면 표와 합계 | 없음 |
| 없는 대본 | `?practice=999` | 오류 안내 후 대본 목록 | `openScript`와 같게 |
| 빈 대본 | 구성 모두 빔 | "연습할 내용이 없어요" | 없음 |

</frozen-after-approval>

## Code Map

- `public/app.js` -- `route()`에 `practice`, `showOnly` 목록에 `practiceView`(다른 화면이면 연습 정리), `SECTIONS`·`formatSpeech`·`splitNames`·`CHARS_PER_SECOND`·`collect()`·`saveNow()` 재사용, 연습 상태·타이머·키보드·Wake Lock·끝 화면.
- `public/practice.js`(새) -- 화면 없는 순수 함수: `clockText(sec)`, `paceHint(actual, expected)`, `lineOwners(text, names)`. `app.js`보다 먼저 일반 script로 불러온다.
- `public/index.html` -- `#practiceView`, [연습하기] 두 곳, 사용법 `#h-practice`와 목차.
- `public/style.css` -- `.practice` 전체 화면(다크 토큰 고정), 큰 글씨, 하단 버튼, 내/남 줄.
- `test/practice.test.js`(새) -- `vm`으로 `public/practice.js`를 불러 위 함수 시험.

## Tasks & Acceptance

**Execution:**
- [x] `public/practice.js` + `test/practice.test.js`
- [x] `public/index.html`·`style.css`·`app.js` 연습 화면과 진입 버튼
- [x] 사용법 `#h-practice`

**Acceptance Criteria:**
- Given 2인 대본 4단계, when [연습하기] → 나 선택 → 스페이스 → → 여러 번, then 구성 제목·(n/전체)·타이머가 바뀌고 끝 화면에 구성별 실제/예상/차이와 합계가 나온다.
- Given 연습 중, when 브라우저 뒤로, then 타이머가 멈추고 메뉴가 다시 보인다.
- Given 360px·1280px, 밝은/어두운 화면, 기존 주소들과 `?practice=`, when 연다, then 가로 스크롤 없고 예전 화면은 그대로다.

## Implementation Notes

- `SPEAKER_RE`를 `practice.js`로 옮겨 `formatSpeech`와 `lineOwners`가 같은 이름 줄 규칙을 쓴다.
- 편집 화면에서 들어오면 `state.practiceDraft`(지금 화면 `collect()`)를 넘기고, 주소로 바로 열면 서버 내용을 받는다. [끝내기]·Esc·[대본으로 돌아가기]는 `?id=`로 replace 이동.
- 연습 화면은 `position: fixed` 전체 화면(z-index 18, 토스트 아래)이고 `body.practicing`일 때 상단바를 숨긴다. 다크 토큰 값은 `.practice`에 복사해 두었으니 다크 값을 바꾸면 함께 바꾼다.
- 캡처: `screenshots/6-practice-teacher-1280.jpg`, `6-practice-student-360-dark.jpg`, `6-practice-end-360.jpg`. 학생 4단계 아래 막대가 360px에서 두 줄이 되는 건 이번 스토리 전부터 그랬다(연습 버튼을 빼도 높이 같음).

## Spec Change Log

## Review Triage Log

| # | 출처 | 지적 | 판정 | 근거 | 처리 |
|---|---|---|---|---|---|
| 1 | blind·edge | 불러오는 중에 다른 화면으로 가면 늦은 응답이 연습 화면을 띄움 | medium | `stopPractice`가 `state.practice`가 없으면 순번을 안 올림 | patch |
| 2 | blind·edge | 저장 실패·저장 중인데도 연습을 시작해, 돌아오면 고친 내용이 사라짐 | medium | `saveNow()` 결과를 안 보고, 돌아올 때 `openScript`가 서버 내용으로 채움 | patch (저장 뒤에도 dirty면 안내하고 멈춤) |
| 3 | edge | 뒤로 가기 하면 대본을 다 받을 때까지 타이머·키·Wake Lock이 살아 있음 | low | `openScript`가 응답 뒤에야 `showOnly`를 부름 | patch (`route()` 첫머리에서 정리) |
| 4 | blind·edge·gap | 안 잰 구성(0초)에 '조금 천천히'가 붙음 | medium | `paceHint(0, e)` | patch + 시험 |
| 5 | edge | 차이 -0.5초가 '+0:01'로 보임 | low | `Math.round(-0.5)`는 -0 | patch |
| 6 | blind | 제목의 `aria-live`가 매번 새로 만들어져 안 읽힘 | low | `innerHTML`로 h2를 다시 만듦 | patch (고정 알림 영역) |
| 7 | blind·edge | 버튼이 꺼진 이유가 화면 읽기에 안 들림 | low | 고정 `aria-label` | patch |
| 8 | blind | '함께' 줄이 한 사람에게 흐리게 보임 | low | 실제로 그러나, 고정된 결정('함께'는 앞 줄을 따름)을 바꿔야 함 | reject (선생님께 보고) |
| 9 | blind | 스페이스가 초점 둔 버튼과 겹침 | false | 브라우저에서 [다음]에 초점을 둔 채 스페이스: 멈춤만 됨 | reject |
| 10 | blind | 예상 시간에 이름표 글자도 셈 | low | 결정대로 `updateCounts`와 같은 규칙 | reject |
| 11 | blind | 끝낸 뒤 방문 기록에 같은 `?id=`가 두 번 | low | 뒤로 한 번이 같은 화면일 뿐, 고치려면 분기 추가 | reject |
| 12 | blind | 멈춰 있어도 0.25초 시계가 돎 | low | 무시할 만한 비용 | reject |
| 13 | blind | 다크 토큰을 `.practice`에 복사 | low | 미디어 쿼리 블록이라 재사용하려면 CSS 구조 변경, 구현 메모에 적음 | reject |
| 14 | gap | 구성별 시간 쌓기·넘기기·다시 연습을 시험하지 않음 | medium | 상태 전이가 `app.js`에 있어 시험이 못 부름 | defer |
| 15 | gap | `practice.js`가 안 불리면 방송용 보기도 깨짐 | low | 같은 서버 정적 파일, `app.js`와 함께 배포 | reject |
| 16 | blind | 스펙 파일이 diff에 없음 | false | 검토 diff를 일부러 `public`·`test`로 한정 | reject |

## Verification

**Commands:**
- `npm test`, `npm run check`, `node --check public/app.js`, `node --check public/practice.js` -- expected: 성공
