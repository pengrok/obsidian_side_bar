import { MarkdownView, Notice, TFile, type Editor, type WorkspaceLeaf } from "obsidian";
import type MarginNotesPlugin from "./main";
import { plainOrdinal, parseHighlights, findPlainByOrdinal } from "./parser/highlightParser";
import { MSG } from "./editor/noteWriter";
import type { Annotation, Highlight, SidebarItem } from "./types";
import { generateId } from "./utils/id";
import { toLocalIso } from "./utils/time";
import { CommentModal } from "./ui/commentModal";
import { confirmDialog } from "./ui/confirmModal";
import { folderFor } from "./store/fileNaming";
import { basename } from "./ui/search";

async function copyToClipboard(text: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		/* 클립보드를 못 쓰는 환경 */
	}
}

/** 6장 사용자 흐름. 파일은 항상 사용자가 확인한 뒤에만 바꾼다. */
export class Actions {
	constructor(private plugin: MarginNotesPlugin) {}

	private get app() {
		return this.plugin.app;
	}
	private get index() {
		return this.plugin.index;
	}
	private get store() {
		return this.plugin.store;
	}
	private get writer() {
		return this.plugin.writer;
	}
	private get settings() {
		return this.plugin.settings;
	}

	newId(): string {
		return generateId((id) => this.index.hasId(id));
	}

	// ── 6.1 하이라이트 + 코멘트 ───────────────────────────
	async addComment(editor: Editor, file: TFile, colorKey?: string): Promise<void> {
		const check = this.writer.validateSelection(editor, file.path);
		if (check.kind === "error") {
			new Notice(check.reason);
			return;
		}
		if (check.kind === "inside") {
			await this.editCommentFor(file, check.highlight);
			return;
		}
		const range = { from: check.from, to: check.to, quote: check.quote };
		const id = this.newId();
		new CommentModal(this.app, {
			title: "하이라이트 + 코멘트",
			quote: range.quote,
			colors: this.settings.colors,
			color: colorKey ?? this.settings.defaultColor,
			body: "",
			sourcePath: file.path,
			onSubmit: async (body, color) => {
				if (!this.writer.wrapRange(editor, range, id)) {
					await copyToClipboard(body);
					new Notice(MSG.changed + (body ? " (코멘트는 클립보드에 복사했어요)" : ""));
					return;
				}
				await this.createFileOrRollback(file, id, range.quote, color, body, () => this.writer.unwrap(file, id));
			},
		}).open();
	}

	/**
	 * 코멘트 파일을 만든다. 실패하면 노트 변경을 되돌린다(6.1절 9).
	 * 성공하면 인덱스에 바로 넣고 사이드바 카드를 보여 준다(6.1절 10).
	 */
	private async createFileOrRollback(
		source: TFile,
		id: string,
		quote: string,
		color: string,
		body: string,
		rollback: () => Promise<boolean>,
	): Promise<TFile | null> {
		const now = new Date();
		let created: TFile;
		try {
			created = await this.store.create({ id, source, quote, color, body, now });
		} catch (e) {
			await rollback();
			if (body) await copyToClipboard(body);
			new Notice(`코멘트 파일을 만들지 못했어요: ${(e as Error).message}` + (body ? " (코멘트는 클립보드에 복사했어요)" : ""));
			return null;
		}
		this.index.addCreated(created, { id, sourcePath: source.path, quote, color, body, created: toLocalIso(now) });
		this.index.invalidateNote(source.path);
		this.plugin.revealInSidebar(id, false);
		if (this.settings.openFileAfterCreate) await this.app.workspace.getLeaf("tab").openFile(created);
		return created;
	}

	// ── 6.2 하이라이트만 ─────────────────────────────────
	async addHighlight(editor: Editor, file: TFile, colorKey?: string): Promise<void> {
		const color = colorKey ?? this.settings.defaultColor;
		const check = this.writer.validateSelection(editor, file.path);
		if (check.kind === "error") {
			new Notice(check.reason);
			return;
		}
		if (check.kind === "inside") {
			// 이미 하이라이트 → 색만 바꾼다
			if (colorKey) await this.changeColorOfHighlight(file, check.highlight, colorKey);
			else new Notice(MSG.overlap);
			return;
		}
		if (color === this.settings.defaultColor) {
			this.writer.wrapRange(editor, check, null);
			return;
		}
		// 기본색이 아니면 색을 저장할 빈 코멘트 파일이 필요하다
		const id = this.newId();
		if (!this.writer.wrapRange(editor, check, id)) {
			new Notice(MSG.changed);
			return;
		}
		await this.createFileOrRollback(file, id, check.quote, color, "", () => this.writer.unwrap(file, id));
	}

