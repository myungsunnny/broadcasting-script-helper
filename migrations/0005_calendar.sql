-- 방송부 일정 캘린더. 부원 모두가 함께 일정을 넣고, 지난 일정에는 기록을 남긴다.
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
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
