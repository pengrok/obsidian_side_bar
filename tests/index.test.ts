import { describe, expect, it } from "vitest";
import { TFile, notices } from "obsidian";
import { commentFile, settle, setup, wait } from "./helpers";
import { ALL_PATHS } from "../src/store/annotationIndex";

const NOTE = "연구/논문정리.md";
const TEXT = "# 서론\n코멘트 ==첫 문장==%%mn:aaaaaa%% 그리고 ==일반==.\n## 본론\n==둘째==%%mn:bbbbbb%%";

async function env() {
	const e = setup();
	e.app.vault.seed(NOTE, TEXT);
	e.app.vault.seed("Annotations/논문정리/a.md", commentFile({ id: "aaaaaa", source: NOTE, quote: "첫 문장", body: "첫 코멘트", tags: ["개념"] }));
	e.app.vault.seed("Annotations/논문정리/b.md", commentFile({ id: "bbbbbb", source: NOTE, quote: "둘째", color: "blue" }));
	await e.index.build();
	return e;
}

describe("build·getItemsForFile", () => {
	it("linked·plain을 본문 순서대로", async () => {
		const { index } = await env();
		const items = await index.getItemsForFile(NOTE);
		expect(items.map((i) => [i.status, i.highlight?.text, i.annotation?.id ?? null])).toEqual([
			["linked", "첫 문장", "aaaaaa"],
			["plain", "일반", null],
			["linked", "둘째", "bbbbbb"],
		]);
		expect(items[0].annotation!.tags).toEqual(["개념"]);
		expect(items[2].annotation!.color).toBe("blue");
		expect(items[0].highlight!.heading).toBe("서론");
	});

	it("본문은 처음엔 읽지 않고(null) ensureBody로 읽는다", async () => {
		const { index } = await env();
		const ann = index.get("aaaaaa")!;
		expect(ann.body).toBeNull();
		expect(await index.ensureBody(ann)).toBe("첫 코멘트");
	});

	it("일반 하이라이트 표시를 끄면 plain이 빠진다", async () => {
		const e = await env();
		e.settings.showPlainHighlights = false;
		e.index.highlightsByFile.clear();
		const items = await e.index.getItemsForFile(NOTE);
		expect(items.map((i) => i.status)).toEqual(["linked", "linked"]);
	});

	it("코멘트 폴더 안 노트와 제외 폴더는 스캔하지 않는다 (3.4절, E16)", async () => {
		const e = await env();
		e.app.vault.seed("Annotations/x.md", "==코멘트 안==");
		e.app.vault.seed("보관/old.md", "==보관 노트==");
		e.settings.excludeFolders = ["보관"];
		const { items } = await e.index.getAllItems();
		const texts = items.map((i) => i.highlight?.text);
		expect(texts).not.toContain("코멘트 안");
		expect(texts).not.toContain("보관 노트");
		expect(e.index.isCommentFile("Annotations/x.md")).toBe(true);
		expect(e.index.isExcludedNote("보관/old.md")).toBe(true);
	});
});

