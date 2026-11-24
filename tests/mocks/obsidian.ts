/**
 * 테스트용 가짜 obsidian 모듈. 메모리 보관함, frontmatter를 읽는 metadataCache,
 * processFrontMatter를 갖춘 fileManager, 편집기·MarkdownView 흉내를 제공한다.
 * 플러그인이 실제로 쓰는 API만 최소한으로 구현한다.
 */

export type EventRef = { name: string; cb: (...args: unknown[]) => unknown; owner?: Events };

export class Events {
	private _handlers = new Map<string, Set<EventRef>>();
	on(name: string, cb: (...args: any[]) => unknown): EventRef {
		const ref = { name, cb, owner: this };
		if (!this._handlers.has(name)) this._handlers.set(name, new Set());
		this._handlers.get(name)!.add(ref);
		return ref;
	}
	off(name: string, cb: (...args: unknown[]) => unknown): void {
		for (const r of this._handlers.get(name) ?? []) if (r.cb === cb) this._handlers.get(name)!.delete(r);
	}
	offref(ref: EventRef): void {
		this._handlers.get(ref.name)?.delete(ref);
	}
	trigger(name: string, ...args: unknown[]): void {
		for (const r of [...(this._handlers.get(name) ?? [])]) r.cb(...args);
	}
}

export function normalizePath(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "").replace(/ | /g, " ").normalize("NFC");
}

export abstract class TAbstractFile {
	vault!: Vault;
	path = "";
	name = "";
	parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
	stat = { ctime: 0, mtime: 0, size: 0 };
	basename = "";
	extension = "";
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "" || this.path === "/";
	}
}

export const notices: string[] = [];
export class Notice {
	constructor(message: string | DocumentFragment) {
		notices.push(String(message));
	}
	setMessage() {
		return this;
	}
	hide() {}
}

export const Platform = { isMobile: false, isMacOS: false, isDesktop: true };

// ── 아주 작은 YAML (이 플러그인이 쓰는 형식만) ─────────────────

