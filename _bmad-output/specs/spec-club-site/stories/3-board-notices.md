---
title: '스토리 3: [DB] 공지·메모 게시판 + 공지 읽음 확인'
type: 'feature'
created: '2026-11-02'
status: 'done'
baseline_commit: 'c8ea9d80fdf402d08eb87784db66da059f4aba38'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 게시판(`?board`)은 '곧 열려요' 빈 화면이고 홈의 '새 공지' 카드는 자리만 있어서, 선생님 공지와 부원 메모가 사이트 밖에서 오가고 선생님은 누가 공지를 읽었는지 알 수 없다.

**Approach:** `migrations/0006_board.sql`(architecture.md 3절 `posts`·`post_reads`)과 새 `src/board.js`(`BoardError`)로 글 목록·쓰기·고치기·지우기·읽음 기록·읽음 명단 API를 만들고, `?board`에 공지+메모 게시판(ux-design.md 4절)을, 홈에 '새 공지' 묶음과 할 일의 안 읽은 고정 공지를 채운다.

**결정 (2026-11-02 사용자 승인):**
- 글 종류(공지/메모)는 쓸 때 정하고 고칠 때 바꾸지 않는다. 고정은 공지만.
- 공지를 고쳐도 읽음 기록은 그대로 둔다(다시 읽으라고 하려면 새 공지를 올린다).
- 선생님은 선생님이 쓴 글(공지·메모)을 고칠 수 있고, 학생 메모는 고치지 않고 지우기만 한다. 학생은 자기 메모만 고치고 지운다.
- 홈 '새 공지' = 고정 공지(최대 3) + 고정 아닌 최근 공지 3개, 메모는 넣지 않는다. 학생: 안 읽은 공지에 빨강 '새' 칩. 선생님: 카드에 '공지 쓰기' 버튼, 줄마다 '읽음 n/m'.
- 할 일: 안 읽은 고정 공지를 기존 할 일(대본·일정, 날짜순) 뒤에 붙이고 전체 최대 5개.
- 읽음 명단의 '전체'는 지금 사용 중인 학생 계정(`active = 1`). 공지보다 나중에 만든 학생도 안 읽음으로 센다.

## Boundaries & Constraints

**Always:** 권한은 서버에서 확인(공지 쓰기·고정 = 교사, 메모 = 모두, 고치기·지우기는 위 결정, 읽음 기록 = 학생, 명단 = 교사). 서버에서 제목 60·본문 2000자로 자름, 빈 제목은 400. 고정 4번째는 400 "고정 공지는 3개까지예요." 공지 삭제 시 `post_reads`도 같은 batch, `deleteUser`도 그 학생 `post_reads`를 같은 batch로 지움. 마이그레이션은 `CREATE TABLE IF NOT EXISTS`, `schema.sql`에 같은 내용, **ASCII 아닌 글자를 DEFAULT 등 SQL 값에 쓰지 않음**(주석은 한국어 가능). 기존 토큰·`.seg` 알약 탭·`<dialog>`·`.badge-new`·`.member-tag`만 사용, 강조색 `--accent` 하나, Phosphor 아이콘, 이모지·em-dash 금지, 누르는 곳 44px, 다크 모드. 글 본문은 `esc()` 후 줄바꿈 유지. 사용법 화면에 게시판 절과 차례 항목 추가, 홈 설명 갱신.

