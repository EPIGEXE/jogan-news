# AI 데일리 브리핑 시스템 설계안

> 작성일: 2026-10-07 · 상태: v4 확정 (Electron + Groq, 월 예산 $5, 저장·메모 우선) · **1·3·4단계 구현 완료(브리핑, 저장·메모, AI 질문), Windows 설치 파일 지원**

## 0. 확정 사항

| 항목 | 결정 |
|---|---|
| 형태 | **Electron 상주형 데스크톱 앱**: 트레이 아이콘 + 앱 창 |
| 언어 | **TypeScript 하나로** 화면과 백엔드를 모두 작성 |
| LLM | **Groq 유료 플랜** (GPT-OSS 20B / 120B, 역할별로 나눠 씀) |
| 월 예산 | **$5** (도달하면 절약 모드. 80% 경고는 구현하지 않음) |
| 실행 시점 | 로그인하거나 잠금을 해제할 때(새벽 5시 이후) 오늘 브리핑이 없으면 생성. PC를 켜둔 경우에는 오전 8시에 생성 |
| 전달 방식 | 알림 → 클릭하면 앱 창에서 오늘 브리핑을 엶 |
| 실행 환경 | 로컬 PC (Windows) |
| 관심 분야 | **LLM·에이전트 중심** (그 외 분야는 큰 소식만) |
| 언어 표기 | 한국어 요약 + 원제 함께 표기 |
| 확장 기능 | 기사 저장, 메모, 하이라이트, 기사·브리핑 내용을 바탕으로 AI에게 질문 (**저장·메모를 AI 질문보다 먼저** 개발). 내보내기·라이브러리 RAG·개인화는 구현하지 않음(13.6절) |

## 1. 목표

매일 아침 AI 소식을 추려서 받아보는 데서 끝나지 않고, **쓸만한 기사를 쌓아두고 다시 꺼내 쓰는 개인 AI 지식 저장소**로 키웁니다.

```
 수집·브리핑  ──►  읽기  ──►  저장·메모·하이라이트  ──►  AI와 질문·정리  ──►  다시 찾기
 (매일 자동)     (앱 창)    (라이브러리)            (기사, 오늘 브리핑)     (검색, 태그, 아카이브)
```

처음 설계에는 저장·읽음·👍👎 기록을 다음 브리핑 점수에 반영하는 개인화가 있었지만 구현하지 않았습니다(6.5절, 13.6절).

핵심 원칙:
- **양보다 질:** 수집한 글 가운데 규칙 점수 상위 120건만 LLM으로 선별하고, 그중 20건(기본값)만 브리핑에 싣습니다.
- **근거 있는 요약과 답변:** 모든 항목에 원문 링크를 붙입니다. AI 답변에는 본문의 어느 문단을 근거로 했는지 번호로 표시합니다.
- **로컬 우선:** 데이터는 내 PC의 SQLite에 저장합니다. 외부로 나가는 것은 수집 요청, 기사 원문 페이지 요청, Groq API 호출뿐입니다.
- **빠른 준비:** 로그인 후 **3분 안에** 알림이 뜨는 것을 목표로 잡았습니다. Groq은 응답이 매우 빨라서 v3의 5분 목표보다 줄였습니다. 실제로 걸리는 시간을 재는 코드는 없습니다(4.4절).

## 2. 왜 Electron인가

v3까지는 Python으로 설계했지만, 상주형 데스크톱 앱에 필요한 기능이 Electron에는 대부분 기본으로 들어 있습니다.

| 필요한 기능 | Python 설계 (v3) | Electron (v4) |
|---|---|---|
| 트레이 아이콘 | `pystray` | `Tray` (내장) |
| 알림 + 클릭 처리 | `windows-toasts` | `Notification`의 `click` 이벤트 (내장) |
| 잠금 해제·절전 복귀 감지 | `pywin32` 숨김 창으로 직접 구현 | `powerMonitor`의 `unlock-screen`, `resume` 이벤트 (내장) |
| 로그인 시 자동 시작 | 레지스트리 직접 등록 | `app.setLoginItemSettings()` (내장) |
| 전역 단축키 | `keyboard` | `globalShortcut` (내장) |
| 앱 창 | `pywebview` | `BrowserWindow` (내장) |
| 화면 ↔ 백엔드 통신 | 로컬 HTTP 서버 + 접근 토큰 | **IPC** (서버 없음, 포트 없음) |
| 중복 실행 방지 | 락 파일 | `app.requestSingleInstanceLock()` (내장) |
| API 키 보관 | `.env` 평문 파일 | `safeStorage` (Windows 계정 단위 암호화). 개발 중에는 저장된 키가 없으면 프로젝트의 `.env`를 읽음 |
| 설치 파일 | PyInstaller | `electron-builder` (NSIS 설치 파일) |
| 사용 언어 | Python + TypeScript | **TypeScript 하나** |

단점:
- 메모리를 150~300MB 정도 씁니다.
- 설치 용량이 약 100MB입니다.
- 로컬 임베딩은 Python보다 선택지가 적습니다. 설계 때는 `transformers.js`를 쓰려고 했지만, 임베딩은 구현하지 않았습니다(같은 소식 묶기는 LLM 호출로 대신함, 13.1절·13.6절).

## 3. 프로세스 구조

```
┌──────────────────────────── Electron 앱 ─────────────────────────────┐
│                                                                      │
│  Main 프로세스 (앱의 두뇌, 가볍게 유지)                                   │
│   · Tray, Notification, globalShortcut, BrowserWindow 관리              │
│   · 트리거: 앱 시작, powerMonitor(unlock-screen/resume), 오전 8시 타이머, │
│     2시간마다 미리 수집 타이머                                            │
│   · 자동 시작 설정, 중복 실행 방지, safeStorage(API 키)                   │
│   · 사용자 데이터·화면용 조회는 DB에 직접, 무거운 일은 Worker에 맡김       │
│            │ utilityProcess 메시지               ▲ IPC (contextBridge) │
│            ▼                                     │                     │
│  Worker (utilityProcess, 별도 Node 프로세스)       Renderer (React UI)    │
│   · 수집기, 파이프라인, LLM 호출(Groq)            · 오늘 / 라이브러리 / 아카이브 │
│   · 본문 추출, 본문 번역, 태그 추천               · 질문 / 출처 / 설정 / 진단 │
│   · 기사·브리핑 테이블 쓰기 (DB 연결은 따로)     · preload의 타입 있는 API │
│   · 채팅 스트리밍 → Main을 거쳐 Renderer로 전달     로만 접근                 │
└──────────────────────────────────────────────────────────────────────┘
```

- **Worker를 분리하는 이유:** 수집, 본문 추출, LLM 호출 같은 무거운 작업이 Main 프로세스를 막으면 트레이와 창이 멈춥니다. `utilityProcess`로 떼어내면 Worker가 죽어도 Main이 3초 뒤 다시 띄울 수 있습니다(`src/main/platform/worker-client.ts`). 준비도 못 하고 연달아 3번 죽으면 다시 띄우지 않습니다(14절).
- **Main ↔ Worker 통신:** `MessagePort`를 따로 만들지 않고 utilityProcess의 메시지를 씁니다. Main은 `workerProcess.postMessage`, Worker는 `process.parentPort`로 주고받고, 요청마다 번호를 붙여 응답과 짝짓습니다. 규약은 `src/shared/worker-protocol.ts`에 있습니다.
- **DB 접근 (2026-10-12 변경, 13.13절):** DB 파일은 하나이고 Main과 Worker가 각자 연결을 엽니다(`better-sqlite3` + Drizzle ORM, FTS5). Main은 사용자 데이터(저장·메모·태그·하이라이트·설정·대화) 쓰기와 화면용 조회를, Worker는 기사·브리핑·실행 기록 쓰기를 맡습니다. 스키마 변경은 Main이 시작할 때 적용합니다.
- **보안:** Renderer는 `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`로 실행합니다. preload에서 노출한 함수만 쓸 수 있습니다. 기사 본문은 추출할 때 문단별 글자로만 보관하고 화면도 글자로 그리므로, 원문 HTML을 화면에 넣지 않습니다(HTML 정제 라이브러리는 쓰지 않음).
- **데이터 위치:** `%APPDATA%\AINews\`에 둡니다(`app.getPath('userData')`). 표시 이름을 Jogan으로 바꾼 뒤에도 이 폴더를 그대로 쓰도록 `src/main/index.ts`에서 고정합니다. DB(`ainews.db`), 진단 기록(`diagnostics.log`), 암호화한 API 키(`groq-key.bin`)가 여기에 저장됩니다.

### 3.1 Main 프로세스 계층

```
  들어오는 쪽   ipc/       화면 요청 → 서비스 호출만 (영역별: digest, library, chat, settings, diagnostics, window)
              triggers/  OS 이벤트(로그인·잠금 해제·절전 복귀·8시 타이머), 2시간마다 미리 수집 타이머 → 서비스 호출만
                  │
                  ▼
  서비스       services/  앱이 하는 일: BriefingService(생성 흐름), SettingsService(API 키·예산·자동 시작),
                         DigestService·SearchService·SourceStatsService(화면용 조회),
                         ArticleService·TagService·HighlightService·ChatService(사용자 데이터), DiagnosticsService
                         Electron을 import하지 않고, 바깥 기능은 services/ports.ts의 인터페이스로만,
                         DB는 src/backend/data/repositories의 저장소로만 쓴다
                  │ 포트
                  ▼
  나가는 쪽    platform/  포트 구현: 트레이, 창, 알림, 키 보관(safeStorage), 네트워크, Worker 클라이언트,
                         화면 방송, 자동 시작. 상태는 모듈 변수가 아니라 클래스 안에 둔다

  조립         index.ts   객체를 만들고 연결만 한다 (composition root)
  진단         diagnostics/  기록(DiagLog), 개발용 스크린샷
```

- 의존 방향: services/는 Electron과 다른 계층을 import하지 않고, ipc/·triggers/는 platform/을 직접 import하지 않으며(index.ts가 주입), platform/은 ipc/·triggers/를 import하지 않습니다.
- 서비스는 가짜 포트로 단위 테스트합니다 (예: 오프라인이면 파이프라인을 부르지 않음, 실패하면 실패 알림). DB를 쓰는 서비스는 메모리 DB에 실제 저장소를 붙이고 Worker와 화면 알림만 가짜로 대신합니다.

## 4. 실행 시점 설계

### 4.1 자동 시작
- 설정 화면의 **"Windows 시작 시 실행"** 토글로 켜고 끕니다. 내부적으로 `app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] })`를 호출합니다.
- `--hidden`으로 시작하면 창을 띄우지 않고 트레이에만 머뭅니다.
- 창을 닫으면 트레이로 숨고, 앱은 계속 실행됩니다. 완전히 끄려면 트레이 메뉴의 "종료"를 누릅니다.

### 4.2 브리핑 생성 조건

| 이벤트 | 다루는 상황 |
|---|---|
| 앱 시작 (1분 지연) | 아침에 PC를 켜고 로그인할 때 |
| `powerMonitor`: `unlock-screen` / `resume` | PC를 끄지 않고 잠금·절전 상태로 퇴근했을 때 |
| **오전 8시 타이머** | PC를 잠그지도 않고 켜둔 채 아침이 됐을 때 (시각은 `src/shared/schedule.ts`의 `DEFAULT_SCHEDULE`에 고정. 설정 화면에서 바꾸는 기능은 없음) |
| 트레이 메뉴 "지금 브리핑 만들기", 오늘 화면의 "오늘 브리핑 만들기" | 오늘 브리핑이 없을 때 바로 만들기 (있으면 만들지 않음. 트레이 메뉴는 오늘 화면을 엶) |

규칙:
- 모든 이벤트에서 같은 확인을 합니다. "오늘 브리핑이 아직 없으면 생성한다"는 규칙이라 하루에 한 번만 만들어집니다.
- 8시 전에 로그인하거나 잠금을 해제하면 일찍 출근한 것으로 보고 바로 생성합니다. 이 경우 그날 8시 타이머는 건너뜁니다.
- 단, **새벽 5시 전**의 로그인·잠금 해제는 전날 밤 작업으로 보고 생성하지 않습니다(이 시각도 `DEFAULT_SCHEDULE`에 고정). 자정을 넘겨 일하다 잠금을 해제했을 때 다음 날 브리핑이 새벽에 미리 만들어지는 것을 막기 위해서입니다.
- 8시 타이머는 다음 8시까지 남은 시간을 계산해서 그 시각에 한 번 깨어납니다. 절전 때문에 놓친 경우는 `resume` 이벤트에서 "8시가 지났는데 오늘 브리핑이 없나?"를 다시 확인해서 만듭니다.

생성 흐름:
```
이벤트 ─► 오늘 브리핑 있음? ── 예 ─► 종료
             │ 아니요
             ▼
        네트워크 확인 (net.isOnline() + Groq 서버에 실제 요청, 30초 간격으로 최대 5분)
             │                          └─ 실패 ─► 트레이 "오프라인", 다음 이벤트 때 재시도
             ▼
        트레이 아이콘 "생성 중"으로 변경
             ▼
        Worker에서 파이프라인 실행 (수집 구간 = 마지막 성공 이후, 최대 72시간)
             ▼
   성공 ─► 알림 (제목 "📰 Jogan · <날짜>", 내용 <오늘의 한 줄>) ─ 클릭 ─► 앱 창 + 오늘 화면
   실패 ─► 알림 "브리핑 생성 실패" (내용은 실패 이유) ─ 클릭 ─► 설정 화면