describe("8장 예외·엣지 케이스", () => {
	it("E1 문구를 고치면 연결은 유지되고 mn-quote가 갱신된다", async () => {
		const { app, index } = await env();
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		await app.vault.modify(f, TEXT.replace("첫 문장", "고친 첫 문장"));
		await settle();
		const items = await index.getItemsForFile(NOTE);
		expect(items[0].status).toBe("linked");
		expect(items[0].highlight!.text).toBe("고친 첫 문장");
		await wait(1700);
		const cf = app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile;
		expect(app.metadataCache.getFileCache(cf)!.frontmatter!["mn-quote"]).toBe("고친 첫 문장");
		expect(cf.name).toBe("a.md"); // 파일 이름은 그대로
	});

	it("E2 ==만 지우고 ID가 남으면 고아 + strayAnchor", async () => {
		const { app, index } = await env();
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		await app.vault.modify(f, TEXT.replace("==첫 문장==%%mn:aaaaaa%%", "첫 문장%%mn:aaaaaa%%"));
		await settle();
		const items = await index.getItemsForFile(NOTE);
		const o = items.find((i) => i.annotation?.id === "aaaaaa")!;
		expect(o.status).toBe("orphan");
		expect(o.strayAnchor).toBe(true);
		expect(items[items.length - 1]).toBe(o); // 고아는 맨 아래
	});

	it("E3 다른 노트로 잘라내 붙이면 mn-source-path가 새 노트로", async () => {
		const { app, index } = await env();
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		const other = app.vault.seed("다른.md", "");
		await app.vault.modify(f, TEXT.replace("==첫 문장==%%mn:aaaaaa%%", ""));
		await app.vault.modify(other, "옮김 ==첫 문장==%%mn:aaaaaa%%");
		await settle();
		const items = await index.getItemsForFile("다른.md");
		expect(items[0].status).toBe("linked");
		await wait(50);
		const cf = app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile;
		expect(app.metadataCache.getFileCache(cf)!.frontmatter!["mn-source-path"]).toBe("다른.md");
		expect((await index.getItemsForFile(NOTE)).some((i) => i.annotation?.id === "aaaaaa")).toBe(false);
	});

	it("E4 같은 ID가 두 곳 → 원래 노트가 연결, 나머지는 중복 ID", async () => {
		const { app, index } = await env();
		const other = app.vault.seed("복사.md", "==첫 문장==%%mn:aaaaaa%%");
		void other;
		const items = await index.getItemsForFile("복사.md");
		expect(items[0]).toMatchObject({ status: "plain", duplicate: true });
		expect(items[0].duplicateOf?.id).toBe("aaaaaa");
		// 같은 노트 안 중복
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		await app.vault.modify(f, TEXT + "\n==첫 문장==%%mn:aaaaaa%%");
		await settle();
		const same = await index.getItemsForFile(NOTE);
		expect(same.filter((i) => i.duplicate)).toHaveLength(1);
		expect(same.filter((i) => i.annotation?.id === "aaaaaa")).toHaveLength(1);
	});

	it("E5 원본 노트를 지우면 코멘트는 남고 고아(원본 노트가 삭제됨)", async () => {
		const { app, index } = await env();
		await app.vault.delete(app.vault.getAbstractFileByPath(NOTE)!);
		await settle();
		const { items } = await index.getAllItems();
		const orphans = items.filter((i) => i.status === "orphan");
		expect(orphans.map((o) => o.annotation!.id).sort()).toEqual(["aaaaaa", "bbbbbb"]);
		expect(orphans.every((o) => o.sourceMissing)).toBe(true);
		expect(app.vault.getAbstractFileByPath("Annotations/논문정리/a.md")).not.toBeNull();
	});

	it("E6 코멘트 파일을 지우면 '코멘트 파일 없음' plain", async () => {
		const { app, index } = await env();
		await app.vault.delete(app.vault.getAbstractFileByPath("Annotations/논문정리/a.md")!);
		await settle();
		const items = await index.getItemsForFile(NOTE);
		expect(items[0]).toMatchObject({ status: "plain", missingFile: true, key: "aaaaaa" });
	});

	it("E7 frontmatter가 깨졌거나 mn-id가 없으면 인덱스에서 뺀다(파일은 그대로)", async () => {
		const e = setup();
		e.app.vault.seed(NOTE, TEXT);
		e.app.vault.seed("Annotations/깨짐.md", "---\nmn-id: : :\n---\n본문");
		e.app.vault.seed("Annotations/없음.md", "---\nfoo: bar\n---\n본문");
		e.app.vault.seed("Annotations/틀린id.md", "---\nmn-id: ABC\n---\n");
		await e.index.build();
		expect(e.index.all()).toHaveLength(0);
		expect(e.app.vault.text("Annotations/없음.md")).toBe("---\nfoo: bar\n---\n본문");
	});

	it("E8 코멘트 폴더 밖으로 옮기면 인덱스에서 빠진다", async () => {
		const { app, index } = await env();
		const cf = app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile;
		await app.vault.rename(cf, "밖.md");
		await settle();
		expect(index.get("aaaaaa")).toBeUndefined();
		const items = await index.getItemsForFile(NOTE);
		expect(items[0]).toMatchObject({ status: "plain", missingFile: true });
		// 다시 들여오면 연결
		await app.vault.rename(cf, "Annotations/a.md");
		await settle();
		expect(index.get("aaaaaa")?.file).toBe(cf);
	});

	it("E11 늦게 내려받은 코멘트 파일은 metadataCache 이벤트로 자동 연결", async () => {
		const e = setup();
		e.app.vault.seed(NOTE, TEXT);
		await e.index.build();
		expect((await e.index.getItemsForFile(NOTE))[0].missingFile).toBe(true);
		await e.app.vault.createFolder("Annotations");
		await e.app.vault.create("Annotations/늦게.md", commentFile({ id: "aaaaaa", source: NOTE, quote: "첫 문장" }));
		await settle();
		expect((await e.index.getItemsForFile(NOTE))[0].status).toBe("linked");
	});

	it("E15 1MB 넘는 노트는 전체 스캔에서 건너뛴다", async () => {
		const e = await env();
		e.app.vault.seed("큰.md", "==큰 노트== " + "가".repeat(1024 * 1024));
		const { items, skippedBig } = await e.index.getAllItems();
		expect(skippedBig).toBe(1);
		expect(items.map((i) => i.highlight?.text)).not.toContain("큰 노트");
		// 현재 노트 탭은 그대로 처리
		expect((await e.index.getItemsForFile("큰.md"))[0].highlight?.text).toBe("큰 노트");
	});

	it("mn-detached: true는 인덱스에 넣지 않는다 (6.8절)", async () => {
		const e = setup();
		e.app.vault.seed("Annotations/d.md", commentFile({ id: "dddddd", source: NOTE, quote: "x", extra: "mn-detached: true" }));
		await e.index.build();
		expect(e.index.get("dddddd")).toBeUndefined();
	});

	it("코멘트 파일을 직접 고치면 인덱스가 갱신된다 (M9)", async () => {
		const { app, index, changes } = await env();
		const cf = app.vault.getAbstractFileByPath("Annotations/논문정리/a.md") as TFile;
		await index.ensureBody(index.get("aaaaaa")!);
		changes.length = 0;
		await app.vault.modify(cf, commentFile({ id: "aaaaaa", source: NOTE, quote: "첫 문장", body: "직접 고침", color: "red" }).replace("11:12:30", "12:00:00"));
		await settle();
		const ann = index.get("aaaaaa")!;
		expect(ann.color).toBe("red");
		expect(ann.body).toBeNull();
		expect(await index.ensureBody(ann)).toBe("직접 고침");
		expect(changes.some((c) => c.has(NOTE))).toBe(true);
	});
});

