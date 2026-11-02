---
title: '스토리 1: 메뉴 개편 (홈·대본·일정·게시판·알림)'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: 'b52ad2e4b83c006adaa30172c8afdbe61805ac3b'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 사이트가 '대본 목록' 하나를 중심으로 짜여 있어서 일정·계정·사용법이 상단바의 작은 버튼으로 흩어져 있고, 앞으로 생길 게시판·알림을 넣을 자리가 없다.

**Approach:** 넓은 화면(720px 이상)은 상단 탭, 좁은 화면은 하단 탭 막대로 홈·대본·일정·게시판·알림 다섯 메뉴를 만들고, 계정 관련 버튼은 상단바 오른쪽 '내 이름' 버튼의 작은 목록으로 옮긴다. 대본 목록은 `?scripts`, 홈(`/`)은 새 `homeView` 틀, 게시판(`?board`)·알림(`?inbox`)은 '곧 열려요' 빈 화면으로 둔다.

**결정 (홈 내용, 2026-11-02 사용자 답):** 홈은 인사("안녕하세요, ○○님") + 오늘 날짜 아래에 지금 대본 목록 위에 있던 처음 온 학생 안내 띠, 큰 빨강 '이번 주 대본' 버튼, 다가오는 일정 카드(3개 그대로)를 옮겨 둔다. 대본 화면(`?scripts`)에는 제목 + 검색·상태 거르기·다른 날 대본·목록만 남는다. 스토리 2는 이 틀 위에 묶음을 더한다.

## Boundaries & Constraints

**Always:** `ux-design.md` 2절 배치·아이콘·주소를 따른다. 기존 토큰만 쓰고 강조색은 `--accent` 하나. Phosphor 아이콘, 이모지·em-dash 금지, 탭·버튼은 알약 모양. 새 화면은 `<section id="…View" class="hidden">` + `showOnly()` + `route()` 분기. `route()` 순서: help → 로그인 → 비밀번호 변경 강제 → accounts(교사) → calendar → board → inbox → scripts → new → id → 홈. 다크 모드(`prefers-color-scheme`)·`prefers-reduced-motion` 존중, 누르는 곳 44px 이상(하단 탭 48px), 아이콘 전용 버튼 `aria-label`, 현재 메뉴 `aria-current="page"`. 사용법 화면 갱신.

**Never:** DB·API·`src/` 변경. 새 라이브러리·빌드 도구. 알림 숫자 배지 데이터(스토리 5)·첫 화면 대시보드 내용(스토리 2) 구현. main 직접 push, `wrangler deploy`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 옛 주소 | `?id=x`, `?new`, `?new=other`, `?calendar&date=…`, `?help`, `?accounts` | 예전과 같은 화면이 열림. `?id`·`?new`·방송용 보기는 '대본' 메뉴가 현재 표시 | 없는 대본 id면 지금처럼 알림 후 `?scripts`로 |
| 새 주소 | `/`, `?scripts`, `?board`, `?inbox` | 홈 틀 / 대본 목록 / '곧 열려요' / '곧 열려요' | 없음 |
| 로그인 전 | 아무 주소 | 메뉴·내 이름 버튼 숨김, 로그인 화면 (`?help`만 예외) | 없음 |
| 임시 비밀번호 학생 | `mustChange` | 메뉴 숨김, 비밀번호 바꾸기 창 | 없음 |
| 학생 `?accounts` | 학생 계정 | 홈으로 (지금처럼 교사만) | 없음 |
| 계정 목록 | '내 이름' 누름 | 학생: 비밀번호 바꾸기·사용법·로그아웃 / 교사: 학생 계정 관리·사용법·로그아웃. 바깥 누름·Esc로 닫힘 | 없음 |

</frozen-after-approval>

## Code Map

- `public/index.html` -- 상단바 `header.topbar`(18-31): `#btnHelp`, `#userBox` 안 `#btnCalendar`·`#userName`·`#btnAccounts`·`#btnPassword`·`#btnLogout`, `#brandLink`·`#schoolName`·`.brand-name`. `#listView`(96-128): `#firstHelp`, `#btnThisWeek`, `#upcomingCard`, 검색·목록. `#accountsView` 뒤로 버튼 `#btnAccountsBack`(문구 "대본 목록"). 편집 더보기 `#btnBack`(문구 "대본 목록으로"). `#helpView`(262-406): `.help-toc`, `#h-start` 팁("맨 위에 빨간 큰 버튼"), `#h-calendar`("위쪽 일정"), `#h-teacher`("위쪽 학생 계정"), 제목 "방송부 대본 도우미 사용법", `#btnHelpStart`.
- `public/app.js` -- `showOnly()`(47) 화면 목록에 새 view 추가. `route()`(124-139). `init()`(70-87) 제목·학교 이름. `setUser()`(89-95) 상단 버튼 표시. `showList()`(503) + `loadUpcoming()`(360) + `renderList()`(520, `thisWeekScript()` 사용) 재사용. `navigate('')`를 쓰는 곳: 829(`openScript` 실패), 839(`removeScript`), 1227(`btnHelpStart`), 1247(`btnAccountsBack`), 1259(`brandLink`), 1337(`btnBack`). `bindEvents()`(1187-1354)의 `btnHelp`·`btnCalendar` 연결 제거/교체. 주의: 1327 `document.querySelector('.seg')`는 문서 첫 `.seg`(편집 1단계)에 묶임 → 편집 화면 앞에 `.seg` 추가 금지.
- `public/style.css` -- 토큰 `:root`(8-42, 다크 44-70), `.topbar`(150-163), `.wizard-nav` sticky bottom(304), `#toast` bottom 96px(493), `.help-toc` sticky top(445, 640px에서 58px), 휴대폰 `@media (max-width: 640px)`(517), 인쇄(566). 하단 탭 막대 추가 시 `wizard-nav`·토스트·본문 아래 여백이 막대에 가리지 않게 조정.

