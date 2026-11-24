import { Component, ItemView, Menu, setIcon, setTooltip, TFile, type WorkspaceLeaf } from "obsidian";
import type MarginNotesPlugin from "../main";
import { ALL_PATHS } from "../store/annotationIndex";
import type { FilterStatus, GroupBy, SidebarItem, SortBy, TabId, TabState } from "../types";
import { debounceFn } from "../utils/debounce";
import { renderCard, type CardHost } from "./card";
import { applyFilters, filterStatusOf, groupItems, isEmptyQuery, parseQuery, queryNeedsBody, sortItems } from "./search";

export const VIEW_TYPE_MARGIN_NOTES = "margin-notes-sidebar";
const PAGE = 200;

const STATUS_LABEL: Record<FilterStatus, string> = {
	commented: "코멘트 있음",
	plain: "코멘트 없음",
	orphan: "원문 없음",
};
const GROUP_LABEL: Record<GroupBy, string> = {
	none: "없음",
	color: "색",
	heading: "제목",
	note: "노트",
	folder: "폴더",
	date: "작성일",
};
const SORT_LABEL: Record<SortBy, string> = {
	position: "본문 순서",
	created: "만든 날짜",
	updated: "고친 날짜",
	alpha: "가나다",
};

interface EditingState {
	key: string;
	item: SidebarItem;
	card: HTMLElement;
	textarea: HTMLTextAreaElement;
	startMtime: number;
	saving: boolean;
	dirty: boolean;
}

/** 오른쪽 사이드바 (5.9절, 7장) */
export class MarginNotesView extends ItemView {
	private currentFile: TFile | null = null;
	private renderComp: Component | null = null;
	private editing: EditingState | null = null;
	private pendingReveal: { id: string; flash: boolean } | null = null;
	private renderToken = 0;
	private allCache: { items: SidebarItem[]; skippedBig: number } | null = null;
	private allDirty = true;
	private shown = PAGE;
	private lastItems: SidebarItem[] = [];

	private tabsEl!: HTMLElement;
	private toolbarEl!: HTMLElement;
	private searchWrap!: HTMLElement;
	private searchInput!: HTMLInputElement;
	private chipsEl!: HTMLElement;
	private statusEl!: HTMLElement;
	private listEl!: HTMLElement;
	private footerEl!: HTMLElement;

