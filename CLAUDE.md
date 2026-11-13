# CLAUDE.md

삼호중앙초등학교 방송부 통합 사이트(대본 도우미 + 일정·게시판·알림·연습 모드). **실제 학생들이 쓰는 사이트**이고 저장소는 **공개**입니다.

## 구조

- Cloudflare Workers + 정적 파일(`public/`), D1(SQLite) `broadcasting-db`, Gemini REST API
- `src/index.js` 라우터 → 기능별 파일(`auth`, `users`, `ai`, `weekly-plan`, `commemorations`, `calendar`, `board`, `comments`, `notify`, `home`)
- `public/` 바닐라 JS(빌드 없음), 화면 이동은 쿼리 문자열
- DB: `schema.sql`(전체 최신 모습) + `migrations/000N_*.sql`(바뀐 부분). 둘 다 같이 고칩니다.
- 스펙과 스토리: `_bmad-output/specs/spec-club-site/`

## 명령

```bash
npm test          # node --test, 서버 함수 단위 시험
npm run check     # 문법 + wrangler deploy --dry-run
npm run dev       # 로컬 서버 (8787)
```

학교 네트워크에서는 먼저 `$env:NODE_OPTIONS = '--use-system-ca'` (인증서 오류 방지).

## 꼭 지킬 것

- **main에 직접 push 금지, 직접 배포(`wrangler deploy`) 금지.** 브랜치 → PR → `코드 검사` 통과 → 선생님(@myungsunnny) Merge → 배포 승인. 자세한 순서는 [CONTRIBUTING.md](CONTRIBUTING.md).
- **DB가 바뀌는 PR은 Merge 전에** 선생님이 원격 DB에 SQL을 먼저 실행해야 합니다(배포가 테이블보다 먼저 나가면 사이트가 깨짐). PR 설명에 실행할 명령을 적습니다.
  - 학교 네트워크에서 `--file` 업로드가 막히면 `--command "..."` 한 줄로 보냅니다. 터미널 탭에는 ASCII만 넣을 수 있어 SQL의 한글 주석은 뺍니다.
- **비밀값은 코드·PR·커밋·대화에 쓰지 않습니다.** `GEMINI_API_KEY`, `TEACHER_PASSWORD`, `SESSION_SECRET`, `PLAN_SHEET_ID`(주간계획 시트 ID 포함)는 `wrangler secret put` / `gh secret set`으로 선생님이 직접 넣습니다.
- 커밋하지 않을 것: `.dev.vars`, `_bmad/`, `.claude/`(`agents/`만 올림), `_이전_앱스크립트/`.
- 원격 DB 쓰기 명령은 선생님께 명령을 드려 직접 실행하게 합니다. 읽기(SELECT) 확인은 해도 됩니다.

## 관리자 역할 (메인 세션)

선생님과 대화하는 세션이 최종 관리자다. 다 직접 하지 말고 맡기고, 결과를 점검해서 보고한다. 에이전트는 `.claude/agents/`에 있다.

- "스토리 N 시작" → 스토리 파일 확인 → 새 세션(자기 작업 폴더)을 열어 `bmad-build`로 맡긴다.
- PR이 올라오면(선생님 말이나 세션 알림) 순서대로:
  1. `db-guide` — DB 변경이 있으면 선생님께 명령을 **Merge 전에** 드린다.
  2. `pr-checker` — 시험 + 실제 로그인 확인.
  3. 화면 문구가 많이 바뀌었으면 `kid-copy`.
  4. 종합 보고: Merge해도 되는지 / 먼저 할 일 / 확인 못 한 것.
- 작은 질문·수정은 직접 한다. 에이전트를 부르는 게 더 오래 걸리면 부르지 않는다.
- 에이전트 보고를 그대로 믿지 않는다. 핵심(시험 결과, 바뀐 파일 목록, PR 상태)은 직접 한 번 확인한다.
- 선생님 몫은 넘기지도 대신하지도 않는다: Merge, 배포 승인, 비밀값, 원격 DB 쓰기.

## 작업 방식

- 사용자는 담임 선생님입니다. 답은 **쉬운 한국어**로, 개발 용어는 풀어서 씁니다.
- 화면 문구는 초등학생이 읽기 쉽게(존댓말, 짧은 문장).
- 스토리 하나 = 새 세션 + 자기 worktree + PR 하나. 끝나면 PR 링크, DB 변경 여부, 확인 못 한 것을 알립니다.
- PR 확인은 main 폴더에서 `git fetch origin pull/N/head` → detached checkout → `npm test` → 로컬 서버에서 학생·선생님 계정으로 실제 로그인 확인 → `git checkout main`.
  - worktree 세션은 `.dev.vars`가 없어 로그인 확인이 안 됩니다.
- 디자인 토큰: `--accent: #CC3138`, Pretendard·Jua 글꼴, 다크 모드 지원, 아이콘은 Phosphor.