```

- 판단 규칙은 `src/shared/schedule.ts`의 `shouldGenerate`, 이벤트 감지는 `src/main/triggers/briefing-triggers.ts`, 생성 흐름은 `src/main/services/briefing-service.ts`, 알림 문구와 클릭 동작은 `src/main/platform/notifier.ts`에 있습니다.
- 실행 기록만 보여 주는 화면은 없습니다. 실패 알림을 누르면 설정 화면이 열리고, 트리거·알림·Worker 오류 기록은 설정 화면에서 여는 진단 화면에서 봅니다.
- 네트워크에 끝내 연결되지 않으면 알림을 띄우지 않고 트레이와 화면에만 표시합니다.
- 같은 날 다시 만들기는 없습니다(13.7절).

### 4.3 백그라운드 수집
- PC가 켜져 있는 동안 2시간마다 **수집만** 해서 DB에 쌓아둡니다. LLM은 호출하지 않습니다(`src/main/triggers/collect-timer.ts` → Worker의 `collectOnly`).
- 한 번에 최근 24시간 글을 받고, 이미 있는 글은 DB에서 거릅니다.
- 10분마다 "마지막 수집 후 2시간이 지났는지"를 확인합니다. 오프라인이거나 브리핑을 만드는 중이면 건너뜁니다.
- 아침 브리핑은 지난 실행 이후 쌓인 글을 후보로 쓰므로, 피드에서 금방 밀려나는 글(Reddit 인기글, GitHub 릴리스)도 놓치지 않습니다. 아침 실행도 수집 구간 전체를 다시 받으므로 수집 시간이 줄지는 않습니다.

### 4.4 시간 예산 (목표 3분 이내)

3분은 설계 때 잡은 목표입니다. 단계별 걸린 시간을 재거나 기록하는 코드는 없고, LLM 호출 한 번의 지연 시간만 `llm_usage.latency_ms`에 남습니다. 처음 설계의 단계별 예상 시간표는 임베딩 단계와 300건 선별·60건 요약을 가정한 것이라 지웠습니다. 지금 단계별로 시간을 정하는 조건은 아래와 같습니다.

| 단계 | 시간을 정하는 조건 |
|---|---|
| 네트워크 확인 | 바로 닿으면 기다리지 않음. 안 닿으면 30초 간격으로 최대 5분 |
| 수집 | 모든 소스를 동시에 요청. 요청 한 번의 제한 시간 15초 |
| 저장·중복 합치기 | DB 작업만 (LLM·임베딩 없음) |
| LLM 선별 (20B) | 최대 120건을 10건씩 묶어 호출. 같은 모델로는 동시에 4개까지 |
| 같은 소식 묶기·7일 중복 확인 (120B) | 묶기는 1차·2차 각 1회, 중복 확인 1회 |
| 본문 확인 | 선정한 기사의 원문 페이지를 동시에 요청. 요청 한 번의 제한 시간 15초 |
| 한국어 요약·본문 번역 (120B) | 선정한 기사(기본 20건)만. 같은 모델로는 동시에 4개까지 |
| 머리글 (120B) | 호출 1회 |

> 속도를 정하는 것은 Groq의 요청 제한과 동시 호출 수입니다. 7.4절을 보세요.

## 5. 알림과 앱 창

- **알림:** Electron `Notification`을 씁니다.
  - 제목: `📰 Jogan · 10/7(수)`
  - 본문: 오늘의 한 줄
  - 클릭하면 창을 띄우고 오늘 화면으로 이동합니다.
  - Windows에서 알림이 제대로 뜨려면 `app.setAppUserModelId()`를 설정해야 합니다(설치판과 개발 모드 모두).
- **앱 창 여는 방법:** 알림 클릭, 트레이 아이콘 클릭, 전역 단축키 `Ctrl+Alt+N`, 시작 메뉴 바로가기
- **트레이 아이콘 상태:** 대기 / 생성 중 / 새 브리핑(읽지 않음 표시) / 오프라인 / 오류

## 6. 화면과 지식 기능

### 6.1 화면 구성

| 화면 | 내용 |
|---|---|
| **오늘** | 오늘의 브리핑. 오늘의 한 줄·흐름, 분류 탭, 섹션별 목록, 옆 패널 개요(요약·왜 중요한가·저장). 목록에서 고르면 읽음 표시. 👍👎는 구현하지 않음 |
| **기사 읽기** | 넓은 본문 단(한국어 / 원문 / 함께 보기) + 옆 단 탭(메모 / 질문 / 하이라이트). 오늘·라이브러리·아카이브가 같은 화면을 씀 |
| **라이브러리** | 저장한 기사. 전문 검색, "메모 있는 기사" 필터, 태그 필터. 폴더는 구현하지 않음 |
| **아카이브** | 날짜별 지난 브리핑, 브리핑에 실린 기사 검색 |
| **질문** | 오늘 브리핑 전체를 근거로 AI에게 질문. "이번 주"·"내 라이브러리 전체" 범위는 구현하지 않음 |
| **출처** | 출처별 수집·실림 통계와 수집 기록 (읽기 전용, 13.11절) |
| **설정** | Groq API 키, 월 예산·하루 상한과 이번 달·오늘 사용액, Windows 시작 시 실행, 진단 화면 열기 |
| **진단** | 트리거 상태, 알림 테스트, 네트워크 점검, 이벤트 기록 |

- 설계에 있던 설정 항목 가운데 소스 편집, 관심 키워드 편집, 모델 지정, 단축키 변경, 실행 기록 화면은 구현하지 않았습니다. 소스·관심 키워드·모델은 `config/` 폴더의 YAML 파일을 고쳐서 바꿉니다.
- 화면 주소와 화면의 연결은 `src/renderer/src/app/router.tsx`에 있습니다.

기사 읽기 화면:
```
┌──────────────────────────────────────────────┬─────────────────────────┐
│ ← 오늘   Anthropic, 에이전트용 새 메모리 기능 공개 │ [메모] [질문] [하이라이트] │
│          Introducing persistent memory for …  │                         │
│          Anthropic Blog · HN 640점 · 원문       │ 이 기능이 기존 RAG랑       │
│          저장됨  #agent #memory                │ 뭐가 달라?                │
│──────────────────────────────────────────────│                         │
│ 요약: …                                       │ 기사에 따르면 … [¶4]      │
│ 왜 중요한가: …                                 │                         │
│──────────────────────────────────────────────│ 빠른 질문:                │
│ ¶1 (본문: 한국어 | 원문 | 함께 보기)            │ [쉽게 설명] [기술 디테일]  │
│ ¶4 … ▓▓하이라이트한 문장▓▓ …  ← 드래그 → 하이라이트/질문│ [내 일에 적용하면?] [한계와 반론] │
│                                              │ ┌─────────────────────┐ │
│                                              │ │ 질문 입력…            │ │
└──────────────────────────────────────────────┴─────────────────────────┘
```

### 6.2 저장 (스크랩)
- 저장은 바로 끝나고, 뒤에서 Worker가 원문 본문을 추출해서 DB에 보관합니다(`@mozilla/readability` + `linkedom`, `src/worker/knowledge/extract.ts`). 브리핑에 실린 기사는 생성할 때 이미 본문을 보관해 둡니다.
- 원문 링크가 사라져도 남고, AI 질문의 근거로 씁니다.
- 본문은 **문단 단위로** 저장하고, 문단 순서가 화면의 ¶ 번호입니다. 인용과 하이라이트 위치의 기준이 됩니다.
- 논문은 수집한 초록을, GitHub 릴리스는 릴리스 노트를, Hacker News·Reddit 토론 페이지는 수집한 글을 본문으로 씁니다(`src/worker/knowledge/content.ts`의 `isExtractable`). 논문 PDF 본문 추출은 구현하지 않았습니다(13.6절).
- 원문 추출에 실패하면 수집한 요약을 본문 대신 보관하고, 원문 본문이 아니라는 것을 `contents.full_text`에 남깁니다.
- 태그는 기사에 태그가 하나도 없을 때 LLM(20B, 실패하면 120B로 한 번 더)이 추천하고, 앞에서 3개까지 붙입니다. 직접 고칠 수 있습니다.
- 폴더(컬렉션)는 구현하지 않았습니다(13.2절).

### 6.3 메모와 하이라이트
- 기사마다 메모를 씁니다. 줄 노트 모양의 일반 글 입력란이고(Markdown 편집기 아님), 입력을 멈추면 0.8초 뒤 자동 저장합니다. 메모를 쓰면 그 기사는 자동으로 저장됩니다.
- 본문에서 드래그한 문장은 하이라이트로 저장합니다(문단 번호 + 문단 안 위치 + 그은 글자, 번역문·원문 구분). 짧은 메모를 붙이거나 바로 질문할 수 있습니다(13.6절).
- **내보내기:** 구현하지 않았습니다. 처음 설계에는 기사 + 메모 + 하이라이트 + AI 대화 요약을 Markdown으로 내보내고 Obsidian 폴더로 동기화하는 기능이 있었습니다(13.6절).

### 6.4 AI 질문

| 범위 | 근거로 쓰는 자료 | 예시 질문 |
|---|---|---|
| **기사** | 문단 번호가 붙은 본문. 약 36,000자를 넘으면 앞 3문단과 질문과 낱말이 많이 겹치는 문단만 | "이게 기존 RAG랑 뭐가 달라?" |
| **그날 브리핑** | 그날 실린 기사마다 `[#순위]`와 한국어 제목·분류·출처·요약·왜 중요한가 | "오늘 소식 중 우리 팀이 바로 써볼 만한 건?" |
| **라이브러리** | 구현하지 않음 (13.3절, 13.6절) | |

- 기사 범위에 같은 클러스터의 다른 기사를 함께 넣는 것은 구현하지 않았습니다. 같은 소식으로 묶인 다른 기사는 대표 기사의 출처 목록(`items.other_sources`)에만 남고, 본문은 근거에 들어가지 않습니다.
- **근거 표시:** Groq에는 Claude 같은 인용 전용 기능이 없어서 직접 구현합니다(`src/worker/services/chat-answer-service.ts`, `src/worker/knowledge/citations.ts`).
  1. 본문을 `[¶1] … [¶2] …` 형태로 문단 번호를 붙여서 넘깁니다. 브리핑 질문은 기사마다 `[#순위]`를 붙입니다.
  2. 근거에서 가져온 문장에 번호를 붙이고, 근거에 없으면 없다고 먼저 밝히라고 지시합니다(`config/prompts/chat-item.md`, `chat-digest.md`).
  3. 답변이 끝나면 실제로 넘긴 번호만 남기고, 없는 번호는 지웁니다(`cleanCitations`).
  4. 화면에서 `[¶n]`을 누르면 본문의 해당 문단으로 스크롤하고 강조합니다. `[#n]`을 누르면 오늘 화면에서 그 기사를 엽니다.
- 응답은 스트리밍으로 받습니다. 대화는 범위(기사 한 건 또는 그날 브리핑)마다 하나씩 저장하고, "메모에 추가" 버튼으로 답변을 메모로 옮깁니다.
- 이전 대화는 최근 20개(질문·답 10턴)만 함께 보냅니다. 그 이전 대화를 요약해서 넘기는 것은 구현하지 않았습니다.
- **빠른 질문 버튼:** 기사는 쉽게 설명 / 기술 디테일 / 내 일에 적용하면? / 한계와 반론, 브리핑은 꼭 읽을 3개 / 오늘의 흐름 / 바로 써볼 것. 버튼과 프롬프트는 `config/quick-actions.yaml`에서 고칩니다(설정 화면에서 고치는 기능은 없음). 설계의 "관련 기사 찾기"는 라이브러리 검색이 필요해 "한계와 반론"으로 바꿨습니다(13.3절).
- **라이브러리 RAG:** 구현하지 않았습니다. 처음 설계는 저장한 본문의 문단을 로컬에서 임베딩해(`sqlite-vec`) 전문 검색과 벡터 검색을 합치는 것이었습니다. 지금 라이브러리는 전문 검색(FTS5)만 합니다.
- **웹 검색:** 구현하지 않았습니다.

### 6.5 개인화 피드백

구현하지 않았습니다(13.6절). 처음 설계는 저장·메모·질문·👍이면 해당 소스·주제·키워드의 가중치를 올리고, 👎이거나 읽지 않고 넘기면 내리는 것이었습니다. 지금 점수에 쓰는 가중치는 `config/sources.yaml`의 `weight`와 `config/interests.yaml`의 키워드 `weight`뿐이고, 사용자의 동작에 따라 바뀌지 않습니다.

### 6.6 디자인 시스템 — "조간 작업대"

> 확정 시안: https://claude.ai/artifact/UCVCRLMgJNa9KYYcZFpoaJ (D안). A안의 신문 지면 느낌 + B안의 3단 작업대 구성.

**원칙**
- **신문 지면처럼:** 칸은 박스나 그림자 대신 가는 괘선으로 나눕니다. 제목은 명조, 본문은 고딕, 원제는 이탤릭입니다.
- **장식은 괘선과 강조색 하나뿐:** 그라데이션, 그림자, 둥근 카드, 이모지는 쓰지 않습니다. 모서리는 거의 직각(2px)입니다.
- **작업대처럼:** 메뉴 / 목록 / 기사 패널의 3단 구성입니다. 키보드만으로 훑고, 저장하고, 메모할 수 있어야 합니다.
- **테마:** 라이트("조간")만 있습니다. 다크("야간판")는 만들지 않았고, 같은 토큰 이름에 값만 바꿔 넣을 수 있게 색을 CSS 변수로 두었습니다.

**디자인 토큰** (`src/renderer/src/app/styles/tokens.css`의 Tailwind `@theme`가 유일한 원본. 토큰 이름이 곧 유틸리티 이름: `--color-paper` → `bg-paper`, `--text-headline` → `text-headline`. Tailwind 기본 색·글꼴·크기·그림자는 `initial`로 지워서 토큰 밖의 값은 쓸 수 없다. `bg-[#fff]` 같은 임의 값은 쓰지 않는다)

| 분류 | 토큰 | 값 (조간) | 용도 |
|---|---|---|---|
| 지면 | `--color-paper` | `#F5F5F2` | 앱 배경 |
| | `--color-paper-raised` | `#FAFAF8` | 기사 패널 |
| | `--color-paper-sunken` | `#EBEAE4` | 선택된 목록 행 |
| | `--color-paper-input` | `#FFFFFF` | 입력란, 메모장 |
| 글자 | `--color-ink` | `#111114` | 제목, 강조 텍스트, 굵은 괘선 |
| | `--color-ink-body` | `#22222A` | 읽기 본문 |
| | `--color-ink-secondary` | `#33333A` | 메뉴, 보조 텍스트 |
| | `--color-ink-muted` | `#45454D` | 메타 정보, 설명 문장 |
| | `--color-ink-faint` | `#5A5A62` | 원제, 시각 같은 장식성 정보만 (13px 이상). 설명 문장·누를 수 있는 글자에는 쓰지 않음 |
| | `--color-ink-read` | `#7A7A82` | 읽은 기사 제목 |
| 괘선 | `--color-rule` | `#D9D9D3` | 기본 구분선 |
| | `--color-rule-soft` | `#E3E3DD` | 목록 행 사이 |
| | `--color-rule-strong` | `#111114` | "왜 중요한가" 위아래, 이중선 |
| | `--color-memo-line` | `#E6E6E0` | 메모장 줄 |
| | `--color-control-border` | `#C9C9C2` | 외곽선 버튼 |
| 강조 | `--color-accent` | `#B2410E` | 섹션 이름, 선택 표시, 활성 탭 밑줄 (한 가지만 사용) |
| 상태 | `--color-danger` | `#B42318` | 오류 |
| 형광펜 | `--color-highlight` | `#F3E3A3` | 하이라이트 |
| | `--color-highlight-strong` | `#ECD57F` | 짙은 하이라이트 |

| 분류 | 토큰 | 값 |
|---|---|---|
| 글꼴 | `--font-display` | Hahmlet (명조, 제목·섹션 이름·탭) |
| | `--font-body` | Pretendard (고딕, 본문·메타) |
| 글자 크기 / 줄 간격 | `--text-display` | 36px / 1.3 (기사 읽기 화면 제목) |
| | `--text-headline` | 30px / 1.35, 700, 자간 -0.02em (오늘의 한 줄, 페이지 제목) |
| | `--text-title` | 18px / 1.45, 600, 명조 (목록 제목) |
| | `--text-lead` | 19px / 1.75 (읽기 화면 리드 요약) |
| | `--text-reading` | 18px / 1.8 (본문, 요약) |
| | `--text-body` | 16px / 1.65 (기본) |
| | `--text-label` | 14px, 700, 명조, 자간 0.06em (섹션 이름) |
| | `--text-meta` | 14px (출처, 점수, 원제, 설명) |
| | `--text-caption` | 13px (저장 상태, 작은 안내). 가장 작은 글자 |
| 간격 | `--spacing` | 4px 단위 (`p-1`~`p-7` = 4~28px, `h-10` = 40px 컨트롤 높이) |
| 모서리 | `--radius-control` | 2px (그 외 0) |
| 괘선 두께 | `border` / `border-3 border-double` | 1px 실선 / 3px 이중선 |
| 레이아웃 | `--breakpoint-wide` + 간격 단위 | 900px 이상에서 3단. 메뉴 `basis-52`(208px), 목록 `basis-110`(440px), 패널 `basis-100`~`max-w-115`(400~460px) |
| 움직임 | `duration-120` | 120ms (선택·호버 전환만, 그 외 애니메이션 없음) |

- 숫자(개수, 점수, 비용)는 `font-variant-numeric: tabular-nums`로 자릿수를 맞춥니다.
- 글꼴은 인터넷 없이도 뜨도록 npm 패키지(`pretendard`, `@fontsource/hahmlet`)의 글꼴 파일을 앱에 같이 묶습니다(`app/styles/fonts.ts`, 둘 다 OFL 라이선스).
- 터치·클릭 영역은 최소 40px 높이를 지킵니다.

**화면 코드 구조** (`src/renderer/src/`, 2026-10-08 개편: 화면 단위 + 공용 도메인 분리, import는 `@/` 별칭)

| 폴더 | 내용 |
|---|---|
| `app/` | `App`(제목 표시줄·메뉴 틀과 화면 이동 처리), `router`(주소와 화면 연결), `providers/`(`QueryProvider`: 쿼리 캐시와 Main 알림 연결), `layout/`(`NavRail` 제호·메뉴, `TitleBar` 제목 표시줄·창 버튼, `useWindowMaximizedQuery`), `global/`(`Toaster`, `ShortcutHelp`), `styles/`(`tokens.css` 디자인·움직임 토큰 원본, `app.css`, `fonts.ts`) |
| `screens/<화면>/` | `page.tsx` 하나와, 그 화면에서만 쓰는 `components/`·`queries.ts`. today · library · archive · ask · sources(`Funnel` · `DailyBars` · `SourceTable`) · settings(`ApiKeyField`) · diagnostics |
| `domains/article/` | 역할별 하위 폴더: `components/`(`ArticleRow` · `LibraryRow` · `RowReadButton` · `ArticleGroup` · `ArticlePreview` · `ArticleBody` · `WhyItMatters` · `MemoPad` · `TagList`), `views/`(`ArticleReader` · `ItemListView`), `hooks/`(`useAutoTranslate` · `useBodyMode`), `queries.ts`(조회·변경 훅), `cache.ts`(`patchArticle`), `types.ts` |
| `domains/digest/` | 브리핑 한 호(`DigestView`: 지면 머리 + 섹션 목록 + 옆 패널, 오늘·아카이브가 함께 씀), `EditionHeader`, `RunProgress`, `queries.ts`, `useDigest` |
| `domains/highlight/` | `HighlightList` · `HighlightCard` · `SelectionToolbar`, 위치 계산(`highlight.ts`), `queries.ts`, `cache.ts` |
| `domains/chat/` | `ChatPanel` · `ArticleChat`, `queries.ts`, `useChat` |
| `common/ui/` | 기사를 모르는 기본 부품: `Button`(solid/outline/text) · `Tabs` · `Segmented` · `Dialog` · `Chip` · `Skeleton` · `Form` · `Icon` · `Text`(`SectionLabel` · `Kicker` · `OriginalTitle` · `Meta` · `Caption` · `Help`) · `Tag` · `SearchInput` · `LinedTextarea` · `Masthead` · `Notice` |
| `common/layout/` | `AppShell`(3단 틀, `ListPane` · `DetailPane` · `SinglePane`), `ResizeHandle`, `Page`, `ListHeader` |
| `common/lib/` | `api`(preload 호출) · `queryKeys`(쿼리 키) · `paths`(화면 주소) · `useUsageQuery`(비용) · `cn` · `format` · `toast` · `useListKeys` · `useSlidingIndicator` |

규칙:
- 의존은 `app → screens → domains → common` 한 방향입니다. 도메인은 `app`·`screens`를 부르지 않고, 도메인끼리는 `digest → article → highlight · chat`만 씁니다.
- `common/ui`는 기사 데이터를 모르고 토큰만 씁니다. 색이나 크기 값을 직접 쓰지 않습니다(하드코딩 금지).
- 도메인 안의 파일이 늘면 도메인을 쪼개지 않고 역할 폴더(`components/` · `views/` · `hooks/`)로 나눕니다. `index.ts`(배럴)는 두지 않고 파일을 직접 import합니다.
- 조회·변경은 모두 `queries.ts`의 훅으로 만듭니다. 화면 컴포넌트는 `useQuery` · `useMutation` · `api`를 직접 부르지 않습니다(원문 열기·창 버튼·Main 알림 구독은 예외).
- 화면 이동은 React Router로 합니다(`createHashRouter`). 읽는 기사·아카이브 날짜·검색어는 주소에 두고, 주소 문자열은 `common/lib/paths.ts`의 함수로만 만듭니다. 도메인의 뷰는 주소를 모르고 `readingItemId` · `onRead`만 받습니다.
- 화면 전용 부품은 그 화면 폴더에 두고, 두 화면 이상이 쓰게 되면 도메인이나 `common`으로 옮깁니다. `common`은 작게 유지합니다.
- 화면 쪽 공용 폴더를 `shared`가 아니라 `common`으로 부르는 것은, 프로세스 공통 코드 `src/shared/`(`@shared/…`)와 헷갈리지 않게 하려는 것입니다.
- 개발용 컴포넌트 견본 화면(`/dev/components`)은 만들지 않았습니다.

## 7. LLM 설계 (Groq)

### 7.1 Groq에서 쓸 수 있는 모델 (2026-10-07 공식 문서 기준)

| 모델 ID | 상태 | 문맥 길이 / 최대 출력 | 가격 (입력 / 출력, $ per 1M 토큰) | 구조화 출력 (strict) | 프롬프트 캐싱 | 비고 |
|---|---|---|---|---|---|---|
| `openai/gpt-oss-20b` | 정식 | 131K / 65K | $0.075 / $0.30 | ✓ | ✓ (캐시된 입력 50% 할인) | 가장 쌈, 추론 모델 |
| `openai/gpt-oss-120b` | 정식 (대표 모델) | 131K / 65K | $0.15 / $0.60 | ✓ | ✓ | 초당 약 500토큰, 추론 모델, 브라우저 검색 지원 |
| `qwen/qwen3.8-27b` | **프리뷰** | 131K / 16K | $0.80 / $4.00 | ✓ | — | 다국어(한국어 포함) 강점 기대. 프리뷰라 예고 없이 사라질 수 있음. 지금 어떤 역할에도 쓰지 않음 |
| `llama-3.3-70b-versatile` | 정식 | 131K / 32K | 영업팀 문의 | — | — | 셀프서비스 가격 없음 → 제외 |
| `llama-3.1-8b-instant` | 정식 | 131K / 131K | 영업팀 문의 | — | — | 제외 |
| `minimaxai/minimax-m2.7` | 프리뷰 | 196K / 131K | 영업팀 문의 | — | — | 제외 |
| `groq/compound`, `compound-mini` | **2026-09-21 서비스 종료** | — | — | — | — | 사용 불가 |

참고 사항:
- **임베딩 모델 없음:** Groq은 임베딩 API를 제공하지 않습니다. 설계 때는 로컬(`transformers.js`)에서 처리하려고 했지만, 임베딩은 구현하지 않았습니다.
- **구조화 출력과 스트리밍은 동시에 쓸 수 없습니다.** 선별·묶기·중복 확인·요약·번역·머리글·태그 추천은 JSON(스트리밍 없음)으로, 채팅은 스트리밍(일반 텍스트)으로 나눕니다.
- 이 표는 2026-10-07에 공식 문서에서 옮긴 값입니다. 코드에서 쓰는 것은 `config/models.yaml`의 모델 ID와 `config/pricing.yaml`의 단가(20B·120B·Qwen 세 모델)뿐입니다.
- **프롬프트 캐싱은 자동입니다.** 앞부분(시스템 프롬프트, 기사 본문)이 같으면 2시간 동안 캐시되고 입력 비용이 50% 할인됩니다. 고정된 내용을 프롬프트 앞에 두는 것만 지키면 됩니다.

### 7.2 역할별 모델 배정

역할별 모델·추론 강도·출력 상한은 `config/models.yaml`에 있습니다. "역할"은 `llm_usage.role`에 남는 이름입니다.

| 역할 (`role`) | 모델 (`models.yaml`의 키) | 입력 | 설정 | 이유 |
|---|---|---|---|---|
| **1차 선별** (`triage`, 규칙 점수 상위 최대 120건) | `gpt-oss-20b` (`triage`) | 출처 + 제목 + 첫 200자, 10건씩 묶음 | 추론 `low`, strict JSON: `{results: [{id, category, relevance 0~1, importance 1~5}]}` | 건수가 많으니 가장 싼 모델. 판단만 하므로 충분함 |
| **같은 소식 묶기** (`cluster`, 2회) | `gpt-oss-120b` (`summary`) | 1차: 출처 + 원제 + 첫 160자, 2차: 한국어 제목 + 요약 160자 | 추론 `low`, strict JSON: `{groups: [{ids, primary}]}` | 판단이 까다로워 큰 모델. 호출 한 번씩이라 비용이 작음 |
| **지난 7일 중복 확인** (`recent`, 1회) | `gpt-oss-120b` (`summary`) | 지난 7일 브리핑 기사의 제목 + 오늘 상위 후보의 출처·원제·첫 160자 | 추론 `low`, strict JSON: `{matches: [{id, previous_id, follow_up}]}` | 위와 같음 |
| **한국어 제목·요약** (`summary`, 선정된 기사, 기본 20건) | `gpt-oss-120b` (`summary`) | 본문 최대 12,000자(약 3,000토큰) | 추론 `low`, strict JSON: `{title_ko, summary_ko, key_points(3~5), why_it_matters, category, relevance, importance}` | 사용자가 직접 읽는 한국어 품질이 중요함 |
| **본문 번역** (`translate`, 선정된 영어 기사) | `gpt-oss-120b` (`translate`) | 문단 번호가 붙은 본문, 약 5,000자씩 (기사당 최대 40,000자) | 추론 `low`, strict JSON: `{paragraphs: [{n, ko}]}` | 원문 대신 읽는 글이라 품질이 중요함 |
| **머리글** (`digest`, 하루 1회) | `gpt-oss-120b` (`digest`) | 선정된 기사의 섹션·한국어 제목·요약 | 추론 `medium`, strict JSON: `{headline, overview}` | 종합 판단과 글쓰기 |
| **채팅** (`chat`) | `gpt-oss-120b` (`chat`) | 규칙 + 근거(문단 번호가 붙은 본문 또는 그날 브리핑 기사 목록) + 최근 대화 + 질문 | 추론 `low`, **스트리밍** | 빠른 응답. 같은 기사로 이어서 질문하면 자동 캐싱 |
| **태그 추천** (`tags`) | `gpt-oss-20b` (`triage`), 실패하면 `gpt-oss-120b` (`summary`)로 한 번 더 | 제목 + 요약 + 기존 태그 목록(많이 쓴 순 60개) | 추론 `low`, strict JSON: `{tags}` | 가벼운 작업 |

- 원제는 LLM이 만들지 않고 수집한 원본 제목을 그대로 씁니다.
- "왜 중요한가"는 머리글 단계가 아니라 기사별 요약 단계에서 함께 씁니다(13.1절).
- 요약 응답의 `category`·`relevance`·`importance`는 스키마에는 있지만 저장하지 않습니다. 분류와 점수는 1차 선별의 값을 씁니다.
- 묶기와 7일 중복 확인은 `models.yaml`에 따로 키가 없고 `summary` 역할의 모델 설정(출력 상한 포함)을 씁니다.
- `qwen/qwen3.8-27b`를 한국어 요약 대안으로 검토했지만 쓰지 않습니다. `config/pricing.yaml`에 단가만 남아 있습니다.
- 월 예산에 도달하면 태그 추천을 뺀 모든 역할이 `saveMode`의 모델로 바뀝니다(7.5절 ⑤). 태그 추천은 절약 모드와 상관없이 위 표의 모델을 씁니다.

### 7.3 예상 비용 (유료 플랜, 하루 300건 수집, 월 22일 출근 가정)

> 아래 표는 설계 때의 예상입니다(300건 선별, 약 60건 요약 가정). 실제 파이프라인은 최대 120건을 선별하고 선정된 기사(기본 20건)만 요약·번역하며, 실측 비용은 1회 약 $0.01~0.02입니다(13.1절, 13.5절).

**설계 때의 예상 (7.5절의 최적화 적용)**

| 단계 | 하루 토큰 (입력 / 출력, 추론 토큰 포함) | 하루 비용 |
|---|---|---|
| 선별 (20B) | 18만 / 6만 | 약 $0.03 |
| 요약 (120B) | 12만 / 3만 | 약 $0.04 |
| 머리글 (120B) | 4만 / 1만 | 약 $0.01 |
| 채팅 (120B, 하루 10개 질문) | 6만 / 1만 | 약 $0.02 |
| **합계** | | **하루 약 $0.1 → 월 약 $2~3** |

**최악의 경우 (최적화를 하나도 안 했을 때의 예상)**
- 가정: 300건 전부를 120B로 요약(추론 `medium`, 본문 전체 입력) + 하루 채팅 50개
- 하루 약 $0.5 → **월 약 $10~12**
- 즉 설정을 잘못해도 월 1만 원대를 넘기 어려운 구조입니다. 다만 아래와 같은 **버그로 인한 폭주**는 금액에 상한이 없어서, 7.5절의 안전장치로 막습니다.
  - 무한 재시도
  - 같은 항목을 반복해서 요약
  - 아주 긴 본문을 통째로 입력

### 7.4 요청 제한

- **동시 호출 제한:** JSON 호출은 같은 모델로 동시에 4개까지만 보내고 나머지는 차례를 기다립니다(`src/worker/llm/service.ts`의 `CONCURRENCY_PER_MODEL`, `p-limit`). 스트리밍 답변(채팅)은 이 제한을 거치지 않습니다.
- **재시도:** 429를 포함한 요청 실패의 재시도는 `groq-sdk`에 맡깁니다(`createGroqClient`의 `maxRetries: 3`, 요청당 제한 시간 60초). 앱 코드에서 따로 재시도하는 것은 번역 묶음뿐이고, 실패한 묶음을 한 번 더 시도합니다.
- 처음 설계의 토큰 버킷 방식(모델별 분당 요청 수·토큰 수를 설정값으로 두는 속도 조절)은 구현하지 않았습니다. 분당 한도를 담는 설정값은 없습니다.

### 7.5 비용 최적화와 관리

원칙: **사용자가 직접 읽는 텍스트에만 큰 모델(120B)을 쓰고, 나머지는 줄이거나 없앱니다.**

#### ① 호출 자체를 줄이기 (효과 가장 큼)

| 방법 | 내용 |
|---|---|
| 규칙 필터 먼저 | 소스 신뢰도, 관심 키워드, 참여도, 다른 출처 수, 최신성으로 점수를 매겨서(`ruleScore`) 상위 120건만 LLM 선별에 보냄 |
| 처리 결과 다시 쓰기 | 선별 결과와 요약을 `items`에 저장(`triage_*`·`triaged_at`, `title_ko`·`summary_ko`·`summarized_at` 등). 이미 선별한 기사는 다시 선별하지 않고, 이미 요약한 기사는 다시 요약하지 않음. 번역도 `contents.paragraphs_ko`가 있으면 다시 하지 않음. 처음 설계의 `content_hash` 캐시는 만들지 않음 |
| 선정한 기사만 요약 | 같은 소식은 요약 전에 대표 하나로 합치고, 브리핑에 싣기로 고른 기사(기본 20건)만 요약·번역함. 합쳐진 기사는 대표의 출처 목록(`other_sources`)으로만 남음 |
| 본문 없는 기사 제외 | 본문이 300자 미만인 기사는 요약하지 않고 다음 후보로 채움 |
| 백그라운드 수집은 LLM 없이 | 2시간마다 하는 수집은 저장만 함. LLM은 브리핑을 만들 때만 호출 |
| 선별 묶음 처리 | 1차 선별은 기사 10건을 한 번에 묶어 호출. 시스템 프롬프트 반복을 줄임 |

#### ② 입력 줄이기

입력 상한은 토큰이 아니라 글자 수로 자릅니다.

| 역할 | 입력 상한 |
|---|---|
| 1차 선별 | 출처 + 제목 + 첫 200자 |
| 같은 소식 묶기·7일 중복 확인 | 제목 + 첫 160자 (2차 묶기는 한국어 제목 + 요약 160자) |
| 한국어 요약 | 본문 앞에서부터 최대 12,000자. 문단 중간에서 자르지 않음 (`src/worker/pipeline/schemas.ts`의 `MAX_SUMMARY_INPUT_CHARS`) |
| 본문 번역 | 기사당 원문 40,000자까지, 약 5,000자씩 나눠 호출 |
| 머리글 | 선정된 기사의 섹션·한국어 제목·요약만 (본문 제외) |
| 기사 채팅 | 본문 약 36,000자까지. 넘으면 앞 3문단과 질문과 낱말이 많이 겹치는 문단만 골라서 입력 |
| 대화 기록 | 최근 20개(질문·답 10턴)만 넘김. 그 이전 대화는 넘기지 않음 (요약해서 넘기는 것은 구현하지 않음) |
| 태그 추천 | 제목 + 한국어 요약(없으면 소개 글 앞 600자) + 기존 태그 60개 |

- 라이브러리 질문(검색으로 찾은 상위 문단 입력)은 구현하지 않았습니다.

#### ③ 출력 토큰 줄이기
- GPT-OSS는 추론 모델이라 **눈에 안 보이는 추론 토큰도 출력 비용**으로 청구됩니다. 그래서 `reasoningEffort`를 기본 `low`로 둡니다. 머리글만 `medium`을 씁니다.
- 역할별 출력 상한은 `config/models.yaml`의 `maxCompletionTokens`입니다.

| 역할 (`models.yaml`의 키) | 출력 상한 |
|---|---|
| 1차 선별 `triage` (10건 묶음) | 1,500 |
| 한국어 요약 `summary` (묶기·7일 중복 확인도 이 값) | 1,500 |
| 머리글 `digest` | 4,000 |
| 채팅 `chat` | 2,000 |
| 본문 번역 `translate` (약 5,000자 묶음) | 8,000 |

- JSON 필드는 꼭 필요한 것만 둡니다. 예를 들어 선별 결과는 판단 이유를 쓰지 않고 분류와 점수만 받습니다.

#### ④ 자동 캐싱 활용 (입력 50% 할인)
- Groq은 앞부분이 같은 요청을 자동으로 캐시합니다. 그래서 프롬프트를 **"고정된 내용이 앞, 바뀌는 내용이 뒤"** 순서로 조립합니다.
  - 선별·요약: [고정 시스템 프롬프트] → [항목]
  - 채팅: [고정 시스템 프롬프트 + 기사 본문 또는 브리핑 기사 목록] → [대화 기록] → [새 질문]
- 시스템 프롬프트에는 날짜처럼 매번 바뀌는 값을 넣지 않습니다. 머리글 호출의 날짜는 사용자 메시지 쪽에 넣습니다.
- 캐시된 입력 토큰 수는 호출마다 `llm_usage.cached_tokens`에 기록합니다. 캐시 적중률을 보여 주는 화면은 없습니다.

#### ⑤ 안전장치 (폭주 방지)

| 장치 | 동작 |
|---|---|
| **월 예산** (기본 $5, 설정에서 변경) | 이번 달 사용액이 예산 이상이면 **절약 모드**로 전환. 80% 경고 알림은 구현하지 않음 |
| **절약 모드** | 선별·묶기·중복 확인·요약·번역·머리글·채팅의 모델과 추론 강도를 `saveMode` 값(20B, `low`)으로 바꾸고, 브리핑 기사 수를 최대 15건으로 줄이고, 본문 번역은 미리 하지 않고 기사를 열 때 함. 사용액을 호출할 때마다 다시 합산하므로 달이 바뀌거나 예산을 올리면 풀림 (따로 끄는 버튼은 없음) |
| **하루 상한** (기본 $0.5, 설정에서 변경) | 오늘 사용액이 상한 이상이면 브리핑을 만들지 않고, 기사를 열 때 하는 번역도 하지 않음. 채팅과 태그 추천은 막지 않음 |
| **실행당 토큰 상한** (100만 토큰, `RUN_TOKEN_CAP`) | 한 세션이 쓴 토큰(입력 + 출력)이 이 값을 넘으면 그 뒤의 호출은 오류로 중단 |
| **재시도 제한** | `groq-sdk`가 같은 요청을 최대 3회 다시 시도. "연속 실패 5번이면 실행 중단"은 구현하지 않음. 대신 선별 배치가 모두 실패하면 생성을 중단하고, 묶기·중복 확인·요약·번역·머리글이 실패하면 그 단계를 건너뛰고 진행 |
| **중복 생성 방지** | 하루 1회 규칙 + 실행 중 잠금(Main의 `BriefingService`, Worker의 `PipelineService` 양쪽). 수동 요청도 오늘 브리핑이 있으면 만들지 않음 (다시 만들기 없음) |
| **입력 크기 제한** | 호출 전에 ②의 글자 수 상한으로 잘라냄. 토큰 수를 계산하거나 잘라낸 것을 기록하지는 않음 |

- Groq 콘솔에 지출 한도 기능이 있으면 앱 예산보다 조금 높게 함께 걸어둡니다(이중 안전장치, 확인 필요).

#### ⑥ 사용량 계측과 표시
- 모든 호출의 시각, 실행 번호, 역할, 모델, 입력·캐시·출력·추론 토큰, 지연 시간, 비용을 `llm_usage` 테이블에 기록합니다(`LlmSession`).
- 비용은 응답의 토큰 수 × `config/pricing.yaml`의 단가로 계산합니다(`src/backend/config/pricing.ts`). Groq 가격이 바뀌면 이 파일만 고칩니다. 단가가 없는 모델은 비용 0으로 기록합니다.
- 화면에서 보여주는 것:
  - 메뉴 아래와 설정 화면: 이번 달 누적 비용과 월 예산, 오늘 사용액, 절약 모드 여부
  - 출처 화면: 기간별 LLM 비용과 역할별(선별·묶기·중복 확인·요약·번역·머리글·태그·질문) 비용
- 월말 예상 금액, 일별 비용 추이, 캐시 적중률, 브리핑 하단의 "오늘 생성 비용" 표시는 구현하지 않았습니다. 브리핑 한 번의 비용은 `digests.stats`에 저장됩니다.

#### 사용하지 않는 방법
- **Groq Batch API (50% 할인):** 결과가 나오기까지 24시간 이상 걸릴 수 있어서 아침 브리핑에는 맞지 않습니다.

### 7.6 모델 변경에 대비한 설계

Groq은 모델 교체가 잦습니다. 실제로 `groq/compound`가 2026-09-21에 대체 모델 없이 종료됐고, Llama 모델은 셀프서비스 가격이 빠졌습니다. 그래서 다음과 같이 대비합니다.

- **모델 ID를 코드에 박지 않습니다.** 역할 → 모델 매핑을 설정으로 둡니다. 읽는 곳은 `src/backend/config/index.ts`의 `loadConfig`이고, 역할에 쓸 모델은 `modelSpecForRole`이 고릅니다.
  ```yaml
  # config/models.yaml
  triage:    { model: openai/gpt-oss-20b,  reasoningEffort: low,    maxCompletionTokens: 1500 }
  summary:   { model: openai/gpt-oss-120b, reasoningEffort: low,    maxCompletionTokens: 1500 }
  digest:    { model: openai/gpt-oss-120b, reasoningEffort: medium, maxCompletionTokens: 4000 }
  chat:      { model: openai/gpt-oss-120b, reasoningEffort: low,    maxCompletionTokens: 2000 }
  translate: { model: openai/gpt-oss-120b, reasoningEffort: low,    maxCompletionTokens: 8000 }
  saveMode:  { model: openai/gpt-oss-20b,  reasoningEffort: low }
  ```
  `saveMode`는 월 예산에 도달했을 때 각 역할이 대신 쓰는 모델입니다(출력 상한은 각 역할의 값 유지). 처음 설계의 `fallback` 키는 없습니다.
- **앱 시작 시 모델 확인:** 구현하지 않았습니다. 설정된 모델이 Groq에 아직 있는지 확인하거나 대체 모델로 돌리는 코드는 없습니다. 모델이 없어지면 그 역할의 호출이 실패하고, `models.yaml`을 직접 고쳐야 합니다. (`GET /openai/v1/models`는 네트워크 연결 확인에서 Groq 서버에 닿는지 보는 주소로만 씁니다.)
- **LLM 호출 계층을 분리합니다.** 처음 설계의 `LLMClient` 인터페이스(`complete`, `completeJSON`, `stream`)는 만들지 않았습니다. 실제 구성은 다음과 같습니다.
  - `src/worker/llm/groq.ts`: Groq 호출 함수. `createGroqClient`, `completeJson`(strict 구조화 출력 + zod 검증), `streamChat`(스트리밍), `unwrapArrays`(배열을 객체로 감싼 응답 보정)
  - `src/worker/llm/service.ts`: `LlmSession`(한 번의 실행 동안 사용량 기록·토큰 상한·동시 호출 제한), `LlmSessionFactory`(지금의 API 키로 세션을 엶), 서비스가 받는 인터페이스 `LlmCaller`·`LlmSessionSource`
- **SDK:** 공식 `groq-sdk`(npm)를 씁니다.
- **API 키:** 설정 화면에서 입력받아 `safeStorage`로 암호화해서 `groq-key.bin`에 저장합니다(`src/main/platform/secrets.ts`).

### 7.7 한국어 품질 비교 테스트 (MVP 첫 작업)

GPT-OSS는 영어 중심으로 학습된 모델이라 한국어 요약 품질을 실제로 확인하려고 세운 계획입니다. 저장소에는 이 비교 테스트의 코드와 결과물이 없습니다. 지금 요약은 `config/models.yaml`대로 `gpt-oss-120b`를 씁니다.

- **계획한 방법:** 실제 기사 30건(뉴스 10, 논문 10, 커뮤니티 10)을 `gpt-oss-20b`, `gpt-oss-120b`, `qwen/qwen3.8-27b`에 같은 프롬프트로 넣습니다.
- **계획한 평가 기준:**
  - 사실 정확성(원문에 없는 내용이 있는지)
  - 한국어 자연스러움
  - 핵심을 제대로 짚었는지
  - JSON 형식이 맞는지
  - 응답 시간과 토큰 사용량
- **계획한 결과물:** 세 모델의 결과를 나란히 보는 비교 표.

## 8. 수집 소스 (LLM·에이전트 중심)

소스는 `config/sources.yaml`에 있고, 수집기는 `src/worker/collectors/index.ts`에 종류(`type`)별로 있습니다.

| 분류 | 소스 | 수집 방식 (`type`) |
|---|---|---|
| 랩 공식 블로그 | OpenAI News, Google DeepMind, Google AI Blog, Hugging Face Blog. Anthropic은 공식 RSS가 없어 꺼둠(`enabled: false`) | RSS (`rss`) |
| LLM 전문 블로그 | Simon Willison, Latent Space | RSS |
| 개발자·엔지니어링 블로그 | Ahead of AI, Eugene Yan, Lilian Weng, Hamel Husain, Interconnects, Philipp Schmid, Cloudflare Blog(AI), GitHub Blog(AI), Together AI. GitHub Blog와 Together AI는 관심 키워드에 맞는 글만(`keywordFilter`) | RSS |
| 라이브러리 릴리스 | vLLM, Ollama, SGLang, Transformers, LangGraph, LangChain, LlamaIndex, OpenAI Agents SDK, Pydantic AI, MCP Python SDK, smolagents. 메이저·마이너 버전만 받고 패치·프리릴리스는 제외 | 저장소별 `releases.atom` (`github_releases`) |
| 테크 뉴스 | TechCrunch, The Verge | RSS |
| 국내 | GeekNews, 카카오 기술블로그, NAVER D2, 토스 기술블로그. 모두 관심 키워드에 맞는 글만 | RSS |
| 논문 | arXiv cs.CL / cs.AI / cs.LG에서 초록에 agent · agentic · "tool use" · "language model"이 있는 논문, 최신순 60건까지 | arXiv API (`arxiv`) |
| 논문 큐레이션 | Hugging Face Daily Papers (추천수를 참여도로 씀) | `huggingface.co/api/daily_papers` (`hf_papers`) |
| 커뮤니티 | Hacker News: 검색어마다 검색해서 60점을 넘는 글만. Show HN: 30점을 넘는 글만 | Algolia 검색 API (`hackernews`) |
| 커뮤니티 | Reddit r/LocalLLaMA 하루 인기글 피드의 앞 15개 (`maxItems`) | RSS |

- Hacker News 점수 기준은 "이상"이 아니라 "초과"입니다(검색 조건 `points>minPoints`). 점수만 참여도로 쓰고, 댓글 수는 응답 스키마에만 있고 쓰지 않습니다.
- 요청 한 번의 제한 시간은 15초입니다(`src/worker/collectors/types.ts`의 `FETCH_TIMEOUT_MS`).
- 설계에 있던 소스 가운데 만들지 않았거나 뺀 것: Meta AI·Mistral·Qwen·DeepSeek 블로그, CrewAI·AutoGen·MCP 스펙, VentureBeat, AI타임스, r/MachineLearning·r/AI_Agents, HF 트렌딩 모델, GitHub Trending(13.6절), RSS가 없을 때의 HTML 파싱, GitHub Releases API(피드로 대신함). LangChain·LlamaIndex 블로그는 피드가 깨졌거나 없어 뺐습니다(13.5절). X(트위터)는 API 비용이 커서 처음부터 제외했습니다.
- 소스와 관심 키워드는 `config/sources.yaml`, `config/interests.yaml`을 고쳐서 바꿉니다. 설정 화면에서 바꾸거나 DB에 저장하는 기능은 없습니다. 출처 화면은 읽기 전용입니다(13.11절).

## 9. 브리핑 파이프라인 (Worker 안에서 실행)

`src/worker/services/pipeline-service.ts`의 `PipelineService.runPipeline`이 아래 순서로 진행합니다. 단계 번호는 그 파일의 주석, docs/README.md 4.3절과 같습니다.

```
 예산 확인 ─► 수집 구간 결정 ─► ① 수집 ─► ② 저장·중복 합치기 ─► ③ 규칙 점수로 1차 거르기 ─► ④ LLM 선별(20B)
                                                                                              │
 ⑧ 한국어 요약(120B) ◄─ ⑦ 선정 + 본문 확인 ◄─ ⑥ 지난 7일 중복 확인(120B) ◄─ ⑤ 같은 소식 묶기 1차(120B) ◄┘
        │
        └─► ⑨ 같은 소식 묶기 2차(120B) ─► ⑩ 본문 번역(120B) ─► ⑪ 머리글(120B) ─► ⑫ 게시
```

- **예산 확인:** 오늘 사용액이 하루 상한 이상이면 만들지 않습니다. 이번 달 사용액이 월 예산 이상이면 절약 모드로 실행합니다(7.5절 ⑤).
- **수집 구간:** 오늘 이전에 성공한 마지막 실행의 시작 시각부터 지금까지입니다. 첫 실행이면 최근 24시간, 오래 비웠어도 최대 72시간입니다.
- **① 수집:** 켜진 소스마다 `collectSource`를 동시에 실행하고, 결과를 공통 형식 `RawItem`(`sourceId`, `sourceName`, `kind`, `title`, `url`, `publishedAt`, `snippet`, `engagement`, `engagementLabel`, `lang`)으로 받습니다. 제한 시간은 소스 단위가 아니라 요청 한 번에 15초입니다. 소스 하나가 실패해도 나머지는 계속 진행하고, 실패한 소스는 브리핑 통계(`digests.stats`)와 출처별 수집 기록(`source_fetches`)에 남습니다. 브리핑 지면에는 표시하지 않고, 출처 화면에서 봅니다.
- **② 저장·중복 합치기:** 정규화한 URL(`src/worker/pipeline/normalize.ts`의 `urlKey`)이 같거나, 최근 3일 안에 수집한 글과 정규화한 제목(12자 이상)이 같으면 같은 글로 봅니다. 같은 글이 다른 출처에서 오면 새로 만들지 않고 `other_sources`에 붙입니다(`CollectService.storeRawItem`). 임베딩은 쓰지 않습니다.
- **③ 규칙 점수로 1차 거르기:** 소스 신뢰도, 관심 키워드, 참여도, 다른 출처 수, 최신성으로 점수를 매기고(`src/worker/pipeline/select.ts`의 `ruleScore`), 상위 120건만 LLM에 보냅니다.
  ```
  ruleScore = 소스 가중치 + 관심 키워드(0~1) + 참여도(0~1, log10 환산)
            + 0.3 × min(3, 다른 출처 수) + 0.5 × 최신성(72시간에 걸쳐 1 → 0)
  ```
- **④ LLM 선별:** 아직 선별하지 않은 기사만 10건씩 묶어 20B로 분류·관련도(0~1)·중요도(1~5)를 매깁니다. 모든 배치가 실패하면 생성을 중단합니다.
  ```
  finalScore = 관련도 × 중요도 + 0.5 × 참여도(0~1)
             + 0.3 × min(3, 다른 출처 수) + 0.1 × ruleScore
  ```
  개인화 가중치는 점수에 없습니다(구현하지 않음, 6.5절).
- **⑤ 같은 소식 묶기 1차:** 최종 점수 상위 후보(브리핑 크기의 2배까지)를 120B에 보내 같은 발표를 다룬 기사끼리 묶습니다. 대표는 LLM이 고른 원본에 가장 가까운 기사이고, 나머지는 `merged_into`로 표시해 대표의 출처 목록으로 옮깁니다(`applyClusters`). 처음 설계의 로컬 임베딩 클러스터링 대신 LLM 호출로 합니다(13.1절). `clusters` 테이블은 없습니다.
- **⑥ 지난 7일 중복 확인:** 상위 후보를 지난 7일 브리핑에 실린 기사 목록과 함께 120B에 보냅니다. 이미 보낸 소식은 빼고 지난 기사에 출처로 붙이며, 중요한 새 전개면 `follow_up_of`를 남겨 "후속"으로 싣습니다(13.6절). 실패하면 확인 없이 진행합니다.
- **⑦ 선정과 본문 확인:** 관련도 0.4 미만은 빼되 중요도 5는 "그 외 주요 소식"으로 남깁니다. 도구·라이브러리 3건, 실전·응용 2건을 먼저 채우고(관련도 0.6·중요도 2 이상인 후보만), 나머지는 분류별 상한(논문 3, 커뮤니티 4, 업계 3, 그 외 3)을 지키며 점수 순으로 브리핑 크기(기본 20건, 절약 모드 최대 15건)까지 채웁니다. 본문이 300자 미만인 기사는 빼고 다음 후보로 채웁니다(`fillWithContent`, 본문 확인은 브리핑 크기의 2배까지).
- **⑧ 한국어 요약:** 선정된 기사만(약 60건이 아님) 120B로 한 건씩 요약합니다. 한국어 제목, 2~3문장 요약, 핵심 포인트 3~5개, "왜 중요한가"를 받습니다. 이미 요약한 기사는 건너뜁니다.
- **⑨ 같은 소식 묶기 2차:** 한국어 제목·요약끼리 다시 묶어 1차에서 언어가 달라 놓친 중복을 잡습니다. 빠진 자리는 채우지 않습니다.
- **⑩ 본문 번역:** 선정된 영어 기사의 본문을 문단 단위로 번역합니다(13.5절). 절약 모드에서는 미리 번역하지 않습니다.
- **⑪ 머리글:** 선정된 기사의 요약으로 오늘의 한 줄(`headline`)과 오늘의 흐름(`overview`)을 씁니다. 항목별 "왜 중요한가"는 여기서 쓰지 않고 ⑧에서 받은 값을 씁니다. 실패하면 1위 기사의 제목을 씁니다.
- **⑫ 게시:** DB에 `digests`·`digest_entries`를 기록하고 실행 기록을 닫습니다. Renderer에 새 브리핑을 알리는 것과 Windows 알림은 결과를 돌려받은 Main이 합니다.
- **환각 방지:** 원문 발췌만 입력합니다. 원문에 없는 수치나 주장은 쓰지 않도록 지시합니다(`config/prompts/summary.md`).

브리핑 섹션 구성 (2026-10-08 개편: 에이전트·툴링을 도구·라이브러리와 실전·응용으로 나눔). 이름은 `src/shared/types.ts`의 `SECTION_LABEL`입니다.
```
오늘의 톱 (점수 상위 5건)
모델 출시
도구·라이브러리 (최소 3건)
실전·응용 (최소 2건)
주목할 논문 (최대 3건)
커뮤니티 화제 (최대 4건)
업계·정책 (최대 3건)
그 외 주요 소식 (최대 3건)
```

## 10. 데이터 모델 (SQLite)

테이블은 `src/backend/data/schema.ts`의 16개와 전문 검색 색인 `search_fts`입니다. 열 설명은 docs/README.md 3장에 있습니다.

| 테이블 | 내용 |
|---|---|
| `items` | 수집한 기사(원본 정보, 정규화한 URL·제목, 참여도, 다른 출처 목록, LLM 선별 결과, 한국어 제목·요약·핵심 포인트·왜 중요한가, `merged_into`, `follow_up_of`) |
| `contents` | 기사 본문 문단 목록(JSON), 원문에서 추출했는지(`full_text`), 문단별 번역(`paragraphs_ko`) |
| `digests` / `digest_entries` | 날짜별 브리핑(오늘의 한 줄, 흐름, 통계)과 실린 기사의 순위·섹션·왜 중요한가 |
| `saves` | 저장 시각, 저장 후 보강을 마친 시각 |
| `notes` | 기사별 메모 |
| `reads` | 읽음 표시 |
| `tags` / `item_tags` | 태그와 기사-태그 연결(AI 추천 / 직접 입력 구분) |
| `highlights` | 문단 번호, 번역문·원문 구분, 문단 안 위치, 그은 글자, 짧은 메모 |
| `chats` / `chat_messages` | 질문 범위(기사 / 그날 브리핑), 대화 내용, 인용 번호 |
| `settings` | 사용자 설정(월 예산, 하루 상한, 브리핑 크기) |
| `llm_usage` | 호출마다 역할, 모델, 토큰 수, 지연 시간, 비용 |
| `runs` | 브리핑 생성 실행 이력, 수집 구간, 오류 |
| `source_fetches` | 출처별 수집 한 번의 성공 여부, 받은 글 수, 새 글 수, 오류 (90일 보관) |
| `search_fts` | 전문 검색 색인 (FTS5 가상 테이블) |

- 처음 설계에 있던 `clusters`(같은 소식 묶음), `paragraphs`(문단 테이블), `vec_paragraphs`(문단 임베딩, `sqlite-vec`), `events`(👍👎·넘김 기록) 테이블은 만들지 않았습니다. 같은 소식은 `items.merged_into`와 `other_sources`로, 문단은 `contents.paragraphs`의 JSON으로 다룹니다. 저장의 폴더 열도 없습니다.
- 검색: `search_fts` 하나에 기사별로 제목, 본문(요약·핵심 포인트·본문·번역), 메모(메모·하이라이트)를 색인합니다. 토크나이저는 `trigram`이고 2글자 낱말은 LIKE로 보완합니다(13.2절).
- 백업: 구현하지 않았습니다. 하루 한 번 DB를 복사하는 기능은 없습니다.
- 스키마 관리: `src/backend/data/schema.ts`의 Drizzle 테이블 정의가 기준입니다. 고친 뒤 `npm run db:generate`(drizzle-kit)로 `src/backend/data/migrations/`에 변경 SQL을 만들고, Main이 시작할 때 적용합니다. FTS5 색인 테이블만 직접 쓴 SQL입니다(13.13절).

## 11. 기술 스택

`package.json`에 있는 것만 적었습니다.

| 영역 | 선택 |
|---|---|
| 런타임 | Electron 44 |
| 개발·빌드 도구 | `electron-vite` (개발 서버, 빠른 반영), `electron-builder` (NSIS 설치 파일) |
| 언어 | TypeScript (strict 모드) |
| 화면 | React 19 + Vite + **Tailwind CSS v4** (토큰은 `tokens.css`의 `@theme`, 기본 팔레트 초기화). 화면 이동은 React Router(`react-router` 7, `createHashRouter`), 화면 데이터는 TanStack Query(`@tanstack/react-query`). 글꼴은 `pretendard`, `@fontsource/hahmlet` |
| 화면 ↔ Main ↔ Worker | preload `contextBridge` + 타입이 정의된 IPC 계약(`src/shared/ipc.ts`). Main ↔ Worker는 utilityProcess 메시지(Main `postMessage`, Worker `process.parentPort`)이고 계약은 `src/shared/worker-protocol.ts`. `MessagePort`는 쓰지 않음 |
| DB | `better-sqlite3` + Drizzle ORM(`drizzle-orm`), FTS5. 마이그레이션은 `drizzle-kit`이 생성한 SQL(`src/backend/data/migrations`). 2026-10-12에 `node:sqlite` + 직접 작성한 마이그레이션(`PRAGMA user_version`)에서 바꿈(13.13절). 벡터 검색(`sqlite-vec`)은 쓰지 않음 |
| 수집 | Node 내장 `fetch`, `rss-parser`. 소스는 `Promise.all`로 동시에 요청 |
| 본문 추출 | `@mozilla/readability` + `linkedom`. PDF 추출(`unpdf`)과 HTML 정제(`dompurify`)는 쓰지 않음 |
| 중복 제거 | URL 정규화 + 정규화 제목 일치 + **LLM 묶기 2회**(선별 후 원제·첫 부분으로, 요약 후 한국어 요약으로) + 지난 7일 브리핑과의 LLM 중복 확인 1회. 임베딩(`@huggingface/transformers`)은 쓰지 않음 |
| LLM | `groq-sdk`. 모델별 동시 호출 제한은 `p-limit` |
| 설정 파일 | `yaml`(`config/*.yaml` 읽기), `dotenv`(개발 중 `.env`의 API 키 읽기) |
| 검증 | `zod` (LLM JSON 출력, 설정 파일, 수집 API 응답). IPC 메시지는 zod로 검증하지 않고 TypeScript 타입으로만 맞춤 |
| 메모 편집기 | 직접 만든 줄 노트 입력란(`LinedTextarea`). Markdown 편집기 라이브러리는 쓰지 않음 |
| 로그 | 직접 만든 진단 기록(`src/main/diagnostics/diag-log.ts`, `diagnostics.log`). `electron-log`는 쓰지 않음 |
| 테스트 | `vitest`. 순수 함수(정규화·선정·인용·번역 나누기·생성 시점 규칙)와, 메모리 DB에 실제 저장소를 붙인 저장소·서비스 테스트. 저장해 둔 응답 파일로 하는 수집기 테스트는 없음 |

## 12. 디렉터리 구조

```
ai-news/
├─ package.json
├─ electron.vite.config.ts  Main·Worker·preload·화면 빌드와 import 별칭
├─ electron-builder.yml     Windows 설치 파일 설정
├─ drizzle.config.ts        스키마 변경 SQL 생성 설정 (npm run db:generate)
├─ vitest.config.ts
├─ tsconfig.json, tsconfig.node.json, tsconfig.web.json
├─ .env.example             개발용 API 키 자리
├─ build/
│  └─ icon.png              앱 아이콘 (트레이 아이콘은 코드로 그림)
├─ config/                  기본 설정 (설치판은 resources/config로 같이 배포됨)
│  ├─ sources.yaml
│  ├─ interests.yaml
│  ├─ models.yaml
│  ├─ pricing.yaml          모델별 단가 (비용 계산용)
│  ├─ quick-actions.yaml    빠른 질문 버튼
│  └─ prompts/              triage.md, cluster.md, recent.md, summary.md, translate.md, digest.md,
│                           tags.md, chat-item.md, chat-digest.md
├─ src/
│  ├─ main/                 Main 프로세스 (3.1절)
│  │  ├─ index.ts           조립만 (composition root)
│  │  ├─ ipc/               화면 요청 입구: index.ts, digest.ts, library.ts, chat.ts, settings.ts,
│  │  │                     diagnostics.ts, window.ts
│  │  ├─ triggers/          briefing-triggers.ts (앱 시작·잠금 해제·절전 복귀·8시),
│  │  │                     collect-timer.ts (2시간마다 미리 수집)
│  │  ├─ services/          ports.ts, briefing-, settings-, digest-, search-, source-stats-, article-, tag-,
│  │  │                     highlight-, chat-, diagnostics-service.ts, test-support.ts (+ 테스트)
│  │  ├─ platform/          tray/(tray.ts, tray-icon.ts), window.ts, notifier.ts, secrets.ts, network.ts,
│  │  │                     autostart.ts, netcheck.ts, worker-client.ts, renderer-events.ts,
│  │  │                     system.ts(단축키·외부 링크)
│  │  └─ diagnostics/       diag-log.ts, dev-screenshot.ts
│  ├─ preload/
│  │  ├─ index.ts           contextBridge로 화면에 노출할 API (window.jogan)
│  │  └─ index.d.ts
│  ├─ worker/               utilityProcess
│  │  ├─ index.ts           메시지 처리
│  │  ├─ article-worker.ts  Worker 기능 구현과 조립
│  │  ├─ log.ts             Worker 로그 함수의 모양
│  │  ├─ services/          collect-, pipeline-, enrichment-, translation-, chat-answer-service.ts,
│  │  │                     testing.ts (+ 테스트)
│  │  ├─ collectors/        index.ts (RSS·HF Papers·arXiv·Hacker News·GitHub 릴리스 수집기),
│  │  │                     types.ts (RawItem, 요청 도구)
│  │  ├─ pipeline/          normalize.ts (URL·제목 정규화), select.ts (점수·선정·묶기),
│  │  │                     schemas.ts (LLM 출력 스키마)
│  │  ├─ knowledge/         extract.ts (본문 추출), content.ts (추출 대상 판단·문단 나누기),
│  │  │                     translate.ts (문단별 번역), citations.ts (인용 정리·문단 고르기)
│  │  └─ llm/               groq.ts (Groq 호출), service.ts (LlmSession, LlmSessionFactory)
│  ├─ backend/              Main·Worker가 같이 쓰는 코드 (화면은 쓰지 않음)
│  │  ├─ data/              DB 계층: schema.ts, client.ts, testing.ts,
│  │  │                     migrations/(0000_initial.sql, 0001_search_fts.sql, meta/),
│  │  │                     repositories/(item-, digest-, run-, llm-usage-, source-fetch-, library-, tag-,
│  │  │                     highlight-, chat-, settings-, search-repository.ts)
│  │  ├─ domain/            두 프로세스가 같이 쓰는 규칙: app-settings.ts, usage.ts, translation.ts
│  │  └─ config/            설정 파일 읽기: index.ts, pricing.ts
│  ├─ renderer/             React 앱
│  │  ├─ index.html
│  │  └─ src/
│  │     ├─ main.tsx        진입점
│  │     ├─ app/            App.tsx, router.tsx, providers/, layout/(NavRail·TitleBar), global/,
│  │     │                  styles/(tokens.css·app.css·fonts.ts)
│  │     ├─ screens/        today, library, archive, ask, sources, settings, diagnostics (page.tsx)
│  │     ├─ domains/        article, digest, highlight, chat
│  │     └─ common/         ui, layout, lib
│  └─ shared/               types.ts, ipc.ts (IPC 계약), worker-protocol.ts (Main ↔ Worker 계약),
│                           schedule.ts (생성 시점 규칙), wordmark.ts (제호 글자 모양)
├─ docs/
│  ├─ README.md             지금 구조와 동작을 정리한 문서
│  └─ (Word 문서 1개)
├─ README.md
└─ DESIGN.md
```

- 처음 설계에 있던 파일 가운데 만들지 않은 것: 소스별 수집기 파일(`rss.ts`, `arxiv.ts`, `hfPapers.ts`, `hackernews.ts`, `reddit.ts`, `githubReleases.ts`. 수집기는 `collectors/index.ts` 한 파일에 있고 Reddit은 RSS 수집기로 받음), `pipeline/`의 `dedup.ts`·`ruleFilter.ts`·`triage.ts`·`summarize.ts`·`digest.ts`·`publish.ts`(이 단계들은 `services/pipeline-service.ts`·`collect-service.ts`와 `pipeline/select.ts`에 있음), `knowledge/`의 `paragraphs.ts`·`embed.ts`·`search.ts`·`chat.ts`·`personalize.ts`·`export.ts`, `llm/`의 `client.ts`·`rateLimiter.ts`·`models.ts`, `shared/schemas.ts`, `config/prompts/chat.md`.
- `resources/` 폴더와 `renderer/assets/fonts/` 폴더는 없습니다. 트레이 아이콘은 `src/main/platform/tray/tray-icon.ts`가 코드로 그리고, 글꼴은 npm 패키지에서 가져옵니다.

## 13. 개발 로드맵

| 단계 | 내용 | 결과 |
|---|---|---|
| **0. 사전 검증** | Groq 한국어 품질 비교 테스트(7.7절), Electron 기본 뼈대(트레이, 알림 클릭, `unlock-screen` 이벤트, 자동 시작, 이 PC 네트워크에서 Groq·RSS 호출이 되는지 확인) | 모델 확정, 핵심 기능이 이 PC에서 동작하는지 확인 |
| **1. MVP** | 수집(RSS, arXiv, HF Papers, HN) → URL 중복 제거 → 20B 선별 → 120B 요약 → DB → "오늘" 화면. 트레이 메뉴로 수동 실행 | 브리핑이 앱 창에 나옴 |
| **2. 자동 실행** | 자동 시작, 생성 조건(앱 시작 / 잠금 해제 / 절전 복귀 / 8시 타이머), 알림 클릭으로 창 열기, 단축키, 백그라운드 수집, 요청 속도 조절 | **출근해서 PC를 켜면 알림이 옴** |
| **3. 저장·메모** | ☆저장 + 본문 추출(문단 번호), 라이브러리, 태그, 메모, 읽음 표시, 전문 검색, 아카이브 | 기사를 쌓고 다시 찾을 수 있음 |
| **4. AI 질문** | 기사 채팅(스트리밍, 문단 인용), 빠른 질문, 오늘 브리핑에 질문, 답변을 메모로 옮기기 | 기사로 AI와 대화 |
| **5. 품질** | 임베딩 클러스터링, 점수 매기기, 최종 브리핑, 7일 중복 방지, 소스 확장 | 브리핑 품질 향상 |
| **6. 지식화** | 하이라이트, 라이브러리 RAG, 개인화 가중치, Markdown/Obsidian 내보내기, 주간 리뷰, 설치 파일 배포 | 개인 AI 지식 저장소 |

위 표는 처음 세운 계획입니다. 실제로 한 일은 아래 13.1~13.13절에 날짜순으로 적었습니다. 계획과 달라진 점은 다음과 같습니다.
- 0단계의 한국어 품질 비교 테스트는 저장소에 코드와 결과물이 없습니다(7.7절).
- 5단계의 임베딩 클러스터링은 구현하지 않았고, 같은 소식 묶기와 7일 중복 방지를 LLM 호출로 합니다(13.1절, 13.6절).
- 6단계에서는 하이라이트와 설치 파일만 만들었습니다. 라이브러리 RAG, 개인화 가중치, Markdown/Obsidian 내보내기, 주간 리뷰는 구현하지 않았습니다(13.6절).

### 13.1 1단계 MVP 구현 결과 (2026-10-07)

- **파이프라인:** 수집 → 중복 합치기 → 규칙 점수 → 20B 선별(10건씩) → 같은 소식 묶기(120B) → 선정 → 본문 추출 → 120B 요약(한국어 제목·요약·핵심 포인트·왜 중요한가) → 요약 기준 2차 묶기 → 머리글(120B) → 게시.
- **실측 비용:** 후보 약 115건, 선정 17~18건 기준 **1회 약 $0.01** (월 22회 약 $0.25). 예산 $5 대비 여유가 큽니다.
- **설계에서 바뀐 점**
  - "왜 중요한가"를 머리글 단계에서 한꺼번에 쓰면 다른 기사 코멘트가 섞여서, 기사별 요약 단계에서 함께 씁니다.
  - gpt-oss가 strict JSON에서 배열을 `{items: [...]}`로 감싸는 실수를 자주 합니다. 응답의 `failed_generation`을 풀어서 살리는 처리를 넣었습니다.
  - 같은 소식 묶기를 5단계에서 1단계로 앞당겼습니다(LLM 2회). 대표 기사는 LLM이 고른 원본(공식 발표 > 보도 > 커뮤니티)입니다.
  - 일부 사이트는 User-Agent에 괄호 설명이 있으면 봇으로 차단합니다(GeekNews 403).
  - 처음에 CSS Modules로 구현했다가 설계대로 Tailwind v4로 옮겼습니다. 버튼처럼 변형이 있는 부품은 높이·여백·테두리 색을 변형마다 따로 줍니다(기본 클래스와 겹치면 어느 쪽이 이길지 보장되지 않음).
- **남은 품질 과제 (5단계):** 사소한 글이 상위에 오르는 경우, "왜 중요한가"가 60자 지시보다 길어지는 경우, 언어가 다른 같은 소식을 가끔 못 묶는 경우, Anthropic 공식 소식 수집(RSS 없음), DeepMind 피드가 가끔 HTML을 돌려주는 문제.

### 13.2 3단계 저장·메모 구현 결과 (2026-10-07)

- **저장하면 뒤에서:** 원문 본문 추출(문단 보관) → 20B가 태그 2~3개 추천(실패하면 120B로 한 번 더). 끝나면 화면의 태그·본문이 저절로 갱신됩니다. 태그 추천 1건 약 $0.0001.
- **라이브러리:** 저장한 기사 목록, 전문 검색(제목·요약·본문·메모), "메모 있는 기사" 필터, 태그 필터(개수 표시), 태그 떼기·추가, 저장 해제.
- **아카이브:** 날짜별 지난 브리핑 목록 → 그날 지면 그대로 보기, 브리핑에 실린 모든 기사 검색.
- **기사 패널:** 오늘·라이브러리·아카이브 모두 같은 패널. [메모 / 본문(¶ 문단 번호) / 질문(4단계) / 하이라이트(6단계)] 탭.
- **검색 구현:** SQLite FTS5 trigram(한국어 3글자 이상 부분 일치) + 2글자 낱말은 LIKE로 보완. 낱말은 AND.
- **태그 정리:** 소문자·하이픈으로 통일하고, 하이픈만 다른 기존 태그(openweight ↔ open-weight)는 기존 표기로 합칩니다. 아무 기사에도 안 쓰는 태그는 지웁니다.
- **미룬 것:** 폴더(컬렉션)는 설계상 선택 사항이라 태그만 먼저 만들었습니다. 하이라이트는 계획대로 6단계.

### 13.3 4단계 AI 질문 구현 결과 (2026-10-08)

- **기사 채팅:** 기사 패널 질문 탭. 본문 문단에 [¶번호]를 붙여 근거로 넘기고 답변을 스트리밍으로 받습니다. 끝나면 실제로 있는 번호만 남겨 저장합니다. 인용을 누르면 본문 탭의 그 문단으로 스크롤·강조합니다.
- **브리핑 채팅:** 메뉴의 "질문" 화면. 그날 실린 기사 목록을 [#순위]로 넘기고, 인용을 누르면 오늘 화면에서 그 기사를 엽니다.
- **설계에서 바뀐 점:** 빠른 질문의 "관련 기사 찾기"는 라이브러리 검색 기반 질문(6단계)이 필요해 "한계와 반론"으로 바꿨습니다. 라이브러리 전체 질문(RAG)은 6단계로 둡니다.
- **실측:** 기사 질문 1건 약 $0.001 미만. 기사에 없는 내용을 물으면 없다고 먼저 밝히고 일반 지식과 구분해 답합니다.

### 13.4 화면 개선 (2026-10-08, 사용자 피드백 반영)

- **기사 읽기 화면:** 옆 패널은 개요(요약·왜 중요한가·기사 읽기·저장)만 보여주고, "기사 읽기"(Enter·두 번 클릭)로 전용 읽기 화면을 엽니다. 넓은 본문 단(최대 720px) + 메모·질문 단(1200px 이상에서 오른쪽 고정). J/K 다음·이전, Esc 목록으로.
- **가독성:** 글자 크기를 한 단계씩 올림(본문 16, 본문 읽기 18, 목록 제목 18, 메타 14, 최소 13px). 보조 회색을 진하게(ink-muted #45454D, ink-faint #5A5A62).
- **기타:** 비활성 버튼은 외곽선, 목록에 출처 + 참여도 배지, 분류 탭 한 줄(짧은 이름), 오늘의 흐름 두 줄 + 더 보기, "다시 만들기"는 ⋯ 메뉴 안에서 확인 후 실행, 동작 알림(토스트), 단축키 안내는 ? 키 대화상자, 작은 버튼 클릭 영역 확대, 빠른 질문은 칩, 로딩 자리 표시, 생성 진행 단계 표시.
- **단축키 변경:** 목록에서 Enter는 원문이 아니라 기사 읽기, 원문은 O.

### 13.5 5단계 품질: 본문 번역과 개발자 소스 확장 (2026-10-08)

- **본문 전체 번역:** 선정된 영어 기사의 본문을 문단 단위로 번역해 `contents.paragraphs_ko`에 둡니다. 읽기 화면에서 [한국어 | 원문 | 함께 보기]로 바꿔 봅니다(T). 문단 번호가 같아서 인용·강조가 그대로 맞습니다. 상한은 기사당 원문 40,000자이고, 넘는 문단은 원문으로 보여줍니다. 절약 모드에서는 미리 번역하지 않고 열 때 번역합니다.
- **요약 조정:** 본문 입력 상한을 6,000자 → 12,000자로, 핵심 포인트를 최대 3개 → 3~5개로. 번역이 있으므로 별도의 긴 상세 요약은 만들지 않습니다.
- **소스 확장:** 개발자·엔지니어링 블로그 9곳, 국내 기술블로그 3곳, GitHub 릴리스 감시(11개 저장소, 메이저·마이너만), Show HN, Reddit r/LocalLLaMA. LangChain·LlamaIndex·Modal 블로그는 피드가 깨졌거나 없어 뺐습니다.
- **분류·선정:** 에이전트·툴링 → 도구·라이브러리(tools) + 실전·응용(applied). 기존 기사는 tools로 옮김(마이그레이션 6). 최소 몫 도구 3·실전 2(관련도 0.6·중요도 2 이상만), 논문 상한 5 → 3, 업계 상한 4 → 3. 기본 브리핑 크기 18 → 20.
- **실측 (18건 선정):** 1회 약 $0.018 — 요약 $0.0076, 번역 $0.0075(14건, 입력 14K·출력 9K 토큰), 나머지 $0.003. 월 22회 약 $0.40으로 예산 $5 안에서 여유가 큽니다.
- **본문 없는 기사 제외 (추가):** 원문 추출에 실패해 본문이 300자 미만인 기사(주로 HN 링크 글, 링크만 있는 Reddit 글)는 제목만으로 요약하면 내용을 지어내게 되므로 싣지 않고 다음 순위 후보로 채웁니다. 실측에서 5건이 빠지고 20건이 모두 채워졌습니다.

### 13.6 마무리: 하이라이트, 낮 동안 미리 수집, 7일 중복 방지 (2026-10-08)

- **범위 확정:** 남은 기능은 이 세 가지만 하기로 했습니다. 내보내기(Markdown/Obsidian), 라이브러리 RAG, 개인화 가중치, 주간 리뷰, 설정 화면 확장, 트렌딩 소스, 논문 PDF는 하지 않습니다.
- **하이라이트:** 드래그 → 선택 막대(하이라이트 H / 질문). 모양은 형광펜 질감(글자 아래쪽, 둥근 끝, 잉크 농담), 메모가 있으면 ✎, 문단 여백에 강조색 교정 괘선, 마우스를 올리면 메모 카드(보기·고치기·질문·지우기). 번역문·원문 어느 쪽에도 긋고(`highlights.variant`), 문단 번호 + 문단 안 위치 + 그은 글자를 저장합니다. 겹치면 합치고, 그은 기사는 자동 저장. 하이라이트 탭에서 메모·이 부분 질문·지우기. 내보내기는 만들지 않습니다.
- **낮 동안 미리 수집:** 2시간마다 수집만(LLM 없음). 아침 후보에 낮 동안 쌓인 글이 들어가 릴리스·인기글을 놓치지 않습니다.
- **7일 중복 방지:** 임베딩 대신 120B 호출 한 번으로 지난 7일 브리핑 기사와 비교합니다(약 $0.001). 같은 소식은 빼고, 큰 후속 소식은 "후속"으로 표시해 싣습니다. 시험한 예에서 다른 매체의 같은 보도는 중복으로, "정식 출시·가격 발표"는 후속으로 정확히 갈랐습니다.
- **수집 안정화:** 피드를 rss-parser가 직접 받지 않고 fetch로 받아 넘깁니다. gzip 응답 때문에 실패하던 DeepMind 피드가 정상이 됐습니다.

### 13.7 화면 정리 (2026-10-08, 사용자 피드백 반영)

- **다시 만들기 제거:** 오늘 브리핑이 있으면 수동 요청이 건너뛰어지는데 화면은 "준비 중"에서 멈추던 버그가 있었습니다. 같은 날은 결과가 거의 같아 다시 만들기 자체를 없앴습니다. 오늘 것이 없거나 실패했을 때만 "오늘 브리핑 만들기".
- **읽기 버튼 위치:** 옆 개요 패널이 아니라 목록 줄 오른쪽에 "읽기 →".
- **아카이브:** 옆 패널 없이 날짜 목록을 화면 폭 전체로, J/K·Enter·"보기". (한 단 화면에 옆 단을 새로 붙이는 방식은 화면이 난잡해져서 쓰지 않음)
- **기사 읽기 옆 단:** 탭이 내용을 가리던 문제 수정(탭 고정 + 내용 따로 스크롤).
- **너비 조절:** 목록 화면의 오른쪽 기사 패널과 읽기 화면 옆 단은 경계선을 끌어 너비 조절(320~720px, 창 절반 이하, 두 번 누르면 기본, 기억).
- **넓은 창:** 지면 머리(오늘의 한 줄·흐름) 글줄 폭을 720px로 제한.

### 13.8 이름과 트레이 아이콘 (2026-10-08)

- **이름: Jogan.** 화면 제호·창 제목·알림·트레이·설치 프로그램 이름을 Jogan으로 맞췄습니다. 내부 식별자(`com.ainews.desktop`)와 데이터 폴더(`%APPDATA%\AINews`)는 그대로 둬서 기존 DB·저장한 기사·설정이 이어집니다.
- **제호·아이콘:** 제호는 블랙레터 "Jogan"(UnifrakturMaguntia, OFL — 글꼴을 싣지 않고 외곽선 경로만 `shared/wordmark.ts`에 담음) + 이중선 + 부제 "朝刊 · 매일 아침 AI 소식". 앱 아이콘(`build/icon.png`)과 트레이 아이콘은 같은 블랙레터 J.
- **트레이 아이콘:** 색 원(임시) → 앱 아이콘과 같은 구성(종이색 + 먹색 테두리 + 블랙레터 J). 상태는 오른쪽 아래 배지: 평소 없음 / 만드는 중 속 빈 먹색 원 / 새 브리핑 강조색 원 / 오프라인 회색 원 / 실패 빨간 원 + !. 화면 배율별(16·20·24·32px)로 코드에서 그립니다(`tray-icon.ts`). 밝은·어두운 작업 표시줄 모두에서 보이게 테두리를 둡니다.
- **툴팁:** "Jogan · 상태"에 새 브리핑이면 오늘의 한 줄, 실패면 이유를 붙입니다(127자까지). 트레이 아이콘을 눌러 새 브리핑을 열면 배지를 거둡니다.

### 13.9 움직임: "인쇄소의 움직임" (2026-10-08)

- **원칙:** 잉크·도장·형광펜·종이에서 가져온 짧은 움직임(120~320ms), 튀지 않음. 페이지 전환은 움직이지 않음. Windows "애니메이션 효과"를 끄면 모두 끔(`prefers-reduced-motion`). 라이브러리 없이 CSS만.
- **토큰:** `tokens.css`의 `--ease-ink`·`--ease-paper`·`--ease-out`, `--animate-*`(paper-feed, paper-out, timer, stamp, marker, nudge-in, flash, ink-in, caret, rule-draw, ink-breathe, paper-drop, fade-in). 유틸리티로 어려운 것은 `app.css`의 `.marker`, `.paper-dialog`, `.slide-indicator`, `.width-ease`.
- **적용:**
  | 대상 | 움직임 |
  |---|---|
  | 토스트 | 위에서부터 드러남(윤전기 쪽지) + 아래 강조색 선이 줄며 남은 시간 표시, 사라질 때 4px 내려가며 흐려짐 |
  | 저장 버튼 | 채워지는 순간 아이콘이 도장처럼 찍힘 (처음 열 때는 움직이지 않음) |
  | 하이라이트 | 방금 그은 것만 왼쪽→오른쪽으로 형광펜이 그어짐. 마우스를 올리면 잉크가 짙어지고 메모 카드가 종이처럼 놓임 |
  | 탭·본문 전환기 | 밑줄·검은 칸이 고른 항목으로 미끄러짐 (`useSlidingIndicator`) |
  | 목록 선택 | 왼쪽 강조색 세로선이 그어지고 "읽기 →"가 살짝 들어옴. 읽은 제목은 0.4초에 걸쳐 흐려짐 |
  | 인용·하이라이트 누르기 | 그 문단에 형광 잔상이 1.2초 동안 사라짐 (누를 때마다 다시) |
  | 번역 도착 | 원문을 보던 중 번역이 오면 문단이 위에서부터 20ms 간격으로 인쇄되듯 나타남 |
  | AI 답변 | 받는 동안 글 끝에 강조색 커서, 끝나면 인용이 차례로 찍힘 |
  | 생성 진행 | 끝난 단계의 ✓가 찍히고 진행선이 부드럽게 늘어남 |
  | 새 브리핑 도착 | 보고 있던 오늘 화면의 지면 머리 이중선이 왼쪽→오른쪽으로 그어짐 |
  | 대화상자 | 바탕이 어두워지고 종이가 8px 아래에서 올라와 놓임 (닫을 때 반대로) |
  | 불러오는 중 | 잉크가 배어들 듯 느린 명암 변화 |
  | 메모 자동 저장 | 저장될 때마다 작은 ✓가 찍힘 |
  | 너비 조절 | 끄는 중에는 바로 따라오고, 두 번 눌러 기본으로 돌아갈 때만 부드럽게 |

### 13.10 제목 표시줄: 지면 윗줄 (2026-10-08)

- Windows 기본 테두리·제목 표시줄 없이(`frame: false`) 앱의 `TitleBar`(36px)가 윗줄과 창 버튼까지 직접 그립니다. 창 버튼(최소화·최대화/복원·닫기)은 1px 먹선 기호, 마우스를 올리면 종이를 누른 색, 닫기만 빨간 바탕에 흰 기호(Windows 관례). 닫기는 앱을 끄지 않고 트레이로 숨깁니다. 창 조작은 IPC(`window:*`)로 Main의 `MainWindow`(`WindowControls`)가 합니다. 윗줄 빈 곳 끌기·더블클릭 최대화·가장자리 크기 조절은 그대로 되고, Windows 11 스냅 레이아웃 메뉴(최대화 버튼에 올렸을 때)는 쓸 수 없습니다(Win+화살표·화면 가장자리로 끌기는 됨).
- **구성:** 왼쪽에 신문 맨 윗줄처럼 날짜 · 제N호 · 기사 N건(날짜 글꼴), 오른쪽에 상태(만드는 중 / 새 브리핑 / 연결 대기 중 / 생성 실패, 트레이 배지와 같은 색 점, 누르면 오늘 화면), 아래 괘선 위에 생성 중 진행선. 제호는 메뉴 맨 위에 있으므로 윗줄에는 넣지 않습니다.
- 빈 곳은 끌기 영역(`.app-drag`), 버튼은 `.app-no-drag`. 창이 비활성이면 글자와 버튼 기호가 흐려집니다.
- 화면 높이는 `h-screen` 대신 "제목 표시줄을 뺀 나머지"(`h-full` 사슬)로 바꿨습니다.

### 13.11 출처 페이지 (2026-10-08)

- 왼쪽 메뉴 "출처": 어디서 자료를 받는지, 얼마나 받아서 얼마나 실리는지 보는 읽기 전용 통계 화면. 출처 편집은 하지 않음(sources.yaml).
- 흐름(수집 → 중복 합침 → AI 선별 → 실림 → 저장)과 단계별 LLM 비용, 최근 30일 날마다 막대, 출처별 표(상태·수집·실림·채택률·저장, 펼치면 수집 조건·수집 기록·실린 기사).
- 기간 7일·30일·전체, 기간 숫자와 전체 누적을 함께 표시.
- 출처별 수집 성공·실패를 남기는 `source_fetches`(마이그레이션 8)를 추가. 브리핑 생성·미리 수집 모두 기록, 90일 보관.

### 13.12 화면 코드 개편: 폴더 구조와 TanStack Query (2026-10-08)

- 화면 코드를 `app/ · screens/ · domains/ · common/`(화면 단위 + 공용 도메인)으로 옮기고 import를 `@/` 별칭으로 바꿨습니다(6.6절 표).
- 화면 데이터를 TanStack Query 캐시로 옮겼습니다. 이전에는 같은 기사를 오늘 목록·검색 결과·상세가 각자 들고 `onPatch` 콜백으로 맞췄는데, 이제 `patchArticle`이 모든 캐시를 한꺼번에 고치고, Main 알림(`item-updated`, `digest-updated`)은 `QueryProvider` 한 곳에서 무효화로 잇습니다. 전역 스토어는 필요가 없어 넣지 않았습니다.

### 13.13 프로세스 역할 분리와 DB 계층 개편 (2026-10-12)

- **이전 구조:** Worker만 DB를 열었고, SQL은 모두 `src/worker/db/repo.ts` 한 파일에 직접 썼습니다. 화면의 조회와 저장·메모·태그·하이라이트 같은 짧은 쓰기도 전부 Main → Worker 호출을 거쳤습니다. 스키마는 마이그레이션 배열과 `PRAGMA user_version`으로 관리했습니다.
- **프로세스를 역할로 나눔:** Worker는 기사를 만들어 오는 일(수집·브리핑 생성·본문 추출·태그 추천·번역·답변 생성)만 하고, Main이 DB를 직접 열어 사용자 데이터와 화면용 조회를 맡습니다. Worker를 따로 둔 이유는 오래 걸리는 일이 Main을 막지 않게 하는 것인데, 사용자 데이터 쓰기와 조회는 짧은 DB 작업이라 Worker를 거칠 이유가 없습니다. Main이 직접 처리하면 화면 요청이 Worker의 응답을 기다리지 않습니다. Main ↔ Worker 규약은 `runPipeline`·`collectOnly`·`enrichItem`·`translateItem`·`answerQuestion` 다섯 호출로 줄었습니다. Worker는 기사 갱신·질문 이벤트를 보내지 않고 생성 진행 상황과 답변 조각만 보내며, 추천 태그 붙이기·보강 완료 표시·질문과 답변 저장·화면 알림은 Main이 합니다.
- **직접 쓴 SQL 대신 ORM:** Drizzle ORM + `better-sqlite3`로 바꿨습니다. 테이블 정의가 `src/backend/data/schema.ts` 한 곳에 있고, 쿼리 결과의 타입이 그 정의에서 나오므로 컬럼 이름과 타입을 SQL 문자열과 TypeScript 타입 양쪽에 따로 적어 맞출 필요가 없습니다. 스키마 변경 SQL은 `npm run db:generate`(drizzle-kit)가 `src/backend/data/migrations`에 만들고, Main이 시작할 때(Worker를 띄우기 전) 적용합니다. FTS5 가상 테이블(`search_fts`)은 Drizzle 스키마로 표현할 수 없어 직접 쓴 SQL 파일로 둡니다. 예전 `PRAGMA user_version` 마이그레이션은 없앴습니다.
- **repository와 service 분리:** controller(Main `ipc/`, Worker `index.ts`) → service → repository로 나눴습니다. 저장소(`src/backend/data/repositories/*-repository.ts`, 11개)는 읽고 쓰기만 하고, 업무 규칙과 트랜잭션 경계는 서비스(`src/main/services`, `src/worker/services`)에 둡니다. 저장소를 두 프로세스가 같이 쓰므로 규칙이 저장소에 섞이면 어느 프로세스의 규칙인지 흐려지고, 규칙을 서비스에 모으면 메모리 DB에 실제 저장소를 붙여 서비스 단위로 테스트할 수 있습니다.
- **테이블마다 쓰는 프로세스는 하나:** Worker는 `items`·`contents`·`digests`·`digest_entries`·`runs`·`llm_usage`·`source_fetches`를, Main은 `saves`·`notes`·`reads`·`tags`·`item_tags`·`highlights`·`settings`·`chats`·`chat_messages`를 씁니다. 한 파일에 연결이 둘이지만(WAL, 잠금 대기 5초) 같은 행을 두 프로세스가 서로 고치는 일이 없어 덮어쓰기 충돌이 생기지 않습니다. `search_fts`만 양쪽이 쓰는데, 원본 테이블에서 기사 단위로 다시 만드는 파생 색인이라 어느 쪽이 갱신해도 결과가 같습니다.
- **함께 옮긴 것:** 두 프로세스가 같은 규칙으로 판단해야 하는 것(사용자 설정 읽기, 사용액·절약 모드 판정, 번역 대상 판정)은 `src/backend/domain`로, 설정 파일 읽기는 `src/backend/config`로 옮겼습니다.
- **바뀌지 않은 것:** 화면과 화면 API(`src/shared/ipc.ts`의 `JoganApi`, DTO)는 그대로입니다. 지금 구조는 docs/README.md 2장·3.6절에 있습니다.

### 13.14 지난 질문 목록 (2026-10-12)

- **추가한 것:** 질문 화면 위에 탭 두 개("오늘 브리핑에 질문" / "지난 질문")를 두고, "지난 질문"에 질문한 적 있는 기사와 브리핑을 최근에 질문한 것부터 보여줍니다(마지막 질문 날짜, 제목, 출처, 질문 수, 가장 최근 질문). 기사를 열면 읽기 화면이 질문 탭으로, 브리핑을 열면 그날 브리핑의 대화가 열립니다. 주소는 `/ask/history`, `/ask/history/item/:itemId`, `/ask/history/digest/:date`입니다.
- **구현:** 스키마는 바꾸지 않았습니다. `chats`·`chat_messages`에서 대화별 질문 수와 가장 최근 질문을 쿼리 하나로 읽고(`listChatQuestionSummaries`), Main의 `ChatService.listChatHistory`가 범위 키를 기사·브리핑으로 풀어 제목을 붙입니다. 기사나 브리핑이 없어진 대화는 목록에서 뺍니다. Worker와 Main ↔ Worker 규약은 그대로입니다.
- **질문해도 기사를 저장하지 않는 이유:** 질문했다고 해서 그 기사에 관심이 있다는 뜻은 아니기 때문입니다. 그래서 질문한 기사를 다시 찾는 길을 저장(라이브러리)이 아니라 대화 기록에서 만든 목록으로 따로 뒀습니다.

## 14. 리스크와 대응

| 리스크 | 대응 |
|---|---|
| **Groq 모델 종료·변경** | 모델 ID를 `config/models.yaml`로 분리해 파일만 고치면 바뀜. 시작 시 모델 목록 확인과 대체 모델 자동 전환은 구현하지 않음 (7.6절) |
| **Groq 요청 제한** | 모델별 동시 호출 4개 제한, 429 재시도는 `groq-sdk`(최대 3회), 규칙 필터로 호출 수 줄이기 (7.4절). 토큰 버킷 속도 조절은 구현하지 않음 |
| **LLM 비용 증가·폭주** | 월 예산·하루 상한·실행당 토큰 상한, 절약 모드 자동 전환, 메뉴 아래·설정·출처 화면의 사용액 표시 (7.5절) |
| **GPT-OSS 한국어 품질** | 필요하면 `config/models.yaml`의 `summary`·`translate`만 다른 모델로 교체. 사전 비교 테스트의 결과물은 저장소에 없음 (7.7절) |
| 구조화 출력과 스트리밍을 동시에 못 씀 | 선별·묶기·요약·번역·머리글·태그는 JSON, 채팅은 스트리밍 텍스트로 역할을 나눔 |
| 로그인 직후 네트워크 미연결 | 앱 시작 1분 뒤 확인 + 30초 간격으로 최대 5분 대기, 끝내 안 되면 트레이 "오프라인"으로 두고 다음 이벤트 때 재시도 |
| Worker 프로세스 비정상 종료 | Main이 감지해서 3초 뒤 다시 띄움(`src/main/platform/worker-client.ts`). 응답을 기다리던 호출은 모두 실패로 끝나고, 진행 중이던 작업을 이어서 하지는 않음. `running`으로 남은 실행 기록은 다음에 Worker가 시작할 때 오류("앱 종료로 중단됨")로 정리하고, 오늘 브리핑이 없으므로 다음 계기에 처음부터 다시 만듦. 다시 뜨기를 기다리는 동안 들어온 호출은 새 Worker가 준비되면 보냄 |
| Worker가 준비도 못 하고 연달아 3번 종료 | Main이 다시 띄우기를 그만두고, 이후 Worker 호출은 바로 실패로 답함. 화면용 조회와 저장·메모·태그·하이라이트는 Main이 직접 처리하므로 계속 동작 |
| 네이티브 모듈 빌드 문제 | DB 드라이버 `better-sqlite3`가 네이티브 모듈임. 설치 파일을 만들 때 다시 빌드하지 않게 하고(`electron-builder.yml`의 `npmRebuild: false`), `.node` 파일은 asar 밖에 둠(`asarUnpack`) |
| 사내 네트워크 (프록시, SSL 검사) | Worker의 수집과 Groq 호출은 Node `fetch`를 씀(시스템 프록시·인증서를 따르는 Electron `net.fetch`로 바꾸지 않음). `net.fetch`는 Main의 네트워크 연결 확인에만 씀. 진단 화면의 네트워크 점검이 같은 주소를 두 방식으로 호출해 차이를 보여 줌(`src/main/platform/netcheck.ts`) |
| PC 정책 (시작 프로그램 등록, 알림 차단) | 알림이 막혀도 트레이 아이콘 배지·툴팁과 제목 표시줄 상태로 새 브리핑·실패를 표시. 진단 화면에 알림 테스트가 있음 |
| 본문 추출 실패 (유료 기사, JS로 그리는 페이지) | 브리핑: 본문이 300자 미만이면 싣지 않고 다음 후보로 채움. 저장한 기사: 수집한 요약을 본문 대신 보관하고 원문 본문이 아님을 표시. 사용자가 본문을 붙여넣는 기능은 구현하지 않음 |
| 요약·답변 환각 | 원문에 없는 내용을 쓰지 않도록 지시, 답변에 문단 번호를 붙이게 하고 없는 번호는 걸러냄. 본문이 없는 기사는 요약하지 않음 |
| 스크래핑 약관 위반, 차단 | RSS와 공식 API 우선, 같은 User-Agent로 요청, Reddit은 하루 인기글 피드만. 요청 사이에 간격을 두는 코드는 없음 |

## 15. 추가 확인 필요

현재 없음.

## 참고 자료
- Groq 모델 목록: https://console.groq.com/docs/models
- Groq 요청 제한: https://console.groq.com/docs/rate-limits
- Groq 구조화 출력: https://console.groq.com/docs/structured-outputs
- Groq 프롬프트 캐싱: https://console.groq.com/docs/prompt-caching
- Groq Compound 서비스 종료 안내: https://console.groq.com/docs/compound
