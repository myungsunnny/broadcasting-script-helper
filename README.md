# 🎙️ 방송부 대본 도우미

초등학교 방송부 학생들이 금요방송 대본을 **AI(Gemini)의 도움을 받아 작성하고, 함께 수정·관리·공유**하는 웹사이트입니다.
Cloudflare에 무료로 배포할 수 있습니다.

## 구조

```
[학생/선생님 브라우저]
        │
        ▼
Cloudflare Workers ──── public/        화면 (HTML·CSS·JS)
  (src/index.js)  ──── D1 데이터베이스  대본 + 수정 기록
                  ──── Gemini API      AI 초안 (API 키는 서버에만 저장)
                  ──── 구글 시트 CSV   학교 주간계획 (읽기만)
```

| 폴더/파일 | 내용 |
|---|---|
| `src/index.js` | API 주소 처리, 대본 저장·수정·삭제, 권한 확인 |
| `src/auth.js` | 로그인(학생 개인 계정 / 선생님 비밀번호), 비밀번호 바꾸기 |
| `src/users.js` | 선생님의 학생 계정 관리 |
| `src/ai.js` | 구성별 Gemini 프롬프트 ← **대본 말투·분량(`LENGTH`)을 바꾸려면 여기** |
| `src/weekly-plan.js` | 주간계획 시트 읽기 ← **학교 양식이 다르면 여기** |
| `public/` | 화면 |
| `schema.sql` | 데이터베이스 표 구조 |
| `wrangler.jsonc` | Cloudflare 설정 (학교 이름, 주간계획 주소 등) |

## 기능

- **대본 구성**: ① 인사말 → ② 다음 주 학교 행사 → ③ 사자성어 → ④ 계기교육 → ⑤ 마무리 인사
- **AI 도움**: 전체 초안 한 번에 만들기 / 구성별로 쓰기 / 학생 초안 다듬기 / "더 짧게" 같은 요청
  - 행사 소개는 주간계획 시트에서 **방송일 다음 주 월~금** 행사만 읽어서 작성
  - 사자성어·계기교육은 주제를 직접 정하거나 AI가 시기에 맞게 고름
- **관리**: 목록·검색, 상태(작성중 → 검토요청 → 완료), 선생님 메모, 구성별 글자 수와 예상 낭독 시간
- **함께 고치기**: 저장할 때마다 수정 기록이 남고 되돌리기 가능, 두 명이 동시에 고치면 덮어쓰지 않고 알려 줌
- **공유**: 대본 링크 복사, 큰 글씨 방송용 보기, 인쇄, 대본 글자 복사
- **아나운서 1명/2명**: 2명이면 "이름: 대사" 대화 형식으로 쓰고, 인사말·마무리에 아나운서 이름이 들어감
- **계정**: 선생님이 [👥 학생 계정]에서 학생 개인 계정을 만들고(여러 명 한꺼번에), 비밀번호 초기화·사용 중지·삭제
  - 새 계정과 초기화한 계정은 4자리 임시 비밀번호 → 학생이 처음 들어올 때 자기 비밀번호로 바꿔야 함
  - 선생님은 이름 + 선생님 비밀번호(`TEACHER_PASSWORD`)로 로그인
- **공유**: 모든 대본은 로그인한 방송부 모두가 보고 함께 고칠 수 있음
- **권한**: 선생님만 '완료' 처리·대본 삭제·계정 관리 가능, 완료된 대본은 학생이 고칠 수 없음

---

## 처음 한 번: 준비

