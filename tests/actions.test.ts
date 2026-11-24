import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor, notices, type TFile } from "obsidian";
import { commentFile, settle, setup, type Env } from "./helpers";
import { Actions } from "../src/actions";
import { parseHighlights } from "../src/parser/highlightParser";
import type { CommentModalOptions } from "../src/ui/commentModal";
import type { ConfirmOptions } from "../src/ui/confirmModal";
import type { SidebarItem } from "../src/types";

// 입력창: 테스트가 정한 답을 바로 돌려준다
const modal = vi.hoisted(() => ({
	answer: null as null | { body: string; color?: string } | "cancel",
	last: null as null | CommentModalOptions,
}));
vi.mock("../src/ui/commentModal", () => ({
	CommentModal: class {
		constructor(
			_app: unknown,
			private opts: CommentModalOptions,
		) {}
		open() {
			modal.last = this.opts;
			const a = modal.answer;
			if (a === "cancel" || a === null) this.opts.onCancel?.();
			else void this.opts.onSubmit(a.body, a.color ?? this.opts.color);
		}
	},
}));
// 확인창
const confirm = vi.hoisted(() => ({ choice: "cancel" as string | null, checked: false, last: null as null | ConfirmOptions }));
vi.mock("../src/ui/confirmModal", () => ({
	confirmDialog: async (_app: unknown, opts: ConfirmOptions) => {
		confirm.last = opts;
		return confirm.choice === null ? null : { choice: confirm.choice, checked: confirm.checked };
	},
}));

