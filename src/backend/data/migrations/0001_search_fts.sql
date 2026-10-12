-- 전문 검색 색인 (직접 쓴 SQL: FTS5 가상 테이블은 Drizzle 스키마로 표현할 수 없음)
-- rowid = items.id. trigram이라 한국어도 3글자 이상 부분 일치로 찾음 (2글자는 LIKE로 보완)
CREATE VIRTUAL TABLE `search_fts` USING fts5(title, body, memo, tokenize = 'trigram');
