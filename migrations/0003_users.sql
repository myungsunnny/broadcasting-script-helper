-- 학생 개인 계정. 선생님이 만들고 관리한다. (선생님은 TEACHER_PASSWORD 비밀값으로 로그인)
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
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
