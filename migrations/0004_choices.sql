-- 대본에 넣을 행사·계기교육 주제 선택을 대본마다 저장한다. (JSON: { "events": [{date, weekday, text}], "special": "주제" })
-- 이미 만들어진 데이터베이스에 한 번만 실행한다. (새로 설치할 때는 schema.sql에 이미 들어 있음)
ALTER TABLE scripts ADD COLUMN choices TEXT NOT NULL DEFAULT '{}';