function parseScalar(v: string): unknown {
	const t = v.trim();
	if (t === "") return null;
	if (t === "[]") return [];
	if (t.startsWith("[") && t.endsWith("]")) {
		return t
			.slice(1, -1)
			.split(",")
			.map((x) => parseScalar(x))
			.filter((x) => x !== null);
	}
	if (t.startsWith('"')) return JSON.parse(t.replace(/\\'/g, "'"));
	if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
	if (t === "true") return true;
	if (t === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
	return t;
}

export function parseYaml(src: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	let listKey: string | null = null;
	for (const line of src.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const item = /^\s+-\s+(.*)$/.exec(line);
		if (item && listKey) {
			(out[listKey] as unknown[]).push(parseScalar(item[1]));
			continue;
		}
		const m = /^([^:\s][^:]*):(.*)$/.exec(line);
		if (!m) throw new Error("YAML 오류: " + line);
		const key = m[1].trim();
		const val = m[2];
		if (val.trim() === "") {
			out[key] = [];
			listKey = key;
		} else {
			out[key] = parseScalar(val);
			listKey = null;
		}
	}
	return out;
}

export function stringifyYaml(obj: Record<string, unknown>): string {
	const lines: string[] = [];
	for (const [k, v] of Object.entries(obj)) {
		if (Array.isArray(v)) {
			if (!v.length) lines.push(`${k}: []`);
			else {
				lines.push(`${k}:`);
				for (const x of v) lines.push(`  - ${typeof x === "string" ? JSON.stringify(x) : String(x)}`);
			}
		} else if (typeof v === "string") {
			lines.push(`${k}: ${/^[\w\-+:.\/ ]+$/.test(v) && !/^[\d-]/.test(v) ? v : JSON.stringify(v)}`);
		} else lines.push(`${k}: ${String(v)}`);
	}
	return lines.join("\n") + "\n";
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

// ── Vault ───────────────────────────────────────────────

let clock = 1_000;

export class Vault extends Events {
	private files = new Map<string, TAbstractFile>();
	private contents = new Map<string, string>();
	configDir = ".obsidian";
	app!: App;
	/** create 실패를 흉내 내는 훅 */
	failCreate: ((path: string) => Error | null) | null = null;

	constructor() {
		super();
		const root = new TFolder();
		root.path = "/";
		root.name = "";
		root.vault = this;
		this.files.set("/", root);
	}

	get root(): TFolder {
		return this.files.get("/") as TFolder;
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		return this.files.get(normalizePath(path) || "/") ?? null;
	}
	getFileByPath(path: string): TFile | null {
		const f = this.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}
	getMarkdownFiles(): TFile[] {
		return [...this.files.values()].filter((f): f is TFile => f instanceof TFile && f.extension === "md");
	}
	getAllLoadedFiles(): TAbstractFile[] {
		return [...this.files.values()];
	}

	private parentOf(path: string): TFolder {
		const i = path.lastIndexOf("/");
		const p = i < 0 ? "/" : path.slice(0, i);
		const f = this.files.get(p);
		if (!(f instanceof TFolder)) throw new Error(`폴더가 없어요: ${p}`);
		return f;
	}

	async createFolder(path: string): Promise<TFolder> {
		path = normalizePath(path);
		if (this.files.has(path)) throw new Error("이미 있어요: " + path);
		const parent = this.parentOf(path);
		const f = new TFolder();
		f.path = path;
		f.name = path.split("/").pop()!;
		f.parent = parent;
		f.vault = this;
		parent.children.push(f);
		this.files.set(path, f);
		return f;
	}

	/** 테스트 준비용: 폴더를 자동으로 만들며 파일을 넣는다(이벤트 없음) */
	seed(path: string, content: string): TFile {
		const parts = path.split("/");
		let cur = "";
		for (const part of parts.slice(0, -1)) {
			cur = cur ? `${cur}/${part}` : part;
			if (!this.files.has(cur)) void this.createFolder(cur);
		}
		return this.make(path, content, false);
	}

	private make(path: string, content: string, emit: boolean): TFile {
		path = normalizePath(path);
		const parent = this.parentOf(path);
		const f = new TFile();
		f.path = path;
		f.name = path.split("/").pop()!;
		f.extension = f.name.includes(".") ? f.name.split(".").pop()! : "";
		f.basename = f.extension ? f.name.slice(0, -(f.extension.length + 1)) : f.name;
		f.parent = parent;
		f.vault = this;
		f.stat = { ctime: clock, mtime: clock++, size: content.length };
		parent.children.push(f);
		this.files.set(path, f);
		this.contents.set(path, content);
		this.app?.metadataCache.update(f, content);
		if (emit) {
			this.trigger("create", f);
			this.app?.metadataCache.trigger("changed", f, content, this.app.metadataCache.getFileCache(f));
		}
		return f;
	}

	async create(path: string, content: string): Promise<TFile> {
		path = normalizePath(path);
		if (this.files.has(path)) throw new Error("이미 있어요: " + path);
		const err = this.failCreate?.(path);
		if (err) throw err;
		return this.make(path, content, true);
	}

	async read(file: TFile): Promise<string> {
		const c = this.contents.get(file.path);
		if (c === undefined) throw new Error("없는 파일: " + file.path);
		return c;
	}
	cachedRead(file: TFile): Promise<string> {
		return this.read(file);
	}
	text(path: string): string {
		return this.contents.get(normalizePath(path)) ?? "";
	}

	async modify(file: TFile, data: string): Promise<void> {
		this.write(file, data);
	}
	write(file: TFile, data: string): void {
		this.contents.set(file.path, data);
		file.stat = { ...file.stat, mtime: clock++, size: data.length };
		this.app?.metadataCache.update(file, data);
		this.trigger("modify", file);
		this.app?.metadataCache.trigger("changed", file, data, this.app.metadataCache.getFileCache(file));
	}

	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const next = fn(await this.read(file));
		this.write(file, next);
		return next;
	}

	async delete(file: TAbstractFile): Promise<void> {
		this.files.delete(file.path);
		this.contents.delete(file.path);
		if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
		if (file instanceof TFile) this.app?.metadataCache.remove(file);
		this.trigger("delete", file);
	}

	async rename(file: TAbstractFile, newPath: string): Promise<void> {
		newPath = normalizePath(newPath);
		if (this.files.has(newPath)) throw new Error("이미 있어요: " + newPath);
		const old = file.path;
		const parent = this.parentOf(newPath);
		if (file.parent) file.parent.children = file.parent.children.filter((c) => c !== file);
		file.parent = parent;
		parent.children.push(file);
		this.files.delete(old);
		file.path = newPath;
		file.name = newPath.split("/").pop()!;
		if (file instanceof TFile) {
			file.basename = file.extension ? file.name.slice(0, -(file.extension.length + 1)) : file.name;
			const c = this.contents.get(old)!;
			this.contents.delete(old);
			this.contents.set(newPath, c);
			this.app?.metadataCache.move(old, file);
		}
		this.files.set(newPath, file);
		this.trigger("rename", file, old);
	}
}

export interface CachedMetadata {
	frontmatter?: Record<string, unknown>;
}

export class MetadataCache extends Events {
	private caches = new Map<string, CachedMetadata>();
	update(file: TFile, content: string): void {
		const m = FM_RE.exec(content);
		let frontmatter: Record<string, unknown> | undefined;
		if (m) {
			try {
				frontmatter = parseYaml(m[1]);
			} catch {
				frontmatter = undefined;
			}
		}
		this.caches.set(file.path, { frontmatter });
	}
	remove(file: TFile): void {
		this.caches.delete(file.path);
	}
	move(old: string, file: TFile): void {
		const c = this.caches.get(old);
		this.caches.delete(old);
		if (c) this.caches.set(file.path, c);
	}
	getFileCache(file: TFile): CachedMetadata | null {
		return this.caches.get(file.path) ?? null;
	}
}

export class FileManager {
	trashed: string[] = [];
	constructor(private app: App) {}
	generateMarkdownLink(file: TFile, _sourcePath: string): string {
		return `[[${file.basename}]]`;
	}
	async processFrontMatter(file: TFile, fn: (fm: Record<string, unknown>) => void): Promise<void> {
		const text = await this.app.vault.read(file);
		const m = FM_RE.exec(text);
		const fm = m ? parseYaml(m[1]) : {};
		fn(fm);
		const body = m ? text.slice(m[0].length) : text;
		this.app.vault.write(file, `---\n${stringifyYaml(fm)}---\n${body}`);
	}
	async trashFile(file: TAbstractFile): Promise<void> {
		this.trashed.push(file.path);
		await this.app.vault.delete(file);
	}
	async renameFile(file: TAbstractFile, newPath: string): Promise<void> {
		await this.app.vault.rename(file, newPath);
	}
}

// ── 편집기 흉내 ─────────────────────────────────────────

export interface EditorPosition {
	line: number;
	ch: number;
}

export class Editor {
	transactions = 0;
	private text: string;
	private anchor = 0;
	private head = 0;
	constructor(text: string) {
		this.text = text;
	}
	getValue(): string {
		return this.text;
	}
	setValue(t: string): void {
		this.text = t;
	}
	posToOffset(p: EditorPosition): number {
		const lines = this.text.split("\n");
		let off = 0;
		for (let i = 0; i < p.line; i++) off += lines[i].length + 1;
		return off + p.ch;
	}
	offsetToPos(off: number): EditorPosition {
		const before = this.text.slice(0, off).split("\n");
		return { line: before.length - 1, ch: before[before.length - 1].length };
	}
	getLine(n: number): string {
		return this.text.split("\n")[n] ?? "";
	}
	getRange(a: EditorPosition, b: EditorPosition): string {
		return this.text.slice(this.posToOffset(a), this.posToOffset(b));
	}
	select(from: number, to: number): void {
		this.anchor = from;
		this.head = to;
	}
	setSelection(a: EditorPosition, b?: EditorPosition): void {
		this.anchor = this.posToOffset(a);
		this.head = b ? this.posToOffset(b) : this.anchor;
	}
	getCursor(which: "from" | "to" | "head" | "anchor" = "head"): EditorPosition {
		const from = Math.min(this.anchor, this.head);
		const to = Math.max(this.anchor, this.head);
		const off = which === "from" ? from : which === "to" ? to : which === "anchor" ? this.anchor : this.head;
		return this.offsetToPos(off);
	}
	somethingSelected(): boolean {
		return this.anchor !== this.head;
	}
	transaction(tx: { changes?: { from: EditorPosition; to?: EditorPosition; text: string }[]; selection?: { from: EditorPosition } }): void {
		this.transactions++;
		const changes = (tx.changes ?? [])
			.map((c) => ({ from: this.posToOffset(c.from), to: c.to ? this.posToOffset(c.to) : this.posToOffset(c.from), text: c.text }))
			.sort((a, b) => b.from - a.from);
		for (const c of changes) this.text = this.text.slice(0, c.from) + c.text + this.text.slice(c.to);
		if (tx.selection) this.setSelection(tx.selection.from);
	}
	scrollIntoView(): void {}
	focus(): void {}
}

export class MarkdownView {
	leaf: WorkspaceLeaf;
	mode: "source" | "preview" = "source";
	constructor(
		public file: TFile,
		public editor: Editor,
	) {
		this.leaf = new WorkspaceLeaf(this);
	}
	getMode() {
		return this.mode;
	}
	getViewData() {
		return this.editor.getValue();
	}
}

export class WorkspaceLeaf {
	constructor(public view: unknown) {}
	async openFile(): Promise<void> {}
}

export class Workspace extends Events {
	leaves: WorkspaceLeaf[] = [];
	getLeavesOfType(type: string): WorkspaceLeaf[] {
		return type === "markdown" ? this.leaves.filter((l) => l.view instanceof MarkdownView) : [];
	}
	getActiveViewOfType<T>(cls: new (...a: any[]) => T): T | null {
		const l = this.leaves.find((x) => x.view instanceof cls);
		return (l?.view as T) ?? null;
	}
	getLeaf(): WorkspaceLeaf {
		return new WorkspaceLeaf(null);
	}
	async revealLeaf(): Promise<void> {}
	setActiveLeaf(): void {}
	/** 테스트: 파일을 편집기에 연다 */
	open(file: TFile, text: string): MarkdownView {
		const v = new MarkdownView(file, new Editor(text));
		this.leaves.push(v.leaf);
		return v;
	}
}

export class App {
	vault: Vault;
	metadataCache = new MetadataCache();
	fileManager: FileManager;
	workspace = new Workspace();
	constructor() {
		this.vault = new Vault();
		this.vault.app = this;
		this.fileManager = new FileManager(this);
	}
}

// ── UI 클래스 (화면 테스트용 최소 구현) ─────────────────────

import { StateField } from "@codemirror/state";

/** 편집기 상태: 어떤 파일인지 (테스트가 초기값을 바꿀 수 있게 전역에 둔다) */
export const editorState = { file: null as TFile | null, livePreview: true };
export const editorInfoField = StateField.define<{ file: TFile | null }>({
	create: () => ({ file: editorState.file }),
	update: (v) => v,
});
export const editorLivePreviewField = StateField.define<boolean>({
	create: () => editorState.livePreview,
	update: (v) => v,
});

export class Modal {
	constructor(public app: App) {}
	open() {}
	close() {}
}

export class Component {
	private children: Component[] = [];
	private cleanups: (() => void)[] = [];
	loaded = false;
	load() {
		this.loaded = true;
	}
	unload() {
		for (const c of this.children) c.unload();
		for (const f of this.cleanups) f();
		this.cleanups = [];
		this.loaded = false;
	}
	addChild<T extends Component>(c: T): T {
		this.children.push(c);
		c.load();
		return c;
	}
	removeChild<T extends Component>(c: T): T {
		this.children = this.children.filter((x) => x !== c);
		c.unload();
		return c;
	}
	register(f: () => void) {
		this.cleanups.push(f);
	}
	registerEvent(ref: EventRef & { owner?: Events }) {
		this.cleanups.push(() => ref.owner?.offref(ref));
	}
	registerDomEvent(el: EventTarget, type: string, cb: EventListener) {
		el.addEventListener(type, cb);
		this.cleanups.push(() => el.removeEventListener(type, cb));
	}
}

export class ItemView extends Component {
	app: App;
	containerEl: HTMLElement;
	contentEl: HTMLElement;
	constructor(public leaf: WorkspaceLeaf & { app?: App }) {
		super();
		this.app = (leaf as unknown as { app: App }).app;
		this.containerEl = document.createElement("div");
		this.contentEl = this.containerEl.createDiv({ cls: "view-content" });
	}
}

export interface RecordedMenuItem {
	title: string;
	icon?: string;
	checked?: boolean | null;
	section?: string;
	click?: () => void;
}
export const menus: Menu[] = [];
export class Menu {
	items: (RecordedMenuItem | "separator")[] = [];
	constructor() {
		menus.push(this);
	}
	addItem(cb: (mi: MenuItem) => unknown) {
		const rec: RecordedMenuItem = { title: "" };
		cb(new MenuItem(rec));
		this.items.push(rec);
		return this;
	}
	addSeparator() {
		this.items.push("separator");
		return this;
	}
	showAtMouseEvent() {}
	showAtPosition() {}
	titles(): string[] {
		return this.items.filter((i): i is RecordedMenuItem => i !== "separator").map((i) => i.title);
	}
	click(title: string) {
		const it = this.items.find((i): i is RecordedMenuItem => i !== "separator" && i.title === title);
		if (!it) throw new Error("메뉴 항목 없음: " + title + " / " + this.titles().join(", "));
		it.click?.();
	}
}
export class MenuItem {
	constructor(private rec: RecordedMenuItem) {}
	setTitle(t: string) {
		this.rec.title = t;
		return this;
	}
	setIcon(i: string) {
		this.rec.icon = i;
		return this;
	}
	setChecked(c: boolean | null) {
		this.rec.checked = c;
		return this;
	}
	setSection(s: string) {
		this.rec.section = s;
		return this;
	}
	onClick(cb: () => void) {
		this.rec.click = cb;
		return this;
	}
}

export const MarkdownRenderer = {
	async render(_app: App, markdown: string, el: HTMLElement) {
		for (const para of markdown.split(/\n{2,}/)) {
			const p = document.createElement("p");
			p.textContent = para;
			el.appendChild(p);
		}
	},
};

export class Plugin {}
export class PluginSettingTab {}
export class AbstractInputSuggest {}
export class Setting {}
export function setIcon(el: HTMLElement, icon: string) {
	el.setAttribute("data-icon", icon);
}
export function setTooltip(el: HTMLElement, t: string) {
	el.setAttribute("aria-label", t);
}
export function debounce<T extends (...a: any[]) => unknown>(fn: T) {
	return fn;
}
