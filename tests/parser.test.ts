import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { parseHighlights, resolveAnchor, highlightAt, plainOrdinal, findPlainByOrdinal } from "../src/parser/highlightParser";
import { analyzeLines, maskInlineCode, MASK_CHAR, rangeTouchesExcluded } from "../src/parser/mask";

const sample = readFileSync(new URL("./fixtures/sample.md", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("T1 parseHighlights — 샘플 노트", () => {
	const hls = parseHighlights(sample, "테스트/샘플.md", null);
	it("하이라이트 7개", () => {
		expect(hls.map((h) => h.text)).toEqual([
			"일반 하이라이트",
			"첫 번째 문장",
			"두 번째 문장",
			"반복",
			"반복",
			"인용 하이라이트",
			"표 안 하이라이트",
		]);
	});
	it("ID", () => {
		expect(hls.map((h) => h.id)).toEqual([null, "aaaaaa", "bbbbbb", null, null, null, null]);
	});
	it("코드·인라인 코드·주석·frontmatter 안은 0개", () => {
		const texts = hls.map((h) => h.text);
		for (const t of ["무시", "코드 안", "주석 안", "테스트"]) expect(texts).not.toContain(t);
	});
});

describe("T2 heading·order", () => {
	const hls = parseHighlights(sample, "a.md", null);
	it("heading", () => {
		expect(hls.map((h) => h.heading)).toEqual(["서론", "서론", "서론", "본론", "본론", "본론", "본론"]);
	});
	it("order", () => {
		expect(hls.map((h) => h.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
	});
});

function checkOffsets(text: string) {
	const hls = parseHighlights(text, "a.md", null);
	for (const h of hls) {
		expect(text.slice(h.textFrom, h.textTo)).toBe(h.text);
		const whole = text.slice(h.from, h.to);
		expect(whole.startsWith("==")).toBe(true);
		if (h.id) {
			expect(whole.endsWith("%%")).toBe(true);
			expect(whole).toBe(`==${h.text}==%%mn:${h.id}%%`);
		} else expect(whole).toBe(`==${h.text}==`);
	}
	return hls;
}

describe("T3 오프셋", () => {
	it("text.slice(textFrom, textTo) === text, from~to 형식", () => {
		checkOffsets(sample);
	});
	it("line 번호", () => {
		const hls = parseHighlights(sample, "a.md");
		const lines = sample.split("\n");
		for (const h of hls) expect(lines[h.line]).toContain(`==${h.text}==`);
	});
});

describe("T4 \\r\\n 줄바꿈", () => {
	const crlf = sample.replace(/\n/g, "\r\n");
	it("T1·T3과 같은 결과", () => {
		const a = parseHighlights(sample, "a.md").map((h) => [h.text, h.id, h.heading, h.line]);
		const b = checkOffsets(crlf).map((h) => [h.text, h.id, h.heading, h.line]);
		expect(b).toEqual(a);
	});
});

describe("T5 인식하지 않는 경우", () => {
	it.each([["== 앞공백=="], ["===="], ["==줄\n넘김=="], ["==뒤공백 =="]])("%s → 0개", (t) => {
		expect(parseHighlights(t, "a.md")).toHaveLength(0);
	});
	it("앞공백 다음에 정상 하이라이트가 이어져도 정상 것은 잡는다", () => {
		const hls = parseHighlights("== 앞공백== 그리고 ==정상==", "a.md");
		expect(hls.map((h) => h.text)).toEqual(["정상"]);
	});
});

describe("마스킹 세부", () => {
	it("maskInlineCode는 길이를 유지한다", () => {
		const line = "a `==x==` b ``c ` d`` e";
		const m = maskInlineCode(line);
		expect(m.length).toBe(line.length);
		expect(m.includes("==")).toBe(false);
		expect(m.startsWith("a ")).toBe(true);
		expect(m.endsWith(" e")).toBe(true);
	});
	it("닫히지 않은 백틱은 그대로", () => {
		expect(maskInlineCode("a `b ==c==")).toBe("a `b ==c==");
	});
	it("한 줄 %% 주석 안은 제외, 앵커는 주석이 아니다", () => {
		const t = "앞 %%숨김 ==x==%% 뒤 ==y==%%mn:abc123%% 끝 ==z==";
		const hls = parseHighlights(t, "a.md");
		expect(hls.map((h) => [h.text, h.id])).toEqual([
			["y", "abc123"],
			["z", null],
		]);
	});
	it("주석 안의 앵커 문법은 하이라이트가 아니다", () => {
		const t = "%%\n==x==%%mn:abc123%%\n%%\n==ok==";
		// 주석 블록 안 두 번째 줄의 %%mn:…%% 는 앵커로 보존되지만 주석 내부라 가려진다
		const hls = parseHighlights(t, "a.md");
		expect(hls.map((h) => h.text)).toEqual(["ok"]);
	});
	it("~~~ 펜스, $$ 수식 블록, 인용 안 펜스", () => {
		const t = ["~~~", "==a==", "~~~", "$$", "==b==", "$$", "> ```", "> ==c==", "> ```", "$$ ==d== $$", "==e=="].join("\n");
		expect(parseHighlights(t, "a.md").map((h) => h.text)).toEqual(["e"]);
	});
	it("닫히지 않은 frontmatter는 frontmatter가 아니다", () => {
		const t = "---\n==a==";
		expect(parseHighlights(t, "a.md").map((h) => h.text)).toEqual(["a"]);
	});
	it("rangeTouchesExcluded", () => {
		const t = "abc `code` ==x==\n```\nzz\n```";
		const lines = analyzeLines(t);
		expect(lines[0].masked.includes(MASK_CHAR)).toBe(true);
		expect(rangeTouchesExcluded(lines, 5, 8)).toBe(true); // code 안
		expect(rangeTouchesExcluded(lines, 0, 3)).toBe(false);
		const zz = t.indexOf("zz");
		expect(rangeTouchesExcluded(lines, zz, zz + 2)).toBe(true);
	});
	it("제목 안의 하이라이트·앵커는 제목 문구에서 빠진다", () => {
		const t = "# 제목 ==강조==%%mn:abc123%%\n본문 ==a==";
		const hls = parseHighlights(t, "a.md");
		expect(hls[1].heading).toBe("제목 강조");
	});
});

describe("resolveAnchor 외", () => {
	const hls = parseHighlights("==a==%%mn:aaaaaa%% 사이 ==b== ==a==%%mn:aaaaaa%% ==b==", "x.md");
	it("ID로 찾고, 중복이면 첫 번째", () => {
		expect(resolveAnchor({ id: "aaaaaa" }, hls)).toBe(hls[0]);
		expect(resolveAnchor({ id: "zzzzzz" }, hls)).toBeNull();
	});
	it("highlightAt", () => {
		expect(highlightAt(hls, 1)).toBe(hls[0]);
		expect(highlightAt(hls, hls[0].to)).toBe(hls[0]);
		expect(highlightAt(hls, hls[0].to + 2)).toBeNull();
	});
	it("plainOrdinal / findPlainByOrdinal", () => {
		const second = hls[3];
		const n = plainOrdinal(hls, second);
		expect(n).toBe(1);
		expect(findPlainByOrdinal(hls, "b", n)).toBe(second);
	});
});
