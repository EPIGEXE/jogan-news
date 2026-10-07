# AI 브리핑

LLM·에이전트 소식을 매일 모아 한국어로 요약해 주는 Windows 상주형 데스크톱 앱.

문서: [개요](docs/01-overview.md) · [아키텍처](docs/02-architecture.md) · [DB 구조](docs/03-database.md) · [주요 흐름](docs/04-business-flows.md) · 설계 기록 [DESIGN.md](DESIGN.md)

현재 단계: **3단계 완료 · 설치 파일 지원** — 매일 브리핑(수집 → 선별 → 요약), 저장·메모·태그, 라이브러리·아카이브 검색, 자동 실행

## 설치해서 쓰기

```sh
npm install
npm run dist     # → dist/AINews-Setup-<버전>.exe
```

1. `dist/AINews-Setup-<버전>.exe`를 실행해 설치합니다. 서명하지 않은 설치 파일이라 Windows가 "PC 보호" 경고를 띄우면 **추가 정보 → 실행**을 누릅니다. 관리자 권한 없이 사용자 폴더에 설치됩니다.
2. 처음 실행하면 **설정**에서 Groq API 키를 입력합니다. 설치판은 `.env`를 읽지 않고, 입력한 키를 Windows 계정으로 암호화해 저장합니다.
3. 설정에서 **Windows 시작 시 실행**을 켭니다. 이후로는 로그인하면 창 없이 트레이에서 시작하고, 하루 한 번 브리핑을 만들어 알림을 띄웁니다.
4. 업데이트는 코드를 고친 뒤 다시 `npm run dist`로 만든 설치 파일을 덮어 설치하면 됩니다. 저장한 기사·메모·설정은 그대로 남습니다(제거해도 데이터는 남김).

사용법:
- 창을 닫아도 트레이에 남습니다. 완전히 끄려면 트레이 메뉴 → 종료.
- 트레이 메뉴의 "지금 새로고침"이나 화면의 "다시 만들기"로 바로 만들 수 있습니다.
- 단축키: `Ctrl+Alt+N` 창 열기 · 목록에서 `J`/`K` 이동, `S` 저장, `M` 메모, `Enter` 원문 (오늘·라이브러리·아카이브 공통)
- 기사를 저장하면 원문 본문을 보관하고 태그를 추천합니다. 라이브러리에서 제목·요약·본문·메모로 검색할 수 있습니다.
- 데이터: `%APPDATA%\AINews\` (ainews.db, diagnostics.log, 암호화된 API 키). 개발 모드와 설치판이 같은 폴더를 씁니다.

## 개발 모드로 실행

```sh
cp .env.example .env   # 개발 중에는 여기의 GROQ_API_KEY를 읽음
npm run dev            # 화면 수정이 바로 반영됨
```

- 개발 모드에서 자동 시작을 켰다면 설치판을 쓰기 전에 꺼 두세요. 개발 모드의 자동 시작은 이 프로젝트 폴더의 Electron을 가리킵니다.

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
