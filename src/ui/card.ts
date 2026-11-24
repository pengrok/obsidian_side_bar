import { MarkdownRenderer, Menu, Platform, setIcon, setTooltip, type Component } from "obsidian";
import type MarginNotesPlugin from "../main";
import type { SidebarItem, TabId } from "../types";
import { isoDatePart } from "../utils/time";
import { basename, colorKeyOf } from "./search";
import { applyColor, isHexColor } from "../utils/color";
import { pickColor } from "./colorPicker";

export interface CardHost {
	plugin: MarginNotesPlugin;
	/** 이번 렌더링의 MarkdownRenderer 수명 */
	component: Component;
	tab: TabId;
	startEdit(item: SidebarItem, cardEl: HTMLElement): void;
	addTagToQuery(tag: string): void;
}

const isEmptyBody = (b: string | null | undefined) => b !== null && b !== undefined && b.trim() === "";

/** 카드 1개 (7.2절) */
export function renderCard(host: CardHost, parent: HTMLElement, item: SidebarItem): HTMLElement {
	const { plugin } = host;
	const settings = plugin.settings;
	const ann = item.annotation;
	const colorKey = colorKeyOf(item, settings.colors, settings.defaultColor);

	const card = parent.createDiv({ cls: "mn-card", attr: { "data-key": item.key } });
	if (ann) card.setAttr("data-mn-id", ann.id);
	applyColor(card, colorKey);
	if (item.status === "orphan") card.addClass("mn-card--orphan");
	if (item.status === "plain") card.addClass("mn-card--plain");
	const relinking = ann && plugin.relinkingId === ann.id;
	if (relinking) card.addClass("mn-card--relinking");

	// 왼쪽 색 띠 → 색 바꾸기
	const bar = card.createDiv({ cls: "mn-card-bar" });
	setTooltip(bar, "색 바꾸기");
	bar.addEventListener("click", (e) => {
		e.stopPropagation();
		showColorMenu(plugin, item, e);
	});

	const main = card.createDiv({ cls: "mn-card-main" });

	// 1행: 위치 + 배지 + 동작 아이콘
	const head = main.createDiv({ cls: "mn-card-head" });
	const heading = item.highlight?.heading ?? null;
	let loc = "";
	if (host.tab === "all") loc = basename(item.notePath) + (heading ? ` › ${heading}` : "");
	else if (heading) loc = heading;
	head.createSpan({ cls: "mn-card-loc", text: loc });

	const badges = head.createSpan({ cls: "mn-badges" });
	const badge = (text: string, warn = false) => badges.createSpan({ cls: "mn-badge" + (warn ? " mn-badge--warn" : ""), text });
	if (item.status === "orphan") badge(item.sourceMissing ? "원본 노트가 삭제됨" : "원문 없음", true);
	else if (item.duplicate) badge("중복 ID", true);
	else if (item.missingFile) badge("코멘트 파일 없음", true);
	else if (!ann || isEmptyBody(ann.body)) badge("코멘트 없음");

	const actions = head.createDiv({ cls: "mn-card-actions" });
	if (Platform.isMobile) actions.addClass("is-visible");
	const action = (icon: string, label: string, fn: (e: MouseEvent) => void) => {
		const b = actions.createEl("button", { cls: "clickable-icon mn-card-action", attr: { "aria-label": label } });
		setIcon(b, icon);
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			fn(e);
		});
		return b;
	};
	if (item.highlight || ann) action("pencil", "코멘트 편집", () => host.startEdit(item, card));
	if (ann) action("file-text", "코멘트 파일 열기", () => void plugin.actions.openCommentFile(item));
	action("more-horizontal", "더 보기", (e) => showMoreMenu(host, item, card, e));

	// 2행: 하이라이트 문구
	const quoteEl = main.createDiv({ cls: "mn-card-quote" });
	const quoteText = item.highlight?.text ?? ann?.quote ?? "";
	void MarkdownRenderer.render(plugin.app, quoteText, quoteEl, item.notePath, host.component).then(() => stripRenderedLinks(quoteEl));
	quoteEl.addEventListener("click", (e) => {
		if ((e.target as HTMLElement).closest("a.tag")) return;
		e.preventDefault();
		void plugin.actions.goToItem(item, e.ctrlKey || e.metaKey);
	});

	// 3행: 코멘트 미리보기
	const commentEl = main.createDiv({ cls: "mn-card-comment" });
	commentEl.style.setProperty("--mn-preview-lines", String(settings.previewLines));
	renderCommentPreview(host, item, commentEl);

	// 4행: 메타
	if (ann) {
		const meta = main.createDiv({ cls: "mn-card-meta" });
		const date = isoDatePart(ann.created);
		if (date) meta.createSpan({ cls: "mn-card-date", text: date });
		for (const t of ann.tags) {
			const chip = meta.createEl("a", { cls: "tag mn-tag", text: "#" + t, href: "#" });
			chip.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				host.addTagToQuery(t);
			});
		}
	}

	// 다시 연결 대기 (6.8절)
	if (relinking) {
		const row = main.createDiv({ cls: "mn-card-relink" });
		row.createSpan({ text: "노트에서 글을 선택한 뒤 누르세요" });
		const ok = row.createEl("button", { text: "여기에 연결", cls: "mod-cta" });
		ok.addEventListener("click", (e) => {
			e.stopPropagation();
			void plugin.actions.relinkHere(item);
		});
		const cancel = row.createEl("button", { text: "취소" });
		cancel.addEventListener("click", (e) => {
			e.stopPropagation();
			plugin.actions.cancelRelink();
		});
	}

	return card;
}

