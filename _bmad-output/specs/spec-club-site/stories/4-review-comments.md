---
title: '스토리 4: [DB] 선생님 검토 댓글'
type: 'feature'
created: '2026-11-03'
status: 'done'
baseline_commit: '6170dfe2b3e436e685072523ee2a856c1ef71edc'
route: 'dispatch'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/ux-design.md'
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 선생님 피드백은 대본 전체에 하나뿐인 메모 칸에만 남길 수 있어서, 어느 구성을 고쳐야 하는지, 학생이 고쳤는지 알 수 없다.

**Approach:** `migrations/0007_review_comments.sql`(architecture.md 3절 `script_comments`)과 새 `src/comments.js`(`CommentError`)로 댓글 목록·남기기·반영함·지우기 API를 만들고, 4단계 구성 탭에 댓글 카드·반영 안 된 수 배지(ux-design.md 5절), 대본 목록 `open_comments`, 학생 홈 '내 할 일' 맨 위 줄을 채운다.

**결정 (stories.yaml에 spec_checkpoint 없음, 개발자가 정함):**
- 댓글 쓰기·지우기 = 선생님(교사 쿠키에 uid가 없어 선생님끼리는 서로의 댓글도 지움). '반영했어요' = 로그인한 누구나, 완료된 대본에서도 됨. 반영 되돌리기는 없음(두 번 눌러도 처음 기록 유지).
- 탭 안에서 반영 안 된 댓글 먼저(오래된 순), 반영한 댓글은 그 뒤에 흐리게 접힘(`<details>`).
- 학생 홈 할 일: 반영 안 된 댓글이 있는 내 대본(`isMyScript`, '완료' 제외)을 방송일 순으로 맨 위에. 같은 대본의 '마저 쓰기' 줄은 빼서 겹치지 않게. 전체 5개 그대로.
- 대본 목록 줄에 반영 안 된 수가 있으면 `--warn` 칩 "의견 n".
- 아직 저장 안 된 새 대본에는 선생님 의견 칸을 숨긴다(첫 저장 뒤 보임).

## Boundaries & Constraints

**Always:** 권한은 서버에서 확인. 본문 1000자로 자름, 빈 본문 400, 모르는 구성 400, 없는 대본·댓글 404. 대본 삭제 batch에 댓글 삭제. 마이그레이션 `CREATE TABLE IF NOT EXISTS`, `schema.sql`에 같은 내용, SQL 값에 ASCII 아닌 글자 금지. 기존 토큰만, 댓글 배지는 `--warn` 계열(빨강은 알림 전용), Phosphor 아이콘 + 글자, 이모지·em-dash 금지, 누르는 곳 44px, 다크 모드. 본문은 `esc()` 후 줄바꿈 유지. 사용법 4단계·검토 절·선생님 안내 갱신.

**Never:** `--remote` 실행, 기존 표·열 변경, 대본 상태 자동 변경(댓글을 남겨도 '검토요청' 그대로), 알림 표(스토리 5), 학생 댓글 쓰기·답글, 새 라이브러리.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 선생님 의견 | POST `/api/scripts/:id/comments` `{section:'events', body}` | 201 댓글, 학생 '학교 행사' 탭 배지 1 | 없는 대본 404, 구성 틀림·빈 본문 400 |
| 학생 의견 쓰기 | 학생 POST | 403 | 화면에 입력칸 없음 |
| 반영했어요 | 학생 POST `/api/comments/:id/resolve` | `resolved_by`=학생 이름, 배지 줄어듦, 선생님 화면 "반영함 · 이름 날짜" | 없는 댓글 404 |
| 다시 반영 | 이미 반영한 댓글 | 처음 기록 그대로 200 | 없음 |
| 완료된 대본 | 학생, 읽기 전용 | 댓글 보이고 '반영했어요' 됨 | 없음 |
| 지우기 | 선생님 DELETE `/api/comments/:id` | 지워짐 | 학생 403, 확인창 |
| 대본 삭제 | 선생님 | 그 대본 댓글도 지워짐 | 없음 |
| 목록 | GET `/api/scripts` | 줄마다 `open_comments` | 없음 |
| 홈 | 학생, 내 대본에 반영 안 된 댓글 | 할 일 맨 위 "선생님 의견 n개 반영하기" | 남의 대본·완료 대본은 안 나옴 |

</frozen-after-approval>

