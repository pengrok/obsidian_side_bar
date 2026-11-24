// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, editorState, menus, type TFile } from "obsidian";
import { installDomHelpers } from "./dom";
import { commentFile, settle, setup, wait } from "./helpers";
import { Actions } from "../src/actions";
import { mergeData } from "../src/settingsDefaults";
import { MarginNotesView } from "../src/ui/sidebarView";
import { buildCmExtension, refreshEditorView } from "../src/editor/cmExtension";
import { buildReadingProcessor } from "../src/editor/readingProcessor";
import { applyHighlightVisibility, HIDE_CLASS } from "../src/utils/visibility";

vi.mock("../src/ui/confirmModal", () => ({ confirmDialog: async () => ({ choice: "trash", checked: false }) }));

beforeAll(() => installDomHelpers());

const NOTE = "연구/논문정리.md";
const TEXT = [
	"# 서론",
	"트랜스포머는 ==셀프 어텐션만으로==%%mn:aaaaaa%% 처리한다.",
	"이건 ==일반 하이라이트==다.",
	"## 본론",
	"==둘째 문장==%%mn:bbbbbb%% 이다.",
	"```",
	"==코드 안==%%mn:cccccc%%",
	"```",
].join("\n");

async function makeEnv() {
	const e = setup();
	const note = e.app.vault.seed(NOTE, TEXT) as TFile;
	e.app.vault.seed("Annotations/논문정리/a.md", commentFile({ id: "aaaaaa", source: NOTE, quote: "셀프 어텐션만으로", body: "RNN을 빼고도", tags: ["개념/수학"] }));
	e.app.vault.seed("Annotations/논문정리/b.md", commentFile({ id: "bbbbbb", source: NOTE, quote: "둘째 문장", color: "blue" }));
	e.app.vault.seed("Annotations/논문정리/o.md", commentFile({ id: "oooooo", source: NOTE, quote: "사라진 문장", body: "고아 코멘트" }));
	await e.index.build();
	const { uiState } = mergeData({});
	let current: TFile | null = note;
	const plugin: Record<string, unknown> = {
		app: e.app,
		settings: e.settings,
		uiState,
		index: e.index,
		store: e.store,
		writer: e.writer,
		relinkingId: null,
		saveUiSoon: () => {},
		saveAll: async () => {},
		lastMarkdownFile: () => current,
		lastMarkdownView: () => null,
		fileOfLeaf: () => null,
		rebuildIndex: async () => {},
		revealInSidebar: () => {},
		refreshEditors: () => {},
		refreshView: () => {},
		mainLeaf: () => e.app.workspace.getLeaf(),
		highlightsHidden: false,
		setHighlightsHidden(v: boolean) {
			plugin.highlightsHidden = v;
			applyHighlightVisibility(document.body, v);
		},
		effectiveColor: (k: string | null) => (k && e.settings.colors.some((c) => c.key === k) ? k : e.settings.defaultColor),
	};
	plugin.actions = new Actions(plugin as never);
	const view = new MarginNotesView({ app: e.app } as never, plugin as never);
	document.body.appendChild(view.containerEl);
	await view.onOpen();
	return {
		...e,
		note,
		plugin,
		view,
		root: view.contentEl,
		setCurrent: (f: TFile | null) => {
			current = f;
			e.app.workspace.trigger("layout-change");
		},
	};
}

const cards = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".mn-card"));
const quotes = (root: HTMLElement) => cards(root).map((c) => c.querySelector(".mn-card-quote")!.textContent);

beforeEach(() => {
	menus.length = 0;
});

