import { describe, expect, it } from "vitest";
import { TFile, parseYaml } from "obsidian";
import { setup, settle } from "./helpers";
import { splitFrontmatter, yamlString } from "../src/store/frontmatter";

describe("AnnotationStore.create (3.2절 형식, M1·M4)", () => {
	it("폴더가 없으면 만들고 3.2절 형식으로 쓴다", async () => {
		const { app, store } = setup();
		const src = app.vault.seed("연구/논문정리.md", "본문");
		const now = new Date(2026, 10, 24, 11, 10, 0);
		const f = await store.create({ id: "a1b2c3", source: src, quote: '셀프 "어텐션"\\만으로', color: "yellow", body: "RNN을 빼고도", now });
		expect(f.path).toBe("Annotations/논문정리/논문정리 - 셀프 어텐션 만으로 - a1b2c3.md");
		expect(app.vault.getAbstractFileByPath("Annotations/논문정리")).not.toBeNull();
		const text = app.vault.text(f.path);
		const { head, body } = splitFrontmatter(text);
		expect(body).toBe("RNN을 빼고도");
		const fm = parseYaml(head.replace(/^---\n|---\n$/g, ""));
		expect(fm).toMatchObject({
			"mn-id": "a1b2c3",
			"mn-source": "[[논문정리]]",
			"mn-source-path": "연구/논문정리.md",
			"mn-quote": '셀프 "어텐션"\\만으로',
			"mn-color": "yellow",
			tags: [],
		});
		expect(String(fm["mn-created"])).toMatch(/^2026-11-24T11:10:00[+-]\d{2}:\d{2}$/);
		expect(fm["mn-updated"]).toBe(fm["mn-created"]);
		// 키 순서도 명세와 같다
		expect(Object.keys(fm)).toEqual(["mn-id", "mn-source", "mn-source-path", "mn-quote", "mn-color", "mn-created", "mn-updated", "tags"]);
	});

	it("같은 경로가 있으면 (2), (3)을 붙인다", async () => {
		const { app, store, settings } = setup();
		settings.fileNamePattern = "{{source}} {{id}}";
		const src = app.vault.seed("a.md", "");
		const p = { id: "aaaaaa", source: src, quote: "q", color: "yellow", body: "" };
		const f1 = await store.create(p);
		const f2 = await store.create(p);
		const f3 = await store.create(p);
		expect([f1.path, f2.path, f3.path]).toEqual(["Annotations/a/a aaaaaa.md", "Annotations/a/a aaaaaa (2).md", "Annotations/a/a aaaaaa (3).md"]);
	});

	it("본문이 비어 있어도 유효한 파일", async () => {
		const { app, store } = setup();
		const src = app.vault.seed("a.md", "");
		const f = await store.create({ id: "aaaaaa", source: src, quote: "q", color: "yellow", body: "" });
		expect(await store.readBody(f)).toBe("");
		expect(app.metadataCache.getFileCache(f)?.frontmatter?.["mn-id"]).toBe("aaaaaa");
	});

	it("줄바꿈이 든 문구도 YAML이 깨지지 않는다", () => {
		expect(yamlString('a\n"b"\\')).toBe('"a\\n\\"b\\"\\\\"');
		expect(JSON.parse(yamlString('a\n"b"\\'))).toBe('a\n"b"\\');
	});
});

describe("readBody / writeBody / patchProps", () => {
	it("writeBody는 frontmatter를 보존하고 mn-updated를 바꾼다 (M11)", async () => {
		const { app, store } = setup();
		const src = app.vault.seed("a.md", "");
		const f = await store.create({ id: "aaaaaa", source: src, quote: "q", color: "blue", body: "처음", now: new Date(2020, 0, 1) });
		const before = app.metadataCache.getFileCache(f)!.frontmatter!;
		await store.writeBody(f, "두 번째\n\n- 목록");
		expect(await store.readBody(f)).toBe("두 번째\n\n- 목록");
		const after = app.metadataCache.getFileCache(f)!.frontmatter!;
		expect(after["mn-color"]).toBe("blue");
		expect(after["mn-id"]).toBe("aaaaaa");
		expect(after["mn-updated"]).not.toBe(before["mn-updated"]);
	});

	it("patchProps는 지정한 속성만 바꾼다", async () => {
		const { app, store } = setup();
		const src = app.vault.seed("a.md", "");
		const f = await store.create({ id: "aaaaaa", source: src, quote: "q", color: "blue", body: "본문" });
		await store.patchProps(f, { color: "red", detached: true });
		const fm = app.metadataCache.getFileCache(f)!.frontmatter!;
		expect(fm["mn-color"]).toBe("red");
		expect(fm["mn-detached"]).toBe(true);
		expect(fm["mn-quote"]).toBe("q");
		expect(await store.readBody(f)).toBe("본문");
		await store.patchProps(f, { detached: false });
		expect(app.metadataCache.getFileCache(f)!.frontmatter!["mn-detached"]).toBeUndefined();
	});

	it("trash는 fileManager.trashFile을 쓴다", async () => {
		const { app, store } = setup();
		const src = app.vault.seed("a.md", "");
		const f = await store.create({ id: "aaaaaa", source: src, quote: "q", color: "blue", body: "" });
		await store.trash(f);
		expect(app.fileManager.trashed).toEqual([f.path]);
		expect(app.vault.getAbstractFileByPath(f.path)).toBeNull();
	});

	it("moveTo는 하위 폴더를 만들고 옮긴다", async () => {
		const { app, store } = setup();
		const src = app.vault.seed("a.md", "");
		const f = await store.create({ id: "aaaaaa", source: src, quote: "q", color: "blue", body: "" });
		await store.moveTo(f, "새폴더/x");
		expect(f.path).toBe("새폴더/x/" + f.name);
		expect(app.vault.getAbstractFileByPath(f.path)).toBeInstanceOf(TFile);
		await settle();
	});
});
