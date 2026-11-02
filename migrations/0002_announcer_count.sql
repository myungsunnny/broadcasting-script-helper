-- 아나운서 수(1명 또는 2명)를 대본마다 저장한다.
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
ALTER TABLE scripts ADD COLUMN announcer_count INTEGER NOT NULL DEFAULT 1;