describe("사이드바 — 현재 노트 탭 (7장, M7·M8)", () => {
	it("카드를 본문 순서대로, 고아는 맨 아래 점선", async () => {
		const { root } = await makeEnv();
		await wait(10);
		expect(quotes(root)).toEqual(["셀프 어텐션만으로", "일반 하이라이트", "둘째 문장", "사라진 문장"]);
		const [a, plain, b, orphan] = cards(root);
		expect(a.classList.contains("mn-color-yellow")).toBe(true);
		expect(b.classList.contains("mn-color-blue")).toBe(true);
		expect(plain.classList.contains("mn-card--plain")).toBe(true);
		expect(orphan.classList.contains("mn-card--orphan")).toBe(true);
		expect(orphan.querySelector(".mn-badge")!.textContent).toBe("원문 없음");
		expect(plain.querySelector(".mn-badge")!.textContent).toBe("코멘트 없음");
		expect(a.querySelector(".mn-card-loc")!.textContent).toBe("서론");
		expect(a.querySelector(".mn-card-comment")!.textContent).toBe("RNN을 빼고도");
		expect(plain.querySelector(".mn-card-add")!.textContent).toBe("+ 코멘트 추가");
		expect(a.querySelector(".mn-tag")!.textContent).toBe("#개념/수학");
		expect(a.querySelector(".mn-card-date")!.textContent).toBe("2026-11-24");
		expect(root.querySelector(".mn-footer")!.textContent).toBe("하이라이트 3 · 코멘트 1 · 원문 없음 1");
	});

	it("코드 블록 안 ==는 카드에 나오지 않는다 (9.1절 완료 기준)", async () => {
		const { root } = await makeEnv();
		expect(quotes(root)).not.toContain("코드 안");
	});

	it("빈 상태 문구 (7.5절)", async () => {
		const t = await makeEnv();
		t.setCurrent(null);
		await wait(150);
		expect(t.root.querySelector(".mn-empty")!.textContent).toContain("노트를 열면 하이라이트가 여기 보여요.");
		const empty = t.app.vault.seed("빈.md", "하이라이트 없음") as TFile;
		t.setCurrent(empty);
		await wait(150);
		expect(t.root.querySelector(".mn-empty")!.textContent).toContain("아직 하이라이트가 없어요.");
		t.setCurrent(t.app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile);
		await wait(150);
		expect(t.root.querySelector(".mn-empty")!.textContent).toContain("코멘트 파일이에요.");
		expect(t.root.querySelector(".mn-empty button")!.textContent).toBe("원본 노트 열기");
	});

	it("검색·필터 결과 없음 → 필터 초기화", async () => {
		const t = await makeEnv();
		t.view.setQuery("없는단어");
		await wait(10);
		expect(t.root.querySelector(".mn-empty")!.textContent).toContain("조건에 맞는 하이라이트가 없어요.");
		(t.root.querySelector(".mn-empty button") as HTMLElement).click();
		await wait(10);
		expect(cards(t.root)).toHaveLength(4);
	});

	it("검색 문법 (7.3절)", async () => {
		const t = await makeEnv();
		t.view.setQuery("#개념");
		await wait(10);
		expect(quotes(t.root)).toEqual(["셀프 어텐션만으로"]);
		t.view.setQuery("is:orphan");
		await wait(10);
		expect(quotes(t.root)).toEqual(["사라진 문장"]);
		t.view.setQuery("rnn"); // 코멘트 본문 검색 (본문을 먼저 읽는다)
		await wait(10);
		expect(quotes(t.root)).toEqual(["셀프 어텐션만으로"]);
		t.view.setQuery("color:파랑");
		await wait(10);
		expect(quotes(t.root)).toEqual(["둘째 문장"]);
	});

	it("태그 칩을 누르면 검색창에 #태그", async () => {
		const t = await makeEnv();
		(t.root.querySelector(".mn-tag") as HTMLElement).click();
		await wait(10);
		expect((t.root.querySelector(".mn-search input") as HTMLInputElement).value).toBe("#개념/수학");
		expect(cards(t.root)).toHaveLength(1);
	});

	it("필터 메뉴 → 칩, × 로 해제 (7.1절)", async () => {
		const t = await makeEnv();
		(t.root.querySelector('[data-act="filter"]') as HTMLElement).click();
		menus.at(-1)!.click("파랑");
		await wait(10);
		expect(quotes(t.root)).toEqual(["둘째 문장"]);
		expect(t.root.querySelector('[data-act="filter"]')!.classList.contains("is-active")).toBe(true);
		const chip = t.root.querySelector(".mn-chip")!;
		expect(chip.textContent).toContain("파랑");
		(chip.querySelector(".mn-chip-x") as HTMLElement).click();
		await wait(10);
		expect(cards(t.root)).toHaveLength(4);
	});

	it("제목으로 묶기, 접은 상태 저장", async () => {
		const t = await makeEnv();
		(t.root.querySelector('[data-act="layers"]') as HTMLElement).click();
		menus.at(-1)!.click("제목");
		await wait(10);
		const groups = Array.from(t.root.querySelectorAll(".mn-group-name")).map((g) => g.textContent);
		expect(groups).toEqual(["서론", "본론", "원문 없음"]);
		(t.root.querySelector(".mn-group-header") as HTMLElement).click();
		expect(t.root.querySelector(".mn-group")!.classList.contains("is-collapsed")).toBe(true);
		expect((t.plugin.uiState as { tabs: { current: { collapsedGroups: string[] } } }).tabs.current.collapsedGroups).toEqual(["heading:서론"]);
	});

	it("더 보기 메뉴 항목이 상태별 표(7.2절)와 같다", async () => {
		const t = await makeEnv();
		const open = (i: number) => {
			(cards(t.root)[i].querySelector('[aria-label="더 보기"]') as HTMLElement).click();
			return menus.at(-1)!.titles();
		};
		expect(open(0)).toEqual(["코멘트 편집", "코멘트 파일 열기", "색 바꾸기", "인용 복사", "하이라이트 제거", "코멘트 삭제"]);
		expect(open(1)).toEqual(["코멘트 추가", "색 바꾸기", "인용 복사", "하이라이트 제거"]);
		expect(open(3)).toEqual(["코멘트 편집", "코멘트 파일 열기", "색 바꾸기", "인용 복사", "다시 연결", "일반 노트로 남기기", "코멘트 삭제"]);
	});

	it("카드 안 편집: Ctrl/Cmd+Enter로 저장 (6.3절, M11)", async () => {
		const t = await makeEnv();
		(cards(t.root)[0].querySelector(".mn-card-comment") as HTMLElement).click();
		await wait(10);
		const ta = t.root.querySelector<HTMLTextAreaElement>(".mn-card-input")!;
		expect(ta.value).toBe("RNN을 빼고도");
		ta.value = "카드에서 고침";
		ta.dispatchEvent(new Event("input"));
		ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
		await wait(50);
		expect(await t.store.readBody(t.index.get("aaaaaa")!.file)).toBe("카드에서 고침");
		await wait(150);
		expect(t.root.querySelector(".mn-card-input")).toBeNull();
	});

	it("편집 중에 다시 그려도 입력창은 그대로 (5.9절)", async () => {
		const t = await makeEnv();
		(cards(t.root)[1].querySelector(".mn-card-comment") as HTMLElement).click();
		await wait(10);
		const ta = t.root.querySelector<HTMLTextAreaElement>(".mn-card-input")!;
		ta.value = "입력 중";
		ta.dispatchEvent(new Event("input"));
		await t.view.render();
		expect(t.root.querySelector(".mn-card-input")).toBe(ta);
		expect(ta.value).toBe("입력 중");
		ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await wait(20);
		expect(t.app.vault.text(NOTE)).toBe(TEXT); // 취소하면 노트 그대로
	});

	it("1초 자동 저장 뒤에도 입력창이 닫히지 않고 포커스·커서가 그대로", async () => {
		const t = await makeEnv();
		(cards(t.root)[0].querySelector(".mn-card-comment") as HTMLElement).click();
		await wait(10);
		const ta = t.root.querySelector<HTMLTextAreaElement>(".mn-card-input")!;
		expect(activeDocument.activeElement).toBe(ta);
		ta.value = "RNN을 빼고도 계속 쓰는 중";
		ta.setSelectionRange(5, 5);
		ta.dispatchEvent(new Event("input"));
		await wait(1600); // 자동 저장(1초) → 파일 변경 → 인덱스 알림 → 다시 그리기까지
		expect(await t.store.readBody(t.index.get("aaaaaa")!.file)).toBe("RNN을 빼고도 계속 쓰는 중");
		expect(t.root.querySelector(".mn-card-input")).toBe(ta);
		expect(ta.isConnected).toBe(true);
		expect(activeDocument.activeElement).toBe(ta);
		expect(ta.selectionStart).toBe(5);
	});

	it("편집 중에 목록을 다시 그려도 포커스·커서를 되돌린다", async () => {
		const t = await makeEnv();
		(cards(t.root)[1].querySelector(".mn-card-comment") as HTMLElement).click();
		await wait(10);
		const ta = t.root.querySelector<HTMLTextAreaElement>(".mn-card-input")!;
		ta.value = "abcdef";
		ta.setSelectionRange(2, 4);
		ta.dispatchEvent(new Event("input"));
		await t.view.render();
		await wait(200); // blur 처리(0.15초)가 지나도
		expect(t.root.querySelector(".mn-card-input")).toBe(ta);
		expect(activeDocument.activeElement).toBe(ta);
		expect([ta.selectionStart, ta.selectionEnd]).toEqual([2, 4]);
	});

	it("다른 곳의 변경 알림이 와도 편집 중에는 닫히지 않는다", async () => {
		const t = await makeEnv();
		(cards(t.root)[0].querySelector(".mn-card-comment") as HTMLElement).click();
		await wait(10);
		const ta = t.root.querySelector<HTMLTextAreaElement>(".mn-card-input")!;
		ta.value = "쓰는 중";
		ta.dispatchEvent(new Event("input"));
		t.index.emitChanged([NOTE, "*"]);
		await wait(400);
		expect(t.root.querySelector(".mn-card-input")).toBe(ta);
		expect(activeDocument.activeElement).toBe(ta);
	});

	it("입력창 밖을 누르면(포커스를 잃으면) 저장하고 닫는다", async () => {
		const t = await makeEnv();
		(cards(t.root)[0].querySelector(".mn-card-comment") as HTMLElement).click();
		await wait(10);
		const ta = t.root.querySelector<HTMLTextAreaElement>(".mn-card-input")!;
		ta.value = "밖을 누름";
		ta.dispatchEvent(new Event("input"));
		const other = document.body.createEl("input");
		other.focus();
		await wait(300);
		expect(t.root.querySelector(".mn-card-input")).toBeNull();
		expect(await t.store.readBody(t.index.get("aaaaaa")!.file)).toBe("밖을 누름");
		other.remove();
	});

	it("코멘트 파일을 직접 고치면 1초 안에 카드에 반영 (M9)", async () => {
		const t = await makeEnv();
		const cf = t.app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile;
		// 사용자가 직접 고칠 때는 mn-updated가 그대로다
		await t.app.vault.modify(cf, commentFile({ id: "aaaaaa", source: NOTE, quote: "셀프 어텐션만으로", body: "밖에서 고침" }));
		await wait(600);
		expect(cards(t.root)[0].querySelector(".mn-card-comment")!.textContent).toBe("밖에서 고침");
	});

	it("reveal: 카드 강조", async () => {
		const t = await makeEnv();
		t.view.reveal("bbbbbb");
		const card = t.root.querySelector('.mn-card[data-key="bbbbbb"]')!;
		expect(card.classList.contains("mn-card--flash")).toBe(true);
	});

	it("고아 카드 → 다시 연결 대기 상태 (6.8절)", async () => {
		const t = await makeEnv();
		(cards(t.root)[3].querySelector('[aria-label="더 보기"]') as HTMLElement).click();
		menus.at(-1)!.click("다시 연결");
		await wait(150);
		const relink = t.root.querySelector(".mn-card--relinking");
		expect(relink).not.toBeNull();
		expect(relink!.querySelector(".mn-card-relink button")!.textContent).toBe("여기에 연결");
	});
});

