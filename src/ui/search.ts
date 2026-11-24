/** 검색어 파싱·필터·묶기·정렬 (7.3절, 7.4절). 모두 순수 함수 */
import type { FilterStatus, GroupBy, HighlightColor, SidebarItem, SortBy, TabId } from "../types";
import { isoDatePart, isoToTime } from "../utils/time";

export interface Query {
	words: string[];
	phrases: string[];
	excludes: string[];
	tags: string[];
	colors: string[];
	notes: string[];
	statuses: FilterStatus[];
}

const STATUS_ALIASES: Record<string, FilterStatus> = {
	orphan: "orphan",
	plain: "plain",
	commented: "commented",
};

/** 색 key별 한국어·영어 별칭 (color:노랑 처럼 쓸 수 있게) */
const COLOR_ALIASES: Record<string, string[]> = {
	yellow: ["노랑", "노란", "노란색", "노랑색"],
	green: ["초록", "초록색", "녹색"],
	blue: ["파랑", "파란", "파란색", "파랑색"],
	red: ["빨강", "빨간", "빨간색", "빨강색"],
	purple: ["보라", "보라색"],
};

export function emptyQuery(): Query {
	return { words: [], phrases: [], excludes: [], tags: [], colors: [], notes: [], statuses: [] };
}

export function isEmptyQuery(q: Query): boolean {
	return (Object.values(q) as unknown[][]).every((a) => a.length === 0);
}

/** 본문을 읽어야 판단할 수 있는 조건이 있는지 (단어·구절·제외·상태 commented/plain) */
export function queryNeedsBody(q: Query): boolean {
	return (
		q.words.length > 0 ||
		q.phrases.length > 0 ||
		q.excludes.length > 0 ||
		q.statuses.some((s) => s === "commented" || s === "plain")
	);
}

export function parseQuery(input: string): Query {
	const q = emptyQuery();
	const re = /(-?)"([^"]*)"?|(\S+)/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(input)) !== null) {
		if (m[2] !== undefined) {
			const phrase = m[2].trim().toLowerCase();
			if (!phrase) continue;
			(m[1] ? q.excludes : q.phrases).push(phrase);
			continue;
		}
		const tok = m[3];
		const lower = tok.toLowerCase();
		if (lower.startsWith("-") && lower.length > 1) {
			q.excludes.push(lower.slice(1));
		} else if (lower.startsWith("#") && lower.length > 1) {
			q.tags.push(lower.slice(1));
		} else if (lower.startsWith("color:") && lower.length > 6) {
			q.colors.push(lower.slice(6));
		} else if (lower.startsWith("note:") && lower.length > 5) {
			q.notes.push(lower.slice(5));
		} else if (lower.startsWith("is:") && STATUS_ALIASES[lower.slice(3)]) {
			q.statuses.push(STATUS_ALIASES[lower.slice(3)]);
		} else if (lower !== "-") {
			q.words.push(lower);
		}
	}
	return q;
}

export function basename(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.md$/i, "");
}

export function dirname(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? "/" : path.slice(0, i);
}

export function itemQuote(item: SidebarItem): string {
	return item.highlight?.text ?? item.annotation?.quote ?? "";
}

/** 필터용 상태: 원문 없음 / 코멘트 있음 / 코멘트 없음 */
export function filterStatusOf(item: SidebarItem): FilterStatus {
	if (item.status === "orphan") return "orphan";
	const body = item.annotation?.body;
	if (item.annotation && body !== null && body !== undefined && body.trim() !== "") return "commented";
	// 본문을 아직 안 읽었으면 코멘트가 있다고 본다(파일이 있으므로)
	if (item.annotation && (body === null || body === undefined)) return "commented";
	return "plain";
}

/** 표시할 색 key. 지워진 색이면 기본색 */
export function colorKeyOf(item: SidebarItem, colors: HighlightColor[], defaultColor: string): string {
	const k = item.annotation?.color;
	if (k && colors.some((c) => c.key === k)) return k;
	return colors.some((c) => c.key === defaultColor) ? defaultColor : colors[0]?.key ?? "yellow";
}

function colorMatches(want: string, key: string, colors: HighlightColor[]): boolean {
	const c = colors.find((x) => x.key === key);
	if (key.toLowerCase() === want) return true;
	if (c && c.name.toLowerCase() === want) return true;
	if (c && c.color.toLowerCase() === want) return true;
	return (COLOR_ALIASES[key] ?? []).includes(want);
}

