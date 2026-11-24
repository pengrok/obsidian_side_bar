import { normalizePath, TFile, TFolder, type App } from "obsidian";
import type { MarginNotesSettings } from "../types";
import { toLocalIso } from "../utils/time";
import { buildPath, withSuffix } from "./fileNaming";
import { buildCommentFile, PROP, splitFrontmatter } from "./frontmatter";

export interface PropPatch {
	quote?: string;
	color?: string;
	sourcePath?: string;
	tags?: string[];
	detached?: boolean;
}

/** 코멘트 파일 CRUD (5.4절). 코멘트 파일을 바꾸는 유일한 곳 */
export class AnnotationStore {
	constructor(
		private app: App,
		private getSettings: () => MarginNotesSettings,
	) {}

	async create(p: {
		id: string;
		source: TFile;
		quote: string;
		color: string;
		body: string;
		tags?: string[];
		now?: Date;
	}): Promise<TFile> {
		const now = p.now ?? new Date();
		const settings = this.getSettings();
		let path = normalizePath(buildPath(settings, p.source.basename, p.quote, p.id, now));
		const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		if (folder) await this.ensureFolder(folder);

		const vault = this.app.vault;
		for (let n = 2; vault.getAbstractFileByPath(path); n++) {
			path = withSuffix(path.replace(/ \(\d+\)(\.md)$/, "$1"), n);
		}

		const sourceLink = this.app.fileManager.generateMarkdownLink(p.source, path);
		const content = buildCommentFile(
			{
				id: p.id,
				sourceLink,
				sourcePath: p.source.path,
				quote: p.quote,
				color: p.color,
				created: toLocalIso(now),
				tags: p.tags,
			},
			p.body,
		);
		return vault.create(path, content);
	}

	/** 폴더가 없으면 상위부터 차례로 만든다 */
	async ensureFolder(folder: string): Promise<void> {
		const parts = normalizePath(folder).split("/").filter(Boolean);
		let cur = "";
		for (const part of parts) {
			cur = cur ? `${cur}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(cur);
			if (existing instanceof TFolder) continue;
			if (existing) throw new Error(`'${cur}'는 폴더가 아니에요`);
			try {
				await this.app.vault.createFolder(cur);
			} catch (e) {
				// 다른 작업이 먼저 만들었으면 괜찮다
				if (!(this.app.vault.getAbstractFileByPath(cur) instanceof TFolder)) throw e;
			}
		}
	}

	async readBody(file: TFile): Promise<string> {
		const text = await this.app.vault.cachedRead(file);
		return splitFrontmatter(text).body;
	}

	/** 본문만 바꾸고 mn-updated를 갱신한다 */
	async writeBody(file: TFile, body: string): Promise<void> {
		await this.app.vault.process(file, (data) => {
			const { head } = splitFrontmatter(data);
			return head + body;
		});
		await this.patchProps(file, {});
	}

	/** frontmatter는 processFrontMatter로만 고친다. 항상 mn-updated도 갱신 */
	async patchProps(file: TFile, patch: PropPatch): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			if (patch.quote !== undefined) fm[PROP.quote] = patch.quote;
			if (patch.color !== undefined) fm[PROP.color] = patch.color;
			if (patch.sourcePath !== undefined) fm[PROP.sourcePath] = patch.sourcePath;
			if (patch.tags !== undefined) fm[PROP.tags] = patch.tags;
			if (patch.detached !== undefined) {
				if (patch.detached) fm[PROP.detached] = true;
				else delete fm[PROP.detached];
			}
			fm[PROP.updated] = toLocalIso(new Date());
		});
	}

	/** 사용자의 휴지통 설정을 따른다 */
	async trash(file: TFile): Promise<void> {
		await this.app.fileManager.trashFile(file);
	}

	/** 같은 내용으로 새 ID 코멘트 파일을 만든다 (E4 "새 ID로 분리") */
	async duplicate(file: TFile, p: { id: string; source: TFile; quote: string; color: string; tags: string[] }): Promise<TFile> {
		const body = await this.readBody(file);
		return this.create({ ...p, body });
	}

	/** 파일을 다른 폴더로 옮긴다 (E9, 코멘트 폴더 정리). 링크는 옵시디언이 고친다 */
	async moveTo(file: TFile, folder: string): Promise<TFile> {
		await this.ensureFolder(folder);
		let path = normalizePath(`${folder}/${file.name}`);
		if (path === file.path) return file;
		for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) {
			path = withSuffix(normalizePath(`${folder}/${file.name}`), n);
		}
		await this.app.fileManager.renameFile(file, path);
		return file;
	}
}

export function isMarkdown(f: unknown): f is TFile {
	return f instanceof TFile && f.extension === "md";
}
