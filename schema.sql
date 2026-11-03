-- 방송 대본
CREATE TABLE IF NOT EXISTS scripts (
  id             TEXT PRIMARY KEY,
  broadcast_date TEXT NOT NULL,          -- 방송일 YYYY-MM-DD
  title          TEXT NOT NULL DEFAULT '',
  announcers     TEXT NOT NULL DEFAULT '', -- 아나운서 이름 (쉼표로 구분)
  announcer_count INTEGER NOT NULL DEFAULT 1, -- 아나운서 수 (1 또는 2)
  status         TEXT NOT NULL DEFAULT '작성중', -- 작성중 / 검토요청 / 완료
  greeting       TEXT NOT NULL DEFAULT '', -- ① 인사말
  events         TEXT NOT NULL DEFAULT '', -- ② 다음 주 학교 행사
  idiom          TEXT NOT NULL DEFAULT '', -- ③ 사자성어
  special        TEXT NOT NULL DEFAULT '', -- ④ 계기교육
  closing        TEXT NOT NULL DEFAULT '', -- ⑤ 마무리 인사
  memo           TEXT NOT NULL DEFAULT '', -- 선생님/부원 메모 (방송에서 읽지 않음)
  choices        TEXT NOT NULL DEFAULT '{}', -- 고른 행사·계기교육 주제 (JSON)
  created_by     TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL DEFAULT '',
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scripts_date ON scripts (broadcast_date DESC);

-- 저장할 때마다 이전 내용을 남겨 두는 수정 기록
CREATE TABLE IF NOT EXISTS script_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  script_id TEXT NOT NULL,
  snapshot  TEXT NOT NULL,  -- 저장 직전 대본 전체(JSON)
  saved_by  TEXT NOT NULL,
  saved_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_script ON script_history (script_id, id DESC);

-- 학생 개인 계정 (선생님이 관리)
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  login_id      TEXT NOT NULL UNIQUE,      -- 로그인 아이디 (기본은 이름)
  name          TEXT NOT NULL,             -- 화면·대본에 표시되는 이름
  password_hash TEXT NOT NULL,             -- pbkdf2$반복$소금$해시
  must_change   INTEGER NOT NULL DEFAULT 1, -- 1이면 다음 로그인 때 비밀번호를 바꿔야 함
  active        INTEGER NOT NULL DEFAULT 1, -- 0이면 로그인 불가(사용 중지)
  created_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- 방송부 일정 캘린더
CREATE TABLE IF NOT EXISTS calendar_events (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,              -- YYYY-MM-DD
  time       TEXT NOT NULL DEFAULT '',   -- HH:MM (비우면 하루 종일)
  title      TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '', -- 방송 / 연습 / 회의 / 기타 (서버가 늘 채움)
  members    TEXT NOT NULL DEFAULT '[]', -- 함께하는 부원 이름 (JSON 배열)
  note       TEXT NOT NULL DEFAULT '',   -- 할 일·준비물
  record     TEXT NOT NULL DEFAULT '',   -- 끝난 뒤 남기는 기록
  created_by TEXT NOT NULL,
  created_by_uid TEXT NOT NULL DEFAULT '', -- 만든 학생 계정 id (선생님은 빈칸)
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events (date);

-- 게시판: 선생님 공지와 부원 메모, 공지 읽음 기록
CREATE TABLE IF NOT EXISTS posts (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL,              -- 'notice'(교사만) / 'memo'(누구나)
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0, -- 공지만 1 가능
  created_by TEXT NOT NULL,
  created_by_uid TEXT NOT NULL DEFAULT '', -- 쓴 학생 계정 id (선생님은 빈칸)
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