**Never:** 원격 DB(`--remote`) 실행, 기존 표·열 변경. 알림 표·메뉴 배지(스토리 5), 검토 댓글(스토리 4), 메모 댓글·좋아요·파일 올리기. 새 라이브러리.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 학생이 공지 쓰기 | POST `kind=notice` | 403 | 화면엔 '공지 쓰기' 버튼 없음 |
| 남의 메모 고치기·지우기 | 학생, uid 다름 | 403 | 버튼 숨김 |
| 선생님 지우기 | 아무 글 | 지워짐(공지면 읽음 기록도) | 지우기 전 확인창 |
| 목록 | `GET /api/posts?kind=&before=` | 첫 쪽: 고정 공지 전부 + 나머지 최신순 20개, `more` 여부. 학생은 공지마다 `unread`, 교사는 `readCount`·`total` | 잘못된 kind는 전체 |
| 더 보기 | `before=<마지막 글 id>` | 그 글보다 오래된 고정 아닌 글 20개 | 없는 id면 빈 목록 |
| 공지 펼침 | 학생, `?board&post=<id>` | 펼쳐지고 읽음 기록, '새' 칩 사라짐. 두 번 열어도 기록 하나 | 없는 글이면 토스트 후 `?board` |
| 메모 펼침 | 학생 | 읽음 기록 안 함 | 없음 |
| 읽음 명단 | 교사, `GET /api/posts/:id/reads` | `{ read:[이름], unread:[이름] }` 사용 중 학생만 | 학생이면 403 |
| 고정 4개째 | 교사가 고정 체크 | 400 "고정 공지는 3개까지예요." | 창 유지, 토스트 |
| 빈 게시판 | 글 없음 | "아직 글이 없어요. 방송부에 알리고 싶은 것을 메모로 남겨 보세요." | 없음 |

</frozen-after-approval>

## Code Map

