import { describe, expect, it } from "vitest";
import { applyFilters, groupItems, matches, parseQuery, sortItems } from "../src/ui/search";
import { DEFAULT_SETTINGS } from "../src/settingsDefaults";
import type { Annotation, SidebarItem } from "../src/types";

const colors = DEFAULT_SETTINGS.colors;

function item(p: {
	quote: string;
	body?: string | null;
	tags?: string[];
	color?: string;
	note?: string;
	status?: SidebarItem["status"];
	from?: number;
	created?: string;
	heading?: string | null;
}): SidebarItem {
	const note = p.note ?? "논문정리.md";
	const status = p.status ?? "linked";
	const ann: Annotation | null =
		status === "plain"
			? null
			: ({
					id: "aaaaaa",
					file: {} as never,
					sourcePath: note,
					quote: p.quote,
					color: p.color ?? "yellow",
					created: p.created ?? "2026-11-24T11:10:00+09:00",
					updated: p.created ?? "2026-11-24T11:10:00+09:00",
					tags: p.tags ?? [],
					body: p.body === undefined ? "" : p.body,
				} as Annotation);
	return {
		key: Math.random().toString(),
		status,
		notePath: note,
		annotation: ann,
		highlight:
			status === "orphan"
				? null
				: {
						filePath: note,
						line: 0,
						from: p.from ?? 0,
						to: 0,
						textFrom: 0,
						textTo: 0,
						text: p.quote,
						id: null,
						heading: p.heading ?? null,
						order: 0,
					},
	};
}

describe("T8 parseQuery·matches", () => {
	const q = parseQuery('어텐션 -RNN #개념 color:노랑 "셀프 어텐션"');
	it("파싱", () => {
		expect(q.words).toEqual(["어텐션"]);
		expect(q.excludes).toEqual(["rnn"]);
		expect(q.tags).toEqual(["개념"]);
		expect(q.colors).toEqual(["노랑"]);
		expect(q.phrases).toEqual(["셀프 어텐션"]);
	});

	const base = { quote: "셀프 어텐션만으로 처리", body: "좋은 설명", tags: ["개념"], color: "yellow" };
	const cases: [string, Parameters<typeof item>[0], boolean][] = [
		["모든 조건 만족", base, true],
		["단어 없음", { ...base, quote: "셀프 처리", body: "" }, false],
		["제외어 포함", { ...base, body: "RNN과 비교" }, false],
		["태그 없음", { ...base, tags: [] }, false],
		["하위 태그도 찾음", { ...base, tags: ["개념/수학"] }, true],
		["비슷한 다른 태그는 아님", { ...base, tags: ["개념들"] }, false],
		["색이 다름", { ...base, color: "blue" }, false],
		["구절이 떨어져 있음", { ...base, quote: "셀프 처리 어텐션" }, false],
	];
	it.each(cases)("%s", (_name, p, expected) => {
		expect(matches(item(p), q, colors)).toBe(expected);
	});

	it("color:는 key·이름 모두", () => {
		expect(matches(item({ ...base }), parseQuery("color:yellow"), colors)).toBe(true);
		expect(matches(item({ ...base }), parseQuery("color:노랑"), colors)).toBe(true);
	});
	it("note:", () => {
		expect(matches(item({ ...base, note: "폴더/독서노트.md" }), parseQuery("note:독서"), colors)).toBe(true);
		expect(matches(item({ ...base }), parseQuery("note:독서"), colors)).toBe(false);
	});
	it("is: 상태", () => {
		expect(matches(item({ quote: "a", status: "orphan" }), parseQuery("is:orphan"), colors)).toBe(true);
		expect(matches(item({ quote: "a", status: "plain" }), parseQuery("is:plain"), colors)).toBe(true);
		expect(matches(item({ quote: "a", body: "x" }), parseQuery("is:commented"), colors)).toBe(true);
		expect(matches(item({ quote: "a", body: "" }), parseQuery("is:commented"), colors)).toBe(false);
	});
	it("대소문자 무시", () => {
		expect(matches(item({ quote: "Attention" }), parseQuery("attention"), colors)).toBe(true);
	});
	it("지워진 색은 기본색으로 본다", () => {
		expect(matches(item({ quote: "a", color: "c9" }), parseQuery("color:yellow"), colors, "yellow")).toBe(true);
	});
});

describe("필터·정렬·묶기", () => {
	const a = item({ quote: "다", from: 30, created: "2026-11-20T00:00:00+09:00", heading: "본론", color: "blue" });
	const b = item({ quote: "가", from: 10, created: "2026-11-24T00:00:00+09:00", heading: "서론" });
	const o = item({ quote: "나", status: "orphan", created: "2026-11-25T00:00:00+09:00" });
	const p = item({ quote: "라", status: "plain", from: 20, heading: "서론" });

	it("본문 순서: 오프셋 순, 고아는 끝", () => {
		expect(sortItems([o, a, b, p], "position", "current").map((i) => i.highlight?.text ?? "orphan")).toEqual([
			"가",
			"라",
			"다",
			"orphan",
		]);
	});
	it("만든 날짜: 최신 위, 일반 하이라이트는 아래, 고아는 끝", () => {
		expect(sortItems([p, a, b, o], "created", "current").map((i) => i.annotation?.quote ?? "plain")).toEqual([
			"가",
			"다",
			"plain",
			"나",
		]);
	});
	it("가나다", () => {
		expect(sortItems([a, p, b], "alpha", "current").map((i) => i.highlight?.text)).toEqual(["가", "다", "라"]);
	});
	it("전체 탭 본문 순서는 노트 경로 → 오프셋", () => {
		const x = item({ quote: "x", note: "b.md", from: 1 });
		const y = item({ quote: "y", note: "a.md", from: 99 });
		expect(sortItems([x, y], "position", "all").map((i) => i.highlight?.text)).toEqual(["y", "x"]);
	});
	it("색으로 묶기", () => {
		const g = groupItems([a, b], "color", colors, "yellow");
		expect(g.map((x) => [x.label, x.items.length])).toEqual([
			["파랑", 1],
			["노랑", 1],
		]);
	});
	it("제목으로 묶기", () => {
		const g = groupItems(sortItems([a, b, p, o], "position", "current"), "heading", colors, "yellow");
		expect(g.map((x) => x.label)).toEqual(["서론", "본론", "원문 없음"]);
	});
	it("작성일로 묶기는 최신이 위", () => {
		const g = groupItems([a, b, p], "date", colors, "yellow");
		expect(g.map((x) => x.label)).toEqual(["2026-11-24", "2026-11-20", "날짜 없음"]);
	});
	it("applyFilters: 색·상태 필터", () => {
		const opts = { query: parseQuery(""), colorFilter: ["blue"], statusFilter: [], colors, defaultColor: "yellow" };
		expect(applyFilters([a, b, p], opts)).toEqual([a]);
		expect(applyFilters([a, b, p, o], { ...opts, colorFilter: [], statusFilter: ["orphan"] })).toEqual([o]);
	});
});
