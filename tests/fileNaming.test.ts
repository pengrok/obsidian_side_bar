import { describe, expect, it } from "vitest";
import { buildPath, renderPattern, sanitize, withSuffix, validateCommentFolder, MAX_FILE_NAME } from "../src/store/fileNaming";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";

const vars = (quote: string) => ({ source: "논문정리", quote, id: "a1b2c3", date: "2026-11-24", time: "111000" });

describe("T6 sanitize·renderPattern", () => {
	it("금지 문자 → 공백, 연속 공백 하나, 끝 마침표 제거", () => {
		expect(sanitize('a/b:c*?"<>|\n#^[]d')).toBe("a b c d");
		expect(sanitize("  끝에 마침표... ")).toBe("끝에 마침표");
		expect(sanitize("a\\b")).toBe("a b");
	});
	it("기본 패턴", () => {
		expect(renderPattern("{{source}} - {{quote}} - {{id}}", vars("셀프 어텐션만으로 시퀀스를 처리한다"))).toBe(
			"논문정리 - 셀프 어텐션만으로 시퀀스를 처리한다 - a1b2c3",
		);
	});
	it("{{quote}}는 앞 30자", () => {
		const q = "가".repeat(50);
		const name = renderPattern("{{quote}} {{id}}", vars(q));
		expect(name).toBe("가".repeat(30) + " a1b2c3");
	});
	it("금지 문자가 들어간 문구", () => {
		const name = renderPattern("{{source}} - {{quote}} - {{id}}", vars('a/b:c*?"<>|\n#^[]'));
		expect(name).toBe("논문정리 - a b c - a1b2c3");
		expect(name).not.toMatch(/[\\/:*?"<>|#^[\]]/);
	});
	it("200자 문구·긴 노트 이름도 확장자 포함 120자 이내, ID 유지", () => {
		const name = renderPattern("{{source}} - {{quote}} - {{id}}", {
			...vars("나".repeat(200)),
			source: "아주 긴 노트 이름 ".repeat(15),
		});
		expect(Array.from(name + ".md").length).toBeLessThanOrEqual(MAX_FILE_NAME);
		expect(name.endsWith("a1b2c3")).toBe(true);
	});
	it("date·time 치환자", () => {
		expect(renderPattern("{{date}} {{time}} {{id}}", vars("x"))).toBe("2026-11-24 111000 a1b2c3");
	});
});

describe("T7 buildPath", () => {
	const now = new Date(2026, 10, 24, 11, 10, 0);
	it("하위 폴더 켬", () => {
		expect(buildPath({ ...DEFAULT_SETTINGS, subfolderPerNote: true }, "샘플", "문구", "a1b2c3", now)).toBe(
			"Annotations/샘플/샘플 - 문구 - a1b2c3.md",
		);
	});
	it("하위 폴더 끔", () => {
		expect(buildPath({ ...DEFAULT_SETTINGS, subfolderPerNote: false }, "샘플", "문구", "a1b2c3", now)).toBe(
			"Annotations/샘플 - 문구 - a1b2c3.md",
		);
	});
	it("폴더 경로 정규화", () => {
		expect(
			buildPath({ ...DEFAULT_SETTINGS, commentFolder: "/메모//코멘트/", subfolderPerNote: false }, "a", "b", "c1c1c1", now),
		).toBe("메모/코멘트/a - b - c1c1c1.md");
	});
	it("withSuffix", () => {
		expect(withSuffix("A/b.md", 2)).toBe("A/b (2).md");
	});
	it("validateCommentFolder", () => {
		expect(validateCommentFolder("")).not.toBeNull();
		expect(validateCommentFolder("/")).not.toBeNull();
		expect(validateCommentFolder(".obsidian/x")).not.toBeNull();
		expect(validateCommentFolder("Annotations")).toBeNull();
	});
});

import { generateId, idFromProp, isValidId } from "../src/utils/id";
import { buildCommentFile } from "../src/store/frontmatter";
import { parseYaml } from "obsidian";

describe("앵커 ID (3.1절, E17)", () => {
	it("형식은 [a-z0-9]{6}, 첫 글자는 영문자", () => {
		for (let i = 0; i < 2000; i++) {
			const id = generateId();
			expect(isValidId(id)).toBe(true);
			expect(id[0]).toMatch(/[a-z]/);
		}
	});
	it("이미 있으면 다시 만든다", () => {
		const seen = new Set<string>();
		let calls = 0;
		const id = generateId((x) => {
			calls++;
			if (calls < 3) {
				seen.add(x);
				return true;
			}
			return false;
		});
		expect(calls).toBe(3);
		expect(seen.has(id)).toBe(false);
	});
	it("YAML이 숫자로 읽은 mn-id도 받아 준다", () => {
		expect(idFromProp(123)).toBe("000123");
		expect(idFromProp("a1b2c3")).toBe("a1b2c3");
		expect(idFromProp("ABCDEF")).toBeNull();
		expect(idFromProp(Infinity)).toBeNull();
	});
	it("숫자로 시작하는 ID는 따옴표로 써서 문자열로 남긴다", () => {
		const text = buildCommentFile({ id: "123456", sourceLink: "[[a]]", sourcePath: "a.md", quote: "q", color: "yellow", created: "x" }, "");
		const fm = parseYaml(text.split("---\n")[1]);
		expect(fm["mn-id"]).toBe("123456");
	});
});
