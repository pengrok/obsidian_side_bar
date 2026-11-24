import type { CachedMetadata } from "obsidian";
import type { Annotation, Highlight } from "../types";
import { analyzeLines, type LineInfo } from "./mask";

/** 3.1절 인식 정규식 (한 줄 단위). group 1 = 문구, group 2 = 앵커 ID */
export const HIGHLIGHT_RE = /==(?!=)([^\n]+?)==(?:%%mn:([a-z0-9]{6})%%)?/g;

/**
 * 노트 텍스트 → Highlight[] (순수 함수).
 *
 * 제외 구간은 텍스트를 직접 훑어 구한다(mask.ts). 메타데이터 캐시는 디스크 기준이라
 * 편집기의 최신 텍스트와 어긋날 수 있어 쓰지 않는다. cache 인자는 시그니처 호환용이다.
 */
export function parseHighlights(text: string, filePath: string, _cache?: CachedMetadata | null): Highlight[] {
	return parseLines(analyzeLines(text), filePath);
}

export function parseLines(lines: LineInfo[], filePath: string): Highlight[] {
	const out: Highlight[] = [];
	let heading: string | null = null;
	for (const l of lines) {
		if (l.heading !== null) heading = l.heading;
		if (l.excluded || !l.masked.includes("==")) continue;
		HIGHLIGHT_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = HIGHLIGHT_RE.exec(l.masked)) !== null) {
			const textStart = m.index + 2;
			const quote = l.text.slice(textStart, textStart + m[1].length);
			// 옵시디언은 공백으로 시작·끝나는 ==…==를 하이라이트로 그리지 않는다
			if (/^\s|\s$/.test(quote)) {
				// 닫는 == 를 다음 하이라이트의 여는 == 로 다시 쓸 수 있게 한 칸만 전진
				HIGHLIGHT_RE.lastIndex = m.index + 1;
				continue;
			}
			out.push({
				filePath,
				line: l.line,
				from: l.start + m.index,
				to: l.start + m.index + m[0].length,
				textFrom: l.start + textStart,
				textTo: l.start + textStart + quote.length,
				text: quote,
				id: m[2] ?? null,
				heading,
				order: out.length,
			});
		}
	}
	return out;
}

/**
 * 코멘트 파일 → 노트 안 하이라이트 (D4 기본안: 앵커 ID로 찾기).
 * 같은 ID가 여러 번 나오면 첫 번째를 연결한다(E4).
 */
export function resolveAnchor(annotation: Pick<Annotation, "id">, highlights: Highlight[]): Highlight | null {
	return highlights.find((h) => h.id === annotation.id) ?? null;
}

/** offset이 하이라이트 구간(여는 == ~ 앵커 끝) 안에 있으면 그 하이라이트 */
export function highlightAt(highlights: Highlight[], offset: number): Highlight | null {
	return highlights.find((h) => offset >= h.from && offset <= h.to) ?? null;
}

/** 같은 문구의 일반 하이라이트 중 몇 번째인지 (본문 이동·제거 때 위치를 다시 찾는 용도) */
export function plainOrdinal(highlights: Highlight[], hl: Highlight): number {
	let n = 0;
	for (const h of highlights) {
		if (h === hl || (h.from === hl.from && h.text === hl.text)) return n;
		if (h.id === null && h.text === hl.text) n++;
	}
	return -1;
}

/** plainOrdinal의 역: 문구와 순번으로 일반 하이라이트를 다시 찾는다 */
export function findPlainByOrdinal(highlights: Highlight[], text: string, ordinal: number): Highlight | null {
	let n = 0;
	for (const h of highlights) {
		if (h.id === null && h.text === text) {
			if (n === ordinal) return h;
			n++;
		}
	}
	return null;
}
