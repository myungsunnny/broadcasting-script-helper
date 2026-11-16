-- AI 사용량: 학생마다 한국 시간 하루에 AI 구성 요청을 몇 번 썼는지 센다. (선생님은 세지 않음)
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
CREATE TABLE IF NOT EXISTS ai_usage (
  user_uid TEXT NOT NULL,           -- 학생 계정 id
  day      TEXT NOT NULL,           -- KST YYYY-MM-DD
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_uid, day)
);
