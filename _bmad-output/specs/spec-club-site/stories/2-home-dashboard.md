---
title: '스토리 2: 통합 첫 화면 (대시보드)'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: '326a555b481e526567d15ed1cf4c5091a2c8423b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 홈(`/`)은 스토리 1에서 인사·이번 주 버튼·일정 3개만 있는 빈 틀이라, 부원이 이번 주에 자기가 할 일이나 선생님이 검토할 대본을 한눈에 볼 수 없다.

**Approach:** 서버에 `GET /api/home` 하나를 만들어 `thisWeek`(다음 금요일 대본 요약)·`todo[]`·`upcoming[]`(5개, 대본 있는 날 표시)·`notices[]`(지금은 빈 배열)·교사면 `reviewQueue[]`를 한 번에 돌려주고, 홈 화면이 이것으로 묶음 카드를 그린다. '내 대본' 판정은 서버 함수 `isMyScript(script, user)` 하나로 한다.

**결정 (계획 단계, 사용자 확인 대상):**
- 내 할 일은 지금 데이터로 만들 수 있는 두 가지만: ① 내 대본 중 '작성중'이고 방송일이 오늘~7일 안 → 편집 화면, ② 내가 '함께하는 부원'인 일정 중 오늘·내일 → 캘린더 그날. 검토 댓글(스토리 4)·안 읽은 고정 공지(스토리 3)는 그 스토리에서 더한다. 최대 5개, 방송일·날짜 빠른 순.
- 새 공지 카드는 자리만: "공지는 게시판이 열리면 여기에 보여요." 한 줄과 게시판 링크. '공지 쓰기'·'읽음 12/15'는 스토리 3.
- 교사: '내 할 일' 대신 '검토 기다리는 대본'(상태 '검토요청', 방송일 빠른 순, 최대 10개) 카드를 인사 바로 아래, 이번 주 버튼 위에 둔다.
- 처음 온 학생 안내 띠는 스토리 1에서 이미 홈 맨 위로 옮겨졌으므로 그대로 둔다(동작 동일).

## Boundaries & Constraints

**Always:** `ux-design.md` 3절 배치: 좁은 화면 한 열(인사 → [교사: 검토 기다리는 대본] → 이번 주 방송 → 내 할 일 → 새 공지 → 다가오는 일정), 720px 이상은 새 공지·다가오는 일정 2열. 기존 토큰·카드(18px)·`.badge`·`.cat` 칩만 사용, 강조색은 `--accent` 하나, Phosphor 아이콘, 이모지·em-dash 금지. 새 API는 기존 로그인·비밀번호 변경 가드 뒤, `json()`/`HttpError` 형식. 날짜는 서버 `todayKST()`/`addDays()`. 항목은 실제 주소 `href` + 앱 안 이동(Ctrl/⌘ 클릭은 새 탭). 누르는 곳 44px 이상, 다크 모드. 사용법 화면 '홈' 설명 갱신.

**Never:** DB 변경, 새 라이브러리. 게시판·검토 댓글·알림 데이터 구현. 기존 주소 동작 변경. `/api/scripts` 응답 형식 변경.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 학생 홈 | 학생 로그인, `/` | 이번 주 버튼·내 할 일·새 공지(자리)·다가오는 일정 5개. 검토 카드 없음 | 없음 |
| 교사 홈 | 교사 로그인, `/` | 검토 기다리는 대본·이번 주 버튼·새 공지(자리)·일정. 내 할 일 없음 | 없음 |
| 내 대본 판정 | `created_by`가 내 이름, 또는 `announcers` 쉼표 구분 중 하나가 내 이름(앞뒤 공백 무시) | 내 대본 | 이름 일부만 같으면(김방송 vs 김방송2) 아님 |
| 할 일 없음 | 해당 대본·일정 없음 | "오늘은 할 일이 없어요. 대본 목록을 둘러볼까요?" + 대본 링크 | 없음 |
| 이번 주 대본 있음/없음 | 다음 금요일 대본 | 있으면 "이어서 만들기"·상태, 누르면 `?id=`; 없으면 "만들기", 누르면 `?new` | 홈 응답 전에 누르면 응답을 기다린 뒤 이동, 실패하면 토스트만(새로 만들지 않음) |
| 다가오는 일정 | 일정 날짜에 대본 있음 | 그 줄에 '대본' 칩 | 일정 0개면 기존 빈 안내 |
| 홈 불러오기 실패 | `/api/home` 오류 | 토스트 + 각 카드에 "불러오지 못했어요" | 다른 화면은 정상 |
| 학생 직접 호출 | 학생이 `/api/home` | `reviewQueue` 키 없음 | 없음 |

</frozen-after-approval>

## Code Map

