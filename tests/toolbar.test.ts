// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Editor, TFile } from "obsidian";
import { installDomHelpers } from "./dom";
import { canOfferToolbar, placeToolbar, SelectionToolbar, type ToolbarDeps } from "../src/ui/selectionToolbar";
import { DEFAULT_COLORS } from "../src/settingsDefaults";

beforeAll(() => installDomHelpers());

const file = Object.assign(new TFile(), { path: "n.md", basename: "n", extension: "md" });
const coords = { left: 300, right: 400, top: 200, bottom: 220 };

function make(text: string, from: number, to: number, over: Partial<ToolbarDeps> = {}) {
	const editor = new Editor(text);
	editor.select(from, to);
	const onComment = vi.fn();
	const onHighlight = vi.fn();
	const tb = new SelectionToolbar({
		getContext: () => ({ editor: editor as never, file, coords }),
		isCommentFile: (p) => p.startsWith("Annotations/"),
		enabled: () => true,
		colors: () => DEFAULT_COLORS,
		defaultColor: () => "yellow",
		onComment,
		onHighlight,
		doc: () => document,
		...over,
	});
	return { tb, editor, onComment, onHighlight };
}

describe("placeToolbar", () => {
	const vp = { width: 1000, height: 800 };
	it("선택 위 가운데", () => {
		expect(placeToolbar(coords, { width: 200, height: 30 }, vp)).toEqual({ left: 250, top: 162, below: false });
	});
	it("위 공간이 없으면 아래", () => {
		const p = placeToolbar({ ...coords, top: 10, bottom: 30 }, { width: 200, height: 30 }, vp);
		expect(p.below).toBe(true);
		expect(p.top).toBe(38);
	});
	it("화면 밖으로 나가지 않는다", () => {
		expect(placeToolbar({ left: 0, right: 10, top: 300, bottom: 320 }, { width: 200, height: 30 }, vp).left).toBe(6);
		expect(placeToolbar({ left: 990, right: 1000, top: 300, bottom: 320 }, { width: 200, height: 30 }, vp).left).toBe(794);
	});
});

describe("SelectionToolbar", () => {
	it("하이라이트할 수 있는 선택이면 뜬다: 코멘트·하이라이트·색 5개", () => {
		const { tb } = make("가나다 라마바", 4, 7);
		tb.update();
		expect(tb.visible).toBe(true);
		const el = tb.el!;
		expect(el.querySelectorAll(".mn-tb-btn")).toHaveLength(2);
		expect(el.querySelectorAll(".mn-tb-color")).toHaveLength(5);
		expect(el.style.getPropertyValue("left")).not.toBe("");
	});

	it("버튼을 누르면 실행하고 사라진다", () => {
		const t = make("가나다 라마바", 4, 7);
		t.tb.update();
		(t.tb.el!.querySelector(".mn-tb-comment") as HTMLElement).click();
		expect(t.onComment).toHaveBeenCalledWith(t.editor, file);
		expect(t.tb.visible).toBe(false);
		t.tb.update();
		(t.tb.el!.querySelector('.mn-tb-color[data-key="blue"]') as HTMLElement).click();
		expect(t.onHighlight).toHaveBeenCalledWith(t.editor, file, "blue");
		t.tb.update();
		(t.tb.el!.querySelector(".mn-tb-highlight") as HTMLElement).click();
		expect(t.onHighlight).toHaveBeenLastCalledWith(t.editor, file);
	});

	it("버튼을 눌러도 편집기 선택이 풀리지 않게 mousedown을 막는다", () => {
		const { tb } = make("가나다 라마바", 4, 7);
		tb.update();
		const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
		tb.el!.querySelector(".mn-tb-comment")!.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(true);
	});

	it.each([
		["선택 없음", "가나다", 1, 1],
		["여러 줄", "가나다\n라마바", 1, 6],
		["코드 안", "`코드 ==x==`", 1, 3],
		["기존 하이라이트와 겹침", "==가나다== 라", 3, 8],
	])("%s → 뜨지 않는다", (_n, text, a, b) => {
		const { tb } = make(text as string, a as number, b as number);
		tb.update();
		expect(tb.visible).toBe(false);
	});

	it("설정에서 끄면 뜨지 않는다", () => {
		const { tb } = make("가나다 라마바", 4, 7, { enabled: () => false });
		tb.update();
		expect(tb.visible).toBe(false);
	});

	it("코멘트 파일에서는 뜨지 않는다", () => {
		const editor = new Editor("가나다");
		editor.select(0, 2);
		const cf = Object.assign(new TFile(), { path: "Annotations/a.md" });
		expect(canOfferToolbar(editor as never, cf, (p) => p.startsWith("Annotations/"))).toBe(false);
	});

	it("색이 하나뿐이면 색 점을 안 보여 준다, reset하면 다시 만든다", () => {
		let colors = DEFAULT_COLORS.slice(0, 1);
		const { tb } = make("가나다 라마바", 4, 7, { colors: () => colors });
		tb.update();
		expect(tb.el!.querySelectorAll(".mn-tb-color")).toHaveLength(0);
		colors = DEFAULT_COLORS;
		tb.reset();
		tb.update();
		expect(tb.el!.querySelectorAll(".mn-tb-color")).toHaveLength(5);
	});
});
