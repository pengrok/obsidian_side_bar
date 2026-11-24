import { describe, expect, it } from "vitest";
import { Editor, type TFile } from "obsidian";
import { checkSelection, MSG } from "../src/editor/noteWriter";
import { parseHighlights } from "../src/parser/highlightParser";
import { setup } from "./helpers";

const sel = (text: string, part: string, nth = 0) => {
	let i = -1;
	for (let k = 0; k <= nth; k++) i = text.indexOf(part, i + 1);
	return [i, i + part.length] as const;
};

describe("checkSelection (5.6절 검사 1~6, M5)", () => {
	const T = "첫 줄 문장입니다.\n둘째 줄 ==기존 하이라이트==%%mn:aaaaaa%% 끝\n`인라인 ==코드==` 밖\n```\n코드 블록\n```\n> 인용 문장\n| 칸1 | 칸2 |";

	it("1 비어 있음", () => {
		expect(checkSelection(T, 3, 3)).toEqual({ kind: "error", reason: MSG.empty });
	});
	it("2 여러 줄", () => {
		const [a] = sel(T, "문장");
		const [, b] = sel(T, "둘째");
		expect(checkSelection(T, a, b)).toEqual({ kind: "error", reason: MSG.multiline });
	});
	it("3 양끝 공백을 자르고, 공백뿐이면 1번 안내", () => {
		const [a, b] = sel(T, " 문장입니다. ".trimEnd());
		const r = checkSelection(T, a, b);
		expect(r).toMatchObject({ kind: "ok", quote: "문장입니다." });
		const sp = T.indexOf(" ");
		expect(checkSelection(T, sp, sp + 1)).toEqual({ kind: "error", reason: MSG.empty });
	});
	it("4 코드 블록·인라인 코드 안", () => {
		expect(checkSelection(T, ...sel(T, "코드 블록"))).toEqual({ kind: "error", reason: MSG.code });
		expect(checkSelection(T, ...sel(T, "인라인"))).toEqual({ kind: "error", reason: MSG.code });
	});
	it("5 == 또는 %% 포함, 기존 하이라이트와 겹침", () => {
		expect(checkSelection(T, ...sel(T, "줄 ==기존"))).toEqual({ kind: "error", reason: MSG.overlap });
		expect(checkSelection(T, ...sel(T, "aaaaaa"))).toEqual({ kind: "error", reason: MSG.overlap });
		expect(checkSelection("a==b", 0, 1)).toEqual({ kind: "error", reason: MSG.overlap });
	});
	it("6 기존 하이라이트 안에 완전히 들어가면 그 하이라이트", () => {
		const r = checkSelection(T, ...sel(T, "하이라이트"), "n.md");
		expect(r.kind).toBe("inside");
		if (r.kind === "inside") {
			expect(r.highlight.id).toBe("aaaaaa");
			expect(r.highlight.filePath).toBe("n.md");
		}
	});
	it("E14 줄 앞 > 기호가 선택에 들어가면 잘라낸다", () => {
		const [a, b] = sel(T, "> 인용 문장");
		expect(checkSelection(T, a, b)).toMatchObject({ kind: "ok", quote: "인용 문장" });
	});
	it("표에서 | 를 넘는 선택은 막는다", () => {
		expect(checkSelection(T, ...sel(T, "칸1 | 칸2"))).toEqual({ kind: "error", reason: MSG.tableCell });
		expect(checkSelection(T, ...sel(T, "칸1"))).toMatchObject({ kind: "ok" });
	});
	it("frontmatter 안", () => {
		const t = "---\ntitle: 제목\n---\n본문";
		expect(checkSelection(t, ...sel(t, "제목"))).toEqual({ kind: "error", reason: MSG.code });
	});
});

