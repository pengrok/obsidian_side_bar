# 고쳐야 할 항목

아직 고치지 않은 문제를 적어 둡니다. 고치면 해당 항목을 지우거나 체크합니다.

- [ ] **Mac에서 `Command + Shift + 방향키`로 선택하면 버튼 줄이 뜨지 않음**
	- 증상: 마우스 드래그, `Shift + 방향키`, `Option + Shift + 방향키`로 선택하면 버튼 줄이 뜨는데, `Command + Shift + 방향키`(줄 처음·끝까지 선택)로는 뜨지 않음.
	- 원인: 버튼 줄은 방향키를 뗄 때의 `keyup`에서 그 키가 방향키일 때만 뜬다(`src/main.ts`의 `setupSelectionToolbar`, keyup 처리). macOS의 Chromium은 `Command`가 눌려 있는 동안 다른 키의 `keyup`을 보내지 않는다. 그래서 `→`의 keyup이 오지 않고, 나중에 오는 `Meta`·`Shift`의 keyup은 방향키 조건(`/^(Arrow|Home|End|Page)/`)에 걸리지 않는다.
	- 고칠 방법 (정함): `Shift`나 `Meta`(Command)를 뗄 때도, 편집기에 선택이 있으면 버튼 줄을 띄운다(`tb.update()`).
	- 쓰지 않기로 한 방법: CodeMirror의 "선택이 바뀜" 신호를 받는 방법. 마우스 드래그 도중에 뜨고, 사이드바 카드 클릭·찾기·되돌리기처럼 사용자가 직접 선택하지 않았을 때도 뜨며, 키를 꾹 누르면 깜빡이고, 모바일 기본 메뉴와 겹칠 수 있다.
