import { FuzzySuggestModal, TFolder, type App } from "obsidian";

/** 보관함 폴더 목록 (루트와 설정 폴더는 뺀다) */
export function pickableFolders(app: App): TFolder[] {
	const cfg = app.vault.configDir;
	return app.vault
		.getAllLoadedFiles()
		.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path !== cfg && !f.path.startsWith(cfg + "/"))
		.sort((a, b) => a.path.localeCompare(b.path, "ko"));
}

/** 폴더를 검색해서 고르는 창 */
export class FolderPickModal extends FuzzySuggestModal<TFolder> {
	constructor(
		app: App,
		title: string,
		private onPick: (folder: TFolder) => void,
	) {
		super(app);
		this.setPlaceholder(`${title} — 폴더 이름으로 검색`);
	}
	getItems(): TFolder[] {
		return pickableFolders(this.app);
	}
	getItemText(folder: TFolder): string {
		return folder.path;
	}
	onChooseItem(folder: TFolder): void {
		this.onPick(folder);
	}
}