describe("NoteWriter — 편집기", () => {
	it("wrapRange: 한 번의 transaction(=Ctrl/Cmd+Z 한 번)으로 ==문구==%%mn:id%% (M3)", () => {
		const { writer } = setup();
		const ed = new Editor("가나다 라마바 사");
		const [a, b] = sel(ed.getValue(), "라마바");
		const ok = writer.wrapRange(ed as never, { from: a, to: b, quote: "라마바" }, "abc123");
		expect(ok).toBe(true);
		expect(ed.getValue()).toBe("가나다 ==라마바==%%mn:abc123%% 사");
		expect(ed.transactions).toBe(1);
		// 커서는 삽입한 텍스트 끝
		expect(ed.posToOffset(ed.getCursor())).toBe(ed.getValue().indexOf(" 사"));
	});
	it("wrapRange: 모달이 열린 사이 글이 바뀌면 false, 본문 그대로 (E10)", () => {
		const { writer } = setup();
		const ed = new Editor("가나다 라마바 사");
		const [a, b] = sel(ed.getValue(), "라마바");
		ed.setValue("가나다 바뀜바 사");
		expect(writer.wrapRange(ed as never, { from: a, to: b, quote: "라마바" }, "abc123")).toBe(false);
		expect(ed.getValue()).toBe("가나다 바뀜바 사");
		expect(ed.transactions).toBe(0);
	});
	it("wrapSelection: 검사에 걸리면 본문을 바꾸지 않는다", () => {
		const { writer } = setup();
		const ed = new Editor("a\nb");
		ed.select(0, 3);
		expect(writer.wrapSelection(ed as never, null)).toEqual({ ok: false, reason: MSG.multiline });
		expect(ed.getValue()).toBe("a\nb");
	});
	it("열린 파일은 편집기로, 아니면 vault.process로 고친다", async () => {
		const { app, writer } = setup();
		const f = app.vault.seed("a.md", "앞 ==문구==%%mn:abc123%% 뒤");
		expect(await writer.unwrap(f as TFile, "abc123")).toBe(true);
		expect(app.vault.text("a.md")).toBe("앞 문구 뒤");

		const g = app.vault.seed("b.md", "앞 ==문구==%%mn:abc123%% 뒤");
		const view = app.workspace.open(g, app.vault.text("b.md"));
		expect(await writer.unwrap(g as TFile, "abc123")).toBe(true);
		expect(view.editor.getValue()).toBe("앞 문구 뒤");
		expect(view.editor.transactions).toBe(1);
		expect(app.vault.text("b.md")).toBe("앞 ==문구==%%mn:abc123%% 뒤"); // 저장은 옵시디언 몫
	});
});

describe("NoteWriter — 파일 고치기", () => {
	it("attachId: 일반 하이라이트에 ID를 붙인다. 오프셋이 낡았으면 순번으로 다시 찾는다", async () => {
		const { app, writer } = setup();
		const f = app.vault.seed("a.md", "==반복== 그리고 ==반복==") as TFile;
		const hls = parseHighlights(app.vault.text("a.md"), "a.md");
		await app.vault.modify(f, "앞에 글 추가 ==반복== 그리고 ==반복==");
		expect(await writer.attachId(f, hls[1], "abc123", 1)).toBe(true);
		expect(app.vault.text("a.md")).toBe("앞에 글 추가 ==반복== 그리고 ==반복==%%mn:abc123%%");
	});
	it("attachId: 위치를 못 찾으면 바꾸지 않고 false", async () => {
		const { app, writer } = setup();
		const f = app.vault.seed("a.md", "==x==") as TFile;
		const hl = parseHighlights("==y==", "a.md")[0];
		expect(await writer.attachId(f, hl, "abc123")).toBe(false);
		expect(app.vault.text("a.md")).toBe("==x==");
	});
	it("unwrapPlain", async () => {
		const { app, writer } = setup();
		const f = app.vault.seed("a.md", "==a== ==b==") as TFile;
		const hl = parseHighlights("==a== ==b==", "a.md")[1];
		expect(await writer.unwrapPlain(f, hl)).toBe(true);
		expect(app.vault.text("a.md")).toBe("==a== b");
	});
	it("removeAnchor: 하이라이트는 남기고 ID만 (6.5절) / ID만 남은 경우 (E2)", async () => {
		const { app, writer } = setup();
		const f = app.vault.seed("a.md", "==a==%%mn:abc123%% 끝 b%%mn:zzz999%%") as TFile;
		expect(await writer.removeAnchor(f, "abc123")).toBe(true);
		expect(await writer.removeAnchor(f, "zzz999")).toBe(true);
		expect(app.vault.text("a.md")).toBe("==a== 끝 b");
		expect(await writer.removeAnchor(f, "nonono")).toBe(false);
	});
	it("replaceAnchorAt: 두 번째 중복만 새 ID로 (E4)", async () => {
		const { app, writer } = setup();
		const t = "==a==%%mn:abc123%% ==a==%%mn:abc123%%";
		const f = app.vault.seed("a.md", t) as TFile;
		const second = parseHighlights(t, "a.md")[1];
		expect(await writer.replaceAnchorAt(f, second, "new001")).toBe(true);
		expect(app.vault.text("a.md")).toBe("==a==%%mn:abc123%% ==a==%%mn:new001%%");
	});
});
