# AI 브리핑

LLM·에이전트 소식을 매일 모아 한국어로 요약해 주는 Windows 상주형 데스크톱 앱.

문서: [개요](docs/01-overview.md) · [아키텍처](docs/02-architecture.md) · [DB 구조](docs/03-database.md) · [주요 흐름](docs/04-business-flows.md) · 설계 기록 [DESIGN.md](DESIGN.md)

현재 단계: **3단계 완료** — 매일 브리핑(수집 → 선별 → 요약), 저장·메모·태그, 라이브러리·아카이브 검색, 자동 실행

## 준비

```sh
npm install
cp .env.example .env   # 개발 중에는 여기의 GROQ_API_KEY를 읽음 (앱 설정 화면에서 입력해도 됨)
```

## 실행

```sh
npm run dev        # 개발 모드 (화면 수정이 바로 반영됨)
npm run build      # out/ 빌드
npm start          # 빌드한 앱 실행
```

- 창을 닫아도 트레이에 남습니다. 완전히 끄려면 트레이 메뉴 → 종료.
- 브리핑은 로그인·잠금 해제 시(5시 이후) 또는 켜둔 채 오전 8시에 하루 한 번 자동으로 만들어집니다. 트레이 메뉴나 화면의 "다시 만들기"로 바로 만들 수도 있습니다.
- 단축키: `Ctrl+Alt+N` 창 열기 · 목록에서 `J`/`K` 이동, `S` 저장, `M` 메모, `Enter` 원문 (오늘·라이브러리·아카이브 공통)
- 기사를 저장하면 원문 본문을 보관하고 태그를 추천합니다. 라이브러리에서 제목·요약·본문·메모로 검색할 수 있습니다.
- 데이터: `%APPDATA%\AINews\` (ainews.db, diagnostics.log, 암호화된 API 키)

## 개발 도구

```sh
npm run typecheck
npm test
```

- 스타일은 Tailwind v4. 색·크기는 `src/renderer/src/styles/tokens.css`(@theme)에 있는 토큰 유틸리티만 씁니다(`bg-paper`, `text-ink-muted` …). 임의 값(`bg-[#fff]`)이나 색을 직접 쓰지 않습니다.
- 개발 모드에서는 메뉴 하단 "부품 견본"에서 컴포넌트 상태별 모습을 볼 수 있습니다.
- 화면 확인용 스크린샷(개발 모드만): `AINEWS_USER_DATA=<폴더> AINEWS_SCREENSHOT=<파일.png> AINEWS_ROUTE=today npx electron .`
- `npm run dev`가 `does not provide an export named 'BrowserWindow'`로 실패하면, 터미널에 `ELECTRON_RUN_AS_NODE` 환경 변수가 켜져 있는 것입니다. 일반 터미널에서 실행하세요.

## 설정 파일

| 파일 | 내용 |
|---|---|
| `config/sources.yaml` | 수집 소스, 가중치, 켜기/끄기 |
| `config/interests.yaml` | 관심 키워드 (1차 거르기 점수) |
| `config/models.yaml` | 역할별 Groq 모델 |
| `config/pricing.yaml` | 모델 단가 (비용 계산) |
| `config/prompts/*.md` | 선별·묶기·요약·머리글 프롬프트 |