## Code Map

- `migrations/0007_review_comments.sql`(새) + `schema.sql` -- architecture.md 3절 SQL, 0006 머리 주석 형식.
- `src/comments.js`(새) -- `CommentError`, `listComments`, `createComment`, `resolveComment`, `deleteComment`, 홈용 `openCommentStatement(env)`. `SECTIONS`는 `src/ai.js`에서. id·`nowKST()`는 board.js 패턴.
- `src/index.js` -- `listScripts` SELECT에 `open_comments` 하위 질의, `deleteScript` batch에 댓글 삭제, `/api/scripts/:id/comments`·`/api/comments/:id(/resolve)` 연결(게시판 블록 패턴).
- `src/home.js` -- 학생 batch에 `openCommentStatement` 추가, `isMyScript` 거름, `kind:'comments'` 줄을 맨 앞, 같은 id의 `script` 줄 제외.
- `public/app.js` -- `buildSections()` 탭에 배지 자리·카드에 댓글 자리·선생님 입력칸, `loadComments(id)`(늦은 응답 무시), `renderComments()`, 반영·남기기·지우기, `openScript`/`newScript`/`saveNow`(첫 저장 뒤 입력칸 보이기). `fill()`의 잠금 선택자는 `.chip`·textarea라 댓글 버튼에 `.chip` 쓰지 않음. `renderList()` 칩, `renderHome()` `comments` 줄.
- `public/index.html` -- 사용법 `#h-step4`·`#h-review`·`#h-teacher`, 홈 설명.
- `public/style.css` -- `.cm-badge`(warn), 댓글 카드·접힌 반영 댓글·입력칸.
- `test/comments.test.js`(새) -- 실제 SQLite(board.sql.test.js 어댑터)로 권한·자르기·반영·삭제 batch·목록 수·홈 할 일.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0007_review_comments.sql`, `schema.sql` -- 표·인덱스.
- [x] `src/comments.js`, `src/index.js` -- API·권한·삭제 batch·목록 수.
- [x] `src/home.js` -- 할 일 맨 위 댓글 줄.
- [x] `public/app.js`, `public/index.html`, `public/style.css` -- 댓글 화면·배지·목록 칩·홈 줄·사용법.
- [x] `test/comments.test.js`, `test/home.test.js` -- I/O 표 서버 쪽 시험.

**Acceptance Criteria:**
- Given 로컬 DB에 0007 `--local` 적용, when 선생님이 '학교 행사'에 의견을 남기고 학생이 반영함, then I/O 표대로 배지·목록·홈이 바뀐다.
- Given 360px·1280px, 밝은/어두운 화면, when 4단계·목록·홈을 봄, then 가로 스크롤 없고 토큰 색만.
- Given 기존 주소(`?scripts`, `?id=`, `?new`, `?calendar`, `?help`, `?accounts`, `?board`, `?inbox`), when 연다, then 예전과 같은 화면.

## Implementation Notes

- 홈 할 일 줄 주소는 `?id=<id>&tab=<첫 의견 구성>`. `route()`가 `tab`을 `openScript(id, tab)`에 넘겨 4단계 그 탭을 바로 연다(`tab`이 없거나 틀리면 예전과 같음).
- 대본 목록 수는 `OPEN_COMMENTS_SQL` 하위 질의, 홈은 `openCommentStatement`(상태 `완료`는 바인드 값으로 넘김).
- 같은 초에 남긴 의견은 `rowid`로 순서를 정한다. 화면은 안정 정렬로 서버 순서를 지킨다.
- 의견 작성자 표시는 이름이 이미 `선생님`으로 끝나면 덧붙이지 않는다.
- 의견 입력칸(`.cm-input`)은 자동 저장(`markDirty`)에서 뺐다.
- 캡처: `screenshots/4-home-student-360-light.jpg`, `4-tab-student-resolved-360-light.jpg`, `4-list-student-360-dark.jpg`, `4-tab-teacher-360-dark.jpg`, `4-tab-teacher-1280-light.jpg`.

## Spec Change Log

## Review Triage Log

| # | 출처 | 지적 | 판정 | 근거 | 처리 |
|---|---|---|---|---|---|
| 1 | blind·edge | 방송일이 지난(완료 안 된) 의견 대본이 할 일 맨 위에 계속 남아 오늘 일정·공지를 밀어냄 | medium | `openCommentStatement`에 날짜 아래 경계가 없음, 마저 쓰기 질의는 `BETWEEN today` | patch (`broadcast_date >= today` + 시험) |
| 2 | edge | 새 대본 첫 저장 응답이 다른 대본을 연 뒤 오면 의견 칸이 새 대본 id로 바뀌어 엉뚱한 대본에 의견이 남음 | medium | `saveNow`의 `wasNew` 분기가 지금 열린 대본을 확인하지 않음 | patch (`scriptId`가 비었을 때만) |
| 3 | edge | 첫 의견 목록 응답이 남기기보다 늦게 오면 새 의견이 사라짐 | low | `addComment`가 `seq`를 바꾸지 않아 늦은 GET이 목록을 덮음, 고치기가 한 줄 | patch (남긴 뒤 다시 불러오기) |
| 4 | edge | 이미 지워진 의견을 지우면 카드가 남고 계속 404 | low | `removeComment` catch가 다시 불러오지 않음(반영은 다시 불러옴) | patch |
| 5 | blind | `.section-tabs button.on .cm-badge`가 기본 값과 똑같음 | low | 효과 없는 규칙, 지우기만 하면 됨 | patch |
| 6 | blind | 아무 학생이나 남의 대본 의견을 반영함으로 표시 | false | 결정(frozen): '반영했어요' = 로그인한 누구나, architecture.md 4절 '모두' | reject |
| 7 | blind | 반영 되돌리기·의견 고치기 없음 | false | 결정(frozen): 되돌리기 없음, 고치기는 범위 밖 | reject |
| 8 | blind | 선생님에게 반영됐다고 알리지 않음 | false | 선생님 4단계 화면에 "반영함 · 이름 날짜"로 보임(성공 기준). 알림은 스토리 5 | reject |
| 9 | blind | 완료 대본 의견은 홈에 안 나옴 | false | 결정(frozen): 홈은 '완료' 제외. 목록 칩과 4단계에는 보임 | reject |
| 10 | blind·edge | 8자리 id가 겹치면 500 | low | 기존 대본·게시판과 같은 규칙, 이 규모에서 드묾(스토리 3 #19) | reject |
| 11 | blind | `resolved_by` 인덱스 없음 | low | 표가 작고 대본별 인덱스가 하위 질의를 받침 | reject |
| 12 | blind | `script_id` 외래 키·연쇄 삭제 없음 | low | 기존 표들도 외래 키 없이 batch로 정리, 대본 삭제 경로는 하나 | reject |
| 13 | blind | `<span>`의 `aria-label`이 안 읽힘 | low | 보이는 글자 "의견 2"가 그대로 읽혀 뜻이 같음 | reject |
| 14 | blind | `fill()`이 같은 대본을 다시 채우면 쓰던 의견이 지워짐 | false | `fill`은 대본을 새로 열 때·새 대본에서만 불림, 같은 대본 다시 채우기 경로 없음 | reject |
| 15 | blind·edge | 1000자 자르기가 이모지를 반으로 자를 수 있음 | low | 다른 모듈과 같은 `slice`(스토리 3 #16) | reject |
| 16 | blind | 반영·지우기 뒤 목록·홈 숫자가 낡음 | false | `showList`·`showHome`이 열 때마다 새로 받음 | reject |
| 17 | blind | 선생님끼리 지우기·지원 안 하는 메서드 시험 없음 | low | 선생님은 구분되지 않아 같은 경로, 메서드는 끝의 404로 떨어짐 | reject |
| 18 | verification-gap·blind | 홈 줄 `&tab=` 연결·`openScript` 탭 고르기·탭 배지 수를 확인하는 화면 시험 없음 | medium | 저장소에 화면 시험 도구 없음(스토리 1~3 미룬 작업과 같은 종류). 서버의 `section`·`count`는 시험함 | defer |

## Verification

**Commands:**
- `npm test` -- expected: 모두 통과
- `npm run check`, `node --check public/app.js` -- expected: 성공
- `npx wrangler d1 execute broadcasting-db --local --file=./migrations/0007_review_comments.sql` -- expected: 성공(두 번 실행해도)

**Manual checks (if no CLI):**
- `npm run dev`에서 선생님·학생으로 I/O 표, 360·1280px, 밝은/어두운, 기존 주소. 캡처 `stories/screenshots/4-*.jpg`.
