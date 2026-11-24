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
