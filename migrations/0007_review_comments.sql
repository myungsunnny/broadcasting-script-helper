-- 검토 댓글: 선생님이 대본의 구성(인사말, 학교 행사 ...)마다 남기는 의견과 학생의 '반영했어요' 기록.
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
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
