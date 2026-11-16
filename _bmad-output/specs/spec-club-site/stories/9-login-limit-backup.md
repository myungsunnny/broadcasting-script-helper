---
title: '스토리 9: 로그인 시도 제한 + 데이터 백업 받기'
type: 'feature'
created: '2026-11-16'
status: 'done'
baseline_commit: '57aa855d0b1486d8ad7e87d634e110c1b0eb0f7e'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/specs/spec-club-site/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 저장소와 사이트가 공개이고 학생 임시 비밀번호가 4자리라, 누군가 비밀번호를 계속 넣어 보면 뚫릴 수 있다(SPEC Non-goals에 "로그인 시도 횟수 제한 (추후 별도 작업)"으로 남아 있던 것). 또 데이터가 D1 한 곳에만 있어 선생님이 손에 쥘 백업이 없다.

**Approach:** (A1) 로그인에 실패할 때마다 DB(`login_fails`)에 아이디 기준·인터넷 주소(`CF-Connecting-IP`) 기준으로 기록하고, 짧은 시간에 너무 많이 틀리면 비밀번호를 확인하지 않고 쉬운 말로 거절한다(429). 성공하면 그 아이디 기록을 지운다. 선생님 로그인(아무 이름 + 선생님 비밀번호)도 같은 길이라 함께 보호된다. (A2) 선생님 화면 '학생 계정 관리'에 '백업 내려받기' 버튼을 두고, 서버가 주요 표를 JSON 하나로 돌려주면 브라우저가 날짜 붙은 파일로 저장한다. 함께 작은 고침 2개: (B1) 새 대본 첫 저장 응답이 늦게 와도 편집 화면이 보일 때만 주소를 `?id=`로 바꾼다. (B2) `npm run check`가 `public/app.js`도 문법 검사한다(CI와 같게).

**결정:**
- (선생님 승인) 아이디 기준: 최근 10분 동안 5번 틀리면 막음. 인터넷 주소 기준: 최근 10분 동안 30번 틀리면 막음(학교 안은 모두 같은 주소라 넉넉하게). 막힌 동안 시도는 비밀번호를 확인하지 않고 기록도 늘리지 않는다. 가장 오래된 실패가 10분을 지나면 다시 시도할 수 있다(최대 10분 기다림).
- (선생님 승인) `login_fails` 표가 아직 없으면(배포가 표보다 먼저 나간 사고) 제한 없이 로그인은 그대로 된다. 서버 기록에 오류만 남긴다.
- 아이디는 로그인 칸에 쓴 글자 그대로(앞뒤 공백 뺌, 30자) 센다. 없는 아이디도 센다(있는지 없는지 알려 주지 않기 위해).
- 성공하면 그 아이디의 기록만 지운다. 인터넷 주소 기록은 지우지 않는다(내 계정으로 성공해 다른 계정 공격 기록을 지우지 못하게).
- 10분 지난 기록은 실패를 기록할 때 함께 지운다.
- 거절 문구: "비밀번호를 여러 번 틀렸어요. 10분 뒤에 다시 해 보세요. 비밀번호를 잊었으면 선생님께 말씀드려요."
- 백업 범위: scripts, script_history, users, calendar_events, posts, post_reads, script_comments, notifications, ai_usage. `users`는 `password_hash`를 뺀다. `login_fails`는 넣지 않는다(잠깐 쓰는 기록이라). 파일 이름 `방송부-백업-YYYY-MM-DD.json`(한국 날짜).

## Boundaries & Constraints

**Always:** 기존 표·열은 그대로(새 표 추가만). `CREATE TABLE IF NOT EXISTS`로 두 번 실행해도 안전. 화면 문구는 해요체. 백업은 선생님만(학생 403), 읽기만 한다.