	// ── 6.3 코멘트 추가·편집 ─────────────────────────────

	/** 편집기에서 하이라이트에 대해 모달로 편집 */
	async editCommentFor(file: TFile, hl: Highlight): Promise<void> {
		const ann = hl.id ? this.index.get(hl.id) : undefined;
		const body = ann ? await this.index.ensureBody(ann) : "";
		const startMtime = ann?.file.stat.mtime ?? 0;
		new CommentModal(this.app, {
			title: ann ? "코멘트 편집" : "코멘트 추가",
			quote: hl.text,
			colors: this.settings.colors,
			color: ann?.color ?? this.settings.defaultColor,
			body,
			sourcePath: file.path,
			onSubmit: async (newBody, color) => {
				if (ann) {
					if (!(await this.confirmOverwrite(ann, startMtime))) return;
					await this.store.writeBody(ann.file, newBody);
					ann.body = newBody;
					if (color !== ann.color) await this.store.patchProps(ann.file, { color });
					this.index.emitChanged([ann.sourcePath]);
				} else {
					await this.attachComment(file, hl, newBody, color);
				}
			},
		}).open();
	}

	/** 사이드바 카드 안에서 편집한 본문 저장. 저장하면 true */
	async saveBody(item: SidebarItem, body: string, startMtime: number): Promise<boolean> {
		const ann = item.annotation;
		if (ann) {
			if (!(await this.confirmOverwrite(ann, startMtime))) return false;
			await this.store.writeBody(ann.file, body);
			ann.body = body;
			this.index.emitChanged([ann.sourcePath]);
			return true;
		}
		if (!item.highlight || body.trim() === "") return false;
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (!(f instanceof TFile)) return false;
		return (await this.attachComment(f, item.highlight, body, this.settings.defaultColor)) !== null;
	}

	/** 외부에서 바뀌었으면 덮어쓸지 묻는다 */
	private async confirmOverwrite(ann: Annotation, startMtime: number): Promise<boolean> {
		if (!startMtime || ann.file.stat.mtime === startMtime) return true;
		const r = await confirmDialog(this.app, {
			title: "코멘트가 바뀌었어요",
			message: "다른 곳에서 코멘트가 바뀌었어요. 덮어쓸까요?",
			buttons: [
				{ id: "overwrite", label: "덮어쓰기", cta: true },
				{ id: "cancel", label: "취소" },
			],
		});
		return r?.choice === "overwrite";
	}

	/**
	 * 코멘트 파일이 없는 하이라이트에 코멘트를 단다.
	 * ID 없음 → attachId 후 파일 생성, ID는 있는데 파일 없음(E6) → 같은 ID로 파일 생성
	 */
	async attachComment(file: TFile, hl: Highlight, body: string, color: string): Promise<TFile | null> {
		if (hl.id) {
			return this.createFileOrRollback(file, hl.id, hl.text, color, body, async () => true);
		}
		const id = this.newId();
		const ord = this.ordinalOf(hl);
		if (!(await this.writer.attachId(file, hl, id, ord))) {
			await copyToClipboard(body);
			new Notice(MSG.changed + (body ? " (코멘트는 클립보드에 복사했어요)" : ""));
			return null;
		}
		return this.createFileOrRollback(file, id, hl.text, color, body, () => this.writer.removeAnchor(file, id));
	}

	private ordinalOf(hl: Highlight): number {
		const items = this.index.highlightsByFile.get(hl.filePath)?.items ?? [];
		return plainOrdinal(items, hl);
	}

