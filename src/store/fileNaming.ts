import type { MarginNotesSettings } from "../types";
import { formatDate, formatTime } from "../utils/time";

/** 확장자를 포함한 파일 이름 최대 길이 (3.3절) */
export const MAX_FILE_NAME = 120;
export const QUOTE_CHARS = 30;
const EXT = ".md";

const FORBIDDEN_RE = /[\\/:*?"<>|#^[\]\r\n]/g;

/** 3.3절: 금지 문자 → 공백, 연속 공백 하나로, 앞뒤 공백·끝 마침표 제거 */
export function sanitize(name: string): string {
	let s = name.replace(FORBIDDEN_RE, " ").replace(/\s+/g, " ").trim();
	s = s.replace(/\.+$/, "").trim();
	return s;
}

/** 문자 단위(코드 포인트) 자르기 — 이모지·한글이 깨지지 않게 */
function cut(s: string, n: number): string {
	const arr = Array.from(s);
	return arr.length <= n ? s : arr.slice(0, Math.max(0, n)).join("");
}
const len = (s: string) => Array.from(s).length;

export function patternHasId(pattern: string): boolean {
	return pattern.includes("{{id}}");
}

/**
 * 파일 이름 패턴을 채운다(확장자 제외). 확장자 포함 120자를 넘으면 {{quote}} 부분부터 줄인다.
 */
export function renderPattern(
	pattern: string,
	vars: { source: string; quote: string; id: string; date: string; time: string },
): string {
	const v = {
		source: sanitize(vars.source),
		quote: cut(sanitize(vars.quote), QUOTE_CHARS).trim(),
		id: sanitize(vars.id),
		date: sanitize(vars.date),
		time: sanitize(vars.time),
	};
	const fillWith = (quote: string) =>
		sanitize(
			pattern.replace(/\{\{(source|quote|id|date|time)\}\}/g, (_m, k: keyof typeof v) =>
				k === "quote" ? quote : v[k],
			),
		);

	const limit = MAX_FILE_NAME - EXT.length;
	let name = fillWith(v.quote);
	if (len(name) > limit) {
		const without = len(fillWith(""));
		const room = limit - without;
		name = fillWith(room > 0 ? cut(v.quote, room).trim() : "");
	}
	if (len(name) > limit) {
		// {{quote}}를 다 줄여도 길면, ID가 남도록 앞부분을 자른다
		const idPart = v.id && name.endsWith(v.id) ? v.id : "";
		name = idPart ? cut(name, limit - len(idPart) - 3).trim() + " - " + idPart : cut(name, limit);
		name = sanitize(name);
	}
	return name || v.id || "comment";
}

/** 보관함 경로 정규화 (옵시디언 normalizePath와 같은 규칙의 순수 버전) */
export function normalizeFolder(p: string): string {
	return p
		.replace(/\\/g, "/")
		.replace(/\/+/g, "/")
		.replace(/^\/+|\/+$/g, "")
		.trim();
}

/** 코멘트 파일이 들어갈 폴더 */
export function folderFor(settings: Pick<MarginNotesSettings, "commentFolder" | "subfolderPerNote">, sourceBasename: string): string {
	const root = normalizeFolder(settings.commentFolder);
	if (!settings.subfolderPerNote) return root;
	const sub = sanitize(sourceBasename) || "untitled";
	return root ? `${root}/${sub}` : sub;
}

/** 폴더 + 파일 이름 + '.md' */
export function buildPath(
	settings: MarginNotesSettings,
	sourceBasename: string,
	quote: string,
	id: string,
	now: Date,
): string {
	const name = renderPattern(settings.fileNamePattern, {
		source: sourceBasename,
		quote,
		id,
		date: formatDate(now),
		time: formatTime(now),
	});
	const folder = folderFor(settings, sourceBasename);
	return (folder ? `${folder}/` : "") + name + EXT;
}

/** 'a/b/c.md' → 'a/b/c (2).md' */
export function withSuffix(path: string, n: number): string {
	const dot = path.toLowerCase().endsWith(EXT) ? path.length - EXT.length : path.length;
	return `${path.slice(0, dot)} (${n})${path.slice(dot)}`;
}

/** 코멘트 폴더 설정값 검증. 문제가 있으면 안내 문구 */
export function validateCommentFolder(p: string, configDir: string): string | null {
	const n = normalizeFolder(p);
	if (!n) return "코멘트 폴더를 입력하세요. 보관함 루트는 쓸 수 없어요.";
	if (n === configDir || n.startsWith(configDir + "/")) return `${configDir} 폴더 안에는 둘 수 없어요.`;
	if (n.split("/").some((seg) => seg === "." || seg === "..")) return "'.'나 '..'는 쓸 수 없어요.";
	return null;
}
