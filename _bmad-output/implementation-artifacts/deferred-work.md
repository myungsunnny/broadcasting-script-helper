# 미룬 작업

- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 화면 주소별로 맞는 화면·메뉴가 열리는지 자동으로 확인하는 테스트가 없다.
  evidence: 저장소에 JS 테스트 도구가 없고 CI(`코드 검사`)는 `node --check`와 `wrangler deploy --dry-run`만 한다. 지금은 사람이 직접 눌러 보는 확인에 기댄다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 홈의 '이번 주 대본' 버튼이 이미 있는 대본을 두 번 만들지 않는지 자동으로 확인하는 테스트가 없다.
  evidence: 위와 같은 이유. 로그인 직후, 이번 주 대본이 이미 있을 때 버튼을 바로 눌러 보는 수동 확인으로 대신한다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: (확인 안 됨, 사실이면 medium) 휴대폰에서 대본을 쓸 때 화면 키보드가 열리면 하단 메뉴 막대와 단계 이동 막대가 함께 올라와 쓰는 칸을 가릴 수 있다.
  evidence: 안드로이드 실기기에서 키보드를 열고 4단계 대본 칸을 써 보면 확인된다. 사실이면 입력 칸에 포커스가 있을 때 하단 메뉴를 숨기는 방법이 있다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 화면이 바뀔 때 화면 읽기 프로그램에 알리지 않고, 브라우저 탭 제목도 화면마다 바뀌지 않는다.
  evidence: `showOnly()`는 숨김만 바꾸고 `document.title`은 항상 "방송부 · 학교이름"이다. 이번 스토리 전부터 그랬다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/2-home-dashboard.md`
  summary: 홈의 이번 주 버튼이 홈 응답을 기다렸다가 이동하고, 불러오기에 실패하면 새 대본을 만들지 않는지 자동으로 확인하는 화면 테스트가 없다.
  evidence: 저장소에 브라우저(화면) 테스트 도구가 없다. 서버 쪽 `thisWeek`는 `test/home.test.js`가 확인하지만 `public/app.js`의 `btnThisWeek` 처리기는 사람이 직접 눌러 확인한다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/3-board-notices.md`
  summary: `/api/posts` 경로와 `BoardError`가 맞는 HTTP 상태(400·403·404)로 나가는지 확인하는 요청 단위 시험이 없다.
  evidence: 시험은 `src/board.js` 함수를 직접 부른다. `src/index.js`를 요청으로 시험하려면 로그인 쿠키 서명·env 틀이 필요해 이번 스토리보다 크다. 로컬 `wrangler dev`에서 경로별로 직접 확인했다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/3-board-notices.md`
  summary: 대본 편집의 아나운서 수 버튼(`.big-seg`)과 홈 할 일의 공지 줄을 확인하는 화면 시험이 없다.
  evidence: 게시판 `.seg` 탭이 문서에서 먼저 나와 연결을 `.big-seg`로 바꿨는데, 다시 바뀌어도 잡아낼 시험이 없다. 스토리 1·2의 미룬 화면 시험과 같은 종류다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/4-review-comments.md`
  summary: 홈 '선생님 의견' 줄의 `?id=&tab=` 연결, `openScript`의 탭 고르기, 4단계 탭 배지 수(반영 안 된 것만)를 확인하는 화면 시험이 없다.
  evidence: 저장소에 `public/app.js`를 불러오는 시험 도구가 없다. 서버 쪽 `section`·`count`는 `test/comments.test.js`·`test/home.test.js`가 확인하고, 화면은 로컬 `wrangler dev`에서 사람이 눌러 확인했다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/5-inbox.md`
  summary: 알림 줄의 이동 주소(`inboxQuery`: 의견은 `&tab=`, 일정은 `?calendar&date=`), '몇 분 전'(`timeAgo`), 메뉴 배지 수를 확인하는 화면 시험이 없다.
  evidence: 저장소에 `public/app.js`를 불러오는 시험 도구가 없다. 서버의 `ref_date`(구성 키·날짜)는 `test/notify.test.js`가 확인하고, 화면은 로컬 `wrangler dev`에서 눌러 확인했다. `inboxQuery`·`timeAgo`를 작은 모듈로 빼면 `node:test`로 시험할 수 있다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/6-practice-mode.md`
  summary: 낭독 연습의 구성별 시간 쌓기(넘길 때 앞 구성에 기록, 멈춘 시간 제외, 다시 연습 초기화)를 확인하는 시험이 없다.
  evidence: 상태 전이(`practiceFlush`·`practiceMove`·`practiceRestart`)가 `public/app.js`에 있어 `node:test`가 부를 수 없다. `now`를 받는 순수 함수로 `public/practice.js`에 옮기면 `test/practice.test.js`에 넣을 수 있다. 이번엔 로컬 화면에서 눌러 확인했다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/8-ai-limit.md`
  summary: /api/ai/section에서 Gemini 실패 뒤 refundAi까지 실패하는 경우 원래 AI 오류가 그대로 가는지 시험이 없다.
  evidence: 바깥 try/catch를 지워도 지금 시험은 모두 통과한다. 드문 이중 실패라 영향은 작다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/8-ai-limit.md`
  summary: public/app.js의 AI 남은 횟수 표시·버튼 막기(renderAiLeft, aiAll, aiSection)에 자동 시험이 없다.
  evidence: app.js를 불러오는 시험 틀이 없다. 서버 429가 한도를 지키므로 위험은 화면 동작뿐이고, 학생·선생님 실제 로그인 확인으로 대신한다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/9-login-limit-backup.md`
  summary: 새 대본을 처음 저장하는 중에 다른 대본을 열면, 늦게 온 저장 응답이 주소(`?id=`)와 `state.current`를 앞 대본 것으로 바꾼다.
  evidence: `public/app.js` `saveNow()`는 응답 뒤 `state.current = saved`를 무조건 하고, B1 고침은 편집 화면이 숨겨진 경우만 막는다. 저장 전에 `state.current`를 잡아 두고 같을 때만 바꾸면 된다. 이번 스토리 전부터 있던 문제다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/9-login-limit-backup.md`
  summary: `saveNow()`의 주소 바꾸기 조건(B1)과 백업 버튼(`downloadBackup`)에 자동 시험이 없다.
  evidence: `public/app.js`를 불러오는 시험 틀이 없다. 서버 `/api/backup`은 `test/backup.test.js`가 확인하고, 화면은 메인 폴더에서 실제로 눌러 확인한다.
