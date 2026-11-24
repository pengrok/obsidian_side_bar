import { App, MarkdownView, type TFile } from "obsidian";
import { AnnotationIndex } from "../src/store/annotationIndex";
import { AnnotationStore } from "../src/store/annotationStore";
import { NoteWriter } from "../src/editor/noteWriter";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";
import type { MarginNotesSettings } from "../src/types";

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 인덱스 디바운스(300ms) + 변경 알림(30ms)이 끝날 때까지 */
export const settle = () => wait(400);

export function setup(over: Partial<MarginNotesSettings> = {}) {
	const app = new App();
	const settings: MarginNotesSettings = { ...structuredClone(DEFAULT_SETTINGS), ...over };
	const store = new AnnotationStore(app as never, () => settings);
	const liveText = (p: string) => {
		for (const l of app.workspace.leaves) {
			const v = l.view;
			if (v instanceof MarkdownView && v.file.path === p) return v.getViewData();
		}
		return null;
	};
	const index = new AnnotationIndex({ app: app as never, getSettings: () => settings, store, getLiveText: liveText });
	app.metadataCache.on("changed", (f: TFile) => index.onMetadataChanged(f as never));
	app.vault.on("delete", (f: TFile) => index.onDelete(f as never));
	app.vault.on("rename", (f: TFile, old: string) => index.onRename(f as never, old));
	const writer = new NoteWriter(app as never);
	const changes: Set<string>[] = [];
	index.onChanged((p) => changes.push(p));
	return { app, settings, store, index, writer, changes };
}

export type Env = ReturnType<typeof setup>;

/** 3.2절 형식의 코멘트 파일 내용 */
export function commentFile(p: { id: string; source: string; quote: string; color?: string; body?: string; tags?: string[]; extra?: string }): string {
	return [
		"---",
		`mn-id: ${p.id}`,
		`mn-source: "[[${p.source.replace(/\.md$/, "").split("/").pop()}]]"`,
		`mn-source-path: ${JSON.stringify(p.source)}`,
		`mn-quote: ${JSON.stringify(p.quote)}`,
		`mn-color: ${p.color ?? "yellow"}`,
		`mn-created: 2026-11-24T11:10:00+09:00`,
		`mn-updated: 2026-11-24T11:12:30+09:00`,
		p.tags?.length ? `tags: [${p.tags.join(", ")}]` : "tags: []",
		...(p.extra ? [p.extra] : []),
		"---",
		p.body ?? "",
	].join("\n");
}