	// ── 6.4 하이라이트 제거 ──────────────────────────────
	async removeHighlight(item: SidebarItem): Promise<void> {
		const hl = item.highlight;
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (!hl || !(f instanceof TFile)) return;
		const ann = item.annotation;

		if (!ann) {
			// 일반 하이라이트 / 파일 없는 ID / 중복 ID
			const ok = hl.id ? await this.writer.unwrapAt(f, hl) : await this.writer.unwrapPlain(f, hl, this.ordinalOf(hl));
			if (!ok) new Notice("하이라이트 위치를 찾지 못했어요. 노트를 확인해 주세요");
			return;
		}

		let mode = this.settings.onRemoveHighlight;
		if (mode === "ask") {
			const r = await confirmDialog(this.app, {
				title: "하이라이트 제거",
				message: "하이라이트를 없애요. 코멘트 파일은 어떻게 할까요?",
				buttons: [
					{ id: "trash", label: "파일도 휴지통으로", warning: true },
					{ id: "keep", label: "파일은 남기기" },
					{ id: "cancel", label: "취소" },
				],
				checkbox: "다음부터 묻지 않기",
			});
			if (!r || r.choice === "cancel") return;
			mode = r.choice as "trash" | "keep";
			if (r.checked) {
				this.settings.onRemoveHighlight = mode;
				await this.plugin.saveAll();
			}
		}
		if (!(await this.writer.unwrap(f, ann.id))) {
			new Notice("하이라이트 위치를 찾지 못했어요. 노트를 확인해 주세요");
			return;
		}
		if (mode === "trash") await this.store.trash(ann.file);
	}

	// ── 6.5 코멘트만 삭제 ───────────────────────────────
	async deleteComment(item: SidebarItem): Promise<void> {
		const ann = item.annotation;
		if (!ann) return;
		const r = await confirmDialog(this.app, {
			title: "코멘트 삭제",
			message: item.status === "orphan" ? "코멘트 파일을 휴지통으로 보낼까요?" : "코멘트 파일을 휴지통으로 보낼까요? 하이라이트는 남아요.",
			buttons: [
				{ id: "trash", label: "휴지통으로", warning: true },
				{ id: "cancel", label: "취소" },
			],
		});
		if (r?.choice !== "trash") return;
		const f = this.app.vault.getAbstractFileByPath(ann.sourcePath);
		if (f instanceof TFile) await this.writer.removeAnchor(f, ann.id);
		await this.store.trash(ann.file);
	}

	// ── 6.6 색 바꾸기 ───────────────────────────────────
	async changeColor(item: SidebarItem, key: string): Promise<void> {
		if (item.annotation) {
			if (item.annotation.color === key) return;
			item.annotation.color = key;
			await this.store.patchProps(item.annotation.file, { color: key });
			this.index.emitChanged([item.annotation.sourcePath]);
			this.plugin.refreshEditors();
			return;
		}
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (item.highlight && f instanceof TFile) await this.changeColorOfHighlight(f, item.highlight, key);
	}

	async changeColorOfHighlight(file: TFile, hl: Highlight, key: string): Promise<void> {
		const ann = hl.id ? this.index.get(hl.id) : undefined;
		if (ann) {
			await this.changeColor({ key: ann.id, status: "linked", highlight: hl, annotation: ann, notePath: file.path }, key);
			return;
		}
		// 기본색으로 되돌리는 일반 하이라이트는 할 일이 없다
		if (!hl.id && key === this.settings.defaultColor) return;
		await this.attachComment(file, hl, "", key);
		this.plugin.refreshEditors();
	}

