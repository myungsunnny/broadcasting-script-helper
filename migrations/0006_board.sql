-- 게시판: 선생님 공지와 부원 메모, 그리고 학생이 공지를 읽었는지 기록한다.
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
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