- `migrations/0006_board.sql`(새) + `schema.sql` -- architecture.md 3절 SQL 그대로, 0005 머리 주석 형식.
- `src/board.js`(새) -- `BoardError`(calendar.js `CalendarError` 패턴), `listPosts(env,user,{kind,before})`, `createPost`, `updatePost`, `deletePost`, `markRead`, `postReads`, 그리고 홈용 `noticeStatements(env,user)`/`toNotices(...)`(getHome batch에 넣을 문장과 결과 정리). id `crypto.randomUUID().slice(0,8)`, 시각 `nowKST()`, 작성자 `user.name`/`user.uid||''`.
- `src/index.js` -- 가드 뒤 `/api/posts…` 연결, `BoardError` → `HttpError` (calendar 블록 패턴).
- `src/home.js` -- `notices: []` 자리를 board.js 문장으로 채우고, 학생 할 일 끝에 `{kind:'notice', id, title, date}` 붙인 뒤 5개 자르기. `isMyScript` 그대로.
- `src/users.js` `deleteUser` -- `DELETE FROM post_reads WHERE user_uid = ?`를 같은 batch로.
- `public/index.html` -- `#boardView`(181)의 '곧 열려요'를 머리(쓰기 버튼)·`.seg` 탭(전체/공지/메모)·`#postList`·더 보기로 교체, `<dialog id="postDialog">`(eventDialog 525 패턴: 제목·내용·고정 체크). `#noticeCard`(145)에 교사용 '공지 쓰기' 버튼. 사용법 `help-toc`(349)·`#h-menu`(374) 갱신, 새 `#h-board`, `#h-teacher`(481)에 공지·읽음 확인.
- `public/app.js` -- `showBoard()`(316) 구현: 목록 받기·그리기, 펼치기(주소 `?board&post=`를 `replaceState`, 학생 공지면 `POST /read`), 교사 읽음 명단 펼치기(`.member-tag` 두 줄), 글 쓰기/고치기 창, 지우기 `confirm`. `route()`는 그대로(`board` 분기에서 `post` 읽기). `renderHome()`(261)의 공지 자리를 `homeRow` 패턴으로, 할 일 `kind==='notice'` 줄 → `?board&post=`. `data-go` 앱 안 이동 재사용.
- `public/style.css` -- 게시판 줄·펼친 본문(`white-space: pre-wrap`)·고정 표시·읽음 명단. 기존 `.upcoming-item`·`.seg`·`.cat` 재사용.
- `test/board.test.js`(새), `test/home.test.js` -- 가짜 `env.DB`(home.test.js `fakeEnv` 패턴)로 권한·고정 3개·자르기·삭제 batch·홈 공지/할 일을 시험.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0006_board.sql`, `schema.sql` -- 표 두 개와 인덱스 -- 게시판 저장소.
- [x] `src/board.js`, `src/index.js`, `src/users.js` -- API·권한·정리 -- 서버 확인.
- [x] `src/home.js` -- 새 공지 묶음·안 읽은 고정 공지 할 일 -- 홈 채우기.
- [x] `public/index.html`, `public/app.js`, `public/style.css` -- 게시판 화면·창·홈 공지 카드·사용법.
- [x] `test/board.test.js`, `test/home.test.js` -- I/O 표의 서버 쪽 줄 시험.

**Acceptance Criteria:**
- Given 로컬 DB에 0006을 `--local`로 적용, when 학생·교사로 로그인해 게시판·홈을 씀, then I/O 표대로 동작하고 교사 화면의 읽음 수가 학생이 연 뒤 바뀐다.
- Given 360px·1280px, 밝은/어두운 화면, when 게시판·홈·글 쓰기 창을 봄, then 가로 스크롤 없고 토큰 색만 쓰인다.
- Given 기존 주소(`?scripts`, `?id=`, `?new`, `?calendar`, `?help`, `?accounts`, `?inbox`), when 연다, then 예전과 같은 화면.

## Implementation Notes

- `GET /api/posts/:id` 추가: 주소(`?board&post=`)로 연 글이 첫 쪽 목록에 없을 때(오래된 글) 하나만 받아 맨 위에 보여 준다. 없으면 404 → 토스트 후 `?board`.
- 목록·글 응답에 서버가 정한 `canEdit`/`canDelete`를 넣어 화면 버튼 표시를 서버 권한 판정과 한곳에서 맞춘다.
- 선생님 `readCount`는 사용 중인(`active = 1`) 학생의 읽음만 센다(명단 `total`과 같은 기준).
- `app.js`의 아나운서 수 버튼 연결을 `querySelector('.seg')` → `.big-seg`로 바꿈: 게시판 `.seg` 탭이 문서에서 먼저 나와 엉뚱한 곳에 걸리는 것을 막음.
- `toast()`는 창(dialog)이 열려 있으면 그 안에 붙어 어두운 배경 위로 보인다(고정 4개째 오류 토스트).

- 검토 뒤: `test/board.sql.test.js`(실제 SQLite에 schema.sql을 올려 학생 unread·교사 readCount·쪽 넘기기·홈 공지 확인, `node:sqlite`가 없으면 건너뜀), `getPost` 시험, 화면 고침 7개(Review Triage Log #3-#9). 확인: `npm test` 29개 통과, `npm run check`·`node --check` 통과, 0006 `--local` 다시 실행 성공. 검토 뒤 화면 고침은 브라우저로 다시 눌러 보지 않음.

## Spec Change Log

## Review Triage Log

| # | 출처 | 지적 | 판정 | 근거 | 처리 |
|---|---|---|---|---|---|
| 1 | verification-gap·blind | 게시판 SQL(학생 `unread`, 교사 `readCount`의 `active = 1`, `before` 쪽 넘기기)을 실제로 실행하는 시험이 없음 | medium | 가짜 DB가 SQL을 실행하지 않고 정해 둔 행을 돌려줘서 `IS NULL` 뒤집기 같은 실수도 시험을 통과함 | patch (`test/board.sql.test.js`, `node:sqlite`) |
| 2 | verification-gap·blind | `getPost`의 교사 `total`과 404 처리 시험 없음 | low | `getPost`를 직접 부르는 시험이 없음 | patch |
| 3 | blind·edge | '더 보기'로 불러온 글을 고치면 첫 쪽만 다시 받아 펼친 글이 사라짐 | medium | `savePost`가 `loadBoard()` 뒤 `b.extra`를 채우지 않음 | patch |
| 4 | edge | 이미 지워진 글을 지우면 토스트만 나오고 목록에 남음 | low | `removePost`의 catch가 다시 불러오지 않음, 고치기가 한 줄 | patch |
| 5 | blind·edge | 공지·메모 탭이 비면 "메모로 남겨 보세요" 문구가 탭과 안 맞음 | low | `renderBoard`가 `kind`를 안 봄 | patch |
| 6 | blind | 홈 공지 빈 문구가 역할 대신 `h.reviewQueue`로 교사를 판정 | low | 응답 모양이 바뀌면 문구가 어긋남, 고치기가 한 줄 | patch |
| 7 | blind | 공백만 있는 본문이 빈 칸으로 보임 | low | `p.body ?` 판정 | patch |
| 8 | blind·edge | 창 안에 띄운 토스트가 창을 닫으면 사라지고 창 안에 남음 | low | `toast()`가 토스트를 창 안으로 옮긴 뒤 되돌리지 않음 | patch |
| 9 | blind | 읽음 명단이 화면 읽기 프로그램에 알려지지 않음 | low | `.post-reads`에 `aria-live` 없음, 속성 하나 | patch |
| 10 | verification-gap·blind | `/api/posts` 경로·`BoardError`→HTTP 상태를 확인하는 요청 단위 시험 없음 | medium | 저장소에 `src/index.js` 요청 시험 틀이 없음(로그인 쿠키 서명 등). 로컬 `wrangler dev`로 경로별 수동 확인함 | defer |
| 11 | verification-gap | 아나운서 수 버튼 `.big-seg` 연결·홈 할 일 공지 줄을 확인하는 화면 시험 없음 | medium | 화면 시험 도구 없음(스토리 1·2 미룬 작업과 같은 종류) | defer |
| 12 | blind·edge | 고정 3개 제한이 셈 뒤 쓰기라 동시에 고정하면 4개 가능 | low | 선생님 몇 명이 쓰는 규모에서 같은 순간 고정은 드물고, 고치려면 조건부 INSERT·UPDATE로 바꿔야 함 | reject |
| 13 | blind·edge | '더 보기' 기준 글이 지워지면 더 보기가 멈춤 | low | 더 보기를 누르기 직전에 그 글이 지워져야 함. 고치려면 기준 형식 변경 필요. 다시 열면 됨 | reject |
| 14 | blind | `uid` 없는 학생 세션이 쓴 메모가 선생님 글로 보임 | false | `auth.js` `currentUser`가 `uid` 없는 학생 쿠키를 로그아웃으로 봄(124행) | reject |
| 15 | blind | 게시판은 작성자에 '선생님'을 붙이고 홈은 안 붙임, 이름이 '선생님'으로 끝나면 겹침 | low | 홈 공지는 늘 선생님 글이라 이름만 보여도 뜻이 같음. 겹침은 스토리 2 인사와 같은 예전 방식 | reject |
| 16 | blind | 제목·본문 자르기가 UTF-16 단위라 이모지가 반으로 잘릴 수 있음 | low | 60·2000번째 글자에 보충 문자가 걸려야 함. 다른 모듈도 같은 `slice` | reject |
| 17 | blind | `post_reads.user_uid` 인덱스 없음 | low | 학생 계정 삭제 때만 쓰고 표가 작음 | reject |
| 18 | blind | `kind`·`pinned`에 CHECK 제약 없음 | low | 쓰기는 모두 `board.js`를 거치며 거기서 검사함. 기존 표들도 CHECK 없이 앱에서 확인 | reject |
| 19 | edge | 8자리 id가 겹치면 500 | low | 기존 대본·일정과 같은 id 규칙, 이 규모에서 겹칠 일이 거의 없음 | reject |

## Verification

**Commands:**
- `npm test` -- expected: 모두 통과
- `npm run check`, `node --check public/app.js`, `node --check src/board.js` -- expected: 성공
- `npx wrangler d1 execute broadcasting-db --local --file=./migrations/0006_board.sql` -- expected: 성공(두 번 실행해도 성공)

**Manual checks (if no CLI):**
- `npm run dev`에서 학생·교사로 I/O 표 각 줄, 360·1280px, 밝은/어두운 화면, 기존 주소 확인. 캡처 `screenshots/3-*.jpg`(stories/screenshots).
