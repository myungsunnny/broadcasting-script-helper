-- 로그인 실패 기록: 아이디(id:<아이디>)·인터넷 주소(ip:<주소>)마다 최근 10분 실패를 세서 너무 많으면 잠깐 막는다.
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
CREATE TABLE IF NOT EXISTS login_fails (
  key TEXT NOT NULL,     -- 'id:<아이디>' 또는 'ip:<주소>'
  at  INTEGER NOT NULL   -- 실패한 때 (Date.now() 밀리초)
);
CREATE INDEX IF NOT EXISTS idx_login_fails_key ON login_fails (key, at);
