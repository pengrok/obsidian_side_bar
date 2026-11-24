import { Events, Notice, TFile, TFolder, type App, type EventRef, type TAbstractFile } from "obsidian";
import { parseHighlights } from "../parser/highlightParser";
import type { Annotation, Highlight, MarginNotesSettings, SidebarItem } from "../types";
import { KeyedDebouncer } from "../utils/debounce";
import { idFromProp } from "../utils/id";
import type { AnnotationStore } from "./annotationStore";
import { normalizeFolder } from "./fileNaming";
import { normalizeTags, PROP, propString } from "./frontmatter";

/** 'changed' 이벤트에서 "모든 노트"를 뜻하는 경로 */
export const ALL_PATHS = "*";
/** 전체 탭 스캔에서 건너뛰는 파일 크기 (E15) */
export const BIG_FILE_BYTES = 1024 * 1024;
const BATCH = 50;

export interface IndexDeps {
	app: App;
	getSettings: () => MarginNotesSettings;
	store: AnnotationStore;
	/** 파일이 편집기에 열려 있으면 그 최신 텍스트, 아니면 null */
	getLiveText: (path: string) => string | null;
}

interface HlCache {
	mtime: number; // 편집기 텍스트에서 읽었으면 -1
	text: string;
	items: Highlight[];
}

const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * 메모리 인덱스 (5.5절). "앵커 ID → 코멘트 파일"과 노트별 하이라이트 캐시를 들고 있다.
 * 이벤트: 'changed' (paths: Set<string>) — 영향받은 원본 노트 경로들. ALL_PATHS가 들어 있으면 전부.
 */
export class AnnotationIndex extends Events {
	byId = new Map<string, Annotation>();
	bySource = new Map<string, Set<string>>();
	highlightsByFile = new Map<string, HlCache>();
	/** 코멘트 파일 경로 → id */
	private byFilePath = new Map<string, string>();
	private warned = new Set<string>();
	private fileDebounce = new KeyedDebouncer(300);
	private quoteDebounce = new KeyedDebouncer(1500);
	private pending = new Set<string>();
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	ready = false;

	constructor(private deps: IndexDeps) {
		super();
	}

	private get app() {
		return this.deps.app;
	}
	private get settings() {
		return this.deps.getSettings();
	}

	// ── 조회 ────────────────────────────────────────────

	get commentRoot(): string {
		return normalizeFolder(this.settings.commentFolder);
	}

	isCommentFile(path: string): boolean {
		const root = this.commentRoot;
		return !!root && path.startsWith(root + "/") && path.toLowerCase().endsWith(".md");
	}

	/** 하이라이트 스캔에서 빼는 노트 (코멘트 폴더 + 제외 폴더) */
	isExcludedNote(path: string): boolean {
		if (this.isCommentFile(path)) return true;
		return this.settings.excludeFolders.some((f) => {
			const n = normalizeFolder(f);
			return !!n && (path === n || path.startsWith(n + "/"));
		});
	}

	colorOf(id: string): string | null {
		return this.byId.get(id)?.color ?? null;
	}

	get(id: string): Annotation | undefined {
		return this.byId.get(id);
	}

	all(): Annotation[] {
		return [...this.byId.values()];
	}

	hasId(id: string): boolean {
		if (this.byId.has(id)) return true;
		for (const c of this.highlightsByFile.values()) if (c.items.some((h) => h.id === id)) return true;
		return false;
	}

	// ── 빌드·갱신 ────────────────────────────────────────

	async build(): Promise<void> {
		this.byId.clear();
		this.bySource.clear();
		this.byFilePath.clear();
		this.highlightsByFile.clear();
		for (const f of this.app.vault.getMarkdownFiles()) {
			if (!this.isCommentFile(f.path)) continue;
			const ann = this.readAnnotation(f);
			if (ann) this.add(ann);
		}
		this.ready = true;
		this.emitChanged([ALL_PATHS]);
	}

