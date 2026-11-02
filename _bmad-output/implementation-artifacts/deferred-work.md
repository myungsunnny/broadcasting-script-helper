# 미룬 작업

- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 화면 주소별로 맞는 화면·메뉴가 열리는지 자동으로 확인하는 테스트가 없다.
  evidence: 저장소에 JS 테스트 도구가 없고 CI(`코드 검사`)는 `node --check`와 `wrangler deploy --dry-run`만 한다. 지금은 사람이 직접 눌러 보는 확인에 기댄다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 홈의 '이번 주 대본' 버튼이 이미 있는 대본을 두 번 만들지 않는지 자동으로 확인하는 테스트가 없다.
  evidence: 위와 같은 이유. 로그인 직후, 이번 주 대본이 이미 있을 때 버튼을 바로 눌러 보는 수동 확인으로 대신한다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: `npm run check`에 `node --check public/app.js`를 더해 CI와 맞춘다.
  evidence: `package.json`의 check는 `src/index.js`만 문법 검사하고, CI만 `public/app.js`를 검사한다. 이번 스토리 전부터 있던 차이다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 새 대본을 처음 저장하는 중에 다른 화면으로 가면, 늦게 온 저장 응답이 주소를 `?id=`로 바꾼다.
  evidence: `public/app.js` `saveNow()`가 POST 뒤 무조건 `history.replaceState`를 한다. 예전 일정·로고 버튼에도 있던 문제인데, 메뉴가 늘어 더 자주 생길 수 있다. 편집 화면이 아직 보일 때만 주소를 바꾸면 된다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: (확인 안 됨, 사실이면 medium) 휴대폰에서 대본을 쓸 때 화면 키보드가 열리면 하단 메뉴 막대와 단계 이동 막대가 함께 올라와 쓰는 칸을 가릴 수 있다.
  evidence: 안드로이드 실기기에서 키보드를 열고 4단계 대본 칸을 써 보면 확인된다. 사실이면 입력 칸에 포커스가 있을 때 하단 메뉴를 숨기는 방법이 있다.
- source_spec: `_bmad-output/specs/spec-club-site/stories/1-menu-overhaul.md`
  summary: 화면이 바뀔 때 화면 읽기 프로그램에 알리지 않고, 브라우저 탭 제목도 화면마다 바뀌지 않는다.
  evidence: `showOnly()`는 숨김만 바꾸고 `document.title`은 항상 "방송부 · 학교이름"이다. 이번 스토리 전부터 그랬다.