1. [Node.js](https://nodejs.org) LTS 버전 설치
2. [Cloudflare](https://dash.cloudflare.com/sign-up) 무료 계정 만들기
3. 이 폴더에서 터미널을 열고 패키지 설치

```bash
npm install
```

> **학교 네트워크에서 `fetch failed` / 인증서(certificate) 경고가 나오면**
> 학교 보안 장비가 인증서를 바꿔 끼우기 때문입니다. 터미널을 열 때마다 아래를 먼저 실행하면 Windows에 설치된 인증서를 Node.js가 함께 믿게 됩니다.
>
> ```bash
> $env:NODE_OPTIONS = '--use-system-ca'
> ```

## 내 컴퓨터에서 실행해 보기

1. `.dev.vars.example` 파일을 복사해 `.dev.vars`를 만들고 값을 채웁니다. (Gemini 키가 없어도 AI 외 기능은 동작)
2. 로컬 데이터베이스를 만듭니다.

```bash
npm run db:init:local
```

3. 실행 후 브라우저에서 http://localhost:8787 접속

```bash
npm run dev
```

## Cloudflare에 배포하기

### 1) Cloudflare 로그인

```bash
npx wrangler login
```

브라우저가 열리면 Cloudflare 계정으로 허용합니다.

### 2) 데이터베이스 만들기 (✅ 2026-10-26 완료)

```bash
npx wrangler d1 create broadcasting-db
```

출력된 `database_id` 값을 `wrangler.jsonc`의 `"database_id"`에 붙여넣고(“add it on your behalf?”에는 **n**), 표를 만듭니다.

```bash
npm run db:init:remote
```

### 3) 비밀값 넣기 (하나씩 실행하고 값을 입력)

```bash
npx wrangler secret put GEMINI_API_KEY
```

```bash
npx wrangler secret put TEACHER_PASSWORD
```

```bash
npx wrangler secret put SESSION_SECRET
```

| 이름 | 값 |
|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey 에서 발급 |
| `TEACHER_PASSWORD` | 선생님 비밀번호 (학생 계정 관리용, 학생에게 알려 주지 마세요) |
| `SESSION_SECRET` | 아무 글자나 32자 이상 (로그인 유지용) |

### 4) 학교 설정 (`wrangler.jsonc`의 `vars`)

- `SCHOOL_NAME`: 학교 이름
- 주간계획 시트 ID는 비밀값 `PLAN_SHEET_ID`로 넣습니다 (아래 참고)
- `GEMINI_MODEL`: 기본 `gemini-3.8-flash`

### 5) 배포

처음 한 번만 직접 배포합니다.

```bash
npx wrangler deploy
```

끝나면 `https://broadcasting-script-helper.<내계정>.workers.dev` 주소가 나옵니다. 이 주소를 방송부에 알려 주세요.

> **그다음부터는 직접 배포하지 않습니다.** 브랜치에서 고치고 → 변경 요청(PR) → 관리자 점검·승인 → GitHub Actions가 자동 배포합니다.
> 자세한 순서는 [CONTRIBUTING.md](CONTRIBUTING.md) (운영 가이드)를 보세요.

---

## 주간계획 시트 연결하기

Cloudflare는 학교 구글 계정에 로그인할 수 없으므로, 시트를 **"링크가 있는 모든 사용자 – 뷰어"**로 공유해야 합니다.
시트 주소 `https://docs.google.com/spreadsheets/d/<여기>/edit…` 의 `<여기>` 부분을 비밀값으로 넣습니다: `npx wrangler secret put PLAN_SHEET_ID`

**삼호중앙초 주간계획 형식에 맞춰져 있습니다.**

- 한 주가 탭 하나 (`11월 1주`, `11월 2주`, … / `완료`가 붙어도 됨) → 방송일 다음 주에 해당하는 탭을 **자동으로 찾습니다.** 새 주 탭을 추가하기만 하면 됩니다.
- 탭 첫 줄의 `2026년 11월 1주 …` 제목에서 연·월을, `일`·`요일` 열에서 날짜를 읽습니다. (`30`, `12/1`처럼 달이 넘어가도 요일로 맞춥니다)
- **`교육활동 및 행사` 열만** 읽습니다. 머리글이 빈 열(※ 교직원 복무, 보결 명단)은 읽지 않습니다.
- 그중에서도 `보결`, `연수`, `직원`, `기획 회의`, `실천연구`, `출결` 같은 교직원 일정은 AI에 보내기 전에 뺍니다. 빼는 낱말 목록은 `src/weekly-plan.js` 맨 위 `STAFF_ONLY`에서 고칠 수 있습니다.

> ⚠️ 링크 공유된 시트는 **주소를 아는 사람은 누구나 볼 수 있습니다.** 주간계획에는 교직원 복무·보결 명단이 있으니 시트 주소가 밖으로 퍼지지 않게 주의하세요. 방송부 사이트는 시트 주소를 학생 화면에 보여 주지 않습니다.

## 알아 두면 좋은 점

- **Gemini 무료 등급**은 입력한 내용이 Google 서비스 개선에 쓰일 수 있습니다. 대본에 학생 실명·개인정보를 넣지 않도록 지도하거나, 유료 등급(결제 연결)을 쓰세요. AI에는 아나운서 칸 이름이 전달됩니다.
- **선생님 비밀번호를 바꾸려면** `npx wrangler secret put TEACHER_PASSWORD`를 다시 실행하면 됩니다. `SESSION_SECRET`을 바꾸면 모든 사람이 로그아웃됩니다.
- **데이터베이스 변경 기록**: `migrations/` 폴더의 파일은 이미 만든 데이터베이스에 한 번씩만 실행합니다 (`npx wrangler d1 execute broadcasting-db --remote --file=./migrations/파일이름.sql`). 새로 설치할 때는 `schema.sql`만 실행하면 됩니다.
- **비용**: 방송부 규모(주 1회, 수십 명)는 Cloudflare Workers·D1 무료 한도 안에서 충분합니다.
- **백업**: `npx wrangler d1 export broadcasting-db --remote --output=backup.sql`

## 다음에 붙이면 좋은 기능

- 학교 연간 계기교육 계획표를 시트로 만들어 AI 프롬프트에 반영
- 로그인 시도 횟수 제한
- 지난 방송에서 쓴 사자성어가 겹치지 않게 하기