	readonly refresh = debounceFn(() => void this.render(), 100);
	private readonly autosave = debounceFn(() => void this.saveEditing(false), 1000);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MarginNotesPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_MARGIN_NOTES;
	}
	getDisplayText(): string {
		return "하이라이트";
	}
	getIcon(): string {
		return "highlighter";
	}

	private get ui() {
		return this.plugin.uiState;
	}
	private get tab(): TabId {
		return this.ui.activeTab;
	}
	private get ts(): TabState {
		return this.ui.tabs[this.tab];
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("mn-view");

		this.tabsEl = root.createDiv({ cls: "mn-tabs" });
		this.toolbarEl = root.createDiv({ cls: "mn-toolbar" });
		this.searchWrap = root.createDiv({ cls: "mn-search search-input-container" });
		this.searchInput = this.searchWrap.createEl("input", {
			attr: { type: "search", placeholder: "검색 (단어, \"구절\", -제외, #태그, color:, note:, is:)", spellcheck: "false" },
		});
		const clear = this.searchWrap.createDiv({ cls: "search-input-clear-button", attr: { "aria-label": "지우기" } });
		clear.addEventListener("click", () => {
			this.searchInput.value = "";
			this.setQuery("");
		});
		const onSearch = debounceFn(() => this.setQuery(this.searchInput.value), 200);
		this.searchInput.addEventListener("input", () => onSearch());
		this.chipsEl = root.createDiv({ cls: "mn-chips" });
		this.statusEl = root.createDiv({ cls: "mn-progress" });
		this.listEl = root.createDiv({ cls: "mn-list" });
		this.footerEl = root.createDiv({ cls: "mn-footer" });

		this.buildTabs();
		this.buildToolbar();

		this.currentFile = this.plugin.lastMarkdownFile();
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				const f = this.plugin.fileOfLeaf(leaf);
				if (f && f !== this.currentFile) {
					this.currentFile = f;
					if (this.tab === "current") this.refresh();
				}
			}),
		);
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (file && file.extension === "md" && file !== this.currentFile) {
					this.currentFile = file;
					if (this.tab === "current") this.refresh();
				}
			}),
		);
		this.registerEvent(
			this.plugin.index.onChanged((paths) => {
				this.allDirty = true;
				if (this.tab === "all") this.refresh();
				else if (paths.has(ALL_PATHS) || (this.currentFile && paths.has(this.currentFile.path))) this.refresh();
			}),
		);
		await this.render();
	}

	async onClose(): Promise<void> {
		this.refresh.cancel();
		if (this.editing?.dirty) await this.saveEditing(true);
		this.autosave.cancel();
		this.renderComp?.unload();
	}

	// ── 구성 ────────────────────────────────────────────

	private buildTabs(): void {
		this.tabsEl.empty();
		const mk = (id: TabId, label: string) => {
			const t = this.tabsEl.createDiv({ cls: "mn-tab", text: label });
			t.toggleClass("is-active", this.tab === id);
			t.addEventListener("click", () => {
				if (this.tab === id) return;
				this.ui.activeTab = id;
				this.shown = PAGE;
				this.plugin.saveUiSoon();
				this.buildTabs();
				void this.render();
			});
		};
		mk("current", "현재 노트");
		mk("all", "전체");
	}

	private buildToolbar(): void {
		const tb = this.toolbarEl;
		tb.empty();
		const btn = (icon: string, label: string, fn: (e: MouseEvent) => void) => {
			const b = tb.createDiv({ cls: "clickable-icon mn-toolbar-btn", attr: { "aria-label": label, "data-act": icon } });
			setIcon(b, icon);
			setTooltip(b, label);
			b.addEventListener("click", fn);
			return b;
		};
		btn("search", "검색", () => {
			this.ts.searchVisible = !this.ts.searchVisible;
			this.plugin.saveUiSoon();
			this.syncControls();
			if (this.ts.searchVisible) this.searchInput.focus();
		});
		btn("filter", "필터", (e) => this.filterMenu(e));
		btn("layers", "묶기", (e) => this.groupMenu(e));
		btn("arrow-up-down", "정렬", (e) => this.sortMenu(e));
		btn("chevrons-down-up", "모두 접기/펼치기", () => this.toggleCollapseAll());
		btn("refresh-cw", "새로고침", () => void this.plugin.rebuildIndex());
	}

	private filterMenu(e: MouseEvent): void {
		const ts = this.ts;
		const menu = new Menu();
		for (const c of this.plugin.settings.colors) {
			menu.addItem((mi) =>
				mi
					.setTitle(c.name)
					.setChecked(ts.colorFilter.includes(c.key))
					.onClick(() => {
						ts.colorFilter = toggle(ts.colorFilter, c.key);
						this.changed();
					}),
			);
		}
		menu.addSeparator();
		for (const s of ["commented", "plain", "orphan"] as FilterStatus[]) {
			menu.addItem((mi) =>
				mi
					.setTitle(STATUS_LABEL[s])
					.setChecked(ts.statusFilter.includes(s))
					.onClick(() => {
						ts.statusFilter = toggle(ts.statusFilter, s);
						this.changed();
					}),
			);
		}
		menu.addSeparator();
		menu.addItem((mi) =>
			mi.setTitle("모두 해제").onClick(() => {
				ts.colorFilter = [];
				ts.statusFilter = [];
				this.changed();
			}),
		);
		menu.showAtMouseEvent(e);
	}

	private groupMenu(e: MouseEvent): void {
		const menu = new Menu();
		for (const g of Object.keys(GROUP_LABEL) as GroupBy[]) {
			menu.addItem((mi) =>
				mi
					.setTitle(GROUP_LABEL[g])
					.setChecked(this.ts.groupBy === g)
					.onClick(() => {
						this.ts.groupBy = g;
						this.changed();
					}),
			);
		}
		menu.showAtMouseEvent(e);
	}

	private sortMenu(e: MouseEvent): void {
		const menu = new Menu();
		for (const s of Object.keys(SORT_LABEL) as SortBy[]) {
			menu.addItem((mi) =>
				mi
					.setTitle(SORT_LABEL[s])
					.setChecked(this.ts.sortBy === s)
					.onClick(() => {
						this.ts.sortBy = s;
						this.changed();
					}),
			);
		}
		menu.showAtMouseEvent(e);
	}

	private toggleCollapseAll(): void {
		const groups = Array.from(this.listEl.querySelectorAll<HTMLElement>(".mn-group[data-group]"))
			.map((g) => g.dataset.group ?? "")
			.filter(Boolean);
		if (!groups.length) return;
		const allCollapsed = groups.every((g) => this.ts.collapsedGroups.includes(g));
		this.ts.collapsedGroups = allCollapsed ? this.ts.collapsedGroups.filter((g) => !groups.includes(g)) : [...new Set([...this.ts.collapsedGroups, ...groups])];
		this.changed();
	}

	private changed(): void {
		this.shown = PAGE;
		this.plugin.saveUiSoon();
		void this.render();
	}

	setQuery(q: string): void {
		this.ts.query = q;
		if (this.searchInput.value !== q) this.searchInput.value = q;
		this.changed();
	}

	private syncControls(): void {
		const ts = this.ts;
		this.searchWrap.toggleClass("is-hidden", !ts.searchVisible);
		if (document.activeElement !== this.searchInput) this.searchInput.value = ts.query;
		const active = (act: string, on: boolean) => this.toolbarEl.querySelector(`[data-act="${act}"]`)?.toggleClass("is-active", on);
		active("filter", ts.colorFilter.length > 0 || ts.statusFilter.length > 0);
		active("layers", ts.groupBy !== (this.tab === "all" ? "note" : "none"));
		active("arrow-up-down", ts.sortBy !== "position");
		active("search", ts.searchVisible);

		this.chipsEl.empty();
		const chip = (label: string, remove: () => void) => {
			const c = this.chipsEl.createDiv({ cls: "mn-chip" });
			c.createSpan({ text: label });
			const x = c.createSpan({ cls: "mn-chip-x", text: "×", attr: { "aria-label": "해제" } });
			x.addEventListener("click", () => {
				remove();
				this.changed();
			});
		};
		for (const k of ts.colorFilter) {
			const c = this.plugin.settings.colors.find((x) => x.key === k);
			chip(c ? c.name : k, () => (ts.colorFilter = ts.colorFilter.filter((x) => x !== k)));
		}
		for (const s of ts.statusFilter) chip(STATUS_LABEL[s], () => (ts.statusFilter = ts.statusFilter.filter((x) => x !== s)));
		this.chipsEl.toggleClass("is-hidden", this.chipsEl.childElementCount === 0);
	}

	// ── 렌더링 ──────────────────────────────────────────

	async render(): Promise<void> {
		const token = ++this.renderToken;
		this.syncControls();
		const settings = this.plugin.settings;

		let items: SidebarItem[] = [];
		let skippedBig = 0;
		this.statusEl.empty();

		if (this.tab === "current") {
			const file = this.currentFile;
			if (!file || !(this.app.vault.getAbstractFileByPath(file.path) instanceof TFile)) {
				this.showEmpty("노트를 열면 하이라이트가 여기 보여요.");
				return;
			}
			if (this.plugin.index.isCommentFile(file.path)) {
				this.showCommentFileState(file);
				return;
			}
			items = await this.plugin.index.getItemsForFile(file.path);
		} else {
			if (this.allDirty || !this.allCache) {
				const first = !this.allCache;
				const bar = first ? this.statusEl.createDiv({ cls: "mn-progress-bar" }) : null;
				const label = first ? this.statusEl.createDiv({ cls: "mn-progress-label", text: "노트를 살펴보는 중…" }) : null;
				if (first) this.listEl.empty();
				this.allDirty = false;
				const res = await this.plugin.index.getAllItems((done, total) => {
					if (!bar || !label) return;
					bar.style.setProperty("--mn-progress", total ? `${Math.round((done / total) * 100)}%` : "100%");
					label.setText(`노트를 살펴보는 중… (${done} / ${total})`);
				});
				if (token !== this.renderToken) return;
				this.allCache = res;
				this.statusEl.empty();
			}
			items = this.allCache.items;
			skippedBig = this.allCache.skippedBig;
		}
		if (token !== this.renderToken) return;

		const ts = this.ts;
		const query = parseQuery(ts.query);
		const needBody = queryNeedsBody(query) || ts.statusFilter.some((s) => s !== "orphan");
		if (needBody) {
			const unread = items.filter((i) => i.annotation && i.annotation.body === null);
			if (unread.length) {
				this.statusEl.setText("검색 중…");
				for (let i = 0; i < unread.length; i += 20) {
					await Promise.all(unread.slice(i, i + 20).map((it) => this.plugin.index.ensureBody(it.annotation!)));
				}
				if (token !== this.renderToken) return;
				this.statusEl.empty();
			}
		}

		const filtered = applyFilters(items, {
			query,
			colorFilter: ts.colorFilter,
			statusFilter: ts.statusFilter,
			colors: settings.colors,
			defaultColor: settings.defaultColor,
		});
		const sorted = sortItems(filtered, ts.sortBy, this.tab);
		this.lastItems = sorted;

		if (items.length === 0) {
			this.showEmpty(
				this.tab === "current"
					? "아직 하이라이트가 없어요. 글을 선택하고 우클릭 → '하이라이트 + 코멘트'를 눌러 보세요."
					: "보관함에 하이라이트가 없어요.",
			);
			this.renderFooter([], skippedBig);
			return;
		}
		if (sorted.length === 0) {
			this.showEmpty("조건에 맞는 하이라이트가 없어요.", "필터 초기화", () => {
				ts.query = "";
				ts.colorFilter = [];
				ts.statusFilter = [];
				this.searchInput.value = "";
				this.changed();
			});
			this.renderFooter([], skippedBig);
			return;
		}

		this.drawList(sorted);
		this.renderFooter(sorted, skippedBig);
		this.applyPendingReveal();
	}

	private drawList(sorted: SidebarItem[]): void {
		const settings = this.plugin.settings;
		const ts = this.ts;
		// 편집 중인 카드는 새로 만들지 않고 그대로 옮겨 붙인다 (5.9절)
		const keep = this.editing;
		if (keep) keep.card.detach();

		const comp = new Component();
		comp.load();
		this.listEl.empty();
		this.listEl.removeClass("is-empty");
		const host: CardHost = {
			plugin: this.plugin,
			component: comp,
			tab: this.tab,
			startEdit: (item, card) => this.startEdit(item, card),
			addTagToQuery: (tag) => {
				const q = ts.query.trim();
				const token = "#" + tag;
				if (!q.split(/\s+/).includes(token)) this.setQuery((q ? q + " " : "") + token);
				ts.searchVisible = true;
				this.syncControls();
			},
		};

		const limit = this.tab === "all" ? this.shown : Infinity;
		const visible = sorted.slice(0, limit);
		const groups = groupItems(visible, ts.groupBy, settings.colors, settings.defaultColor);
		let keptPlaced = false;
		for (const g of groups) {
			let container = this.listEl;
			if (ts.groupBy !== "none") {
				const collapsed = ts.collapsedGroups.includes(g.key);
				const gEl = this.listEl.createDiv({ cls: "mn-group", attr: { "data-group": g.key } });
				gEl.toggleClass("is-collapsed", collapsed);
				const header = gEl.createDiv({ cls: "mn-group-header" });
				const arrow = header.createSpan({ cls: "mn-group-arrow" });
				setIcon(arrow, "chevron-down");
				header.createSpan({ cls: "mn-group-name", text: g.label });
				header.createSpan({ cls: "mn-group-count", text: String(g.items.length) });
				header.addEventListener("click", () => {
					ts.collapsedGroups = toggle(ts.collapsedGroups, g.key);
					gEl.toggleClass("is-collapsed", ts.collapsedGroups.includes(g.key));
					this.plugin.saveUiSoon();
				});
				container = gEl.createDiv({ cls: "mn-group-items" });
			}
			for (const item of g.items) {
				if (keep && item.key === keep.key) {
					container.appendChild(keep.card);
					keep.item = item;
					keptPlaced = true;
					continue;
				}
				renderCard(host, container, item);
			}
		}
		if (keep && !keptPlaced) {
			// 편집 중이던 항목이 목록에서 빠졌다(필터·삭제) — 저장하고 편집을 끝낸다
			if (keep.dirty) void this.saveEditing(true);
			this.editing = null;
		}
		if (sorted.length > visible.length) {
			const more = this.listEl.createEl("button", { cls: "mn-more", text: `더 보기 (${sorted.length - visible.length}개 남음)` });
			more.addEventListener("click", () => {
				this.shown += PAGE;
				void this.render();
			});
		}
		this.renderComp?.unload();
		this.renderComp = comp;
	}

	private renderFooter(items: SidebarItem[], skippedBig: number): void {
		const hl = items.filter((i) => i.highlight).length;
		const comments = items.filter((i) => i.status !== "orphan" && filterStatusOf(i) === "commented").length;
		const orphans = items.filter((i) => i.status === "orphan").length;
		let text = `하이라이트 ${hl} · 코멘트 ${comments}`;
		if (orphans) text += ` · 원문 없음 ${orphans}`;
		if (skippedBig) text += ` · 큰 파일 ${skippedBig}개 건너뜀`;
		this.footerEl.setText(text);
	}

	private showEmpty(message: string, button?: string, onClick?: () => void): void {
		if (this.editing) {
			if (this.editing.dirty) void this.saveEditing(true);
			this.editing = null;
		}
		this.listEl.empty();
		this.listEl.addClass("is-empty");
		const box = this.listEl.createDiv({ cls: "mn-empty" });
		box.createDiv({ text: message });
		if (button && onClick) box.createEl("button", { text: button }).addEventListener("click", onClick);
		this.footerEl.setText("");
	}

	private showCommentFileState(file: TFile): void {
		const ann = this.plugin.index.all().find((a) => a.file === file);
		const src = ann ? this.app.vault.getAbstractFileByPath(ann.sourcePath) : null;
		this.showEmpty(
			"코멘트 파일이에요.",
			src instanceof TFile ? "원본 노트 열기" : undefined,
			src instanceof TFile && ann
				? () => {
						void this.plugin.actions.openFile(src, false).then(() => this.plugin.revealInSidebar(ann.id, true));
					}
				: undefined,
		);
	}

	// ── 카드 안 편집 (6.3절) ────────────────────────────

	private startEdit(item: SidebarItem, card: HTMLElement): void {
		if (this.editing && this.editing.key === item.key) {
			this.editing.textarea.focus();
			return;
		}
		if (this.editing) void this.finishEditing(true);
		if (!item.highlight && !item.annotation) return;
		const commentEl = card.querySelector<HTMLElement>(".mn-card-comment");
		if (!commentEl) return;
		const ann = item.annotation;
		const begin = (body: string) => {
			card.addClass("mn-card--editing");
			commentEl.empty();
			commentEl.removeClass("is-empty");
			const ta = commentEl.createEl("textarea", { cls: "mn-card-input", attr: { rows: "4", placeholder: "코멘트 (마크다운)" } });
			ta.value = body;
			commentEl.createDiv({ cls: "mn-card-edit-hint", text: "Ctrl/Cmd+Enter 저장 · Esc 취소 · 1초 뒤 자동 저장" });
			this.editing = { key: item.key, item, card, textarea: ta, startMtime: ann?.file.stat.mtime ?? 0, saving: false, dirty: false };
			ta.addEventListener("input", () => {
				if (this.editing) this.editing.dirty = true;
				// 파일이 없는 하이라이트는 자동 저장하지 않는다(빈 파일을 만들지 않게)
				if (ann) this.autosave();
			});
			ta.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
					e.preventDefault();
					void this.finishEditing(true);
				} else if (e.key === "Escape") {
					e.preventDefault();
					e.stopPropagation();
					void this.finishEditing(false);
				}
			});
			ta.addEventListener("blur", () => {
				window.setTimeout(() => {
					if (this.editing?.textarea === ta && document.activeElement !== ta) void this.finishEditing(true);
				}, 150);
			});
			ta.focus();
			ta.setSelectionRange(ta.value.length, ta.value.length);
		};
		if (ann) void this.plugin.index.ensureBody(ann).then(begin);
		else begin("");
	}

	/** 지금까지 입력을 저장한다. final이면 편집을 끝낸다 */
	private async saveEditing(final: boolean): Promise<void> {
		const ed = this.editing;
		if (!ed || ed.saving) return;
		if (!ed.dirty) {
			if (final) this.endEditing();
			return;
		}
		ed.saving = true;
		this.autosave.cancel();
		const body = ed.textarea.value;
		try {
			const ok = await this.plugin.actions.saveBody(ed.item, body, ed.startMtime);
			if (ok) {
				ed.dirty = ed.textarea.value !== body;
				const ann = ed.item.annotation;
				// 내 저장으로 바뀐 mtime은 충돌로 보지 않는다
				if (ann) window.setTimeout(() => (ed.startMtime = ann.file.stat.mtime), 50);
			} else if (!ed.item.annotation) {
				ed.dirty = false;
			}
		} finally {
			ed.saving = false;
		}
		if (final) this.endEditing();
	}

	private async finishEditing(save: boolean): Promise<void> {
		if (!this.editing) return;
		if (save) await this.saveEditing(true);
		else this.endEditing();
	}

	private endEditing(): void {
		this.autosave.cancel();
		this.editing = null;
		void this.render();
	}

	// ── 찾아가기 ────────────────────────────────────────

	/** 카드로 스크롤 + 1.5초 강조 */
	reveal(id: string, flash = true): void {
		this.pendingReveal = { id, flash };
		if (this.tab !== "current") {
			const inList = this.lastItems.some((i) => i.key === id || i.annotation?.id === id);
			if (!inList) {
				this.ui.activeTab = "current";
				this.buildTabs();
			}
		}
		this.currentFile = this.plugin.lastMarkdownFile() ?? this.currentFile;
		if (!this.applyPendingReveal()) void this.render();
	}

	private applyPendingReveal(): boolean {
		const p = this.pendingReveal;
		if (!p) return false;
		const card =
			this.listEl.querySelector<HTMLElement>(`.mn-card[data-key="${CSS.escape(p.id)}"]`) ??
			this.listEl.querySelector<HTMLElement>(`.mn-card[data-mn-id="${CSS.escape(p.id)}"]`);
		if (!card) return false;
		this.pendingReveal = null;
		const group = card.closest<HTMLElement>(".mn-group.is-collapsed");
		if (group) {
			group.removeClass("is-collapsed");
			this.ts.collapsedGroups = this.ts.collapsedGroups.filter((g) => g !== group.dataset.group);
		}
		card.scrollIntoView({ block: "center", behavior: "smooth" });
		if (p.flash) {
			card.removeClass("mn-card--flash");
			void card.offsetWidth;
			card.addClass("mn-card--flash");
			window.setTimeout(() => card.removeClass("mn-card--flash"), 1500);
		}
		return true;
	}

	/** 3단계 따라가기 모드: 편집기 위치에서 가장 가까운 카드를 가운데로 */
	follow(path: string, offset: number): void {
		if (this.tab !== "current" || this.currentFile?.path !== path || this.editing) return;
		let best: SidebarItem | null = null;
		for (const it of this.lastItems) {
			if (!it.highlight) continue;
			if (!best || Math.abs(it.highlight.from - offset) < Math.abs((best.highlight?.from ?? 0) - offset)) best = it;
		}
		if (!best) return;
		const card = this.listEl.querySelector<HTMLElement>(`.mn-card[data-key="${CSS.escape(best.key)}"]`);
		if (!card) return;
		this.listEl.querySelectorAll(".mn-card.is-near").forEach((el) => el.removeClass("is-near"));
		card.addClass("is-near");
		card.scrollIntoView({ block: "center", behavior: "smooth" });
	}

	/** 설정 변경 등으로 전부 다시 */
	invalidateAll(): void {
		this.allCache = null;
		this.allDirty = true;
		this.refresh();
	}
}

function toggle<T>(arr: T[], v: T): T[] {
	return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function isQueryActive(ts: TabState): boolean {
	return !isEmptyQuery(parseQuery(ts.query)) || ts.colorFilter.length > 0 || ts.statusFilter.length > 0;
}