**Never:** 새 라이브러리, 원격 DB에 직접 실행, 비밀값·시트 ID를 코드/PR에 쓰기, 백업에 비밀번호 해시 넣기, 로그인 실패 응답에서 "아이디가 없음"과 "비밀번호 틀림"을 구분하기.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 1~4번 틀림 | 같은 아이디 | 401 "아이디 또는 비밀번호가 맞지 않아요." 기록 늘어남 | 없음 |
| 5번 틀린 뒤 | 같은 아이디, 맞는 비밀번호라도 | 429 거절 문구, 비밀번호 확인 안 함 | 화면은 오류 문구 표시(기존 그대로) |
| 10분 지남 | 오래된 실패만 있음 | 다시 시도 가능, 오래된 기록 지워짐 | 없음 |
| 성공 | 3번 틀린 뒤 맞음 | 200, 그 아이디 기록 0 | 없음 |
| 선생님 비밀번호 마구 넣기 | 이름을 바꿔 가며 30번 틀림(같은 주소) | 31번째 429 | 없음 |
| 다른 아이디 | 한 아이디가 막힘 | 다른 아이디는 그대로 로그인됨(주소 한도 전까지) | 없음 |
| 표 없음 | `login_fails` 없음 | 로그인 정상(200/401) | 서버 기록에 오류 |
| 백업 선생님 | GET /api/backup | 200, 표 9개 모두, users에 `password_hash` 없음 | 없음 |
| 백업 학생 | 학생 로그인 | 403 | 없음 |

</frozen-after-approval>

## Code Map