- `src/index.js` -- `handleApi()` 가드(`user.mustChange`) 뒤에 `GET /api/home` 연결. `/api/calendar/upcoming` 그대로(기본 개수는 calendar.js에서 5로).
- `src/calendar.js` -- `upcomingEvents(env, today, limit = 3)` → 기본 5, 재사용. `toEvent`(members JSON 파싱) 패턴.
- `src/dates.js` -- `todayKST`, `addDays`, `nextFriday` 재사용.
- 새 `src/home.js` -- `isMyScript(script, user)`(export), `getHome(env, user)`. 한 번의 `env.DB.batch`로: 다음 금요일 대본(`ORDER BY updated_at DESC LIMIT 1`), 오늘~+7 '작성중' 대본, 오늘·내일 일정, 다가오는 일정 5개 + 그 날짜 범위의 대본 날짜, (교사) 검토요청 대본.
- `public/index.html` -- `#homeView`(106-130): `#firstHelp`, `#btnThisWeek`(`#thisWeekTitle`/`#thisWeekSub`), `#upcomingCard`/`#upcomingList`. 여기에 `#reviewCard`·`#todoCard`·`#noticeCard`와 2열 묶음 래퍼 추가. 사용법 `#h-menu`(350) 홈 설명, `#h-start`(343), `#h-calendar`(423) 문구, 교사 절 `#h-teacher`(451)에 검토 카드 한 줄.
- `public/app.js` -- `showHome()`(187): `loadScripts()`·`loadUpcoming()` 대신 `/api/home` 한 번(요청 순번으로 늦은 응답 무시). `renderThisWeek()`(594)·`thisWeekScript()`(591)를 `state.home.thisWeek` 기준으로, `btnThisWeek` 처리기(1362)는 `state.homeLoaded`가 아니면 홈을 다시 받고 나서 이동. `loadUpcoming()`(437)은 홈 응답을 그리는 함수로 바꿈(링크 `data-go` 패턴 유지). `state.scriptsLoaded`는 목록 화면만 쓰면 정리. `md()`·`esc()`·`icon()`·`parseYmd`·`localToday` 재사용.
- `public/style.css` -- `.upcoming-*`(444-451) 패턴을 할 일·검토 목록에 재사용, `.home-grid`(720px 이상 2열), 휴대폰 `@media (max-width: 640px)`.

## Tasks & Acceptance

**Execution:**
- [x] `src/home.js` -- `isMyScript`, `getHome` 작성 -- 홈 묶음 데이터와 '내 대본' 판정 한곳.
- [x] `src/calendar.js`, `src/index.js` -- upcoming 기본 5, `/api/home` 경로 연결.
- [x] `public/index.html` -- 홈 카드 구조, 사용법 홈·교사 설명 갱신.
- [x] `public/app.js` -- 홈 불러오기·그리기, 이번 주 버튼을 홈 데이터로.
- [x] `public/style.css` -- 홈 2열·목록 줄 스타일.

**Acceptance Criteria:**
- Given 학생, when 360px·1280px 홈을 봄, then 가로 스크롤 없이 묶음이 정해진 순서·배치로 보이고 각 항목을 누르면 해당 대본·캘린더 날짜가 열린다.
- Given 교사, when 홈을 봄, then 검토 기다리는 대본이 맨 위에 있고 누르면 그 대본이 열린다.
- Given 밝은/어두운 화면, when 홈을 봄, then 토큰 색만 쓰여 글자가 잘 보인다.
- Given 기존 주소(`?scripts`, `?id=`, `?new`, `?calendar`, `?help`, `?accounts`, `?board`, `?inbox`), when 연다, then 예전과 같은 화면이 열린다.

## Implementation Notes

