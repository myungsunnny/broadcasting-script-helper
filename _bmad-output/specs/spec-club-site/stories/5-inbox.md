---
title: '스토리 5: [DB] 알림 모아보기'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '30d5fd886f0fb273078f0237ac1ca34019d70440'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 새 공지, 선생님 의견, 대본 완료, 나를 넣은 일정, 검토 요청을 알려면 화면마다 직접 찾아봐야 한다. 알림 메뉴는 '곧 열려요'뿐이다.

**Approach:** `migrations/0008_notifications.sql`(architecture.md 3절)과 새 `src/notify.js`로 원인 동작과 같은 `env.DB.batch`에 알림을 넣고, `?inbox` 화면(ux-design.md 7절)·메뉴 배지·읽음 API를 만든다.

**결정 (stories.yaml에 spec_checkpoint 없음, 개발자가 정함):**
- 받는 사람: 공지 = 사용 중인 학생 전부. 의견·완료 = 사용 중인 학생 중 `isMyScript`. 일정 = 새로 '함께하는 부원'이 된 이름과 같은 사용 중인 학생, 저장한 본인 제외. 검토 요청 = 학생이 상태를 '검토요청'으로 바꾸거나 그 상태로 만들 때 `'teacher'`.
- 의견은 하나에 알림 하나("11/6 대본에 선생님 의견이 달렸어요 (학교 행사)"). 모아 세지 않는다.
- `ref_date`는 '이동 보조값': 일정은 날짜, 의견은 구성 키(누르면 `?id=&tab=`).
- 목록: 내 알림 최근 90일, 최신 50개. 누르면 읽음 처리 후 이동. '모두 읽음' 버튼. 교사 알림 읽음은 교사 공용.
- 배지 = 안 읽은 수(99 넘으면 99+), `route()` 때마다 새로 받음.
- 정리: 알림을 넣는 batch에 90일 지난 알림 삭제를 붙인다. 공지·대본·일정·학생 계정을 지우면 그 알림도 같은 batch에서 지운다.

## Boundaries & Constraints

**Always:** 권한·받는 사람은 서버에서 정함, 남의 알림은 읽음 처리 안 됨(조건에 recipient). 마이그레이션 `CREATE ... IF NOT EXISTS`, SQL 본문에 ASCII 아닌 글자 금지(주석만 한국어), `schema.sql`에 같은 내용. 빨강 점·배지는 `--accent`(알림 전용), 안 읽은 줄 `--accent-soft`, Phosphor 아이콘 + 글자, 이모지·em-dash 금지, 누르는 곳 44px, 다크 모드. 글자는 `esc()`. 사용법 갱신.

**Never:** `--remote` 실행, 기존 표·열 변경, 푸시·실시간 갱신, 새 라이브러리.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 새 공지 | 선생님 공지 작성 | 사용 중인 학생마다 notice 알림, 배지 +1 | 메모는 알림 없음 |
| 의견 | 선생님 의견 | 그 대본 '내 대본' 학생에게 comment | 해당 학생 없으면 알림 없음 |
| 완료 | 상태 → 완료 | '내 대본' 학생에게 done | 이미 완료면 없음 |
| 검토 요청 | 학생 상태 → 검토요청 | `teacher` review | 선생님이 바꾸면 없음 |
| 일정 | 일정 저장, members에 새 이름 | 그 학생에게 calendar(본인 제외) | 원래 있던 이름은 다시 안 감 |
| 목록 | GET `/api/notifications` | `{ items, unread, now }` 내 것만 | 로그인 안 함 401 |
| 읽음 | POST `/api/notifications/:id/read` | 내 알림만 read_at | 남의 알림은 그대로 200 |
| 모두 읽음 | POST `/api/notifications/read-all` | 내 안 읽은 것 전부 | 없음 |
| 정리 | 알림 넣을 때 | 90일 지난 행 삭제 | 없음 |

</frozen-after-approval>

## Code Map

- `migrations/0008_notifications.sql`(새) + `schema.sql` -- architecture.md 3절 SQL, 0007 머리 주석 형식.
- `src/notify.js`(새) -- `recipientOf(user)`, `activeStudents(env)`, `notifyStatements(env, {recipients, kind, refId, refDate, text})`(INSERT들 + 90일 정리, 받는 사람 없으면 []), `deleteNotificationsStatement`, 목록·안 읽은 수·읽음·모두 읽음.
- `src/board.js` `createPost`/`deletePost` -- 공지 INSERT와 알림을 한 batch로, 삭제 batch에 알림 삭제.
- `src/comments.js` `createComment` -- 대본 행(created_by·announcers·broadcast_date)을 읽어 `isMyScript`(home.js) 학생에게.
- `src/index.js` `createScript`/`updateScript`/`deleteScript` -- 상태 변화(완료·검토요청) 알림을 저장 batch에, 삭제 batch에 알림 삭제, `/api/notifications*` 경로.
- `src/calendar.js` `createEvent`/`updateEvent`/`deleteEvent` -- 새 members 학생에게.
- `src/users.js` `deleteUser` -- 그 학생 알림 삭제.
- `public/index.html`·`app.js`·`style.css` -- 메뉴 `#inboxBadge`, `#inboxView` 목록·'모두 읽음', `refreshInboxBadge()`(늦은 응답 무시), 사용법 `#h-inbox`.
- `test/notify.test.js`(새) -- comments.test.js처럼 실제 SQLite + Worker fetch로 I/O 표.

