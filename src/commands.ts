import { MarkdownView, Notice, TFile, type Editor, type MarkdownFileInfo, type Menu } from "obsidian";
import type MarginNotesPlugin from "./main";
import type { Highlight, SidebarItem } from "./types";

function fileOf(ctx: MarkdownView | MarkdownFileInfo): TFile | null {
	return ctx.file instanceof TFile ? ctx.file : null;
}

/** 편집기 명령을 쓸 수 있는 노트인가 (E16: 코멘트 폴더 안은 안 됨) */
function usable(plugin: MarginNotesPlugin, ctx: MarkdownView | MarkdownFileInfo): TFile | null {
	const f = fileOf(ctx);
	if (!f || plugin.index.isCommentFile(f.path)) return null;
	return f;
}

export function itemForHighlight(plugin: MarginNotesPlugin, file: TFile, hl: Highlight): SidebarItem {
	const ann = hl.id ? plugin.index.get(hl.id) : undefined;
	if (ann && ann.sourcePath === file.path) return { key: ann.id, status: "linked", highlight: hl, annotation: ann, notePath: file.path };
	return { key: hl.id ?? `${file.path}:${hl.from}`, status: "plain", highlight: hl, annotation: null, missingFile: !!hl.id && !ann, notePath: file.path };
}

/** 5.8절 명령어 */
export function registerCommands(plugin: MarginNotesPlugin): void {
	const a = () => plugin.actions;

	plugin.addCommand({
		id: "add-comment",
		name: "선택 영역에 하이라이트 + 코멘트",
		icon: "message-square-plus",
		editorCheckCallback: (checking, editor, ctx) => {
			const f = usable(plugin, ctx);
			if (!f || !editor.somethingSelected()) return false;
			if (!checking) void a().addComment(editor, f);
			return true;
		},
	});

	plugin.addCommand({
		id: "add-highlight",
		name: "선택 영역에 하이라이트만",
		icon: "highlighter",
		editorCheckCallback: (checking, editor, ctx) => {
			const f = usable(plugin, ctx);
			if (!f || !editor.somethingSelected()) return false;
			if (!checking) void a().addHighlight(editor, f);
			return true;
		},
	});

	const atCursor = (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
		const f = usable(plugin, ctx);
		if (!f) return null;
		const hl = plugin.writer.highlightAtCursor(editor, f.path);
		return hl ? { file: f, hl } : null;
	};

	plugin.addCommand({
		id: "edit-comment-at-cursor",
		name: "커서 위치 코멘트 편집",
		icon: "pencil",
		editorCheckCallback: (checking, editor, ctx) => {
			const r = atCursor(editor, ctx);
			if (!r) return false;
			if (!checking) void a().editCommentFor(r.file, r.hl);
			return true;
		},
	});

	plugin.addCommand({
		id: "remove-highlight-at-cursor",
		name: "커서 위치 하이라이트 제거",
		icon: "eraser",
		editorCheckCallback: (checking, editor, ctx) => {
			const r = atCursor(editor, ctx);
			if (!r) return false;
			if (!checking) void a().removeHighlight(itemForHighlight(plugin, r.file, r.hl));
			return true;
		},
	});

	plugin.addCommand({
		id: "open-sidebar",
		name: "하이라이트 사이드바 열기",
		icon: "highlighter",
		callback: () => void plugin.activateView(true),
	});

	plugin.addCommand({
		id: "reveal-at-cursor",
		name: "커서 위치를 사이드바에서 보기",
		icon: "locate",
		editorCheckCallback: (checking, editor, ctx) => {
			const r = atCursor(editor, ctx);
			if (!r) return false;
			if (!checking) plugin.revealInSidebar(r.hl.id ?? `${r.file.path}:${r.hl.from}`, true);
			return true;
		},
	});

	plugin.addCommand({
		id: "rebuild-index",
		name: "인덱스 다시 만들기",
		icon: "refresh-cw",
		callback: async () => {
			await plugin.rebuildIndex();
			new Notice("Margin Notes 인덱스를 다시 만들었어요");
		},
	});

	// 3단계
	plugin.addCommand({
		id: "export-comments",
		name: "현재 노트 코멘트 모아 새 노트 만들기",
		icon: "file-output",
		checkCallback: (checking) => {
			const f = plugin.lastMarkdownFile();
			if (!f || plugin.index.isCommentFile(f.path)) return false;
			if (!checking) void a().exportNote(f);
			return true;
		},
	});

	plugin.addCommand({
		id: "organize-comment-folder",
		name: "코멘트 폴더 정리",
		icon: "folder-tree",
		callback: () => void a().organizeFolder(),
	});
}

/** 편집기 우클릭 메뉴 (5.8절). 모바일에서는 길게 눌러 같은 메뉴가 나온다 */
export function editorMenu(plugin: MarginNotesPlugin, menu: Menu, editor: Editor, ctx: MarkdownView | MarkdownFileInfo): void {
	const f = usable(plugin, ctx);
	if (!f) return;
	const a = plugin.actions;
	let hl: Highlight | null = null;
	if (editor.somethingSelected()) {
		const check = plugin.writer.validateSelection(editor, f.path);
		if (check.kind !== "inside") {
			// 검사에 걸리는 선택이어도 항목은 보여 주고, 누르면 이유를 안내한다
			menu.addSeparator();
			menu.addItem((mi) => mi.setTitle("하이라이트 + 코멘트").setIcon("message-square-plus").setSection("margin-notes").onClick(() => void a.addComment(editor, f)));
			menu.addItem((mi) => mi.setTitle("하이라이트만").setIcon("highlighter").setSection("margin-notes").onClick(() => void a.addHighlight(editor, f)));
			return;
		}
		hl = check.highlight;
	} else {
		hl = plugin.writer.highlightAtCursor(editor, f.path);
	}
	if (!hl) return;
	const item = itemForHighlight(plugin, f, hl);
	menu.addSeparator();
	menu.addItem((mi) =>
		mi
			.setTitle(item.annotation ? "코멘트 편집" : "코멘트 추가")
			.setIcon("pencil")
			.setSection("margin-notes")
			.onClick(() => void a.editCommentFor(f, hl)),
	);
	if (item.annotation) {
		menu.addItem((mi) => mi.setTitle("코멘트 파일 열기").setIcon("file-text").setSection("margin-notes").onClick(() => void a.openCommentFile(item)));
	}
	menu.addItem((mi) => mi.setTitle("하이라이트 제거").setIcon("eraser").setSection("margin-notes").onClick(() => void a.removeHighlight(item)));
}

export function isMarkdownView(v: unknown): v is MarkdownView {
	return v instanceof MarkdownView;
}