- 바꾼 파일: 새 `src/home.js`(`isMyScript`, `getHome`), `src/calendar.js`(`toEvent`·`upcomingStatement` 내보내기, 기본 5개), `src/index.js`(`GET /api/home`), `public/index.html`·`app.js`·`style.css`, 검토 뒤 새 `test/home.test.js` + `package.json` `test` + CI `단위 시험` 단계. DB 변경 없음.
- `node --test test/`는 Node 22 이상에서 폴더를 못 받아 `node --test "test/*.test.js"`로 씀.
- `/api/calendar/upcoming` 경로는 화면이 더 쓰지 않지만 architecture.md 4절대로 남겨 두고 기본 5개로 바꿈.
- 확인: `npm test`(8개 통과), `node --check`(src/*.js, public/app.js), `npm run check`(dry-run) 통과. 로컬 `wrangler dev`에 시험용 선생님 비밀번호(이 컴퓨터에서만 쓰는 값)를 넣어 선생님으로 실제 로그인하고, 학생은 로컬 시험 계정으로 로그인해 I/O 표 각 줄, 360·1280px, 밝은/어두운 화면, 기존 주소를 확인함. 운영 사이트의 실제 계정으로는 확인하지 않음. 시험용으로 넣은 대본·일정은 지움.
- 캡처: `screenshots/2-*.jpg`. `2-1280-teacher-home-light.jpg`는 검토 카드 아이콘을 바꾸기 전 캡처, `2-360-teacher-home-dark.jpg`가 바꾼 뒤.
- 알려진 것: 로컬 시험 계정 이름이 "방송부 선생님"처럼 선생님으로 끝나면 인사가 "선생님 선생님"이 됨(예전 인사 코드 그대로).

## Spec Change Log

## Review Triage Log

| # | 출처 | 지적 | 판정 | 근거 | 처리 |
|---|---|---|---|---|---|
| 1 | blind·verification-gap | `isMyScript`·`getHome`(할 일 순서·5개 제한·교사 검토 목록·`thisWeek`·`hasScript`)을 실행해 보는 검사가 없음 | medium | 저장소에 테스트 파일이 없고 CI는 `node --check`와 dry-run만 함. 서버 쪽은 `node:test`로 새 라이브러리 없이 시험 가능 | patch (`test/home.test.js` + `npm test` + CI 단계) |
| 2 | edge | 탭을 금요일 넘게 열어 두면 홈은 새 금요일을 보는데 `?new` 기본 방송일은 옛 금요일 | medium | `newScript()`가 `state.config.nextFriday`(처음 불러올 때 값)를 씀. 이번 변경으로 버튼 판정과 날짜가 갈라짐 | patch (홈 응답 날짜로 맞춤) |
| 3 | blind | 검토 카드 아이콘이 인사 손 모양, 개수 배지 읽기 이름이 "N개"뿐 | low | `ph-hand-waving`, `aria-label="N개"` | patch |
| 4 | blind | 사용법 홈 설명이 선생님 화면(검토 카드)을 말하지 않고 "5개"가 모호함 | low | `#h-menu` 문구 | patch |
| 5 | blind | 검토 개수 배지가 10개에서 멈춤 | low | 방송부 규모에서 검토요청이 10개 넘을 일이 드물고, 고치려면 개수 쿼리 추가 | reject |
| 6 | blind·edge | 작성중 대본 범위가 오늘~+7로 8일 | false | 스펙 I/O 표가 "오늘~7일 안"(양 끝 포함)으로 정함 | reject |
| 7 | blind·edge | `notices`가 비어 있지 않으면 공지 카드가 빈칸 | false | 이번 스토리에서 서버는 늘 빈 배열을 돌려줌. 채우는 일은 스토리 3 | reject |
| 8 | blind | 홈 응답 전 이번 주 버튼 문구가 잠깐 '만들기' | low | 스토리 1 #17과 같은 예전 동작, 누르면 응답을 기다림 | reject |
| 9 | blind | `renderHome` 안의 예외가 처리되지 않음 | low | 응답 모양은 같은 서버가 정함. 잘못된 응답이 올 길을 보이지 못함 | reject |
| 10 | blind·edge·verification-gap | `/api/calendar/upcoming`을 화면이 더 쓰지 않는데 기본 개수가 5로 바뀜 | false | architecture.md 4절이 이 경로를 3 → 5로 바꾸라고 정함. 경로는 남겨 둠 | reject |
| 11 | blind | batch 결과를 순서로 꺼내 깨지기 쉬움 | low | 순서가 한 함수 안에 있고 테스트(#1)가 지킴 | reject |
| 12 | blind | 다가오는 일정과 '대본' 날짜 범위를 따로 계산 | low | 지금은 같은 결과, 고치려면 쿼리 하나 더 | reject |
| 13 | blind | 동명이인이 할 일을 함께 봄 | false | SPEC 가정: '내 대본'은 이름 기준, 동명이인은 계정 이름으로 구분 | reject |
| 14 | blind | 검토 줄이 `updated_by`·`updated_at`을 받고 안 보여 줌 | low | 해 없음 | reject |
| 15 | edge | 예전 요청을 기다리는 중 홈이 다시 불러오면 버튼이 아무 일도 안 함 | low | 버튼은 홈 화면에만 있어 그 사이 다시 불러올 일이 거의 없음 | reject |
| 16 | edge | 버튼이 부른 불러오기가 늦게 실패하면 토스트 없음 | low | #15와 같은 드문 경우 | reject |
| 17 | edge | `members`가 배열이 아닌 JSON이면 `/api/home` 실패 | false | `calendar.js` `clean()`이 늘 배열로 저장 | reject |
| 18 | edge | 홈을 떠난 뒤 늦은 응답이 숨은 홈을 다시 그림 | low | 보이지 않고 해 없음 | reject |
| 19 | verification-gap | 이번 주 버튼의 기다리기·실패 시 안 만들기를 확인하는 화면 테스트 없음 | medium | 브라우저 테스트 도구가 없음. 스토리 1 미룬 작업과 같은 종류 | defer |

## Verification

**Commands:**
- `npm test` -- expected: 모두 통과
- `npm run check` 그리고 `node --check public/app.js`, `node --check src/home.js` -- expected: 성공 (CI `코드 검사`와 같음)

**Manual checks (if no CLI):**
- `npm run dev`에서 학생·교사로 360px·1280px, 밝은/어두운 화면, I/O 표의 각 줄과 기존 주소를 확인하고 캡처를 `screenshots/2-*.jpg`로 남긴다.