describe("본문 하이라이트 숨기기 버튼", () => {
	it("누르면 숨기기 모드, 다시 누르면 보이기 모드", async () => {
		const t = await makeEnv();
		const eye = t.root.querySelector<HTMLElement>(".mn-toolbar-eye")!;
		expect(eye.getAttribute("data-icon")).toBe("eye");
		expect(document.body.classList.contains(HIDE_CLASS)).toBe(false);
		eye.click();
		expect(document.body.classList.contains(HIDE_CLASS)).toBe(true);
		expect(eye.getAttribute("data-icon")).toBe("eye-off");
		expect(eye.getAttribute("aria-label")).toBe("본문 하이라이트 보이기");
		expect(eye.classList.contains("is-active")).toBe(true);
		// 노트 내용은 그대로
		expect(t.app.vault.text(NOTE)).toBe(TEXT);
		// 사이드바 카드는 그대로
		expect(cards(t.root)).toHaveLength(4);
		eye.click();
		expect(document.body.classList.contains(HIDE_CLASS)).toBe(false);
		expect(eye.getAttribute("data-icon")).toBe("eye");
	});
});

describe("사이드바 — 전체 탭", () => {
	it("노트로 묶고, 위치는 노트 이름 › 제목", async () => {
		const t = await makeEnv();
		t.app.vault.seed("독서노트.md", "# 1장\n==습관은 정체성이다==");
		(t.root.querySelectorAll(".mn-tab")[1] as HTMLElement).click();
		await wait(30);
		const groups = Array.from(t.root.querySelectorAll(".mn-group-name")).map((g) => g.textContent);
		expect(groups).toEqual(["독서노트", "논문정리"]);
		expect(cards(t.root)[0].querySelector(".mn-card-loc")!.textContent).toBe("독서노트 › 1장");
		expect(t.root.querySelector(".mn-footer")!.textContent).toBe("하이라이트 4 · 코멘트 1 · 원문 없음 1");
	});

	it("200개마다 더 보기", async () => {
		const t = await makeEnv();
		t.app.vault.seed("많음.md", Array.from({ length: 250 }, (_, i) => `==항목 ${i}==`).join("\n"));
		(t.root.querySelectorAll(".mn-tab")[1] as HTMLElement).click();
		await wait(30);
		expect(cards(t.root)).toHaveLength(200);
		const more = t.root.querySelector<HTMLElement>(".mn-more")!;
		expect(more.textContent).toContain("54개 남음");
		more.click();
		await wait(30);
		expect(cards(t.root)).toHaveLength(254);
	});
});