	// ── 6.7 카드 → 본문 ─────────────────────────────────
	async goToItem(item: SidebarItem, newTab: boolean): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (!(f instanceof TFile)) {
			if (item.annotation) {
				new Notice("원본 노트가 없어요. 코멘트 파일을 열어요");
				await this.openFile(item.annotation.file, newTab);
			}
			return;
		}
		const leaf = await this.openFile(f, newTab);
		if (item.status === "orphan" || !item.highlight) {
			new Notice("원문을 찾지 못했어요");
			return;
		}
		// 오프셋이 낡았을 수 있으니 다시 찾는다
		const view = leaf.view instanceof MarkdownView ? leaf.view : null;
		const text = view ? view.getViewData() : await this.app.vault.cachedRead(f);
		const hls = parseHighlights(text, f.path);
		const hl = item.highlight;
		const target =
			(hl.id && !item.duplicate ? hls.find((h) => h.id === hl.id) : null) ??
			hls.find((h) => h.from === hl.from && h.text === hl.text) ??
			findPlainByOrdinal(hls, hl.text, this.ordinalOf(hl));
		if (!target) {
			new Notice("원문을 찾지 못했어요");
			return;
		}
		if (!view) return;
		if (view.getMode() === "source") {
			const ed = view.editor;
			const from = ed.offsetToPos(target.textFrom);
			const to = ed.offsetToPos(target.textTo);
			ed.setSelection(from, to);
			ed.scrollIntoView({ from, to }, true);
			ed.focus();
		} else {
			view.setEphemeralState({ line: target.line });
			window.setTimeout(() => this.flashInPreview(view, target), 150);
		}
	}

	private flashInPreview(view: MarkdownView, hl: Highlight): void {
		const root = view.containerEl;
		let el: HTMLElement | null = null;
		if (hl.id) el = root.querySelector<HTMLElement>(`mark[data-mn-id="${hl.id}"]`);
		if (!el) {
			const marks = Array.from(root.querySelectorAll<HTMLElement>(".markdown-preview-view mark"));
			el = marks.find((m) => m.textContent === hl.text) ?? null;
		}
		if (!el) return;
		el.scrollIntoView({ block: "center" });
		el.addClass("mn-hl--flash");
		window.setTimeout(() => el?.removeClass("mn-hl--flash"), 1500);
	}

	/** 열린 탭이 있으면 그 탭, 없으면 현재 탭 (Ctrl/Cmd 클릭 = 새 탭) */
	async openFile(file: TFile, newTab: boolean): Promise<WorkspaceLeaf> {
		if (!newTab) {
			for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
				if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) {
					await this.app.workspace.revealLeaf(leaf);
					this.app.workspace.setActiveLeaf(leaf, { focus: true });
					return leaf;
				}
			}
		}
		const leaf = newTab ? this.app.workspace.getLeaf("tab") : this.plugin.mainLeaf();
		await leaf.openFile(file);
		return leaf;
	}

	async openCommentFile(item: SidebarItem, newTab = true): Promise<void> {
		if (item.annotation) await this.openFile(item.annotation.file, newTab);
	}

	async copyQuote(item: SidebarItem): Promise<void> {
		const quote = item.highlight?.text ?? item.annotation?.quote ?? "";
		const body = item.annotation ? await this.index.ensureBody(item.annotation) : "";
		const quoted = quote
			.split("\n")
			.map((l) => `> ${l}`)
			.join("\n");
		const text = `${quoted}\n>\n> — [[${basename(item.notePath)}]]` + (body.trim() ? `\n\n${body.trim()}` : "");
		await copyToClipboard(text);
		new Notice("인용을 복사했어요");
	}

	// ── 6.8 고아 다시 잇기 ──────────────────────────────
	async startRelink(item: SidebarItem): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (f instanceof TFile) await this.openFile(f, false);
		this.plugin.relinkingId = item.annotation?.id ?? null;
		new Notice("연결할 글을 선택한 뒤 사이드바의 '여기에 연결' 버튼을 누르세요", 6000);
		this.plugin.refreshView();
	}

	async relinkHere(item: SidebarItem): Promise<void> {
		const ann = item.annotation;
		const view = this.plugin.lastMarkdownView();
		if (!ann || !view || !view.file) {
			new Notice("노트를 열고 글을 선택하세요");
			return;
		}
		if (view.getMode() !== "source") {
			new Notice("편집 모드에서 글을 선택하세요");
			return;
		}
		const file = view.file;
		if (this.index.isCommentFile(file.path)) {
			new Notice("코멘트 파일에는 연결할 수 없어요");
			return;
		}
		const check = this.writer.validateSelection(view.editor, file.path);
		if (check.kind !== "ok") {
			new Notice(check.kind === "error" ? check.reason : MSG.overlap);
			return;
		}
		if (!this.writer.wrapRange(view.editor, check, ann.id)) {
			new Notice(MSG.changed);
			return;
		}
		ann.quote = check.quote;
		const patch: { quote: string; sourcePath?: string } = { quote: check.quote };
		if (file.path !== ann.sourcePath) patch.sourcePath = file.path;
		await this.store.patchProps(ann.file, patch);
		if (patch.sourcePath) {
			const old = ann.sourcePath;
			this.index.removeId(ann.id);
			ann.sourcePath = file.path;
			this.index.add(ann);
			this.index.emitChanged([old]);
		}
		this.index.invalidateNote(file.path);
		this.index.emitChanged([file.path]);
		this.plugin.relinkingId = null;
		this.plugin.revealInSidebar(ann.id, false);
	}

	cancelRelink(): void {
		this.plugin.relinkingId = null;
		this.plugin.refreshView();
	}

	async detach(item: SidebarItem): Promise<void> {
		if (!item.annotation) return;
		const r = await confirmDialog(this.app, {
			title: "일반 노트로 남기기",
			message: "이 코멘트 파일을 사이드바에서 빼고 일반 노트로 남겨요. 파일에 mn-detached: true가 들어가요.",
			buttons: [
				{ id: "ok", label: "남기기", cta: true },
				{ id: "cancel", label: "취소" },
			],
		});
		if (r?.choice !== "ok") return;
		await this.store.patchProps(item.annotation.file, { detached: true });
		this.index.removeId(item.annotation.id);
		this.index.emitChanged([item.notePath]);
	}

	/** E2: 노트에 남은 %%mn:id%%만 지운다 */
	async removeStrayAnchor(item: SidebarItem): Promise<void> {
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (!item.annotation || !(f instanceof TFile)) return;
		if (!(await this.writer.removeAnchor(f, item.annotation.id))) new Notice("남은 ID 표시를 찾지 못했어요");
	}

	/** E4: 중복 ID를 새 ID와 코멘트 파일 복사본으로 분리 */
	async splitDuplicate(item: SidebarItem): Promise<void> {
		const hl = item.highlight;
		const f = this.app.vault.getAbstractFileByPath(item.notePath);
		if (!hl || !hl.id || !(f instanceof TFile)) return;
		const src = item.duplicateOf ?? this.index.get(hl.id);
		const newId = this.newId();
		if (!(await this.writer.replaceAnchorAt(f, hl, newId))) {
			new Notice("하이라이트 위치를 찾지 못했어요");
			return;
		}
		try {
			const body = src ? await this.store.readBody(src.file) : "";
			const now = new Date();
			const color = src?.color ?? this.settings.defaultColor;
			const created = await this.store.create({ id: newId, source: f, quote: hl.text, color, body, tags: src?.tags, now });
			this.index.addCreated(created, { id: newId, sourcePath: f.path, quote: hl.text, color, body, created: toLocalIso(now) });
			this.index.invalidateNote(f.path);
		} catch (e) {
			await this.writer.replaceAnchorAt(f, { ...hl, id: newId }, hl.id);
			new Notice(`코멘트 파일을 만들지 못했어요: ${(e as Error).message}`);
		}
	}

	// ── 3단계: 내보내기·정리 ─────────────────────────────

	/** 현재 노트의 코멘트를 본문 순서대로 모은 새 노트 */
	async exportNote(file: TFile): Promise<void> {
		const items = (await this.index.getItemsForFile(file.path)).filter((i) => i.annotation);
		if (!items.length) {
			new Notice("이 노트에는 코멘트가 없어요");
			return;
		}
		const parts: string[] = [`# ${file.basename} 코멘트 모음`, "", `원본: ${this.app.fileManager.generateMarkdownLink(file, file.parent?.path ?? "")}`, ""];
		for (const it of items) {
			const ann = it.annotation as Annotation;
			const quote = it.highlight?.text ?? ann.quote;
			const body = (await this.index.ensureBody(ann)).trim();
			parts.push(quote.split("\n").map((l) => `> ${l}`).join("\n"));
			if (it.status === "orphan") parts.push(">", "> *(원문 없음)*");
			parts.push("");
			if (body) parts.push(body, "");
			parts.push("---", "");
		}
		const dir = file.parent && file.parent.path !== "/" ? file.parent.path + "/" : "";
		let path = `${dir}${file.basename} 코멘트 모음.md`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = `${dir}${file.basename} 코멘트 모음 (${n}).md`;
		const created = await this.app.vault.create(path, parts.join("\n"));
		await this.app.workspace.getLeaf("tab").openFile(created);
	}

	/** 하위 폴더 옵션에 맞게 코멘트 파일을 다시 놓는다 */
	async organizeFolder(): Promise<void> {
		const moves: { ann: Annotation; folder: string }[] = [];
		for (const ann of this.index.all()) {
			const folder = folderFor(this.settings, basename(ann.sourcePath));
			if (ann.file.parent?.path !== folder) moves.push({ ann, folder });
		}
		if (!moves.length) {
			new Notice("옮길 코멘트 파일이 없어요");
			return;
		}
		const r = await confirmDialog(this.app, {
			title: "코멘트 폴더 정리",
			message: `코멘트 파일 ${moves.length}개를 설정에 맞는 폴더로 옮길까요?`,
			buttons: [
				{ id: "ok", label: "옮기기", cta: true },
				{ id: "cancel", label: "취소" },
			],
		});
		if (r?.choice !== "ok") return;
		let n = 0;
		for (const m of moves) {
			try {
				await this.store.moveTo(m.ann.file, m.folder);
				n++;
			} catch (e) {
				console.error("[Margin Notes] 파일을 옮기지 못함", m.ann.file.path, e);
			}
		}
		new Notice(`코멘트 파일 ${n}개를 옮겼어요`);
	}
}
