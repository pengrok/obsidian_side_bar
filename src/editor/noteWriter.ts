import { MarkdownView, type App, type Editor, type TFile } from "obsidian";
import { findPlainByOrdinal, highlightAt, parseHighlights, parseLines } from "../parser/highlightParser";
import { analyzeLines, rangeTouchesExcluded } from "../parser/mask";
import type { Highlight } from "../types";

export const MSG = {
	empty: "글을 먼저 선택하세요",
	multiline: "한 줄 안에서만 선택할 수 있어요",
	code: "코드·수식 안에는 하이라이트할 수 없어요",
	overlap: "이미 하이라이트된 부분과 겹쳐요",
	tableCell: "표의 칸을 넘어 선택할 수 없어요",
	changed: "선택한 글이 바뀌었어요. 다시 선택해 주세요",
} as const;

export type SelectionCheck =
	| { kind: "ok"; from: number; to: number; quote: string }
	| { kind: "inside"; highlight: Highlight }
	| { kind: "error"; reason: string };

interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

const QUOTE_PREFIX_RE = /^\s*(?:>\s?)+(?:\[![^\]]*\][+-]?\s*)?/;

/**
 * 선택 영역 검사 (5.6절 1~6). 본문은 바꾸지 않는다.
 * text 전체, 선택 시작·끝 오프셋을 받아 순수하게 판단한다.
 */
export function checkSelection(text: string, selFrom: number, selTo: number, filePath = ""): SelectionCheck {
	if (selFrom > selTo) [selFrom, selTo] = [selTo, selFrom];
	if (selFrom === selTo) return { kind: "error", reason: MSG.empty };
	const raw = text.slice(selFrom, selTo);
	if (/[\r\n]/.test(raw)) return { kind: "error", reason: MSG.multiline };

	// 줄 앞 인용·콜아웃 기호가 선택에 들어가면 잘라낸다 (E14)
	const lineStart = text.lastIndexOf("\n", selFrom - 1) + 1;
	const lineEndIdx = text.indexOf("\n", selFrom);
	const lineText = text.slice(lineStart, lineEndIdx === -1 ? text.length : lineEndIdx).replace(/\r$/, "");
	const prefix = QUOTE_PREFIX_RE.exec(lineText);
	if (prefix && selFrom < lineStart + prefix[0].length) selFrom = Math.min(selTo, lineStart + prefix[0].length);

	// 양끝 공백 자르기
	while (selFrom < selTo && /\s/.test(text[selFrom])) selFrom++;
	while (selTo > selFrom && /\s/.test(text[selTo - 1])) selTo--;
	if (selFrom === selTo) return { kind: "error", reason: MSG.empty };

	const lines = analyzeLines(text);
	if (rangeTouchesExcluded(lines, selFrom, selTo)) return { kind: "error", reason: MSG.code };

	const quote = text.slice(selFrom, selTo);
	const hls = parseLines(lines, filePath);
	// 6) 기존 하이라이트 문구 안에 완전히 들어감 → 코멘트 흐름으로
	const inside = hls.find((h) => selFrom >= h.textFrom && selTo <= h.textTo);
	if (inside) return { kind: "inside", highlight: inside };
	// 5) == 또는 %% 포함, 기존 하이라이트와 겹침, 바로 옆이 = 라서 붙이면 깨짐
	if (quote.includes("==") || quote.includes("%%")) return { kind: "error", reason: MSG.overlap };
	if (hls.some((h) => selFrom < h.to && selTo > h.from)) return { kind: "error", reason: MSG.overlap };
	if (quote.startsWith("=") || quote.endsWith("=") || text[selFrom - 1] === "=" || text[selTo] === "=") {
		return { kind: "error", reason: MSG.overlap };
	}
	// 표 행에서 | 를 넘는 선택은 표를 깨뜨린다
	if (/^\s*\|/.test(lineText) && /(^|[^\\])\|/.test(quote)) return { kind: "error", reason: MSG.tableCell };
	return { kind: "ok", from: selFrom, to: selTo, quote };
}

export function markup(quote: string, id: string | null): string {
	return "==" + quote + "==" + (id ? `%%mn:${id}%%` : "");
}

/** 원본 노트 본문을 바꾸는 유일한 곳 (5.6절) */
export class NoteWriter {
	constructor(private app: App) {}

