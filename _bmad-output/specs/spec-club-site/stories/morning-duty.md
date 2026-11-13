---
title: '일정에서 아침방송 담당 지정'
type: 'feature'
created: '2026-11-04'
status: 'done'
route: 'dispatch'
baseline_commit: 'f434521a2852d2f4a308b3862999030e950948ff'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/stories/5-inbox.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 아침방송(월~금 매일)을 누가 맡는지 정할 곳이 없다. 지금은 일정을 하루씩 손으로 넣어야 하고, 학생 누구나 바꿀 수 있다.

**Approach:** 일정 화면에 선생님만 보이는 '아침방송 담당' 창을 두고, 한 주(월~금)의 담당 학생을 한 번에 고른다. 담당은 기존 `calendar_events` 행(`category = '아침방송'`, 제목 '아침방송', `members` = [이름])으로 저장해 **DB 변경 없이** 달력·알림·홈 '내 할 일'을 그대로 재사용한다.

**결정 (선생님 답, 2026-11-04):**
- 아침방송은 월~금 매일. 하루 담당은 한 명, 역할 구분 없음.
- 한 주씩 한 번에 정한다. 반복·자동 순번 없음.
- 선생님만 정하고 고친다. 담당이 된 학생에게 알림이 가고, 오늘·내일 담당이면 홈 '내 할 일'에 나온다.
- 홈 '다가오는 일정'에도 다른 일정처럼 그대로 보인다(빼지 않음).

## Boundaries & Constraints

**Always:** 권한은 서버에서 확인(학생이 `아침방송` 일정을 만들기·고치기·지우기 하면 403). 알림은 기존 `memberNotices`로(새로 담당이 된 학생만, 같은 사람은 다시 안 감). 한 주 저장은 한 번의 `env.DB.batch`. 디자인: 단일 강조색, Phosphor 아이콘 + 글자, 이모지·em-dash 금지, 누르는 곳 44px, 다크 모드, 글자는 `esc()`. 사용법 화면 갱신.

**Never:** DB 표·열 변경, 마이그레이션, 반복 규칙·순번, 역할 구분, 새 라이브러리.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 새로 정함 | 선생님 PUT `/api/calendar/morning` `{start: 월요일, duty: {날짜: 이름}}` | 날마다 아침방송 일정 1개, 그 학생에게 calendar 알림 | 없음 |
| 바꿈 | 같은 날 다른 이름 | 그 행 members만 바뀜, 새 학생에게만 알림 | 없음 |
| 그대로 | 같은 이름 | 바뀌지 않음, 알림 없음 | 없음 |
| 비움 | 이름 '' | 그날 아침방송 일정과 알림 삭제 | 없음 |
| 학생 시도 | 학생이 morning PUT, 또는 `아침방송` 일정 POST/PUT/DELETE | 막힘 | 403 "아침방송 담당은 선생님만 정할 수 있어요." |
| 잘못된 주 | `start`가 월요일 아님/날짜 아님, `duty`의 날짜가 그 주 월~금 밖 | 저장 안 됨 | 400 |

</frozen-after-approval>

## Code Map

- `src/calendar.js` -- `CATEGORIES`에 `'아침방송'` 추가. `clean()`, `memberNotices()`, `getEvent()`, `deleteNotificationsStatement` 재사용. 새 `setMorningDuty(env, user, start, duty)`. `createEvent`/`updateEvent`/`deleteEvent`에 아침방송 권한 검사(이전·새 category 어느 쪽이든).
- `src/dates.js` -- `isValidDate`, `addDays` 재사용(요일은 `new Date(date+'T00:00:00Z').getUTCDay()`).
- `src/index.js` 262행 일정 경로 -- `PUT /api/calendar/morning`을 `/:id` 경로보다 먼저.
- `src/home.js` -- `isMember`로 '내 할 일'에 자동으로 들어옴(바꿀 것 없음). 다가오는 일정도 바꾸지 않음.
- `public/index.html` 308행 `calendarView` -- 선생님만 보이는 `아침방송 담당` 버튼, 범례에 `cat-아침방송`, 새 `dutyDialog`(주 이동 + 월~금 다섯 줄 `<select>`). 561행 `eventDialog` 종류 버튼에는 넣지 않음.
- `public/app.js` 700~920행 -- `loadMembers()` 재사용, `openEventDialog`에서 아침방송 일정이면 종류 칸 숨김, `renderDay`에서 학생에게는 아침방송 일정의 고치기·기록 버튼 숨김.
- `public/style.css` 404행 -- `.cat-아침방송` 색(accent 계열 아닌 기존 토큰).
- `test/notify.test.js` 패턴(node:sqlite + D1 어댑터 + worker.fetch) -- 새 `test/morning.test.js`.

## Tasks & Acceptance

**Execution:**
- [x] `src/calendar.js` -- 카테고리·권한 검사·`setMorningDuty` -- 서버에서 권한과 하루 1개를 보장
- [x] `src/index.js` -- `PUT /api/calendar/morning` 연결
- [x] `public/index.html`, `public/app.js`, `public/style.css` -- 버튼·창·범례·색, 사용법 '방송부 일정 캘린더' 갱신
- [x] `test/morning.test.js` -- I/O 표의 각 줄 시험

**Acceptance Criteria:**
- Given 선생님이 일정 화면, when '아침방송 담당'을 누르면, then 지금 고른 날이 있는 주의 월~금이 이미 정한 이름으로 채워져 나오고, 앞뒤 주로 옮길 수 있다.
- Given 학생 계정, when 일정 화면을 보면, then '아침방송 담당' 버튼이 없고 아침방송 일정에 고치기 버튼이 없다.
- Given 내일 아침방송 담당 학생, when 홈을 열면, then '내 할 일'에 아침방송이 보인다.

## Spec Change Log

## Verification

**Commands:**
- `npm test` -- expected: 모두 통과

**Manual checks (if no CLI):**
- 학생·선생님, 360px·1280px, 밝은/어두운에서 일정 화면과 담당 창, 기존 주소들이 그대로 열림.

## Implementation Notes

- DB 변경 없음: 담당은 `calendar_events`의 `category = '아침방송'` 행. `setMorningDuty`가 하루 한 개를 보장(겹친 행은 지움).
- 확인: `npm test` 53개 통과(새 `test/morning.test.js` 5개), `npm run check` 통과. 선생님 1280 밝게·360 어둡게 담당 창, 학생 360 어둡게 달력(고치기·담당 버튼 없음), 홈 '내 할 일'에 내일 아침방송, 기존 주소 열림, 가로 스크롤 없음.