describe("5.7절 노트 이름 변경·이동 (M13)", () => {
	it("이름을 바꾸면 모든 코멘트의 mn-source-path가 새 경로", async () => {
		const { app, index } = await env();
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		await app.vault.createFolder("새폴더");
		await app.vault.rename(f, "새폴더/새이름.md");
		await settle();
		for (const p of ["Annotations/논문정리/a.md", "Annotations/논문정리/b.md"]) {
			const cf = app.vault.getAbstractFileByPath(p) as TFile;
			expect(app.metadataCache.getFileCache(cf)!.frontmatter!["mn-source-path"]).toBe("새폴더/새이름.md");
		}
		const items = await index.getItemsForFile("새폴더/새이름.md");
		expect(items.filter((i) => i.status === "linked")).toHaveLength(2);
		expect(await index.getItemsForFile(NOTE)).toEqual([]);
	});

	it("20개가 넘으면 안내를 띄운다", async () => {
		const e = setup();
		const ids = Array.from({ length: 21 }, (_, i) => `id${String(i).padStart(4, "0")}`);
		e.app.vault.seed("n.md", ids.map((id) => `==q${id}==%%mn:${id}%%`).join("\n"));
		ids.forEach((id) => e.app.vault.seed(`Annotations/${id}.md`, commentFile({ id, source: "n.md", quote: "q" + id })));
		await e.index.build();
		notices.length = 0;
		await e.app.vault.rename(e.app.vault.getAbstractFileByPath("n.md")!, "m.md");
		await settle();
		expect(notices).toContain("코멘트 21개의 원본 경로를 고쳤어요");
	});
});

describe("편집기 최신 텍스트", () => {
	it("열린 편집기의 저장 전 내용으로 하이라이트를 본다", async () => {
		const { app, index } = await env();
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		const view = app.workspace.open(f, TEXT + "\n새 ==편집중==");
		void view;
		const items = await index.getItemsForFile(NOTE);
		expect(items.map((i) => i.highlight?.text)).toContain("편집중");
	});

	it("ID가 노트에서 사라지면 ALL 경로로 알린다", async () => {
		const { app, index, changes } = await env();
		await index.getItemsForFile(NOTE);
		changes.length = 0;
		const f = app.vault.getAbstractFileByPath(NOTE) as TFile;
		await app.vault.modify(f, "비움");
		await settle();
		expect(changes.some((c) => c.has(ALL_PATHS))).toBe(true);
	});
});

describe("성능 (9.2절 완료 기준, M20)", () => {
	it("노트 500개·하이라이트 2,000개 전체 스캔이 5초 안, 스캔 중 이벤트 루프를 놓아 준다", async () => {
		const e = setup();
		for (let n = 0; n < 500; n++) {
			const lines: string[] = [`# 노트 ${n}`];
			for (let h = 0; h < 4; h++) {
				const id = "n" + (n * 4 + h).toString(36).padStart(5, "0");
				lines.push(`문장 ${h} ==하이라이트 ${n}-${h}==%%mn:${id}%% 뒤 문장 `.repeat(1) + "본문 ".repeat(40));
				if (h % 2 === 0) e.app.vault.seed(`Annotations/${id}.md`, commentFile({ id, source: `notes/${n}.md`, quote: `하이라이트 ${n}-${h}` }));
			}
			e.app.vault.seed(`notes/${n}.md`, lines.join("\n\n"));
		}
		await e.index.build();
		let ticks = 0;
		const timer = setInterval(() => ticks++, 0);
		const t0 = performance.now();
		const progress: number[] = [];
		const { items } = await e.index.getAllItems((d) => progress.push(d));
		const ms = performance.now() - t0;
		clearInterval(timer);
		expect(items.length).toBe(2000);
		expect(items.filter((i) => i.status === "linked")).toHaveLength(1000);
		expect(ms).toBeLessThan(5000);
		expect(progress.length).toBeGreaterThanOrEqual(10);
		expect(ticks).toBeGreaterThan(0);
	});
});