	/** 파일이 열린 편집기 (읽기 모드면 null — 그때는 vault.process로 고친다) */
	findEditor(path: string): Editor | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path && v.getMode() === "source") return v.editor;
		}
		return null;
	}

	validateSelection(editor: Editor, filePath = ""): SelectionCheck {
		const text = editor.getValue();
		const from = editor.posToOffset(editor.getCursor("from"));
		const to = editor.posToOffset(editor.getCursor("to"));
		return checkSelection(text, from, to, filePath);
	}

	/** 열린 편집기에서 선택 영역을 바로 감싼다 */
	wrapSelection(editor: Editor, id: string | null): { ok: true; quote: string; from: number } | { ok: false; reason: string } {
		const c = this.validateSelection(editor);
		if (c.kind === "error") return { ok: false, reason: c.reason };
		if (c.kind === "inside") return { ok: false, reason: MSG.overlap };
		if (!this.wrapRange(editor, c, id)) return { ok: false, reason: MSG.changed };
		return { ok: true, quote: c.quote, from: c.from };
	}

	/**
	 * 기억해 둔 구간을 감싼다. 그 사이 글이 바뀌었으면 false (6.1절 6).
	 * 한 번의 transaction이라 Ctrl/Cmd+Z 한 번으로 되돌아간다.
	 */
	wrapRange(editor: Editor, r: { from: number; to: number; quote: string }, id: string | null): boolean {
		const fromPos = editor.offsetToPos(r.from);
		const toPos = editor.offsetToPos(r.to);
		if (editor.getRange(fromPos, toPos) !== r.quote) return false;
		const again = checkSelection(editor.getValue(), r.from, r.to);
		if (again.kind !== "ok" || again.from !== r.from || again.to !== r.to) return false;
		const text = markup(r.quote, id);
		editor.transaction({
			changes: [{ from: fromPos, to: toPos, text }],
			selection: { from: { line: fromPos.line, ch: fromPos.ch + text.length } },
		});
		return true;
	}

	/** 일반 하이라이트에 ID를 붙인다 */
	attachId(file: TFile, hl: Highlight, id: string, ordinal?: number): Promise<boolean> {
		return this.modify(file, (text) => {
			const h = this.relocatePlain(text, hl, ordinal);
			if (!h) return null;
			return { from: h.to, to: h.to, insert: `%%mn:${id}%%` };
		});
	}

	/** ==문구==%%mn:id%% → 문구 */
	unwrap(file: TFile, id: string): Promise<boolean> {
		return this.modify(file, (text) => {
			const h = parseHighlights(text, file.path).find((x) => x.id === id);
			if (!h) return null;
			return { from: h.from, to: h.to, insert: h.text };
		});
	}

	/** 일반 하이라이트 ==문구== → 문구 */
	unwrapPlain(file: TFile, hl: Highlight, ordinal?: number): Promise<boolean> {
		return this.modify(file, (text) => {
			const h = this.relocatePlain(text, hl, ordinal);
			if (!h) return null;
			return { from: h.from, to: h.to, insert: h.text };
		});
	}

	/** 특정 위치의 ID 하이라이트 ==문구==%%mn:id%% → 문구 (중복 ID 쪽을 지울 때) */
	unwrapAt(file: TFile, hl: Highlight): Promise<boolean> {
		return this.modify(file, (text) => {
			const h = parseHighlights(text, file.path).find((x) => x.from === hl.from && x.id === hl.id && x.text === hl.text);
			if (!h) return null;
			return { from: h.from, to: h.to, insert: h.text };
		});
	}

	/** %%mn:id%% 만 지운다. 하이라이트가 있으면 ==문구==는 남는다 (6.5절, E2) */
	removeAnchor(file: TFile, id: string): Promise<boolean> {
		return this.modify(file, (text) => {
			const h = parseHighlights(text, file.path).find((x) => x.id === id);
			if (h) return { from: h.textTo + 2, to: h.to, insert: "" };
			const anchor = `%%mn:${id}%%`;
			const i = text.indexOf(anchor);
			if (i < 0) return null;
			return { from: i, to: i + anchor.length, insert: "" };
		});
	}

	/** 특정 위치 하이라이트의 ID를 새 ID로 바꾼다 (E4 "새 ID로 분리") */
	replaceAnchorAt(file: TFile, hl: Highlight, newId: string): Promise<boolean> {
		return this.modify(file, (text) => {
			const h = parseHighlights(text, file.path).find((x) => x.from === hl.from && x.id === hl.id && x.text === hl.text);
			if (!h || !h.id) return null;
			return { from: h.textTo + 2, to: h.to, insert: `%%mn:${newId}%%` };
		});
	}

	/** 열린 편집기 커서 위치의 하이라이트 */
	highlightAtCursor(editor: Editor, path: string): Highlight | null {
		const text = editor.getValue();
		const off = editor.posToOffset(editor.getCursor("head"));
		const hls = parseHighlights(text, path);
		const sel = editor.getCursor("from");
		const selOff = editor.posToOffset(sel);
		return highlightAt(hls, off) ?? highlightAt(hls, selOff);
	}

	private relocatePlain(text: string, hl: Highlight, ordinal?: number): Highlight | null {
		const hls = parseHighlights(text, hl.filePath);
		const exact = hls.find((h) => h.from === hl.from && h.text === hl.text && h.id === null);
		if (exact) return exact;
		if (ordinal !== undefined && ordinal >= 0) return findPlainByOrdinal(hls, hl.text, ordinal);
		return null;
	}

	/**
	 * 바꾸기 직전 텍스트로 편집 위치를 다시 계산한다. 계산이 null이면 아무것도 바꾸지 않고 false.
	 * 열린 편집기가 있으면 editor.transaction, 아니면 vault.process.
	 */
	async modify(file: TFile, compute: (text: string) => TextEdit | null): Promise<boolean> {
		const editor = this.findEditor(file.path);
		if (editor) {
			const e = compute(editor.getValue());
			if (!e) return false;
			editor.transaction({ changes: [{ from: editor.offsetToPos(e.from), to: editor.offsetToPos(e.to), text: e.insert }] });
			return true;
		}
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const e = compute(data);
			if (!e) return data;
			ok = true;
			return data.slice(0, e.from) + e.insert + data.slice(e.to);
		});
		return ok;
	}
}
