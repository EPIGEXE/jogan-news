// SQLite 스키마. PRAGMA user_version으로 버전을 관리하고, 마이그레이션은 앞에서부터 차례로 적용한다.
// 이미 배포된 마이그레이션은 고치지 말고 새 항목을 뒤에 추가한다.

export const MIGRATIONS: string[] = [
  /* 1: 1단계 MVP */ `
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    url_key TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    title_norm TEXT NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    lang TEXT,
    published_at TEXT,
    collected_at TEXT NOT NULL,
    engagement INTEGER NOT NULL DEFAULT 0,
    engagement_label TEXT,
    other_sources TEXT NOT NULL DEFAULT '[]',
    triage_category TEXT,
    triage_relevance REAL,
    triage_importance INTEGER,
    triaged_at TEXT,
    title_ko TEXT,
    summary_ko TEXT,
    key_points TEXT,
    summary_model TEXT,
    summarized_at TEXT
  );
  CREATE INDEX items_collected ON items(collected_at);
  CREATE INDEX items_title_norm ON items(title_norm);

  CREATE TABLE contents (
    item_id INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    paragraphs TEXT NOT NULL,
    full_text INTEGER NOT NULL,
    extracted_at TEXT NOT NULL
  );

  CREATE TABLE digests (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL UNIQUE,
    headline TEXT NOT NULL,
    overview TEXT,
    stats TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE digest_entries (
    digest_id INTEGER NOT NULL REFERENCES digests(id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES items(id),
    rank INTEGER NOT NULL,
    section TEXT NOT NULL,
    why_it_matters TEXT,
    PRIMARY KEY (digest_id, item_id)
  );
  CREATE INDEX digest_entries_item ON digest_entries(item_id);

  CREATE TABLE saves (
    item_id INTEGER PRIMARY KEY REFERENCES items(id),
    saved_at TEXT NOT NULL
  );

  CREATE TABLE notes (
    item_id INTEGER PRIMARY KEY REFERENCES items(id),
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE reads (
    item_id INTEGER PRIMARY KEY REFERENCES items(id),
    read_at TEXT NOT NULL
  );

  CREATE TABLE runs (
    id INTEGER PRIMARY KEY,
    reason TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    since TEXT NOT NULL,
    error TEXT,
    stats TEXT
  );

  CREATE TABLE llm_usage (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    run_id INTEGER,
    role TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    cached_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    reasoning_tokens INTEGER NOT NULL,
    latency_ms INTEGER NOT NULL,
    cost_usd REAL NOT NULL
  );
  CREATE INDEX llm_usage_at ON llm_usage(at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  /* 2: 같은 소식 묶기 — 대표 기사가 아닌 항목은 merged_into에 대표 id를 둔다 */ `
  ALTER TABLE items ADD COLUMN merged_into INTEGER REFERENCES items(id);
  `,
  /* 3: "왜 중요한가"를 기사별 요약 단계에서 함께 만든다 */ `
  ALTER TABLE items ADD COLUMN why_ko TEXT;
  `,
  /* 4: 3단계 — 태그, 전문 검색 */ `
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
  CREATE TABLE item_tags (
    item_id INTEGER NOT NULL REFERENCES items(id),
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    source TEXT NOT NULL,           -- auto: AI 추천, user: 직접 입력
    PRIMARY KEY (item_id, tag_id)
  );
  CREATE INDEX item_tags_tag ON item_tags(tag_id);
  ALTER TABLE saves ADD COLUMN enriched_at TEXT;  -- 저장 후 본문 추출·태그 추천을 마친 시각

  -- 전문 검색: rowid = items.id. trigram이라 한국어도 3글자 이상 부분 일치로 찾는다 (2글자는 LIKE로 보완)
  CREATE VIRTUAL TABLE search_fts USING fts5(title, body, memo, tokenize = 'trigram');
  INSERT INTO search_fts (rowid, title, body, memo)
    SELECT i.id,
           i.title || ' ' || coalesce(i.title_ko, ''),
           coalesce(i.summary_ko, '') || ' ' || coalesce(i.snippet, '') || ' ' ||
             coalesce((SELECT group_concat(value, ' ') FROM json_each(c.paragraphs)), ''),
           coalesce(n.body, '')
    FROM items i
    LEFT JOIN contents c ON c.item_id = i.id
    LEFT JOIN notes n ON n.item_id = i.id;
  `,
  /* 5: 4단계 — AI 질문 대화. scope_key: 'item:<기사 id>' 또는 'digest:<날짜>' */ `
  CREATE TABLE chats (
    id INTEGER PRIMARY KEY,
    scope_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE chat_messages (
    id INTEGER PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations TEXT NOT NULL DEFAULT '[]',
    model TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX chat_messages_chat ON chat_messages(chat_id, id);
  `,
  /* 6: 본문 문단별 한국어 번역, '에이전트·툴링' 분류를 '도구·라이브러리'와 '실전·응용'으로 나눔 */ `
  ALTER TABLE contents ADD COLUMN paragraphs_ko TEXT;   -- JSON 배열, paragraphs와 같은 길이. 번역하지 않은 문단은 null
  ALTER TABLE contents ADD COLUMN translated_at TEXT;
  ALTER TABLE contents ADD COLUMN translate_model TEXT;
  UPDATE items SET triage_category = 'tools' WHERE triage_category = 'agent_tooling';
  UPDATE digest_entries SET section = 'tools' WHERE section = 'agent_tooling';
  `,
  /* 7: 하이라이트, 지난 브리핑 소식의 후속 보도 표시 */ `
  CREATE TABLE highlights (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id),
    paragraph INTEGER NOT NULL,        -- ¶ 번호 (1부터)
    variant TEXT NOT NULL,             -- ko: 번역문에 그음, original: 원문에 그음
    start_offset INTEGER NOT NULL,     -- 문단 글자 안의 위치 [start, end)
    end_offset INTEGER NOT NULL,
    text TEXT NOT NULL,                -- 그은 글자 (본문이 바뀌어도 다시 찾을 수 있게 보관)
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX highlights_item ON highlights(item_id, paragraph);
  ALTER TABLE items ADD COLUMN follow_up_of INTEGER REFERENCES items(id);  -- 지난 7일 브리핑 기사의 후속 소식이면 그 기사
  `
]