- `migrations/0010_login_fails.sql`(새), `schema.sql` 끝 -- `login_fails(key TEXT NOT NULL, at INTEGER NOT NULL)` + `INDEX (key, at)`. `key`는 `id:<아이디>` 또는 `ip:<주소>`, `at`은 `Date.now()` 밀리초.
- `src/login-limit.js`(새, `src/ai-usage.js` 모양) -- `LOGIN_LIMIT_MESSAGE`, `reserveAttempt(env, loginId, ip)`, `releaseIp(env, attempt)`, `clearFails(env, loginId)`. **먼저 적고 나중에 센다**(동시에 여러 번 보내도 한도를 못 넘게): `reserveAttempt`는 10분 지난 기록을 지우고, `id:`(그리고 `ip`가 있으면 `ip:`) 줄을 `INSERT … RETURNING rowid`로 하나씩 넣은 뒤 최근 10분 수를 센다. 아이디 수 > 5 또는 주소 수 > 30이면 방금 넣은 줄을 rowid로 지우고 `{ blocked: true }`, 아니면 `{ ipRowid }`. 비밀번호가 틀리면 넣은 줄이 그대로 실패 기록이 된다. 성공하면 `clearFails`(그 아이디 줄 모두) + `releaseIp`(방금 넣은 주소 줄 하나만 지움 — 성공한 로그인은 주소 수에 안 들어감). 모두 DB 오류면 `console.error` 후 막지 않음(표 없음 대비). `ip`가 빈 값이면 주소 기준은 건너뜀(로컬·시험). IPv6 주소는 앞 4묶음(/64)으로 묶어 센다(주소를 바꿔 가며 피하지 못하게). D1 batch는 시험 어댑터에서 RETURNING 결과를 못 받으므로 쓰지 않고 한 문장씩 부른다.
- `src/auth.js` `login(env, loginId, password, ip)` -- 아이디 다듬은 뒤 `reserveAttempt`가 `blocked`면 `{ blocked: true }` 반환(비밀번호 확인 안 함), 실패면 `null`, 성공이면 `clearFails` + `releaseIp`. `requireSecrets`·비밀번호 확인 순서는 그대로.
- `src/users.js` `resetPassword` -- 비밀번호를 바꾼 뒤 `clearFails(env, row.login_id)`(오류가 나도 초기화는 성공). 선생님이 초기화하면 막힌 학생이 바로 들어올 수 있다.
- `src/index.js` `/api/login` -- `request.headers.get('CF-Connecting-IP') || ''` 넘김, `blocked`면 `HttpError(429, LOGIN_LIMIT_MESSAGE)`. 새 `GET /api/backup`(mustChange 검사 뒤): 선생님 아니면 403 "백업은 선생님만 받을 수 있어요.", 맞으면 `getBackup(env)`.
- `src/backup.js`(새) -- `getBackup(env)`: `env.DB.batch`로 표별 `SELECT` (users는 열 이름을 적어 `password_hash` 뺌) → `{ created_at: nowKST(), tables: { 이름: 행들 } }`.
- `public/index.html` `accountsView` 끝 -- '데이터 백업' 카드 + `btnBackup` 버튼, 한 줄 설명. 선생님 안내(`h-teacher`)에 한 줄.
- `public/app.js` -- `btnBackup` 처리: `api('/api/backup')` → `Blob` → `<a download>`로 저장, 실패면 `toast`. `saveNow()` 1443줄 `history.replaceState`를 `!$('editView').classList.contains('hidden')`일 때만.
- `package.json` `check` -- `node --check public/app.js` 추가.
- `test/login-limit.test.js`, `test/backup.test.js`(새) -- `test/ai-usage.test.js`의 node:sqlite + D1 어댑터 + `worker.fetch` 방식. 시간은 DB에 오래된 `at`을 넣어 흉내.
- `/api/backup` 응답에 `Cache-Control: no-store`(학교 공용 컴퓨터에 남지 않게). 백업 카드 설명에 "학생 이름이 들어 있으니 선생님만 보관해요." 한 문장.
- 사용법: 학생 FAQ에 "비밀번호를 여러 번 틀려서 막혔어요"(10분 기다리거나 선생님께 비밀번호 초기화 부탁), 선생님 안내에 "로그인이 막힌 학생은 비밀번호 초기화를 하면 바로 들어올 수 있어요" 한 줄. 한도 숫자는 쓰지 않는다.
- 고치지 않음: `currentUser`, 쿠키, `checkPassword`, `users.js`의 `resetPassword` 밖.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/0010_login_fails.sql`, `schema.sql` -- 표·색인 추가
- [x] `src/login-limit.js`, `src/auth.js`, `src/index.js` -- 막기·기록·초기화·429
- [x] `src/backup.js`, `src/index.js` -- `/api/backup`
- [x] `test/login-limit.test.js`, `test/backup.test.js` -- 위 표의 경우들
- [x] `public/index.html`, `public/app.js` -- 백업 버튼, B1 고침
- [x] `package.json` -- B2
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- B1·B2 항목 지우기

**Acceptance Criteria:**
- Given 선생님이 학생 계정 관리 화면에 있음, when '백업 내려받기'를 누른다, then `방송부-백업-오늘날짜.json` 파일이 저장되고 열어 보면 표 9개가 있고 비밀번호 해시는 없다.
- Given 새 대본을 처음 저장하는 중, when 저장 응답 전에 홈으로 간다, then 주소가 `?id=`로 바뀌지 않는다.
- Given 저장소, when `npm run check`, then `public/app.js` 문법 오류도 잡는다.

## Implementation Notes

- 로그인 제한은 리뷰 뒤 "먼저 적고 나중에 세기"(`reserveAttempt`)로 다시 짰다. 막힌 시도는 넣은 줄을 지워 기록이 늘지 않고, 성공한 로그인은 주소 줄을 지워 주소 수에 안 들어간다. 동시에 많이 오면 처음 몇 번까지 막을 수 있다(막는 쪽으로만 틀림).
- `resetPassword`가 그 학생 기록을 지운다. IPv6는 /64로 묶는다. `/api/backup`은 `Cache-Control: no-store`.
- 표가 없으면 제한 없이 로그인된다(선생님 승인). 배포 전에 0010을 먼저 실행한다.
- 확인: `npm test` 87개 통과(새 시험 13개), `npm run check` 통과. 화면·실제 로그인·백업 버튼은 이 폴더에 `.dev.vars`가 없어 확인하지 못했다.

## Spec Change Log

- 리뷰 1회차: (1) `isBlocked`로 확인하고 비밀번호 확인 뒤 `recordFail`로 적는 방식은 동시에 많이 보내면 모두 통과해 4자리 비밀번호를 한꺼번에 맞혀 볼 수 있음 → "먼저 적고 나중에 세기"(`reserveAttempt`)로 바꿈. (2) 비밀번호 초기화해도 막힘이 안 풀림 → `resetPassword`에서 `clearFails`. (3) IPv6 주소 바꾸기로 주소 한도 피하기 → /64로 묶음. 함께: 백업 `no-store`, 안내 문구.
  KEEP: 표·마이그레이션·`/api/backup`·`backup.js`·화면 백업 버튼·B1·B2·시험 틀(`test/login-limit.test.js`의 경우들, `test/backup.test.js`)은 그대로 둔다. 로그인 제한 부분(`login-limit.js`, `auth.js` 연결)만 새로 짠다.

## Review Triage Log

| 찾은 문제 | 판정 | 근거·처리 |
|---|---|---|
| 동시에 여러 요청을 보내면 확인과 기록 사이를 지나 한도보다 많이 시도 | high, bad_spec | `isBlocked`(읽기) → PBKDF2 → `recordFail`(쓰기) 사이에 막는 것이 없음. 먼저 적고 세는 방식으로 다시 짬 |
| 비밀번호 초기화해도 막힌 학생이 10분 기다려야 함 | medium, bad_spec | `resetPassword`가 `login_fails`를 안 지움. 스펙이 `users.js`를 막아 둠 → 고침 |
| IPv6 주소를 바꿔 가며 주소 한도 피하기 | medium, bad_spec | 한 사람이 /64 안에서 주소를 많이 가짐. 선생님 비밀번호는 이름을 바꿔 가며 넣으니 주소 한도만 막음 → /64로 묶음 |
| 일부러 친구 아이디를 막을 수 있음 / 학교 전체 막힘 | low, 고침(안내만) | 선생님이 승인한 기준. 초기화로 풀리게 하고 사용법에 한 줄 |
| 백업 응답에 `Cache-Control` 없음 | low, 고침 | 헤더 한 줄 |
| 백업 파일에 학생 이름이 있다는 안내 없음 | low, 고침 | 카드 설명 한 문장 |
| 429 안내가 알림 창뿐, 사용법에 설명 없음 | low, 고침 | 학생 FAQ 한 줄 |
| users 열을 손으로 적음(새 열이 빠짐) | low, 거절 | 손으로 적어야 나중에 생길 비밀 열이 새지 않음. 일부러 고른 방식 |
| 표 하나가 없으면 백업 전체 실패 | low, 거절 | 0001~0010 모두 실행된 DB에서만 배포됨(규칙). 실패하면 오류 안내가 뜸 |
| 백업이 커져 응답 한도 넘음 | maybe-false, 거절 | 방송부 규모(학생 수십 명, 대본 주 1개)로는 몇 MB 안 됨. 넘으면 표별로 나눠 받기 |
| `CF-Connecting-IP`가 없으면 주소 한도 없음 | false | Cloudflare는 운영에서 늘 넣어 줌. 없는 건 로컬·시험뿐 |
| 사용 중지 학생 시도도 셈 | false | 의도(있는지 없는지 안 알려 줌) |
| 시험 없는 경우들(쿠키 없음 401, mustChange 403 등) | low, 거절 | 같은 라우터 공통 검사로 다른 시험이 이미 확인 |
| 시험의 D1 어댑터 복사본 7개 | low, 거절 | 이번 이전부터 있던 방식. 시험 코드만 해당 |
| 새 대본 저장 중 다른 대본을 열면 주소·`state.current`가 바뀜 | medium, 미룸 | 이번 이전부터 있던 문제(B1은 화면이 바뀐 경우만). deferred-work |
| `saveNow` B1·백업 버튼 자동 시험 없음 | medium, 미룸 | app.js 시험 틀 없음. deferred-work, 실제 확인으로 대신 |

## Verification

**Commands:**
- `npm test`, `npm run check` -- expected: 성공

**Manual checks:**
- 이 작업 폴더에는 `.dev.vars`가 없어 실제 로그인·백업 버튼 확인은 메인 세션(main 폴더)에서 한다.
- PR 설명에 Merge 전 실행할 원격 명령 한 줄(ASCII): `npx wrangler d1 execute broadcasting-db --remote --command "CREATE TABLE IF NOT EXISTS login_fails (key TEXT NOT NULL, at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS idx_login_fails_key ON login_fails (key, at);"`