function makePlugin(e: Env) {
	const plugin = {
		app: e.app,
		index: e.index,
		store: e.store,
		writer: e.writer,
		settings: e.settings,
		relinkingId: null as string | null,
		revealed: [] as string[],
		saveAll: vi.fn(async () => {}),
		revealInSidebar(id: string) {
			plugin.revealed.push(id);
		},
		refreshEditors: vi.fn(),
		refreshView: vi.fn(),
		mainLeaf: () => e.app.workspace.getLeaf(),
		lastMarkdownView: () => e.app.workspace.leaves[0]?.view ?? null,
		effectiveColor: (k: string | null) => k ?? e.settings.defaultColor,
	};
	const actions = new Actions(plugin as never);
	return { plugin, actions };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

async function envWithEditor(text = "트랜스포머는 셀프 어텐션만으로 처리한다.") {
	const e = setup();
	const f = e.app.vault.seed("연구/논문정리.md", text) as TFile;
	await e.index.build();
	const view = e.app.workspace.open(f, text);
	const { plugin, actions } = makePlugin(e);
	return { ...e, f, view, ed: view.editor as Editor, plugin, actions };
}

function select(ed: Editor, part: string) {
	const i = ed.getValue().indexOf(part);
	ed.select(i, i + part.length);
}

beforeEach(() => {
	modal.answer = null;
	modal.last = null;
	confirm.choice = "cancel";
	confirm.checked = false;
	notices.length = 0;
});

describe("6.1 하이라이트 + 코멘트 (M1·M2·M3)", () => {
	it("저장 → 노트에 ==문구==%%mn:id%%, 지정 폴더에 3.2절 형식 파일, 인덱스·사이드바 즉시 반영", async () => {
		const t = await envWithEditor();
		select(t.ed, "셀프 어텐션만으로");
		modal.answer = { body: "RNN을 빼고도", color: "blue" };
		await t.actions.addComment(t.ed as never, t.f);
		await flush();
		const m = /==셀프 어텐션만으로==%%mn:([a-z0-9]{6})%%/.exec(t.ed.getValue());
		expect(m).not.toBeNull();
		const id = m![1];
		expect(t.ed.transactions).toBe(1);
		const ann = t.index.get(id)!;
		expect(ann).toBeDefined();
		expect(ann.color).toBe("blue");
		expect(ann.file.path).toBe(`Annotations/논문정리/논문정리 - 셀프 어텐션만으로 - ${id}.md`);
		expect(await t.store.readBody(ann.file)).toBe("RNN을 빼고도");
		expect(t.plugin.revealed).toEqual([id]);
		expect(modal.last?.quote).toBe("셀프 어텐션만으로");
	});

	it("취소 → 노트·폴더 모두 그대로 (M2)", async () => {
		const t = await envWithEditor();
		const before = t.ed.getValue();
		select(t.ed, "셀프");
		modal.answer = "cancel";
		await t.actions.addComment(t.ed as never, t.f);
		await flush();
		expect(t.ed.getValue()).toBe(before);
		expect(t.app.vault.getAbstractFileByPath("Annotations")).toBeNull();
		expect(t.ed.transactions).toBe(0);
	});

	it("검사에 걸리면 모달을 열지 않고 이유를 안내 (M5)", async () => {
		const t = await envWithEditor("a\nb");
		t.ed.select(0, 3);
		modal.answer = { body: "x" };
		await t.actions.addComment(t.ed as never, t.f);
		expect(modal.last).toBeNull();
		expect(notices).toContain("한 줄 안에서만 선택할 수 있어요");
	});

	it("파일 생성이 실패하면 노트 변경을 되돌리고 코멘트를 클립보드에 (6.1절 9)", async () => {
		const t = await envWithEditor();
		const before = t.ed.getValue();
		t.app.vault.failCreate = () => new Error("권한 없음");
		const written: string[] = [];
		vi.stubGlobal("navigator", { clipboard: { writeText: async (s: string) => void written.push(s) } });
		select(t.ed, "셀프");
		modal.answer = { body: "잃으면 안 되는 코멘트" };
		await t.actions.addComment(t.ed as never, t.f);
		await flush();
		expect(t.ed.getValue()).toBe(before);
		expect(written).toEqual(["잃으면 안 되는 코멘트"]);
		expect(notices.some((n) => n.startsWith("코멘트 파일을 만들지 못했어요: 권한 없음"))).toBe(true);
		vi.unstubAllGlobals();
	});

	it("기존 하이라이트 안을 선택하면 코멘트 편집 흐름으로 (검사 6)", async () => {
		const t = await envWithEditor("앞 ==기존 문구== 뒤");
		select(t.ed, "기존");
		modal.answer = { body: "새 코멘트" };
		await t.actions.addComment(t.ed as never, t.f);
		await flush();
		expect(modal.last?.title).toBe("코멘트 추가");
		expect(t.ed.getValue()).toMatch(/^앞 ==기존 문구==%%mn:[a-z0-9]{6}%% 뒤$/);
		expect(t.index.all()).toHaveLength(1);
	});
});

describe("6.2 하이라이트만", () => {
	it("기본색이면 ID 없이 ==문구==만, 파일 없음", async () => {
		const t = await envWithEditor();
		select(t.ed, "셀프");
		await t.actions.addHighlight(t.ed as never, t.f);
		expect(t.ed.getValue()).toBe("트랜스포머는 ==셀프== 어텐션만으로 처리한다.");
		expect(t.index.all()).toHaveLength(0);
	});
	it("다른 색이면 ID + 빈 코멘트 파일", async () => {
		const t = await envWithEditor();
		select(t.ed, "셀프");
		await t.actions.addHighlight(t.ed as never, t.f, "red");
		const id = /%%mn:([a-z0-9]{6})%%/.exec(t.ed.getValue())![1];
		const ann = t.index.get(id)!;
		expect(ann.color).toBe("red");
		expect(await t.store.readBody(ann.file)).toBe("");
	});
});

async function linkedEnv(over: Partial<Env["settings"]> = {}) {
	const e = setup(over);
	const text = "앞 ==문구==%%mn:abc123%% 뒤 ==일반== 끝";
	const f = e.app.vault.seed("n.md", text) as TFile;
	e.app.vault.seed("Annotations/n/c.md", commentFile({ id: "abc123", source: "n.md", quote: "문구", body: "본문" }));
	await e.index.build();
	const { plugin, actions } = makePlugin(e);
	const items = await e.index.getItemsForFile("n.md");
	return { ...e, f, plugin, actions, items, linked: items[0], plain: items[1] };
}

describe("6.3 코멘트 편집", () => {
	it("카드에서 저장: writeBody + mn-updated (M11)", async () => {
		const t = await linkedEnv();
		const ann = t.linked.annotation!;
		const before = t.app.metadataCache.getFileCache(ann.file)!.frontmatter!["mn-updated"];
		expect(await t.actions.saveBody(t.linked, "고친 본문", ann.file.stat.mtime)).toBe(true);
		expect(await t.store.readBody(ann.file)).toBe("고친 본문");
		expect(t.app.metadataCache.getFileCache(ann.file)!.frontmatter!["mn-updated"]).not.toBe(before);
	});
	it("다른 곳에서 바뀌었으면 덮어쓰기 확인 (M12)", async () => {
		const t = await linkedEnv();
		const ann = t.linked.annotation!;
		const start = ann.file.stat.mtime;
		await t.app.vault.modify(ann.file, t.app.vault.text(ann.file.path) + "\n외부 수정");
		confirm.choice = "cancel";
		expect(await t.actions.saveBody(t.linked, "내 본문", start)).toBe(false);
		expect(confirm.last?.message).toBe("다른 곳에서 코멘트가 바뀌었어요. 덮어쓸까요?");
		expect(await t.store.readBody(ann.file)).toContain("외부 수정");
		confirm.choice = "overwrite";
		expect(await t.actions.saveBody(t.linked, "내 본문", start)).toBe(true);
		expect(await t.store.readBody(ann.file)).toBe("내 본문");
	});
	it("일반 하이라이트에 코멘트: attachId + 파일 생성", async () => {
		const t = await linkedEnv();
		expect(await t.actions.saveBody(t.plain, "새 코멘트", 0)).toBe(true);
		const m = /==일반==%%mn:([a-z0-9]{6})%%/.exec(t.app.vault.text("n.md"));
		expect(m).not.toBeNull();
		expect(await t.store.readBody(t.index.get(m![1])!.file)).toBe("새 코멘트");
	});
	it("일반 하이라이트에 빈 코멘트는 아무것도 만들지 않는다", async () => {
		const t = await linkedEnv();
		expect(await t.actions.saveBody(t.plain, "  ", 0)).toBe(false);
		expect(t.app.vault.text("n.md")).not.toContain("==일반==%%");
	});
	it("ID는 있는데 파일이 없으면 같은 ID로 새로 만든다 (E6)", async () => {
		const t = await linkedEnv();
		await t.app.vault.delete(t.linked.annotation!.file);
		await settle();
		const item = (await t.index.getItemsForFile("n.md"))[0];
		expect(item.missingFile).toBe(true);
		expect(await t.actions.saveBody(item, "다시 씀", 0)).toBe(true);
		expect(await t.store.readBody(t.index.get("abc123")!.file)).toBe("다시 씀");
		expect(t.app.vault.text("n.md")).toBe("앞 ==문구==%%mn:abc123%% 뒤 ==일반== 끝");
	});
});

describe("6.4 하이라이트 제거 (M14)", () => {
	it("물어보기 → 파일도 휴지통으로", async () => {
		const t = await linkedEnv();
		confirm.choice = "trash";
		await t.actions.removeHighlight(t.linked);
		expect(t.app.vault.text("n.md")).toBe("앞 문구 뒤 ==일반== 끝");
		expect(t.app.fileManager.trashed).toEqual(["Annotations/n/c.md"]);
	});
	it("물어보기 → 파일은 남기기 (고아가 됨)", async () => {
		const t = await linkedEnv();
		confirm.choice = "keep";
		await t.actions.removeHighlight(t.linked);
		expect(t.app.vault.text("n.md")).toBe("앞 문구 뒤 ==일반== 끝");
		expect(t.app.fileManager.trashed).toEqual([]);
		await settle();
		const items = await t.index.getItemsForFile("n.md");
		expect(items.find((i) => i.annotation?.id === "abc123")?.status).toBe("orphan");
	});
	it("물어보기 → 취소면 그대로", async () => {
		const t = await linkedEnv();
		confirm.choice = "cancel";
		await t.actions.removeHighlight(t.linked);
		expect(t.app.vault.text("n.md")).toBe("앞 ==문구==%%mn:abc123%% 뒤 ==일반== 끝");
	});
	it("다음부터 묻지 않기 → 설정에 저장", async () => {
		const t = await linkedEnv();
		confirm.choice = "keep";
		confirm.checked = true;
		await t.actions.removeHighlight(t.linked);
		expect(t.settings.onRemoveHighlight).toBe("keep");
		expect(t.plugin.saveAll).toHaveBeenCalled();
	});
	it("일반 하이라이트 제거", async () => {
		const t = await linkedEnv();
		await t.actions.removeHighlight(t.plain);
		expect(t.app.vault.text("n.md")).toBe("앞 ==문구==%%mn:abc123%% 뒤 일반 끝");
	});
});

describe("6.4 같은 ID가 두 번 있을 때", () => {
	it("누른 위치(두 번째)의 하이라이트를 지운다", async () => {
		const t = await linkedEnv();
		await t.app.vault.modify(t.f, "==문구==%%mn:abc123%% 사이 ==문구==%%mn:abc123%%");
		const hls = parseHighlights(t.app.vault.text("n.md"), "n.md");
		confirm.choice = "keep";
		await t.actions.removeHighlight({ ...t.linked, highlight: hls[1] });
		expect(t.app.vault.text("n.md")).toBe("==문구==%%mn:abc123%% 사이 문구");
	});
});

describe("6.5 코멘트만 삭제 (M15)", () => {
	it("파일은 휴지통, 노트에는 ==문구==만", async () => {
		const t = await linkedEnv();
		confirm.choice = "trash";
		await t.actions.deleteComment(t.linked);
		expect(t.app.vault.text("n.md")).toBe("앞 ==문구== 뒤 ==일반== 끝");
		expect(t.app.fileManager.trashed).toEqual(["Annotations/n/c.md"]);
	});
});

describe("6.6 색 바꾸기", () => {
	it("코멘트 파일이 있으면 mn-color만", async () => {
		const t = await linkedEnv();
		await t.actions.changeColor(t.linked, "green");
		expect(t.app.metadataCache.getFileCache(t.linked.annotation!.file)!.frontmatter!["mn-color"]).toBe("green");
	});
	it("일반 하이라이트면 ID + 빈 코멘트 파일", async () => {
		const t = await linkedEnv();
		await t.actions.changeColor(t.plain, "purple");
		const id = /==일반==%%mn:([a-z0-9]{6})%%/.exec(t.app.vault.text("n.md"))![1];
		expect(t.index.get(id)!.color).toBe("purple");
	});
	it("일반 하이라이트를 기본색으로는 아무것도 안 바뀐다", async () => {
		const t = await linkedEnv();
		await t.actions.changeColor(t.plain, "yellow");
		expect(t.app.vault.text("n.md")).toBe("앞 ==문구==%%mn:abc123%% 뒤 ==일반== 끝");
	});
});

describe("6.7 카드에서 본문으로 (M7)", () => {
	it("편집 모드: 오프셋을 다시 찾아 문구를 선택", async () => {
		const t = await linkedEnv();
		const view = t.app.workspace.open(t.f, "새로 쓴 앞부분 " + t.app.vault.text("n.md"));
		await t.actions.goToItem(t.linked, false);
		const ed = view.editor;
		expect(ed.getRange(ed.getCursor("from"), ed.getCursor("to"))).toBe("문구");
	});
	it("고아 카드는 원본 노트만 열고 안내", async () => {
		const t = await linkedEnv();
		const orphan: SidebarItem = { ...t.linked, status: "orphan", highlight: null };
		await t.actions.goToItem(orphan, false);
		expect(notices).toContain("원문을 찾지 못했어요");
	});
});

describe("6.8 고아 다시 잇기 (M16)", () => {
	it("다른 문장을 선택하고 '여기에 연결'", async () => {
		const t = await linkedEnv();
		await t.app.vault.modify(t.f, "앞 문구 뒤 새 문장이 있다");
		await settle();
		const orphan = (await t.index.getItemsForFile("n.md")).find((i) => i.status === "orphan")!;
		expect(orphan).toBeDefined();
		const view = t.app.workspace.open(t.f, t.app.vault.text("n.md"));
		await t.actions.startRelink(orphan);
		expect(t.plugin.relinkingId).toBe("abc123");
		select(view.editor, "새 문장");
		await t.actions.relinkHere(orphan);
		expect(view.editor.getValue()).toBe("앞 문구 뒤 ==새 문장==%%mn:abc123%%이 있다");
		expect(t.app.metadataCache.getFileCache(orphan.annotation!.file)!.frontmatter!["mn-quote"]).toBe("새 문장");
		expect(t.plugin.relinkingId).toBeNull();
	});
	it("다른 노트에 연결하면 mn-source-path도 바뀐다", async () => {
		const t = await linkedEnv();
		await t.app.vault.modify(t.f, "비움");
		await settle();
		const orphan = (await t.index.getItemsForFile("n.md")).find((i) => i.status === "orphan")!;
		const other = t.app.vault.seed("다른.md", "다른 노트의 문장") as TFile;
		const view = t.app.workspace.open(other, "다른 노트의 문장");
		select(view.editor, "문장");
		await t.actions.relinkHere(orphan);
		expect(t.app.metadataCache.getFileCache(orphan.annotation!.file)!.frontmatter!["mn-source-path"]).toBe("다른.md");
		expect(t.index.get("abc123")!.sourcePath).toBe("다른.md");
	});
	it("일반 노트로 남기기 → mn-detached: true, 인덱스에서 빠짐", async () => {
		const t = await linkedEnv();
		confirm.choice = "ok";
		await t.actions.detach(t.linked);
		expect(t.app.metadataCache.getFileCache(t.linked.annotation!.file)!.frontmatter!["mn-detached"]).toBe(true);
		await settle();
		expect(t.index.get("abc123")).toBeUndefined();
	});
	it("E2 남은 ID 표시 지우기", async () => {
		const t = await linkedEnv();
		await t.app.vault.modify(t.f, "앞 문구%%mn:abc123%% 뒤");
		await settle();
		const orphan = (await t.index.getItemsForFile("n.md")).find((i) => i.status === "orphan")!;
		expect(orphan.strayAnchor).toBe(true);
		await t.actions.removeStrayAnchor(orphan);
		expect(t.app.vault.text("n.md")).toBe("앞 문구 뒤");
	});
});

describe("E4 새 ID로 분리 (M17)", () => {
	it("두 번째 중복에 새 ID와 코멘트 파일 복사본", async () => {
		const t = await linkedEnv();
		await t.app.vault.modify(t.f, "==문구==%%mn:abc123%% 그리고 ==문구==%%mn:abc123%%");
		await settle();
		const dup = (await t.index.getItemsForFile("n.md")).find((i) => i.duplicate)!;
		await t.actions.splitDuplicate(dup);
		const text = t.app.vault.text("n.md");
		const ids = [...text.matchAll(/%%mn:([a-z0-9]{6})%%/g)].map((m) => m[1]);
		expect(ids[0]).toBe("abc123");
		expect(ids[1]).not.toBe("abc123");
		expect(await t.store.readBody(t.index.get(ids[1])!.file)).toBe("본문");
	});
});

describe("3단계: 내보내기·폴더 정리", () => {
	it("현재 노트 코멘트 모아 새 노트", async () => {
		const t = await linkedEnv();
		await t.actions.exportNote(t.f);
		const out = t.app.vault.text("n 코멘트 모음.md");
		expect(out).toContain("# n 코멘트 모음");
		expect(out).toContain("> 문구\n\n본문");
	});
	it("하위 폴더 옵션에 맞게 재배치", async () => {
		const t = await linkedEnv({ subfolderPerNote: false });
		confirm.choice = "ok";
		await t.actions.organizeFolder();
		expect(t.app.vault.getAbstractFileByPath("Annotations/c.md")).not.toBeNull();
		expect(notices).toContain("코멘트 파일 1개를 옮겼어요");
	});
	it("인용 복사 형식 (7.2절)", async () => {
		const t = await linkedEnv();
		const written: string[] = [];
		vi.stubGlobal("navigator", { clipboard: { writeText: async (s: string) => void written.push(s) } });
		await t.actions.copyQuote(t.linked);
		expect(written[0]).toBe("> 문구\n>\n> — [[n]]\n\n본문");
		vi.unstubAllGlobals();
	});
});

it("parseHighlights 재확인: 흐름 뒤 노트가 여전히 파싱 가능", async () => {
	const t = await linkedEnv();
	expect(parseHighlights(t.app.vault.text("n.md"), "n.md")).toHaveLength(2);
});
