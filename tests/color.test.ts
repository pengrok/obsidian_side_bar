// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Editor, Menu, parseYaml, TFile, type MarkdownView } from "obsidian";
import { installDomHelpers } from "./dom";
import { applyColor, colorAttrs, isHexColor, resolveColor } from "../src/utils/color";
import { DEFAULT_COLORS, mergeData } from "../src/settingsDefaults";
import { buildCommentFile } from "../src/store/frontmatter";
import { editorMenu } from "../src/commands";
import { SelectionToolbar } from "../src/ui/selectionToolbar";
import { colorKeyOf, groupItems } from "../src/ui/search";
import { setup } from "./helpers";

beforeAll(() => installDomHelpers());

describe("직접 고른 색", () => {
	it("resolveColor: 팔레트 key, #hex, 지워진 key는 기본색", () => {
		expect(resolveColor("blue", DEFAULT_COLORS, "yellow")).toBe("blue");
		expect(resolveColor("#FF8800", DEFAULT_COLORS, "yellow")).toBe("#ff8800");
		expect(resolveColor("c9", DEFAULT_COLORS, "yellow")).toBe("yellow");
		expect(resolveColor(null, DEFAULT_COLORS, "yellow")).toBe("yellow");
		expect(isHexColor("#abc")).toBe(true);
		expect(isHexColor("red; background:url(x)")).toBe(false);
	});
	it("colorAttrs / applyColor: 팔레트는 클래스, #hex는 CSS 변수", () => {
		expect(colorAttrs("blue")).toEqual({ cls: "mn-color-blue", style: null });
		expect(colorAttrs("#ff8800")).toEqual({ cls: "mn-color-custom", style: "--mn-hl-color: #ff8800" });
		const el = document.createElement("div");
		applyColor(el, "#ff8800");
		expect(el.style.getPropertyValue("--mn-hl-color")).toBe("#ff8800");
		applyColor(el, "green");
		expect(el.className).toBe("mn-color-green");
		expect(el.style.getPropertyValue("--mn-hl-color")).toBe("");
	});
	it("#hex는 YAML에서 주석으로 읽히지 않게 따옴표로 저장", () => {
		const text = buildCommentFile({ id: "abc123", sourceLink: "[[a]]", sourcePath: "a.md", quote: "q", color: "#ff8800", created: "x" }, "");
		expect(text).toContain('mn-color: "#ff8800"');
		expect(parseYaml(text.split("---\n")[1])["mn-color"]).toBe("#ff8800");
	});
	it("검색·묶기에서는 #hex 그대로", () => {
		const item = { key: "a", status: "linked", highlight: null, notePath: "n.md", annotation: { color: "#ff8800" } } as never;
		expect(colorKeyOf(item, DEFAULT_COLORS, "yellow")).toBe("#ff8800");
		expect(groupItems([item], "color", DEFAULT_COLORS, "yellow")[0].label).toBe("#ff8800");
	});
});

describe("색 이름", () => {
	it("기본 팔레트에는 뜻 이름이 없다", () => {
		expect(DEFAULT_COLORS.map((c) => c.name)).toEqual(["노랑", "초록", "파랑", "빨강", "보라"]);
	});
	it("예전 버전의 뜻 이름은 색 이름으로 옮기고, 사용자가 바꾼 이름은 그대로", () => {
		const { settings } = mergeData({
			settings: {
				colors: [
					{ key: "yellow", name: "중요", color: "#ffd54f" },
					{ key: "blue", name: "내가 붙인 이름", color: "#64b5f6" },
					{ key: "c1", name: "형광 주황", color: "#ff8800" },
				],
			},
		});
		expect(settings.colors.map((c) => c.name)).toEqual(["노랑", "내가 붙인 이름", "형광 주황"]);
	});
});

describe("우클릭 메뉴에 색 항목이 없다", () => {
	async function menuFor(text: string, from: number, to: number) {
		const e = setup();
		const f = e.app.vault.seed("n.md", text) as TFile;
		await e.index.build();
		const plugin = { index: e.index, writer: e.writer, settings: e.settings, actions: {} };
		const editor = new Editor(text);
		editor.select(from, to);
		const menu = new Menu();
		editorMenu(plugin as never, menu as never, editor as never, { file: f } as unknown as MarkdownView);
		return menu.titles();
	}
	it("선택했을 때", async () => {
		expect(await menuFor("가나다 라마바", 0, 3)).toEqual(["하이라이트 + 코멘트", "하이라이트만"]);
	});
	it("하이라이트 안에 커서", async () => {
		expect(await menuFor("==가나다== 라", 3, 3)).toEqual(["코멘트 추가", "하이라이트 제거"]);
	});
});

describe("버튼 줄의 다른 색 고르기", () => {
	it("고른 #hex로 하이라이트", () => {
		const editor = new Editor("가나다 라마바");
		editor.select(4, 7);
		const file = Object.assign(new TFile(), { path: "n.md" });
		const onHighlight = vi.fn();
		let picked: ((hex: string) => void) | null = null;
		const tb = new SelectionToolbar({
			getContext: () => ({ editor: editor as never, file, coords: { left: 0, right: 10, top: 100, bottom: 120 } }),
			isCommentFile: () => false,
			enabled: () => true,
			colors: () => DEFAULT_COLORS,
			defaultColor: () => "yellow",
			onComment: vi.fn(),
			onHighlight,
			pickColor: (cb) => (picked = cb),
			doc: () => document,
		});
		tb.update();
		(tb.el!.querySelector(".mn-tb-pick") as HTMLElement).click();
		expect(tb.visible).toBe(true); // 선택기가 열린 동안은 그대로
		picked!("#ff8800");
		expect(onHighlight).toHaveBeenCalledWith(editor, file, "#ff8800");
		expect(tb.visible).toBe(false);
	});
});
