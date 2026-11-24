// 플러그인 코드는 팝아웃 창 호환을 위해 window.setTimeout을 쓴다. node 테스트 환경에 window를 둔다.
const g = globalThis as unknown as { window?: typeof globalThis };
if (!g.window) g.window = globalThis;