	/** 코멘트 파일 frontmatter → Annotation. 형식이 틀리면 null (E7) */
	readAnnotation(file: TFile): Annotation | null {
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, unknown> | undefined;
		const id = idFromProp(fm?.[PROP.id]);
		if (!fm || !id) {
			if (fm && !this.warned.has(file.path)) {
				this.warned.add(file.path);
				console.warn(`[Margin Notes] 코멘트 파일 형식이 맞지 않아 건너뜀: ${file.path}`);
			}
			return null;
		}
		if (fm[PROP.detached] === true || fm[PROP.detached] === "true") return null;
		const old = this.byId.get(id);
		return {
			id,
			file,
			sourcePath: propString(fm[PROP.sourcePath]),
			quote: propString(fm[PROP.quote]),
			color: propString(fm[PROP.color]) || this.settings.defaultColor,
			created: propString(fm[PROP.created]),
			updated: propString(fm[PROP.updated]),
			tags: normalizeTags(fm[PROP.tags]),
			// 같은 파일이고 내용이 바뀌지 않았으면 본문 캐시를 이어 쓴다
			body: old && old.file === file && old.updated === propString(fm[PROP.updated]) ? old.body : null,
		};
	}

	/** 인덱스에 넣는다. 같은 id가 다른 파일이면(복사된 코멘트 파일) 먼저 들어온 쪽을 둔다 */
	add(ann: Annotation): void {
		const existing = this.byId.get(ann.id);
		if (existing && existing.file !== ann.file && this.app.vault.getAbstractFileByPath(existing.file.path)) {
			if (!this.warned.has(ann.file.path)) {
				this.warned.add(ann.file.path);
				console.warn(`[Margin Notes] 같은 mn-id(${ann.id})를 가진 코멘트 파일이 또 있어 건너뜀: ${ann.file.path}`);
			}
			return;
		}
		if (existing) this.removeId(existing.id);
		this.byId.set(ann.id, ann);
		this.byFilePath.set(ann.file.path, ann.id);
		let set = this.bySource.get(ann.sourcePath);
		if (!set) this.bySource.set(ann.sourcePath, (set = new Set()));
		set.add(ann.id);
	}

	removeId(id: string): Annotation | undefined {
		const ann = this.byId.get(id);
		if (!ann) return undefined;
		this.byId.delete(id);
		if (this.byFilePath.get(ann.file.path) === id) this.byFilePath.delete(ann.file.path);
		const set = this.bySource.get(ann.sourcePath);
		set?.delete(id);
		if (set && set.size === 0) this.bySource.delete(ann.sourcePath);
		return ann;
	}

	private setSourcePath(ann: Annotation, path: string): void {
		const set = this.bySource.get(ann.sourcePath);
		set?.delete(ann.id);
		if (set && set.size === 0) this.bySource.delete(ann.sourcePath);
		ann.sourcePath = path;
		let next = this.bySource.get(path);
		if (!next) this.bySource.set(path, (next = new Set()));
		next.add(ann.id);
	}

	/** 코멘트를 만든 직후 metadataCache를 기다리지 않고 넣는다 (6.1절 10) */
	addCreated(file: TFile, p: { id: string; sourcePath: string; quote: string; color: string; body: string; created: string }): Annotation {
		const ann: Annotation = { ...p, file, updated: p.created, tags: [] };
		this.add(ann);
		this.emitChanged([p.sourcePath]);
		return ann;
	}

	async ensureBody(ann: Annotation): Promise<string> {
		if (ann.body === null) {
			try {
				ann.body = await this.deps.store.readBody(ann.file);
			} catch {
				ann.body = "";
			}
		}
		return ann.body;
	}

	invalidateNote(path: string): void {
		this.highlightsByFile.delete(path);
	}

	// ── 하이라이트 ──────────────────────────────────────

