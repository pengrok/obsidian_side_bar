import { RangeSetBuilder, StateEffect, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, setIcon } from "obsidian";
import type MarginNotesPlugin from "../main";
import { HIGHLIGHT_RE, parseHighlights } from "../parser/highlightParser";
import type { Highlight } from "../types";
import { colorAttrs } from "../utils/color";

/** 인덱스가 바뀌면 열린 편집기에 보내 장식을 다시 만든다 */
export const refreshEffect = StateEffect.define<null>();

/** 이보다 큰 문서는 화면에 보이는 줄만 단순 정규식으로 훑는다 */
const FULL_PARSE_LIMIT = 500_000;

class CommentIconWidget extends WidgetType {
	constructor(
		readonly id: string,
		readonly plugin: MarginNotesPlugin,
	) {
		super();
	}
	eq(other: CommentIconWidget): boolean {
		return other.id === this.id;
	}
	toDOM(): HTMLElement {
		const span = createSpan({ cls: "mn-icon", attr: { "data-mn-id": this.id, "aria-label": "코멘트 보기" } });
		setIcon(span, "message-square");
		span.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		span.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.plugin.revealInSidebar(this.id, true);
		});
		return span;
	}
	ignoreEvent(): boolean {
		return true;
	}
}

/** 라이브 프리뷰·소스 모드 장식 (5.6절) */
export function buildCmExtension(plugin: MarginNotesPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			private doc: Text | null = null;
			private hls: Highlight[] = [];

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(u: ViewUpdate): void {
				const lpChanged = u.startState.field(editorLivePreviewField, false) !== u.state.field(editorLivePreviewField, false);
				const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshEffect)));
				if (u.docChanged || u.viewportChanged || u.selectionSet || lpChanged || refreshed || u.focusChanged) {
					this.decorations = this.build(u.view);
				}
			}

			private highlights(view: EditorView): Highlight[] {
				const doc = view.state.doc;
				if (this.doc === doc) return this.hls;
				this.doc = doc;
				if (doc.length <= FULL_PARSE_LIMIT) {
					this.hls = parseHighlights(doc.toString(), "");
				} else {
					// 큰 문서: 보이는 줄만 (코드 블록 판별 없이)
					const out: Highlight[] = [];
					for (const r of view.visibleRanges) {
						let pos = r.from;
						while (pos <= r.to) {
							const line = doc.lineAt(pos);
							HIGHLIGHT_RE.lastIndex = 0;
							let m: RegExpExecArray | null;
							while ((m = HIGHLIGHT_RE.exec(line.text)) !== null) {
								const from = line.from + m.index;
								out.push({
									filePath: "",
									line: line.number - 1,
									from,
									to: from + m[0].length,
									textFrom: from + 2,
									textTo: from + 2 + m[1].length,
									text: m[1],
									id: m[2] ?? null,
									heading: null,
									order: out.length,
								});
							}
							pos = line.to + 1;
						}
					}
					this.hls = out;
					this.doc = null; // 스크롤하면 다시 훑는다
				}
				return this.hls;
			}

			build(view: EditorView): DecorationSet {
				const info = view.state.field(editorInfoField, false);
				const path = info?.file?.path;
				if (path && plugin.index.isCommentFile(path)) return Decoration.none;
				const lp = view.state.field(editorLivePreviewField, false) ?? false;
				const hls = this.highlights(view);
				if (!hls.length) return Decoration.none;

				const sel = view.state.selection.ranges;
				const builder = new RangeSetBuilder<Decoration>();
				const visible = view.visibleRanges;
				const inView = (h: Highlight) => visible.some((r) => h.to >= r.from && h.from <= r.to);
				for (const h of hls) {
					if (!inView(h)) continue;
					const color = colorAttrs(plugin.effectiveColor(h.id ? plugin.index.colorOf(h.id) : null));
					const attrs: Record<string, string> = {};
					if (h.id) attrs["data-mn-id"] = h.id;
					if (color.style) attrs.style = color.style;
					builder.add(h.textFrom, h.textTo, Decoration.mark({ class: `mn-hl ${color.cls}`, attributes: attrs }));
					if (h.id && lp) {
						const anchorFrom = h.textTo + 2;
						// 커서·선택이 하이라이트와 겹치면 원문을 보여 준다
						const touching = sel.some((r) => r.from <= h.to && r.to >= h.from);
						if (!touching && anchorFrom < h.to) {
							builder.add(anchorFrom, h.to, Decoration.replace({ widget: new CommentIconWidget(h.id, plugin) }));
						}
					}
				}
				return builder.finish();
			}
		},
		{ decorations: (v) => v.decorations },
	);
}

/** 열린 편집기 하나를 다시 그리게 한다 */
export function refreshEditorView(cm: EditorView | undefined): void {
	cm?.dispatch({ effects: refreshEffect.of(null) });
}
