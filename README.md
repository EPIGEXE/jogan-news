# Jogan

LLM·에이전트 소식을 매일 모아 한국어로 요약·번역해 주는 Windows 상주형 데스크톱 앱.

문서: [Jogan 문서](docs/README.md) (개요 · 아키텍처 · DB 구조 · 주요 흐름) · 설계 기록 [DESIGN.md](DESIGN.md)

현재 상태: **정한 범위 완료 (0.3.0)** — 매일 브리핑(수집 → 선별 → 요약 → 본문 번역), 낮 동안 미리 수집, 지난 7일 중복 방지, 저장·메모·태그·하이라이트, 라이브러리·아카이브 검색, AI 질문(문단 인용), 자동 실행, 설치 파일

## 설치해서 쓰기

```sh
npm install
npm run dist     # → dist/Jogan-Setup-<버전>.exe
```

1. `dist/Jogan-Setup-<버전>.exe`를 실행해 설치합니다. 서명하지 않은 설치 파일이라 Windows가 "PC 보호" 경고를 띄우면 **추가 정보 → 실행**을 누릅니다. 관리자 권한 없이 사용자 폴더에 설치됩니다.
2. 처음 실행하면 **설정**에서 Groq API 키를 입력합니다. 설치판은 `.env`를 읽지 않고, 입력한 키를 Windows 계정으로 암호화해 저장합니다.
3. 설정에서 **Windows 시작 시 실행**을 켭니다. 이후로는 로그인하면 창 없이 트레이에서 시작하고, 하루 한 번 브리핑을 만들어 알림을 띄웁니다.
4. 업데이트는 코드를 고친 뒤 다시 `npm run dist`로 만든 설치 파일을 덮어 설치하면 됩니다. 저장한 기사·메모·설정은 그대로 남습니다(제거해도 데이터는 남김).

사용법:
- 창을 닫아도 트레이에 남습니다. 완전히 끄려면 트레이 메뉴 → 종료.
- 오늘 브리핑이 아직 없으면 트레이 메뉴 "지금 브리핑 만들기"나 화면의 "오늘 브리핑 만들기"로 바로 만들 수 있습니다. 같은 날 다시 만들기는 없습니다(결과가 거의 같고, 낮 동안 쌓인 글은 다음 날 브리핑에 들어감).
- 단축키: `Ctrl+Alt+N` 창 열기 · 목록에서 `J`/`K` 이동, `Enter` 기사 읽기, `S` 저장, `O` 원문 · 읽기 화면에서 `Esc` 목록으로, `M` 메모, `/` 질문, `T` 본문 한국어·원문·함께 보기, `H` 드래그한 문장 하이라이트 · `?` 단축키 안내
- 기사 읽기 화면의 질문 단에서 기사 본문을 근거로 질문할 수 있습니다. 답변의 ¶번호를 누르면 본문의 그 문단으로 갑니다. 메뉴의 "질문"에서는 오늘 브리핑 전체에 질문합니다.
- 기사를 저장하면 원문 본문을 보관하고 태그를 추천합니다. 라이브러리에서 제목·요약·본문·번역·메모·하이라이트로 검색할 수 있습니다.
- 본문 문장을 드래그하면 하이라이트(H)하거나 그 문장으로 질문할 수 있습니다. 하이라이트에 마우스를 올리면 메모 카드가 뜹니다.
- 오른쪽 기사 패널과 읽기 화면의 옆 단은 경계선을 끌어 너비를 바꿉니다(두 번 누르면 기본 너비).
- 메뉴의 "출처"에서 출처별로 얼마나 받아서 얼마나 실리는지, 수집이 잘 되는지 볼 수 있습니다.
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

- 화면 코드는 `src/renderer/src/`의 `app/`(틀·전역) · `screens/`(화면별 `page.tsx`) · `domains/`(기사·브리핑·하이라이트·질문) · `common/`(공용 부품)으로 나누고, import는 `@/` 별칭으로 씁니다.
- 스타일은 Tailwind v4. 색·크기는 `src/renderer/src/app/styles/tokens.css`(@theme)에 있는 토큰 유틸리티만 씁니다(`bg-paper`, `text-ink-muted` …). 임의 값(`bg-[#fff]`)이나 색을 직접 쓰지 않습니다.
- 화면 확인용 스크린샷(개발 모드만): `AINEWS_USER_DATA=<폴더> AINEWS_SCREENSHOT=<파일.png> AINEWS_ROUTE=today npx electron .` — `AINEWS_SIZE=1920x1050`(창 크기), `AINEWS_KEYS=Enter,j,wheel:800,click:X:Y,move:X:Y,drag:X1:Y:X2`(키·마우스 동작)를 더할 수 있습니다.
- `npm run dev`가 `does not provide an export named 'BrowserWindow'`로 실패하면, 터미널에 `ELECTRON_RUN_AS_NODE` 환경 변수가 켜져 있는 것입니다. 일반 터미널에서 실행하세요.

## 설정 파일

| 파일 | 내용 |
|---|---|
| `config/sources.yaml` | 수집 소스, 가중치, 켜기/끄기, GitHub 릴리스 감시 목록 |
| `config/interests.yaml` | 관심 키워드 (1차 거르기 점수) |
| `config/models.yaml` | 역할별 Groq 모델 |
| `config/pricing.yaml` | 모델 단가 (비용 계산) |
| `config/quick-actions.yaml` | 질문 탭의 빠른 질문 버튼 |
| `config/prompts/*.md` | 선별·묶기·지난 7일 중복 확인·요약·번역·머리글·태그·질문 프롬프트 |
