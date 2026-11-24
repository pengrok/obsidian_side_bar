/** 코멘트 파일의 frontmatter·본문 처리 (순수 함수) */

export const PROP = {
	id: "mn-id",
	source: "mn-source",
	sourcePath: "mn-source-path",
	quote: "mn-quote",
	color: "mn-color",
	created: "mn-created",
	updated: "mn-updated",
	detached: "mn-detached",
	tags: "tags",
} as const;

/** YAML 큰따옴표 문자열. 큰따옴표·역슬래시·줄바꿈을 이스케이프한다 */
export function yamlString(s: string): string {
	return (
		'"' +
		s
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\r/g, "\\r")
			.replace(/\n/g, "\\n")
			.replace(/\t/g, "\\t") +
		'"'
	);
}

/**
 * frontmatter와 본문을 나눈다.
 * head = 여는 --- 부터 닫는 --- 줄의 줄바꿈까지 (없으면 ''), body = 그 뒤 전부.
 */
export function splitFrontmatter(text: string): { head: string; body: string } {
	const m = /^---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
	if (!m) return { head: "", body: text };
	return { head: m[0], body: text.slice(m[0].length) };
}

export interface NewCommentProps {
	id: string;
	sourceLink: string;
	sourcePath: string;
	quote: string;
	color: string;
	created: string;
	tags?: string[];
}

/** 새 코멘트 파일 내용 (3.2절 형식) */
export function buildCommentFile(p: NewCommentProps, body: string): string {
	const tags = p.tags && p.tags.length ? "\n" + p.tags.map((t) => `  - ${yamlString(t)}`).join("\n") : " []";
	const head = [
		"---",
		`${PROP.id}: ${p.id}`,
		`${PROP.source}: ${yamlString(p.sourceLink)}`,
		`${PROP.sourcePath}: ${yamlString(p.sourcePath)}`,
		`${PROP.quote}: ${yamlString(p.quote)}`,
		`${PROP.color}: ${p.color}`,
		`${PROP.created}: ${p.created}`,
		`${PROP.updated}: ${p.created}`,
		`${PROP.tags}:${tags}`,
		"---",
		"",
	].join("\n");
	return head + body;
}

/** frontmatter의 tags 값을 문자열 배열로 (앞의 # 제거) */
export function normalizeTags(v: unknown): string[] {
	let arr: unknown[] = [];
	if (Array.isArray(v)) arr = v;
	else if (typeof v === "string") arr = v.split(/[,\s]+/);
	return arr
		.filter((t): t is string | number => typeof t === "string" || typeof t === "number")
		.map((t) => String(t).trim().replace(/^#/, ""))
		.filter((t) => t.length > 0);
}

/** YAML이 날짜를 Date로 읽는 경우까지 문자열로 */
export function propString(v: unknown): string {
	if (v === null || v === undefined) return "";
	if (v instanceof Date) return v.toISOString();
	return String(v);
}