describe("라이브 프리뷰 장식 (5.6절, M6)", () => {
	async function editor(livePreview: boolean, cursorAt = 0) {
		const t = await makeEnv();
		editorState.file = t.note;
		editorState.livePreview = livePreview;
		const parent = document.createElement("div");
		document.body.appendChild(parent);
		const view = new EditorView({
			state: EditorState.create({
				doc: TEXT,
				selection: EditorSelection.cursor(cursorAt),
				extensions: [editorInfoField, editorLivePreviewField, buildCmExtension(t.plugin as never)],
			}),
			parent,
		});
		return { ...t, cm: view };
	}

	it("문구에 색 mark, %%mn:id%%는 말풍선 아이콘으로", async () => {
		const { cm } = await editor(true);
		const marks = Array.from(cm.dom.querySelectorAll<HTMLElement>(".mn-hl"));
		expect(marks.map((m) => m.textContent)).toEqual(["셀프 어텐션만으로", "일반 하이라이트", "둘째 문장"]);
		expect(marks[0].getAttribute("data-mn-id")).toBe("aaaaaa");
		expect(marks[0].classList.contains("mn-color-yellow")).toBe(true);
		expect(marks[2].classList.contains("mn-color-blue")).toBe(true);
		expect(marks[1].classList.contains("mn-color-yellow")).toBe(true); // 일반 = 기본색
		const icons = cm.dom.querySelectorAll(".mn-icon");
		expect(icons).toHaveLength(2);
		const visible = cm.contentDOM.textContent ?? "";
		expect(visible).not.toContain("%%mn:aaaaaa%%");
		expect(visible).toContain("%%mn:cccccc%%"); // 코드 블록 안은 장식하지 않는다
	});

	it("커서가 하이라이트에 들어가면 원문을 보여 준다", async () => {
		const pos = TEXT.indexOf("셀프") + 1;
		const { cm } = await editor(true, pos);
		expect(cm.contentDOM.textContent).toContain("%%mn:aaaaaa%%");
		expect(cm.contentDOM.textContent).not.toContain("%%mn:bbbbbb%%");
		cm.dispatch({ selection: EditorSelection.cursor(0) });
		expect(cm.contentDOM.textContent).not.toContain("%%mn:aaaaaa%%");
	});

	it("소스 모드에서는 색만, 아이콘 없음", async () => {
		const { cm } = await editor(false);
		expect(cm.dom.querySelectorAll(".mn-hl")).toHaveLength(3);
		expect(cm.dom.querySelectorAll(".mn-icon")).toHaveLength(0);
	});

	it("색이 바뀌면 refreshEffect로 다시 칠한다", async () => {
		const t = await editor(true);
		t.index.get("aaaaaa")!.color = "red";
		refreshEditorView(t.cm);
		expect(t.cm.dom.querySelector('.mn-hl[data-mn-id="aaaaaa"]')!.classList.contains("mn-color-red")).toBe(true);
	});

	it("코멘트 파일을 연 편집기에는 장식하지 않는다", async () => {
		const t = await makeEnv();
		editorState.file = t.app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile;
		const view = new EditorView({
			state: EditorState.create({ doc: "==x==%%mn:aaaaaa%%", extensions: [editorInfoField, editorLivePreviewField, buildCmExtension(t.plugin as never)] }),
			parent: document.body,
		});
		expect(view.dom.querySelectorAll(".mn-hl")).toHaveLength(0);
	});
});