## Tasks & Acceptance

**Execution:**
- [x] `public/index.html` -- 상단바: 브랜드("방송부", 넓으면 학교 이름 앞에), 메뉴 `<nav class="main-nav">` 다섯 링크(`href`로 실제 주소, `data-menu` 키), '내 이름' 버튼 + 계정 목록. `#btnHelp`·`#btnCalendar` 제거. `#homeView`(인사·날짜 + `#listView`에서 옮긴 `#firstHelp`·`#btnThisWeek`·`#upcomingCard`, id 유지), `#listView`에 제목 "대본" 추가, `#boardView`·`#inboxView`('곧 열려요' 빈 화면) 추가. 뒤로 버튼 문구 정리. 사용법: 제목·차례에 '메뉴' 절 추가, 위치 설명 문구를 새 메뉴 기준으로 고침 -- CAP-1 화면 구조.
- [x] `public/app.js` -- `showOnly()`에 새 view, `route()` 새 순서와 `showHome/showBoard/showInbox`, `showHome()`은 `/api/scripts`를 받아 이번 주 버튼 문구(`renderList()` 앞부분을 `renderThisWeek()`로 분리)와 `loadUpcoming()`·처음 안내 띠를 맡고 `showList()`는 목록만, 현재 메뉴 표시 함수, 메뉴 클릭은 `confirmLeave()` 후 `navigate()`(Ctrl/⌘ 클릭은 새 탭 허용), 계정 목록 열기·닫기(바깥 클릭·Esc·항목 선택), `setUser()`가 메뉴·계정 항목 표시를 정함, 제목 "방송부 · 학교이름", `navigate('')` 중 대본 목록으로 가야 하는 곳은 `?scripts`로 -- 라우팅.
- [x] `public/style.css` -- 넓은 화면 상단 탭(현재: 빨강 글자 + 2px 밑줄), 720px 미만 하단 고정 탭 막대(아이콘 위·글자 아래, 현재 칸 `ph-fill` + 빨강, `env(safe-area-inset-bottom)`), 계정 목록 팝오버, 빈 화면 카드, 하단 막대만큼 본문·`wizard-nav`·토스트 위치 조정, 인쇄 때 메뉴 숨김 -- 반응형 배치.

**Acceptance Criteria:**
- Given 학생으로 로그인, when 360px 폭에서 하단 탭의 다섯 칸을 차례로 누름, then 각 화면이 한 번에 열리고 누른 칸만 빨강·채운 아이콘이며 가로 스크롤이 없다.
- Given 교사로 로그인, when 1280px 폭에서 상단 탭과 '내 이름' 목록을 씀, then 다섯 메뉴와 학생 계정 관리·사용법·로그아웃이 모두 동작한다.
- Given 밝은/어두운 화면, when 메뉴·계정 목록·빈 화면을 봄, then 토큰 색만 쓰여 글자가 잘 보인다.
- Given 대본 편집 중(4단계), when 좁은 화면에서 아래쪽 단계 이동 막대를 봄, then 하단 탭 막대에 가리지 않는다.

## Implementation Notes

