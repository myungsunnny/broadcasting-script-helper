# 아키텍처: 데이터·API·권한

기존 구조(`src/index.js` 라우터 + 기능별 모듈, `public/` 한 페이지 앱, D1)를 그대로 늘린다. 새 기능마다 `src/<기능>.js` 모듈 하나와 자체 오류 클래스(기존 `CalendarError` 패턴)를 두고 `index.js`에서 경로만 연결한다.

## 1. 공통 규칙

| 항목 | 규칙 |
|---|---|
| id | `crypto.randomUUID().slice(0, 8)` (기존과 동일) |
| 시각 | `nowKST()` 문자열, 날짜 `todayKST()` (`src/dates.js`) |
| 작성자 | `*_by` = 표시 이름, `*_uid` = 학생 계정 id(교사는 빈칸) — `calendar_events.created_by_uid` 패턴 |
| 글자 수 | 서버에서 자름: 제목 60, 본문 2000, 댓글 1000 |
| 권한 | 서버가 `user.role`·`user.uid`로 확인. 화면 숨김은 보조 |
| 교사 식별 | 교사 쿠키에는 uid 없음 → 교사 대상 데이터는 수신자 `'teacher'`(교사 공용) |
| '내 대본' | `created_by = 내 이름` OR `announcers`(쉼표 구분)에 내 이름 포함. 서버 함수 `isMyScript(script, user)` 하나로 통일 |
| 화면 | 새 화면 = `index.html`의 `<section id="…View">` + `app.js`의 `showX()` + `route()` 분기 |
| 마이그레이션 | 스토리마다 `migrations/000N_*.sql` + `schema.sql` 같은 내용 추가. `CREATE TABLE IF NOT EXISTS` 사용. 기존 표 변경 금지(추가만) |

## 2. 화면 주소 (CAP-1)

`route()`의 검사 순서: `help` → 로그인 → 비밀번호 변경 강제 → `accounts`(교사) → `calendar` → `board`(+`post`) → `inbox` → `practice` → `scripts` → `new` → `id` → **기본 = 홈(대시보드)**.

기존 `?id=`, `?new`, `?calendar&date=`, `?help`, `?accounts`는 그대로 동작한다. 기존 대본 목록(`listView`)은 `?scripts`로 옮기고, 홈은 새 `homeView`.

## 3. 데이터 표

### 0006 게시판 (`migrations/0006_board.sql`) — 스토리 3

```sql
CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,              -- 'notice'(교사만) / 'memo'(누구나)
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0, -- 공지만 1 가능
  created_by TEXT NOT NULL,
  created_by_uid TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_list ON posts (pinned DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS post_reads (   -- 공지 읽음 (학생만)
  post_id  TEXT NOT NULL,
  user_uid TEXT NOT NULL,
  read_at  TEXT NOT NULL,
  PRIMARY KEY (post_id, user_uid)
);
```

- 고정 공지는 최대 3개. 4번째를 고정하면 서버가 400 + "고정 공지는 3개까지예요."
- 공지를 지우면 `post_reads`도 같은 batch에서 지운다. 학생 계정을 지우면(`deleteUser`) 그 학생의 `post_reads`도 지운다.
- 읽음 확인 명단 = `users WHERE active = 1` 중 `post_reads`에 있는/없는 학생.

### 0007 검토 댓글 (`migrations/0007_review_comments.sql`) — 스토리 4

```sql
CREATE TABLE IF NOT EXISTS script_comments (
  id          TEXT PRIMARY KEY,
  script_id   TEXT NOT NULL,
  section     TEXT NOT NULL,           -- greeting / events / idiom / special / closing
  body        TEXT NOT NULL,
  created_by  TEXT NOT NULL,           -- 교사 이름
  created_at  TEXT NOT NULL,
  resolved_by TEXT NOT NULL DEFAULT '', -- '반영함' 누른 학생 이름 (빈칸 = 아직)
  resolved_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_comments_script ON script_comments (script_id, created_at);
```