export function matches(
	item: SidebarItem,
	q: Query,
	colors: HighlightColor[],
	defaultColor = colors[0]?.key ?? "yellow",
): boolean {
	const note = basename(item.notePath).toLowerCase();
	const hay = [itemQuote(item), item.annotation?.body ?? "", note].join("\n").toLowerCase();

	for (const w of q.words) if (!hay.includes(w)) return false;
	for (const p of q.phrases) if (!hay.includes(p)) return false;
	for (const e of q.excludes) if (hay.includes(e)) return false;

	if (q.tags.length) {
		const tags = (item.annotation?.tags ?? []).map((t) => t.toLowerCase());
		for (const t of q.tags) {
			if (!tags.some((x) => x === t || x.startsWith(t + "/"))) return false;
		}
	}
	if (q.colors.length) {
		const key = colorKeyOf(item, colors, defaultColor);
		if (!q.colors.some((c) => colorMatches(c, key, colors))) return false;
	}
	for (const n of q.notes) if (!note.includes(n)) return false;
	if (q.statuses.length && !q.statuses.includes(filterStatusOf(item))) return false;
	return true;
}

/** 필터 메뉴(색·상태)와 검색어를 함께 적용 */
export function applyFilters(
	items: SidebarItem[],
	opts: { query: Query; colorFilter: string[]; statusFilter: FilterStatus[]; colors: HighlightColor[]; defaultColor: string },
): SidebarItem[] {
	return items.filter((it) => {
		if (opts.colorFilter.length && !opts.colorFilter.includes(colorKeyOf(it, opts.colors, opts.defaultColor))) return false;
		if (opts.statusFilter.length && !opts.statusFilter.includes(filterStatusOf(it))) return false;
		return matches(it, opts.query, opts.colors, opts.defaultColor);
	});
}

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });

export function sortItems(items: SidebarItem[], sortBy: SortBy, tab: TabId): SidebarItem[] {
	const arr = items.slice();
	const orphanLast = (a: SidebarItem, b: SidebarItem) =>
		Number(a.status === "orphan") - Number(b.status === "orphan");
	const byPosition = (a: SidebarItem, b: SidebarItem) => {
		if (tab === "all") {
			const c = collator.compare(a.notePath, b.notePath);
			if (c !== 0) return c;
		}
		const o = orphanLast(a, b);
		if (o !== 0) return o;
		const pa = a.highlight?.from ?? Number.MAX_SAFE_INTEGER;
		const pb = b.highlight?.from ?? Number.MAX_SAFE_INTEGER;
		if (pa !== pb) return pa - pb;
		return collator.compare(a.annotation?.created ?? "", b.annotation?.created ?? "");
	};
	const byDate = (field: "created" | "updated") => (a: SidebarItem, b: SidebarItem) => {
		const ta = isoToTime(a.annotation?.[field]);
		const tb = isoToTime(b.annotation?.[field]);
		const na = isNaN(ta);
		const nb = isNaN(tb);
		if (na !== nb) return na ? 1 : -1;
		if (!na && ta !== tb) return tb - ta;
		return byPosition(a, b);
	};

	switch (sortBy) {
		case "position":
			if (tab === "all") {
				// 노트 경로 → 오프셋, 고아는 전체의 맨 끝
				arr.sort((a, b) => orphanLast(a, b) || byPosition(a, b));
			} else arr.sort(byPosition);
			break;
		case "created":
			arr.sort((a, b) => orphanLast(a, b) || byDate("created")(a, b));
			break;
		case "updated":
			arr.sort((a, b) => orphanLast(a, b) || byDate("updated")(a, b));
			break;
		case "alpha":
			arr.sort((a, b) => orphanLast(a, b) || collator.compare(itemQuote(a), itemQuote(b)) || byPosition(a, b));
			break;
	}
	return arr;
}

export interface Group {
	key: string;
	label: string;
	items: SidebarItem[];
}

export function groupItems(
	items: SidebarItem[],
	groupBy: GroupBy,
	colors: HighlightColor[],
	defaultColor: string,
): Group[] {
	if (groupBy === "none") return [{ key: "", label: "", items }];
	const map = new Map<string, Group>();
	for (const it of items) {
		let key: string;
		let label: string;
		switch (groupBy) {
			case "color": {
				key = colorKeyOf(it, colors, defaultColor);
				label = colors.find((c) => c.key === key)?.name ?? key;
				break;
			}
			case "heading":
				key = it.highlight?.heading ?? "";
				label = key || "(제목 없음)";
				if (it.status === "orphan") {
					key = "\u0000orphan";
					label = "원문 없음";
				}
				break;
			case "note":
				key = it.notePath;
				label = basename(it.notePath);
				break;
			case "folder":
				key = dirname(it.notePath);
				label = key;
				break;
			case "date":
				key = isoDatePart(it.annotation?.created) || "";
				label = key || "날짜 없음";
				break;
		}
		const fullKey = `${groupBy}:${key}`;
		let g = map.get(fullKey);
		if (!g) {
			g = { key: fullKey, label, items: [] };
			map.set(fullKey, g);
		}
		g.items.push(it);
	}
	const groups = [...map.values()];
	if (groupBy === "date") {
		groups.sort((a, b) => {
			const ea = a.label === "날짜 없음";
			const eb = b.label === "날짜 없음";
			if (ea !== eb) return ea ? 1 : -1;
			return b.key.localeCompare(a.key);
		});
	}
	return groups;
}
