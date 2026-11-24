import { setIcon, setTooltip, type Editor, type TFile } from "obsidian";
import type { HighlightColor } from "../types";
import { checkSelection } from "../editor/noteWriter";

/** 선택 영역의 화면 좌표 (선택 시작·끝 글자의 위·아래) */
export interface SelectionCoords {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface ToolbarContext {
	editor: Editor;
	file: TFile;
	coords: SelectionCoords;
}

export interface ToolbarDeps {
	/** 지금 선택이 있는 편집기와 좌표. 편집 모드의 마크다운 노트가 아니면 null */
	getContext: () => ToolbarContext | null;
	isCommentFile: (path: string) => boolean;
	enabled: () => boolean;
	colors: () => HighlightColor[];
	defaultColor: () => string;
	onComment: (editor: Editor, file: TFile) => void;
	onHighlight: (editor: Editor, file: TFile, colorKey?: string) => void;
	doc: () => Document;
}

const GAP = 8;
const MARGIN = 6;

/**
 * 버튼 줄 위치 (순수 함수). 선택 위에 가운데 맞춰 두고, 위 공간이 모자라면 아래에 둔다.
 * 화면 밖으로 나가지 않게 좌우를 맞춘다.
 */
export function placeToolbar(
	c: SelectionCoords,
	size: { width: number; height: number },
	viewport: { width: number; height: number },
): { left: number; top: number; below: boolean } {
	const center = (c.left + c.right) / 2;
	let left = center - size.width / 2;
	left = Math.max(MARGIN, Math.min(left, viewport.width - size.width - MARGIN));
	let top = c.top - size.height - GAP;
	let below = false;
	if (top < MARGIN) {
		top = c.bottom + GAP;
		below = true;
	}
	top = Math.min(top, viewport.height - size.height - MARGIN);
	return { left: Math.round(left), top: Math.round(top), below };
}

/** 하이라이트할 수 있는 선택인가 (검사 1~5 통과, 코멘트 파일 아님) */
export function canOfferToolbar(editor: Editor, file: TFile, isCommentFile: (p: string) => boolean): boolean {
	if (isCommentFile(file.path) || !editor.somethingSelected()) return false;
	const from = editor.posToOffset(editor.getCursor("from"));
	const to = editor.posToOffset(editor.getCursor("to"));
	return checkSelection(editor.getValue(), from, to, file.path).kind === "ok";
}

/** 글을 선택하면 선택 위에 뜨는 작은 버튼 줄 */
export class SelectionToolbar {
	el: HTMLElement | null = null;
	private ctx: ToolbarContext | null = null;

	constructor(private deps: ToolbarDeps) {}

	/** 마우스를 떼거나 Shift+방향키로 선택을 바꾼 뒤 부른다 */
	update(): void {
		if (!this.deps.enabled()) {
			this.hide();
			return;
		}
		const ctx = this.deps.getContext();
		if (!ctx || !canOfferToolbar(ctx.editor, ctx.file, this.deps.isCommentFile)) {
			this.hide();
			return;
		}
		this.show(ctx);
	}

	private show(ctx: ToolbarContext): void {
		this.ctx = ctx;
		const doc = this.deps.doc();
		if (!this.el || this.el.ownerDocument !== doc) {
			this.el?.remove();
			this.el = this.build(doc);
		}
		const el = this.el;
		el.removeClass("is-hidden");
		const win = doc.defaultView;
		const pos = placeToolbar(
			ctx.coords,
			{ width: el.offsetWidth || 220, height: el.offsetHeight || 32 },
			{ width: win?.innerWidth ?? 1024, height: win?.innerHeight ?? 768 },
		);
		el.setCssProps({ left: `${pos.left}px`, top: `${pos.top}px` });
		el.toggleClass("is-below", pos.below);
	}

	private build(doc: Document): HTMLElement {
		const el = doc.body.createDiv({ cls: "mn-selection-toolbar is-hidden", attr: { role: "toolbar", "aria-label": "Margin Notes" } });
		// 버튼을 눌러도 편집기 선택이 풀리지 않게
		el.addEventListener("mousedown", (e) => e.preventDefault());

		const btn = (icon: string, label: string, run: () => void, cls = "") => {
			const b = el.createEl("button", { cls: "clickable-icon mn-tb-btn " + cls, attr: { "aria-label": label, type: "button" } });
			setIcon(b, icon);
			b.createSpan({ cls: "mn-tb-label", text: label });
			setTooltip(b, label);
			b.addEventListener("click", (e) => {
				e.preventDefault();
				run();
			});
			return b;
		};
		btn("message-square-plus", "코멘트", () => this.fire((c) => this.deps.onComment(c.editor, c.file)), "mn-tb-comment");
		btn("highlighter", "하이라이트", () => this.fire((c) => this.deps.onHighlight(c.editor, c.file)), "mn-tb-highlight");

		const colors = this.deps.colors();
		if (colors.length > 1) {
			el.createDiv({ cls: "mn-tb-sep" });
			for (const c of colors) {
				const dot = el.createEl("button", {
					cls: `mn-tb-color mn-color-${c.key}`,
					attr: { "aria-label": `${c.name} 하이라이트`, type: "button", "data-key": c.key },
				});
				dot.createSpan({ cls: "mn-color-dot" });
				setTooltip(dot, c.name);
				dot.addEventListener("click", (e) => {
					e.preventDefault();
					this.fire((ctx) => this.deps.onHighlight(ctx.editor, ctx.file, c.key));
				});
			}
		}
		return el;
	}

	private fire(fn: (ctx: ToolbarContext) => void): void {
		const ctx = this.ctx;
		this.hide();
		if (ctx) fn(ctx);
	}

	hide(): void {
		this.ctx = null;
		this.el?.addClass("is-hidden");
	}

	get visible(): boolean {
		return !!this.el && !this.el.hasClass("is-hidden");
	}

	/** 색 목록이 바뀌면 다음 표시 때 다시 만든다 */
	reset(): void {
		this.el?.remove();
		this.el = null;
		this.ctx = null;
	}

	destroy(): void {
		this.reset();
	}
}