## Tasks & Acceptance

**Execution:**
- [x] 마이그레이션·schema.sql
- [x] notify.js와 원인 동작 연결, API
- [x] 화면·배지·사용법
- [x] test/notify.test.js

**Acceptance Criteria:**
- Given 로컬 DB에 0008 `--local` 적용, when 선생님이 공지를 올림, then 학생 배지가 1 오르고 알림을 누르면 공지가 열리며 배지가 줄어든다.
- Given 학생이 검토 요청, when 선생님이 알림을 봄, then 그 대본 알림이 있고 누르면 대본이 열린다.
- Given 360px·1280px, 밝은/어두운 화면, 기존 주소(`?scripts`, `?id=`, `?new`, `?calendar`, `?help`, `?accounts`, `?board`, `?inbox`), when 연다, then 가로 스크롤 없고 예전과 같은 화면.

## Implementation Notes

- 배지는 `GET /api/notifications/count`(`{unread}`)로 받는다(화면 이동마다 50줄을 받지 않게). `?inbox`에서는 목록 응답의 `unread`로 맞춘다.
- 날짜를 옮긴 일정은 이미 보낸 calendar 알림의 `ref_date`도 같은 batch에서 새 날짜로 바꾼다(글 속 날짜는 처음 그대로).
- 캡처: `screenshots/5-inbox-student-360-light.jpg`, `5-inbox-teacher-360-dark.jpg`, `5-inbox-teacher-1280-dark.jpg`.
- `notify.js`가 `home.js`의 `isMyScript`를 불러 순환 import가 생기지만 호출 시점에만 써서 문제없다(시험·dry-run 통과).

## Spec Change Log

## Review Triage Log

| # | 출처 | 지적 | 판정 | 근거 | 처리 |
|---|---|---|---|---|---|
| 1 | blind·edge | 일정 날짜를 옮기면 예전 알림이 옛 날짜 캘린더를 엶 | medium | `updateEvent`가 알림 `ref_date`를 그대로 둠 | patch (같은 batch에서 `ref_date` 갱신 + 시험) |
| 2 | blind | 메뉴 배지의 `aria-label`(span)이 안 읽힐 수 있음 | low | 숫자만 읽혀 뜻이 흐림, 고치기가 한 줄 | patch (sr-only 글자) |
| 3 | blind | 모두 읽음 중 다른 화면으로 가면 배지가 낡음 | low | 알림 화면이 아닐 때 배지를 안 고침, 한 줄 | patch (성공 시 `setInboxBadge(0)`) |
| 4 | blind·edge | 의견 하나를 지워도 그 알림이 남음 | low | 알림이 댓글 id가 아닌 대본·구성으로 묶여 정확히 고르려면 열 추가 필요, 누르면 그 대본 탭이 열릴 뿐 | reject |
| 5 | blind | 인덱스가 목록·정리 질의와 안 맞음 | low | 학생 수십 명 규모에서 표가 작고 SQL은 architecture.md 그대로 | reject |
| 6 | blind | 90일 정리를 매 저장 batch에 붙임 | false | architecture.md 3절이 정한 방식(cron 없음) | reject |
| 7 | blind | 일정 이름 비교의 trim 불균형 | false | `clean()`이 members를 이미 trim | reject |
| 8 | blind·edge | 동명이인 학생 모두에게 일정 알림 | low | SPEC Assumptions: 이름으로 판정, 동명이인은 이름에 학년 등을 붙임 | reject |
| 9 | blind | 가운데·Ctrl 클릭은 읽음 처리 안 됨 | low | 드묾, 모두 읽음으로 정리 가능 | reject |
| 10 | blind | 공지 제목을 고쳐도 알림 글은 옛 제목 | low | 누르면 고친 공지가 열림 | reject |
| 11 | blind | 사용 중지 학생 알림이 남음 | low | 로그인 못 하고 90일 뒤 정리됨 | reject |
| 12 | edge | 0008 실행 전 배포하면 공지·의견·상태·일정 저장이 실패 | medium | 같은 batch라 표가 없으면 전부 실패 | reject (운영 규칙: Merge 전 관리자가 0008 실행, PR 맨 위에 명시) |
| 13 | edge | 완료/검토요청을 오가면 같은 알림이 또 옴 | low | 실제로 상태가 다시 바뀐 것이라 다시 알려도 맞음 | reject |
| 14 | edge | members JSON이 배열이 아니면 500 | false | 저장은 `clean()`만 거쳐 언제나 배열 | reject |
| 15 | edge | 서머타임 지역에서 몇 분 전이 1시간 틀림 | false | 한국은 서머타임 없음, 두 시각 모두 KST 문자열 | reject |
| 16 | verification-gap·blind | `inboxQuery`·`timeAgo`·배지 화면 시험 없음 | medium | 저장소에 화면 시험 도구 없음(스토리 1~4 미룬 작업과 같은 종류), 서버 `ref_date`는 시험함 | defer |

## Verification

**Commands:**
- `npm test`, `npm run check`, `node --check public/app.js` -- expected: 성공
- `npx wrangler d1 execute broadcasting-db --local --file=./migrations/0008_notifications.sql` -- expected: 성공(두 번 실행해도)