/** 문구 안의 링크는 카드 클릭(본문 이동)과 겹치므로 글자로만 남긴다 */
function stripRenderedLinks(el: HTMLElement): void {
	el.querySelectorAll("a:not(.tag)").forEach((a) => {
		const span = createSpan({ text: a.textContent ?? "" });
		a.replaceWith(span);
	});
	// <p> 하나만 있으면 여백 없이
	const only = el.children.length === 1 ? el.firstElementChild : null;
	if (only && only.tagName === "P") only.addClass("mn-inline-p");
}

function renderCommentPreview(host: CardHost, item: SidebarItem, el: HTMLElement): void {
	const { plugin } = host;
	const ann = item.annotation;
	const placeholder = () => {
		el.empty();
		el.addClass("is-empty");
		el.createSpan({ cls: "mn-card-add", text: "+ 코멘트 추가" });
	};
	el.addEventListener("click", (e) => {
		const target = e.target as HTMLElement;
		if (target.closest("a") || target.closest(".mn-more-toggle")) return;
		host.startEdit(item, el.closest(".mn-card") as HTMLElement);
	});
	if (!ann) {
		if (item.highlight) placeholder();
		return;
	}
	const draw = (body: string) => {
		if (body.trim() === "") {
			placeholder();
			return;
		}
		el.empty();
		const md = el.createDiv({ cls: "mn-card-comment-body is-clamped" });
		void MarkdownRenderer.render(plugin.app, body, md, ann.file.path, host.component).then(() => {
			window.requestAnimationFrame(() => {
				if (md.scrollHeight > md.clientHeight + 2) {
					const toggle = el.createEl("button", { cls: "mn-more-toggle", text: "더 보기" });
					toggle.addEventListener("click", (e) => {
						e.stopPropagation();
						md.toggleClass("is-clamped", !md.hasClass("is-clamped"));
						toggle.setText(md.hasClass("is-clamped") ? "더 보기" : "접기");
					});
				}
			});
		});
	};
	if (ann.body !== null) draw(ann.body);
	else {
		el.createSpan({ cls: "mn-card-loading", text: "…" });
		void plugin.index.ensureBody(ann).then((b) => {
			if (el.isConnected) draw(b);
		});
	}
}

export function showColorMenu(plugin: MarginNotesPlugin, item: SidebarItem, e: MouseEvent): void {
	const menu = new Menu();
	const cur = colorKeyOf(item, plugin.settings.colors, plugin.settings.defaultColor);
	for (const c of plugin.settings.colors) {
		menu.addItem((mi) =>
			mi
				.setTitle(c.name)
				.setChecked(c.key === cur)
				.onClick(() => void plugin.actions.changeColor(item, c.key)),
		);
	}
	menu.addSeparator();
	menu.addItem((mi) =>
		mi
			.setTitle(isHexColor(cur) ? `직접 고른 색 (${cur})…` : "다른 색 고르기…")
			.setIcon("pipette")
			.setChecked(isHexColor(cur))
			.onClick(() =>
				pickColor(activeDocument, isHexColor(cur) ? cur : "#ffd54f", (hex) => void plugin.actions.changeColor(item, hex)),
			),
	);
	menu.showAtMouseEvent(e);
}

function showMoreMenu(host: CardHost, item: SidebarItem, card: HTMLElement, e: MouseEvent): void {
	const { plugin } = host;
	const a = plugin.actions;
	const ann = item.annotation;
	const menu = new Menu();
	const st = item.status;

	if (item.highlight || ann) {
		menu.addItem((mi) =>
			mi
				.setTitle(ann ? "코멘트 편집" : "코멘트 추가")
				.setIcon("pencil")
				.onClick(() => host.startEdit(item, card)),
		);
	}
	if (ann) menu.addItem((mi) => mi.setTitle("코멘트 파일 열기").setIcon("file-text").onClick(() => void a.openCommentFile(item)));
	menu.addItem((mi) =>
		mi
			.setTitle("색 바꾸기")
			.setIcon("palette")
			.onClick(() => window.setTimeout(() => showColorMenu(plugin, item, e), 0)),
	);
	menu.addItem((mi) => mi.setTitle("인용 복사").setIcon("copy").onClick(() => void a.copyQuote(item)));
	if (item.duplicate) {
		menu.addItem((mi) => mi.setTitle("새 ID로 분리").setIcon("split").onClick(() => void a.splitDuplicate(item)));
	}
	if (st === "orphan") {
		menu.addSeparator();
		menu.addItem((mi) => mi.setTitle("다시 연결").setIcon("link").onClick(() => void a.startRelink(item)));
		if (item.strayAnchor) {
			menu.addItem((mi) => mi.setTitle("남은 ID 표시 지우기").setIcon("eraser").onClick(() => void a.removeStrayAnchor(item)));
		}
		menu.addItem((mi) => mi.setTitle("일반 노트로 남기기").setIcon("file").onClick(() => void a.detach(item)));
	}
	menu.addSeparator();
	if (st !== "orphan" && item.highlight) {
		menu.addItem((mi) =>
			mi
				.setTitle("하이라이트 제거")
				.setIcon("highlighter")
				.setSection("danger")
				.onClick(() => void a.removeHighlight(item)),
		);
	}
	if (ann) {
		menu.addItem((mi) =>
			mi
				.setTitle("코멘트 삭제")
				.setIcon("trash-2")
				.setSection("danger")
				.onClick(() => void a.deleteComment(item)),
		);
	}
	menu.showAtMouseEvent(e);
}
