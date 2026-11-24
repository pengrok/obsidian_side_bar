import { MarkdownView, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { Actions } from "./actions";
import { editorMenu, registerCommands } from "./commands";
import { buildCmExtension, refreshEditorView } from "./editor/cmExtension";
import { NoteWriter } from "./editor/noteWriter";
import { buildReadingProcessor } from "./editor/readingProcessor";
import { MarginNotesSettingTab } from "./settings";
import { mergeData } from "./settingsDefaults";
import { ALL_PATHS, AnnotationIndex } from "./store/annotationIndex";
import { AnnotationStore } from "./store/annotationStore";
import type { MarginNotesSettings, UiState } from "./types";
import { MarginNotesView, VIEW_TYPE_MARGIN_NOTES } from "./ui/sidebarView";
import { debounceFn, throttleFn } from "./utils/debounce";

const HOVER_SOURCE = "margin-notes";

function cmOf(view: MarkdownView): EditorView | undefined {
	return (view.editor as unknown as { cm?: EditorView }).cm;
}

export default class MarginNotesPlugin extends Plugin {
	settings!: MarginNotesSettings;
	uiState!: UiState;
	store!: AnnotationStore;
	index!: AnnotationIndex;
	writer!: NoteWriter;
	actions!: Actions;
	/** 다시 연결 대기 중인 고아 코멘트 id (6.8절) */
	relinkingId: string | null = null;

	private lastMdLeaf: WorkspaceLeaf | null = null;
	private styleEl: HTMLStyleElement | null = null;
	private scrollHooked = new WeakSet<HTMLElement>();
	readonly saveUiSoon = debounceFn(() => void this.saveAll(), 500);

	async onload(): Promise<void> {
		const data = mergeData(await this.loadData());
		this.settings = data.settings;
		this.uiState = data.uiState;

		this.store = new AnnotationStore(this.app, () => this.settings);
		this.index = new AnnotationIndex({
			app: this.app,
			getSettings: () => this.settings,
			store: this.store,
			getLiveText: (p) => this.liveText(p),
		});
		this.writer = new NoteWriter(this.app);
		this.actions = new Actions(this);

		this.registerView(VIEW_TYPE_MARGIN_NOTES, (leaf) => new MarginNotesView(leaf, this));
		this.addRibbonIcon("highlighter", "하이라이트 사이드바 열기", () => void this.activateView(true));
		registerCommands(this);
		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => editorMenu(this, menu, editor, info)));
		this.addSettingTab(new MarginNotesSettingTab(this.app, this));
		this.registerEditorExtension(buildCmExtension(this));
		this.registerMarkdownPostProcessor(buildReadingProcessor(this));
		this.registerHoverLinkSource(HOVER_SOURCE, { display: "Margin Notes", defaultMod: false });
		this.applyColorStyles();

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && leaf.view instanceof MarkdownView) {
					this.lastMdLeaf = leaf;
					this.hookScroll(leaf.view);
				}
			}),
		);
		this.registerDomEvent(document, "mouseover", (e) => this.onHover(e));

		this.app.workspace.onLayoutReady(async () => {
			const active = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (active) {
				this.lastMdLeaf = active.leaf;
				this.hookScroll(active);
			}
			await this.index.build();
			this.registerEvent(this.app.metadataCache.on("changed", (file) => this.index.onMetadataChanged(file)));
			this.registerEvent(this.app.vault.on("delete", (f) => this.index.onDelete(f)));
			this.registerEvent(this.app.vault.on("rename", (f, old) => this.index.onRename(f, old)));
			this.registerEvent(
				this.app.workspace.on("editor-change", (_editor, info) => {
					if (info.file) this.index.onEditorChanged(info.file.path);
				}),
			);
			this.registerEvent(this.index.onChanged((paths) => this.onIndexChanged(paths)));
			this.refreshEditors();
		});
	}

	onunload(): void {
		this.index?.destroy();
		this.saveUiSoon.cancel();
		this.styleEl?.remove();
	}

	async saveAll(): Promise<void> {
		await this.saveData({ settings: this.settings, uiState: this.uiState });
	}

	// ── 색 (7.6절) ──────────────────────────────────────

	/** 지워진 색이면 기본색 */
	effectiveColor(key: string | null): string {
		const colors = this.settings.colors;
		if (key && colors.some((c) => c.key === key)) return key;
		if (colors.some((c) => c.key === this.settings.defaultColor)) return this.settings.defaultColor;
		return colors[0]?.key ?? "yellow";
	}

	applyColorStyles(): void {
		if (!this.styleEl) {
			this.styleEl = document.head.createEl("style", { attr: { id: "mn-colors" } });
		}
		const safeKey = (k: string) => k.replace(/[^a-z0-9_-]/gi, "");
		const safeColor = (c: string) => (/^#[0-9a-f]{3,8}$/i.test(c) ? c : "#ffd54f");
		const vars = this.settings.colors.map((c) => `--mn-color-${safeKey(c.key)}: ${safeColor(c.color)};`).join(" ");
		const rules = this.settings.colors.map((c) => `.mn-color-${safeKey(c.key)} { --mn-hl-color: var(--mn-color-${safeKey(c.key)}); }`).join("\n");
		this.styleEl.textContent = `body { ${vars} }\n${rules}`;
	}

	onColorsChanged(): void {
		this.applyColorStyles();
		this.refreshEditors(true);
		this.refreshView(true);
	}

	// ── 편집기·보기 ──────────────────────────────────────

	private onIndexChanged(paths: Set<string>): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (!(v instanceof MarkdownView) || !v.file) continue;
			const hit = paths.has(v.file.path);
			if (hit || paths.has(ALL_PATHS)) refreshEditorView(cmOf(v));
			if (hit && v.getMode() === "preview") v.previewMode.rerender(true);
		}
	}

	/** 열린 편집기의 장식을 다시 만든다. withPreview면 읽기 모드도 다시 그린다 */
	refreshEditors(withPreview = false): void {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (!(v instanceof MarkdownView)) continue;
			refreshEditorView(cmOf(v));
			if (withPreview && v.getMode() === "preview") v.previewMode.rerender(true);
		}
	}

	/** 편집기에 열린 파일의 최신 텍스트 (저장 전 내용 포함) */
	liveText(path: string): string | null {
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const v = leaf.view;
			if (v instanceof MarkdownView && v.file?.path === path) return v.getViewData();
		}
		return null;
	}

	fileOfLeaf(leaf: WorkspaceLeaf | null): TFile | null {
		return leaf && leaf.view instanceof MarkdownView && leaf.view.file ? leaf.view.file : null;
	}

	/** 사이드바가 포커스를 가져가도 마지막 마크다운 보기를 "현재 노트"로 본다 */
	lastMarkdownView(): MarkdownView | null {
		const l = this.lastMdLeaf;
		if (l && l.view instanceof MarkdownView && l.view.file && this.app.workspace.getLeavesOfType("markdown").includes(l)) return l.view;
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) return active;
		const any = this.app.workspace.getLeavesOfType("markdown")[0]?.view;
		return any instanceof MarkdownView ? any : null;
	}

	lastMarkdownFile(): TFile | null {
		return this.lastMarkdownView()?.file ?? null;
	}

	/** 본문 노트를 열 기본 탭 */
	mainLeaf(): WorkspaceLeaf {
		const v = this.lastMarkdownView();
		return v ? v.leaf : this.app.workspace.getLeaf(false);
	}

	getView(): MarginNotesView | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MARGIN_NOTES)[0];
		return leaf && leaf.view instanceof MarginNotesView ? leaf.view : null;
	}

	async activateView(focus: boolean): Promise<MarginNotesView | null> {
		const ws = this.app.workspace;
		let leaf: WorkspaceLeaf | null = ws.getLeavesOfType(VIEW_TYPE_MARGIN_NOTES)[0] ?? null;
		if (!leaf) {
			leaf = ws.getRightLeaf(false);
			if (!leaf) return null;
			await leaf.setViewState({ type: VIEW_TYPE_MARGIN_NOTES, active: focus });
		}
		await ws.revealLeaf(leaf);
		return leaf.view instanceof MarginNotesView ? leaf.view : null;
	}

	/** 카드로 스크롤 + 강조. open이면 사이드바가 닫혀 있을 때 연다 */
	revealInSidebar(id: string, open: boolean): void {
		const existing = this.getView();
		if (existing) {
			existing.reveal(id, true);
			if (open) void this.app.workspace.revealLeaf(existing.leaf);
			return;
		}
		if (!open) return;
		void this.activateView(false).then((v) => v?.reveal(id, true));
	}

	refreshView(full = false): void {
		const v = this.getView();
		if (!v) return;
		if (full) {
			this.index.highlightsByFile.clear();
			v.invalidateAll();
		} else v.refresh();
	}

	async rebuildIndex(): Promise<void> {
		await this.index.build();
		this.refreshView(true);
		this.refreshEditors(true);
	}

	// ── 3단계: 마우스 올리면 코멘트 미리보기 ──────────────

	private lastHover: HTMLElement | null = null;

	private onHover(e: MouseEvent): void {
		const target = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".mn-hl[data-mn-id], .mn-icon[data-mn-id]") ?? null;
		if (target === this.lastHover) return;
		this.lastHover = target;
		if (!target) return;
		const id = target.getAttribute("data-mn-id");
		const ann = id ? this.index.get(id) : undefined;
		if (!ann) return;
		const leaf = this.app.workspace.getLeavesOfType("markdown").find((l) => l.view.containerEl.contains(target));
		if (!leaf || !(leaf.view instanceof MarkdownView)) return;
		this.app.workspace.trigger("hover-link", {
			event: e,
			source: HOVER_SOURCE,
			hoverParent: leaf.view,
			targetEl: target,
			linktext: ann.file.path,
			sourcePath: ann.file.path,
		});
	}

	// ── 3단계: 따라가기 모드 ─────────────────────────────

	private hookScroll(view: MarkdownView): void {
		const cm = cmOf(view);
		if (!cm || this.scrollHooked.has(cm.scrollDOM)) return;
		this.scrollHooked.add(cm.scrollDOM);
		const onScroll = throttleFn(() => {
			if (!this.settings.followEditorScroll || !view.file) return;
			if (this.lastMarkdownView() !== view) return;
			const rect = cm.scrollDOM.getBoundingClientRect();
			const pos = cm.posAtCoords({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, false);
			this.getView()?.follow(view.file.path, pos);
		}, 200);
		this.registerDomEvent(cm.scrollDOM, "scroll", () => onScroll());
	}
}
