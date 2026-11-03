-- 알림: 새 공지, 선생님 의견, 대본 완료, 나를 넣은 일정, 검토 요청을 받는 사람마다 한 줄씩 모아 둔다.
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient  TEXT NOT NULL,     -- 학생 uid 또는 'teacher'(선생님 공용)
  kind       TEXT NOT NULL,     -- notice / comment / done / calendar / review
  ref_id     TEXT NOT NULL,     -- 공지 id, 대본 id, 일정 id
  ref_date   TEXT NOT NULL DEFAULT '', -- 이동 보조값: 일정은 날짜, 의견은 구성 키
  text       TEXT NOT NULL,     -- 화면에 보일 한 줄
  created_at TEXT NOT NULL,
  read_at    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_notif_recipient ON notifications (recipient, read_at, id DESC);