	async getHighlights(file: TFile): Promise<Highlight[]> {
		const cached = this.highlightsByFile.get(file.path);
		const live = this.deps.getLiveText(file.path);
		if (live !== null) {
			if (cached && cached.text === live) return cached.items;
			const items = live.includes("==") ? parseHighlights(live, file.path) : [];
			this.highlightsByFile.set(file.path, { mtime: -1, text: live, items });
			return items;
		}
		if (cached && cached.mtime !== -1 && cached.mtime === file.stat.mtime) return cached.items;
		const text = await this.app.vault.cachedRead(file);
		if (cached && cached.text === text) {
			cached.mtime = file.stat.mtime;
			return cached.items;
		}
		const items = text.includes("==") ? parseHighlights(text, file.path) : [];
		this.highlightsByFile.set(file.path, { mtime: file.stat.mtime, text, items });
		return items;
	}

	/** 마지막으로 읽은 노트 텍스트 (getHighlights 뒤에만 의미 있음) */
	cachedText(path: string): string | null {
		return this.highlightsByFile.get(path)?.text ?? null;
	}

	private async noteHasId(path: string, id: string): Promise<boolean> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return false;
		return (await this.getHighlights(f)).some((h) => h.id === id);
	}

	// ── 사이드바 항목 ────────────────────────────────────

	async getItemsForFile(path: string): Promise<SidebarItem[]> {
		const f = this.app.vault.getAbstractFileByPath(path);
		if (!(f instanceof TFile)) return this.orphansOf(path, new Set(), true, "");
		const hls = await this.getHighlights(f);
		return this.buildItems(path, hls);
	}

	private async buildItems(path: string, hls: Highlight[]): Promise<SidebarItem[]> {
		const items: SidebarItem[] = [];
		const seen = new Set<string>();
		const showPlain = this.settings.showPlainHighlights;
		for (const hl of hls) {
			if (!hl.id) {
				if (showPlain) items.push({ key: `${path}:${hl.from}`, status: "plain", highlight: hl, annotation: null, notePath: path });
				continue;
			}
			const id = hl.id;
			const ann = this.byId.get(id);
			if (seen.has(id)) {
				items.push({ key: `${path}:${hl.from}`, status: "plain", highlight: hl, annotation: null, duplicate: true, duplicateOf: ann, notePath: path });
				continue;
			}
			seen.add(id);
			if (!ann) {
				items.push({ key: id, status: "plain", highlight: hl, annotation: null, missingFile: true, notePath: path });
				continue;
			}
			if (ann.sourcePath !== path) {
				if (await this.noteHasId(ann.sourcePath, id)) {
					// E4: 다른 노트에도 있다 → 원래 노트 쪽이 연결, 여기는 중복
					items.push({ key: `${path}:${hl.from}`, status: "plain", highlight: hl, annotation: null, duplicate: true, duplicateOf: ann, notePath: path });
					continue;
				}
				// E3: 잘라내 붙여넣음 → 원본 경로를 이 노트로
				const old = ann.sourcePath;
				this.setSourcePath(ann, path);
				void this.deps.store.patchProps(ann.file, { sourcePath: path }).catch((e) => console.error(e));
				this.emitChanged([old]);
			}
			this.syncQuote(ann, hl);
			items.push({ key: id, status: "linked", highlight: hl, annotation: ann, notePath: path });
		}
		const text = this.cachedText(path) ?? "";
		items.push(...this.orphansOf(path, seen, false, text));
		return items;
	}

	private orphansOf(path: string, seen: Set<string>, sourceMissing: boolean, text: string): SidebarItem[] {
		const out: SidebarItem[] = [];
		for (const id of this.bySource.get(path) ?? []) {
			if (seen.has(id)) continue;
			const ann = this.byId.get(id);
			if (!ann) continue;
			out.push({
				key: id,
				status: "orphan",
				highlight: null,
				annotation: ann,
				sourceMissing,
				strayAnchor: text.includes(`%%mn:${id}%%`),
				notePath: path,
			});
		}
		out.sort((a, b) => (a.annotation?.created ?? "").localeCompare(b.annotation?.created ?? ""));
		return out;
	}

	/** E1: 문구가 mn-quote와 다르면 잠시 뒤 갱신 */
	private syncQuote(ann: Annotation, hl: Highlight): void {
		if (ann.quote === hl.text) {
			this.quoteDebounce.cancel(ann.id);
			return;
		}
		this.quoteDebounce.run(ann.id, () => {
			const cur = this.byId.get(ann.id);
			if (!cur || cur.quote === hl.text) return;
			const still = this.highlightsByFile.get(cur.sourcePath)?.items.find((h) => h.id === ann.id);
			if (!still || still.text !== hl.text) return;
			cur.quote = hl.text;
			void this.deps.store.patchProps(cur.file, { quote: hl.text }).catch((e) => console.error(e));
		});
	}

	async getAllItems(onProgress?: (done: number, total: number) => void): Promise<{ items: SidebarItem[]; skippedBig: number }> {
		const files = this.app.vault.getMarkdownFiles().filter((f) => !this.isExcludedNote(f.path));
		const items: SidebarItem[] = [];
		let skippedBig = 0;
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			if (f.stat.size > BIG_FILE_BYTES && this.deps.getLiveText(f.path) === null) {
				skippedBig++;
			} else {
				const hls = await this.getHighlights(f);
				if (hls.length || this.bySource.has(f.path)) items.push(...(await this.buildItems(f.path, hls)));
			}
			if ((i + 1) % BATCH === 0) {
				onProgress?.(i + 1, files.length);
				await yieldToUi();
			}
		}
		onProgress?.(files.length, files.length);
		for (const [src] of this.bySource) {
			if (!this.app.vault.getAbstractFileByPath(src)) items.push(...this.orphansOf(src, new Set(), true, ""));
		}
		return { items, skippedBig };
	}

	// ── 이벤트 (main.ts가 registerEvent로 연결) ───────────

	onMetadataChanged(file: TFile): void {
		this.fileDebounce.run(file.path, () => void this.handleFileChanged(file));
	}

	/** 편집기에서 글자를 고칠 때 (디스크 저장 전) */
	onEditorChanged(path: string): void {
		this.fileDebounce.run("editor:" + path, () => void this.handleNoteChanged(path));
	}

	async handleFileChanged(file: TFile): Promise<void> {
		if (!this.app.vault.getAbstractFileByPath(file.path)) return;
		if (this.isCommentFile(file.path)) {
			const prevId = this.byFilePath.get(file.path);
			const prev = prevId ? this.byId.get(prevId) : undefined;
			const prevSource = prev?.sourcePath;
			const next = this.readAnnotation(file);
			if (prev && (!next || next.id !== prev.id)) this.removeId(prev.id);
			if (next) {
				if (prev && prev.id === next.id) this.removeId(prev.id);
				this.add(next);
			}
			const paths = [prevSource, next?.sourcePath].filter((p): p is string => !!p);
			this.emitChanged(paths);
			return;
		}
		await this.handleNoteChanged(file.path);
	}

	private async handleNoteChanged(path: string): Promise<void> {
		const before = new Set((this.highlightsByFile.get(path)?.items ?? []).map((h) => h.id).filter(Boolean) as string[]);
		this.highlightsByFile.delete(path);
		const f = this.app.vault.getAbstractFileByPath(path);
		let after = new Set<string>();
		if (f instanceof TFile && !this.isExcludedNote(path)) {
			after = new Set((await this.getHighlights(f)).map((h) => h.id).filter(Boolean) as string[]);
		}
		const idsChanged = [...before].some((id) => !after.has(id)) || [...after].some((id) => !before.has(id) && this.byId.get(id)?.sourcePath !== path);
		// ID가 다른 노트로 옮겨 갔을 수 있으면(E3·E4) 전부 다시 그린다
		this.emitChanged(idsChanged ? [path, ALL_PATHS] : [path]);
	}

	onDelete(file: TAbstractFile): void {
		if (!(file instanceof TFile)) return;
		const id = this.byFilePath.get(file.path);
		if (id) {
			const ann = this.removeId(id);
			this.emitChanged([ann?.sourcePath ?? ALL_PATHS]);
			return;
		}
		if (this.highlightsByFile.delete(file.path) || this.bySource.has(file.path)) this.emitChanged([file.path, ALL_PATHS]);
	}

	onRename(file: TAbstractFile, oldPath: string): void {
		if (file instanceof TFolder) {
			void this.handleFolderRename(file, oldPath);
			return;
		}
		if (!(file instanceof TFile)) return;
		void this.handleFileRename(file, oldPath);
	}

	private async handleFolderRename(folder: TFolder, oldPath: string): Promise<void> {
		const prefix = oldPath + "/";
		const next = folder.path + "/";
		// 옵시디언이 하위 파일마다 rename을 따로 보내지 않는 경우를 대비해 직접 맞춘다
		for (const [p, id] of [...this.byFilePath]) {
			if (!p.startsWith(prefix)) continue;
			this.byFilePath.delete(p);
			this.byFilePath.set(next + p.slice(prefix.length), id);
		}
		const sources = [...this.bySource.keys()].filter((s) => s.startsWith(prefix));
		for (const s of sources) await this.moveSource(s, next + s.slice(prefix.length));
		for (const p of [...this.highlightsByFile.keys()]) if (p.startsWith(prefix)) this.highlightsByFile.delete(p);
		if (normalizeFolder(this.settings.commentFolder) && (oldPath === this.commentRoot || folder.path === this.commentRoot)) await this.build();
		else this.emitChanged([ALL_PATHS]);
	}

	private async handleFileRename(file: TFile, oldPath: string): Promise<void> {
		const wasComment = this.byFilePath.get(oldPath);
		if (wasComment !== undefined || this.isCommentFile(oldPath)) {
			if (wasComment !== undefined) this.byFilePath.delete(oldPath);
			const ann = wasComment ? this.byId.get(wasComment) : undefined;
			if (!this.isCommentFile(file.path)) {
				// E8: 코멘트 폴더 밖으로 나감
				if (ann) this.removeId(ann.id);
				this.emitChanged([ann?.sourcePath ?? ALL_PATHS]);
				return;
			}
			if (ann) {
				ann.file = file;
				this.byFilePath.set(file.path, ann.id);
				this.emitChanged([ann.sourcePath]);
				return;
			}
		}
		if (this.isCommentFile(file.path)) {
			// 코멘트 폴더 안으로 들어옴
			const ann = this.readAnnotation(file);
			if (ann) {
				this.add(ann);
				this.emitChanged([ann.sourcePath]);
			}
			return;
		}
		// 일반 노트 (5.7절)
		const cache = this.highlightsByFile.get(oldPath);
		this.highlightsByFile.delete(oldPath);
		if (cache) this.highlightsByFile.set(file.path, { ...cache, items: cache.items.map((h) => ({ ...h, filePath: file.path })) });
		await this.moveSource(oldPath, file.path);
		this.emitChanged([oldPath, file.path]);
	}

	/** 원본 노트 경로가 바뀌면 그 노트의 모든 코멘트 파일 mn-source-path를 고친다 */
	private async moveSource(oldPath: string, newPath: string): Promise<void> {
		const ids = [...(this.bySource.get(oldPath) ?? [])];
		if (!ids.length) return;
		let n = 0;
		for (const id of ids) {
			const ann = this.byId.get(id);
			if (!ann) continue;
			this.setSourcePath(ann, newPath);
			try {
				await this.deps.store.patchProps(ann.file, { sourcePath: newPath });
				n++;
			} catch (e) {
				console.error("[Margin Notes] 원본 경로를 고치지 못함", ann.file.path, e);
			}
		}
		if (n > 20) new Notice(`코멘트 ${n}개의 원본 경로를 고쳤어요`);
	}

	// ── 변경 알림 ────────────────────────────────────────

	onChanged(cb: (paths: Set<string>) => void): EventRef {
		return this.on("changed", (paths) => cb(paths as Set<string>));
	}

	emitChanged(paths: Iterable<string>): void {
		for (const p of paths) this.pending.add(p);
		if (this.flushTimer !== null) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			const set = new Set(this.pending);
			this.pending.clear();
			this.trigger("changed", set);
		}, 30);
	}

	destroy(): void {
		this.fileDebounce.clear();
		this.quoteDebounce.clear();
		if (this.flushTimer !== null) clearTimeout(this.flushTimer);
	}
}