- 바꾼 파일: `public/index.html`, `public/app.js`, `public/style.css`만. `src/`·DB 변경 없음.
- 검토 뒤 고친 것 7건(Review Triage Log의 patch). 15번은 브라우저에서 겹침을 확인한 뒤 CSS 한 줄로 직접 고침.
- 확인 방법: CI와 같은 `node --check`(src/*.js, public/app.js)와 `wrangler deploy --dry-run` 통과. `npm run dev` 화면에서 로컬 로그인이 되지 않아(선생님 비밀번호 확인 불가) 브라우저 안에서 서버 응답을 가짜 학생·선생님 데이터로 바꿔 I/O 표 모든 줄, 360·720·900·1280px, 밝은/어두운 화면을 확인함. 실제 로그인 확인은 아님.
- 캡처: `screenshots/` 폴더.

## Spec Change Log

## Review Triage Log

| # | 출처 | 지적 | 판정 | 근거 | 처리 |
|---|---|---|---|---|---|
| 1 | verification-gap | 라우팅 I/O 표를 자동으로 확인하는 테스트 없음 | medium | 저장소에 JS 테스트 도구가 없고 CI는 `node --check`만 함. 새 라이브러리 금지 | defer (수동 확인으로 대신) |
| 2 | verification-gap | 이번 주 버튼 중복 생성 방지 확인 없음 | medium | 같은 이유로 자동 테스트 없음 | defer (수동 확인으로 대신) |
| 3 | verification-gap | `npm run check`가 `public/app.js`를 검사하지 않음 | low | `package.json` check 스크립트는 `src/index.js`만 검사. 이번 변경 전부터 그랬음 | defer (이번엔 `node --check public/app.js`를 따로 실행) |
| 4 | verification-gap·edge | 이번 주 버튼: 목록 불러오기 실패를 `catch {}`로 삼켜 `?new`로 감 | medium | `btnThisWeek` 처리기에서 실패 후 빈/옛 목록으로 판단해 같은 금요일 대본을 또 만들 수 있음 | patch |
| 5 | edge | 새 대본 저장 뒤 홈에서 빨리 누르면 옛 목록 사용 | medium | `scriptsLoaded`가 앞선 불러오기에서 true로 남아 기다리지 않음 | patch |
| 6 | edge | 로그아웃 중 늦게 온 목록이 다음 사용자에게 남음 | low | `/api/scripts`는 방송부 전체 목록이라 사용자마다 달라지지 않고, 로그아웃과 응답이 겹칠 일도 드묾 | reject |
| 7 | edge | 새 대본 저장 중 메뉴로 떠나면 늦은 응답이 주소를 `?id=`로 바꿈 | medium | `saveNow()`의 `replaceState`. 예전 일정·로고 버튼에도 있던 문제 | defer |
| 8 | edge | 지금 메뉴를 다시 누르면 방문 기록이 쌓임 | low | 예전 로고 링크와 같은 동작, 고치려면 분기 추가 | reject |
| 9 | edge | Alt 클릭이 앱 안 이동이 됨 | low | 쓸 일이 거의 없음 | reject |
| 10 | edge·blind | 계정 목록이 menu 역할인데 화살표 키가 없고, Tab으로 나가도 열려 있음 | low | `role="menu"`·`aria-haspopup="menu"`인데 키 처리가 없고 focusout 처리도 없음 | patch (menu 역할 빼고 focusout으로 닫기) |
| 11 | edge | 목록 항목으로 이동하면 포커스가 body로 감 | low | 이동 후 화면이 바뀌므로 영향 작고, 고치려면 분기 추가 | reject |
| 12 | edge | 사용법을 메뉴로 떠나면 `helpFromApp`가 남음 | low | 예전 일정 버튼에도 같았음 | reject |
| 13 | edge | 로고 `aria-label="홈"`이 보이는 글자와 다름 | low | 음성 조작에서 "방송부"로 못 누름. 지우면 됨 | patch |
| 14 | edge·blind | 사용법 끝 버튼 "이번 주 대본 만들러 가기"가 홈으로 감 | low | `btnHelpStart`가 `navigate('')` 그대로 | patch (문구를 "홈으로 가기"로) |
| 15 | blind | 720~900px에서 상단바 넘침 | medium | 브라우저 720px에서 알림 탭(오른쪽 560px)이 내 이름 버튼(왼쪽 554px)과 겹침을 확인 | patch (900px 미만에서 학교 이름 숨김, 720·900px 겹침 없음 확인) |
| 16 | blind | 사용법 메뉴 절이 선생님 항목과 다르고 화면 너비 설명이 단순함 | low | 선생님은 비밀번호 바꾸기 대신 학생 계정 관리가 보임 | patch |
| 17 | blind | 홈 이번 주 버튼 문구가 목록 오기 전에 잠깐 다르게 보임, 매번 다시 불러옴 | low | 첫 표시 때 잠깐뿐이고, 고치려면 불러오는 중 상태 추가 | reject |
| 18 | blind | 휴대폰 편집 중 하단 막대·키보드가 쓰기 공간을 줄임 | maybe-false | 안드로이드 키보드에서 고정 막대가 올라오는지 실기기로 확인 못 함. 사실이면 medium | defer |
| 19 | blind | 아래 여백 숫자가 막대 높이와 따로 놂, 토스트가 두 줄 단계 막대에 겹칠 수 있음 | low | 막대 65px에 76px로 띄워 겹치지 않음. 토스트 겹침은 예전에도 같았음 | reject |
| 20 | blind | 화면이 바뀌어도 읽기 프로그램에 알리지 않고 탭 제목이 그대로 | low | 예전부터 그랬음 | defer |
| 21 | blind | 스토리 파일 상태·인수 조건이 덜 채워짐 | false | 상태는 단계마다 바뀌고 있으며, 고치려면 이 스펙을 고쳐야 함 | reject |

## Verification

**Commands:**
- `npm run check` -- expected: 문법 검사와 `wrangler deploy --dry-run` 성공 (자동 검사 `코드 검사`와 같은 명령)

**Manual checks (if no CLI):**
- `npm run dev`로 띄워 학생·교사 계정 각각 360px·1280px, 밝은/어두운 화면에서 I/O 표의 주소를 하나씩 열어 확인하고, 360px·1280px 캡처를 PR에 붙인다.