- 대본 삭제(`deleteScript`) batch에 `DELETE FROM script_comments WHERE script_id = ?` 추가.
- '반영함'은 완료된 대본에서도 막지 않는다(댓글 기록만 바뀜, 대본 본문은 그대로).

### 0008 알림 (`migrations/0008_notifications.sql`) — 스토리 5

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient  TEXT NOT NULL,     -- 학생 uid 또는 'teacher'
  kind       TEXT NOT NULL,     -- notice / comment / done / calendar / review
  ref_id     TEXT NOT NULL,     -- 공지 id, 대본 id, 일정 id
  ref_date   TEXT NOT NULL DEFAULT '', -- 캘린더 이동용 날짜
  text       TEXT NOT NULL,     -- 화면에 보일 한 줄
  created_at TEXT NOT NULL,
  read_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications (recipient, read_at, id DESC);
```

- 알림은 원인 동작(공지 작성, 댓글 작성, 상태 변경, 일정 저장)과 **같은 `env.DB.batch`** 로 넣는다.
- 받는 학생 찾기: 공지 → `users WHERE active = 1`, 대본 관련 → 사용 중인 학생 중 `isMyScript`, 일정 → 새로 추가된 `members` 이름과 같은 이름의 사용 중인 학생(본인 제외).
- 교사 공용 알림(`'teacher'`)의 읽음은 교사 누구나 처리 — 교사가 여러 명이어도 함께 읽음.
- 정리: 알림을 쓸 때 `DELETE FROM notifications WHERE created_at < (90일 전)`을 같은 batch에 붙인다. `post_reads`는 공지와 함께 남는다.
- `src/notify.js`에 `notifyStatements(env, {...})`(batch에 넣을 prepared statement 배열을 돌려줌)를 두어 다른 모듈이 호출한다.

### 0009 AI 사용량 (`migrations/0009_ai_usage.sql`) — 스토리 8

```sql
CREATE TABLE IF NOT EXISTS ai_usage (
  user_uid TEXT NOT NULL,
  day      TEXT NOT NULL,           -- KST YYYY-MM-DD
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_uid, day)
);
```

- 한도 = `env.AI_DAILY_LIMIT`(wrangler.jsonc `vars`, 공개 값) 숫자, 없으면 30. 교사는 세지 않는다.
- `/api/ai/section` 시작 시 `INSERT … ON CONFLICT(user_uid, day) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count` 로 원자적으로 하나 올리고, 행이 안 돌아오면 429 + "오늘 AI를 다 썼어요. 내일 다시 쓸 수 있어요."
- Gemini 호출이 실패(오류 응답)하면 같은 날 count를 1 되돌린다 — 학생 잘못이 아닌 실패로 횟수를 잃지 않게.
- `/api/me` 응답 `config`에 `aiLeft`(학생만) 추가, `/api/ai/section` 응답에도 `aiLeft` 포함.
- 7일 지난 행은 쓰기 때 함께 지운다.

## 4. API

기존 응답 형식(`json()`, 오류 `{ error }`)과 `HttpError`를 따른다. 모두 로그인 + 비밀번호 변경 완료가 필요(기존 가드 뒤에 둔다).

| 메서드·경로 | 누가 | 하는 일 | 스토리 |
|---|---|---|---|
| GET `/api/home` | 모두 | 첫 화면 묶음: `thisWeek`(다음 금요일 대본 요약), `todo[]`, `upcoming[]`(5), `notices[]`(고정+최근3, `unread`), 교사면 `reviewQueue[]` | 2 (공지·할 일 일부는 3·4 이후 채워짐) |
| GET `/api/posts?kind=&before=` | 모두 | 목록 20개씩, 학생에게는 공지별 `unread` | 3 |
| POST `/api/posts` | 공지=교사, 메모=모두 | 글 쓰기 | 3 |
| PUT `/api/posts/:id` | 쓴 사람(학생 uid 일치) 또는 교사가 쓴 공지는 교사 | 고치기 | 3 |
| DELETE `/api/posts/:id` | 쓴 사람, 교사 | 지우기 | 3 |
| POST `/api/posts/:id/read` | 학생 | 공지 읽음 기록(이미 있으면 그대로) | 3 |
| GET `/api/posts/:id/reads` | 교사 | `{ read: [이름], unread: [이름] }` | 3 |
| GET `/api/scripts/:id/comments` | 모두 | 댓글 목록 | 4 |
| POST `/api/scripts/:id/comments` | 교사 | `{ section, body }` | 4 |
| POST `/api/comments/:id/resolve` | 모두 | 반영함 표시 | 4 |
| DELETE `/api/comments/:id` | 교사 | 지우기 | 4 |
| GET `/api/inbox` | 모두 | 최근 50개 + `unread` 수 | 5 |
| GET `/api/inbox/count` | 모두 | `{ unread }` (메뉴 배지) | 5 |
| POST `/api/inbox/read` | 모두 | `{ id }` 하나 또는 `{ all: true }` | 5 |
| GET `/api/topics/used?date=` | 모두 | 그 방송일의 학년도에 쓴 `{ idioms: [{topic, date}], specials: [...] }` | 7 |

- 기존 `/api/scripts` 목록 응답에 `open_comments`(반영 안 된 댓글 수)를 더한다(스토리 4).
- 기존 `/api/calendar/upcoming`은 `limit` 3 → 5 (스토리 2).

## 5. 중복 방지 (CAP-7) — DB 변경 없음

- 학년도: 방송일이 3~12월이면 그해 3월 1일 ~ 이듬해 2월 말, 1~2월이면 전해 3월 1일 ~ 그해 2월 말. `src/dates.js`에 `schoolYearRange(date)`.
- 쓴 주제 = 학년도 안의 다른 대본의 `choices.idiom`, `choices.special`.
- **AI가 고른 주제도 기록**: `idiom`/`special` 생성 시 주제를 지정하지 않았으면 프롬프트에 "첫 줄에 `주제: …`만 쓰고 다음 줄부터 대본" 규칙을 추가하고, 서버가 첫 줄을 떼어 `{ text, topic }`으로 돌려준다. 화면은 `topic`을 `choices`에 넣어 저장한다. 첫 줄 형식이 틀리면 `topic` 없이 `text` 전체를 돌려준다(실패해도 대본은 쓰임).
- 주제를 지정하지 않은 생성 프롬프트에 "다음 사자성어/주제는 이미 썼으니 고르지 마: …"를 붙인다(최대 40개). 계기교육 후보(`specialCandidates`)에서는 이미 쓴 주제를 뺀다(후보가 하나도 안 남으면 빼지 않음).

## 6. 연습 모드 (CAP-6) — DB·API 변경 없음

`GET /api/scripts/:id`로 받은 대본을 화면에서만 처리. 2인 대사 구분은 기존 `formatSpeech()`의 "이름: 대사" 규칙을 재사용. 예상 시간은 기존 `CHARS_PER_SECOND`.

## 7. 스토리별 DB 변경 요약

| 스토리 | 마이그레이션 | 배포 승인 전 관리자 실행 |
|---|---|---|
| 1 메뉴 개편 | 없음 | - |
| 2 첫 화면 | 없음 | - |
| 3 게시판 | `0006_board.sql` | 필요 |
| 4 검토 댓글 | `0007_review_comments.sql` | 필요 |
| 5 알림 | `0008_notifications.sql` | 필요 |
| 6 연습 모드 | 없음 | - |
| 7 중복 방지 | 없음 | - |
| 8 AI 사용량 | `0009_ai_usage.sql` (+ `wrangler.jsonc` `vars.AI_DAILY_LIMIT`) | 필요 |

실행 명령 예: `npx wrangler d1 execute broadcasting-db --remote --file=./migrations/0006_board.sql` (CONTRIBUTING.md 참고). 스토리 순서를 바꾸면 번호는 실제로 만드는 순서대로 매긴다.