describe("읽기 모드 (5.6절, M19)", () => {
	function section(html: string, text: string, lineStart: number, lineEnd: number) {
		const el = document.createElement("div");
		el.innerHTML = html;
		const ctx = { sourcePath: NOTE, getSectionInfo: () => ({ text, lineStart, lineEnd }) };
		return { el, ctx };
	}
	it("<mark>와 파싱 결과를 순서대로 짝지어 색·아이콘", async () => {
		const t = await makeEnv();
		const proc = buildReadingProcessor(t.plugin as never);
		const { el, ctx } = section("<p>트랜스포머는 <mark>셀프 어텐션만으로</mark> 처리한다.</p>", TEXT, 1, 1);
		proc(el, ctx as never);
		const mark = el.querySelector("mark")!;
		expect(mark.classList.contains("mn-hl")).toBe(true);
		expect(mark.getAttribute("data-mn-id")).toBe("aaaaaa");
		expect(mark.nextElementSibling?.classList.contains("mn-icon")).toBe(true);
	});
	it("개수가 다르면 칠하지 않는다", async () => {
		const t = await makeEnv();
		const proc = buildReadingProcessor(t.plugin as never);
		const { el, ctx } = section("<p><mark>a</mark> <mark>b</mark></p>", TEXT, 1, 1);
		proc(el, ctx as never);
		expect(el.querySelector(".mn-hl")).toBeNull();
	});
	it("getSectionInfo가 null이면 아무것도 하지 않는다", async () => {
		const t = await makeEnv();
		const proc = buildReadingProcessor(t.plugin as never);
		const el = document.createElement("div");
		el.innerHTML = "<mark>x</mark>";
		proc(el, { sourcePath: NOTE, getSectionInfo: () => null } as never);
		expect(el.querySelector(".mn-hl")).toBeNull();
	});
});

it("settle 헬퍼", async () => {
	await settle();
});
