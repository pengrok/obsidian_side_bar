import { setIcon, type MarkdownPostProcessorContext } from "obsidian";
import type MarginNotesPlugin from "../main";
import { parseHighlights } from "../parser/highlightParser";
import type { Highlight } from "../types";
import { applyColor } from "../utils/color";

/**
 * 읽기 모드 (5.6절). HTML에는 %% 주석이 빠져 있어 ID를 알 수 없으므로,
 * getSectionInfo로 원문 줄을 얻어 파싱하고 <mark>와 순서대로 짝짓는다.
 */
export function buildReadingProcessor(plugin: MarginNotesPlugin) {
	// 같은 노트의 블록마다 노트 전체를 다시 파싱하지 않도록 마지막 결과를 들고 있는다
	let lastText = "";
	let lastHls: Highlight[] = [];

	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		if (plugin.index.isCommentFile(ctx.sourcePath)) return;
		const info = ctx.getSectionInfo(el);
		if (!info) return;
		const marks = Array.from(el.querySelectorAll("mark")).filter((m) => !m.closest("code, pre"));
		if (!marks.length) return;

		if (info.text !== lastText) {
			lastText = info.text;
			lastHls = parseHighlights(info.text, ctx.sourcePath);
		}
		const hls = lastHls.filter((h) => h.line >= info.lineStart && h.line <= info.lineEnd);
		// 개수가 다르면 잘못 칠하는 것보다 안 칠하는 게 안전하다
		if (hls.length !== marks.length) return;

		marks.forEach((mark, i) => {
			const h = hls[i];
			mark.addClass("mn-hl");
			applyColor(mark, plugin.effectiveColor(h.id ? plugin.index.colorOf(h.id) : null));
			if (!h.id) return;
			mark.setAttr("data-mn-id", h.id);
			const icon = createSpan({ cls: "mn-icon", attr: { "data-mn-id": h.id, "aria-label": "코멘트 보기" } });
			setIcon(icon, "message-square");
			mark.insertAdjacentElement("afterend", icon);
			const open = (e: MouseEvent) => {
				if ((e.target as HTMLElement).closest("a")) return;
				e.preventDefault();
				plugin.revealInSidebar(h.id as string, true);
			};
			mark.addEventListener("click", open);
			icon.addEventListener("click", open);
		});
	};
}
