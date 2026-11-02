# 운영 가이드: 고치기 → 점검 → 승인 → 배포

방송부 대본 도우미는 **실제로 학생들이 쓰는 사이트**라서, 고친 내용이 바로 올라가지 않도록 아래 순서를 지킵니다.

```
① 브랜치에서 고치기 ─▶ ② 변경 요청(PR) ─▶ ③ 자동 검사 ─▶ ④ 관리자 점검·합치기 ─▶ ⑤ 배포 승인 ─▶ 사이트 반영
```

- **main 브랜치 = 지금 사이트에 올라가 있는 내용.** main에 직접 고치거나 올리지 않습니다.
- 사이트에 올리는 일(배포)은 **GitHub Actions가** 합니다. 컴퓨터에서 `wrangler deploy`를 직접 하지 않습니다.
- 관리자: 방송부 담당 선생님 (`@myungsunnny`)

---

## ① 브랜치에서 고치기

```bash
git switch main
git pull
git switch -c feature/캘린더-색-바꾸기
```

브랜치 이름은 무엇을 하는지 알 수 있게 짓습니다.

| 종류 | 예 |
|---|---|
| 새 기능 | `feature/연습-모드` |
| 고장 고치기 | `fix/저장-안-됨` |
| 글자·디자인 | `ui/사용법-문구` |

고친 뒤 내 컴퓨터에서 확인합니다. (학교 네트워크에서는 먼저 `$env:NODE_OPTIONS = '--use-system-ca'`)

```bash
npm run dev
```

## ② 변경 요청(PR) 올리기

```bash
git add -A
git commit -m "캘린더의 방송 일정을 빨간색으로 표시"
git push -u origin feature/캘린더-색-바꾸기
gh pr create --fill
```

PR 설명 칸의 체크리스트(무엇을, 왜, 확인한 것, 데이터베이스 변경)를 채웁니다.

## ③ 자동 검사

PR을 올리면 **자동 검사**가 돌아갑니다. (문법 검사 + 서버 코드 묶기 시험)
초록색 체크가 나와야 합칠 수 있습니다. 빨간 X가 나오면 **Details**를 눌러 오류를 보고 고친 뒤 다시 올립니다.

## ④ 관리자 점검·합치기

관리자는 PR의 **Files changed** 탭에서 바뀐 내용을 읽고,

- 괜찮으면 **Merge pull request** (합치기)
- 고칠 점이 있으면 줄마다 댓글을 달고 **Request changes**

## ⑤ 배포 승인

main에 합쳐지면 **배포** 작업이 시작되고, 관리자 승인을 기다리며 멈춥니다.
GitHub의 **Actions** 탭 → **배포** → **Review deployments** → `production` 체크 → **Approve and deploy** 를 누르면 사이트에 반영됩니다.

> 승인 버튼이 없이 바로 배포된다면, 저장소 설정에서 `production` 환경의 승인자 설정이 빠진 것입니다. (아래 '처음 한 번 설정' 참고)

---

## 데이터베이스가 바뀌는 경우

표(테이블)나 칸(열)을 새로 만드는 변경은 `migrations/` 폴더에 SQL 파일로 넣습니다. (예: `0006_무엇.sql`)
이 SQL은 자동으로 실행되지 않으므로, **관리자가 배포를 승인하기 전에** 직접 실행합니다.

```bash
npx wrangler d1 execute broadcasting-db --remote --file=./migrations/0006_무엇.sql
```

학교 네트워크에서 파일 업로드가 막혀 `fetch failed`가 나면, SQL 내용을 `--command "..."`로 직접 보내면 됩니다.

## 문제가 생겼을 때 되돌리기

1. **가장 빠른 방법**: Cloudflare에서 바로 전 버전으로 되돌리기

   ```bash
   npx wrangler rollback
   ```

2. **기록까지 정리**: 문제가 된 PR 화면에서 **Revert** 를 눌러 되돌리는 PR을 만들고, 위 ②~⑤ 순서로 합쳐 배포합니다.

---

## 처음 한 번 설정 (관리자)

GitHub 저장소의 **Settings** 에서:

1. **Secrets and variables → Actions → New repository secret**
   - `CLOUDFLARE_API_TOKEN`: Cloudflare 대시보드 → My Profile → API Tokens → **Edit Cloudflare Workers** 템플릿으로 만든 토큰 (D1 편집 권한 포함)
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정 ID
2. **Environments → New environment → `production`**
   - **Required reviewers** 에 관리자 계정 추가 → 승인해야 배포됨
   - **Deployment branches** 를 `main` 만 허용
3. **Branches → Add branch protection rule (main)**
   - Require a pull request before merging
   - Require status checks to pass → `코드 검사`

> 개인 저장소(private)는 GitHub 요금제에 따라 2·3번 보호 기능이 안 될 수 있습니다. 그때는 **관리자만 PR을 합치는** 약속으로 운영합니다.
