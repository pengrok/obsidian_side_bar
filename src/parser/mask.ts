/**
 * 제외 구간 마스킹 (3.1절).
 *
 * 노트 텍스트를 줄로 나누고, 하이라이트를 찾으면 안 되는 부분을 같은 길이의 마스크 문자로 바꾼다.
 * 오프셋이 그대로 유지되므로, 가린 줄에서 찾은 위치를 원문에 그대로 쓸 수 있다.
 *
 * 가리는 대상: frontmatter, 코드 블록(``` / ~~~), 수식 블록($$), 인라인 코드, %% 주석(한 줄·여러 줄).
 * `%%mn:xxxxxx%%` 앵커는 주석으로 세지 않고 원문대로 둔다.
 */

/** 가린 위치에 쓰는 문자. 공백과 구분하려고 제어 문자를 쓴다. */
export const MASK_CHAR = "\u0001";

export const ANCHOR_RE = /%%mn:([a-z0-9]{6})%%/g;

export interface LineInfo {
	/** 0부터 시작하는 줄 번호 */
	line: number;
	/** 문서 안에서 이 줄이 시작하는 오프셋 */
	start: number;
	/** 원문 (줄바꿈 제외) */
	text: string;
	/** 제외 구간을 MASK_CHAR로 바꾼 줄. 길이는 text와 같다 */
	masked: string;
	/** 줄 전체가 제외 구간 (frontmatter·코드·수식 블록) */
	excluded: boolean;
	/** 이 줄이 제목이면 제목 문구 */
	heading: string | null;
}

/** \n, \r\n 모두 처리해 줄과 시작 오프셋을 돌려준다 */
export function splitLines(text: string): { text: string; start: number }[] {
	const out: { text: string; start: number }[] = [];
	let start = 0;
	const re = /\r?\n/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		out.push({ text: text.slice(start, m.index), start });
		start = m.index + m[0].length;
	}
	out.push({ text: text.slice(start), start });
	return out;
}

const fill = (n: number) => MASK_CHAR.repeat(n);

/**
 * 인라인 코드(`...`, ``...``)를 같은 길이의 마스크 문자로 바꾼다.
 * CommonMark처럼 같은 길이의 백틱 묶음이 나와야 닫힌다. 닫히지 않은 백틱은 그대로 둔다.
 */
export function maskInlineCode(line: string): string {
	if (!line.includes("`")) return line;
	let out = "";
	let i = 0;
	while (i < line.length) {
		if (line[i] !== "`") {
			out += line[i];
			i++;
			continue;
		}
		let run = 0;
		while (line[i + run] === "`") run++;
		// 같은 길이의 닫는 묶음 찾기
		let j = i + run;
		let close = -1;
		while (j < line.length) {
			if (line[j] === "`") {
				let r = 0;
				while (line[j + r] === "`") r++;
				if (r === run) {
					close = j;
					break;
				}
				j += r;
			} else j++;
		}
		if (close === -1) {
			out += line.slice(i, i + run);
			i += run;
		} else {
			out += fill(close + run - i);
			i = close + run;
		}
	}
	return out;
}

/** 줄 앞의 인용 기호(`> `)를 뗀 나머지 */
function stripQuotePrefix(line: string): string {
	return line.replace(/^\s*(?:>\s?)+/, "");
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;

/** 제목 문구에서 하이라이트 표시와 앵커를 뺀 표시용 문구 */
export function cleanHeading(raw: string): string {
	return raw.replace(ANCHOR_RE, "").replace(/==/g, "").trim();
}

/**
 * 노트 전체를 한 번 훑어 줄마다 마스킹 결과를 만든다.
 * 메타데이터 캐시에 의존하지 않으므로 편집기의 최신 텍스트에도 쓸 수 있다.
 */
export function analyzeLines(text: string): LineInfo[] {
	const raw = splitLines(text);
	const out: LineInfo[] = [];

	// frontmatter: 첫 줄이 --- 이고 뒤에 닫는 ---(또는 ...)가 있을 때만
	let fmEnd = -1;
	if (raw.length > 1 && raw[0].text.trimEnd() === "---") {
		for (let i = 1; i < raw.length; i++) {
			const t = raw[i].text.trimEnd();
			if (t === "---" || t === "...") {
				fmEnd = i;
				break;
			}
		}
	}

	let fence: { ch: string; len: number } | null = null;
	let inMath = false;
	let inComment = false;

	for (let i = 0; i < raw.length; i++) {
		const { text: line, start } = raw[i];
		const base: LineInfo = { line: i, start, text: line, masked: line, excluded: false, heading: null };

		if (i <= fmEnd) {
			out.push({ ...base, masked: fill(line.length), excluded: true });
			continue;
		}

		const body = stripQuotePrefix(line);

		if (fence) {
			const m = FENCE_RE.exec(body);
			if (m && m[1][0] === fence.ch && m[1].length >= fence.len && body.slice(m[0].length).trim() === "") {
				fence = null;
			}
			out.push({ ...base, masked: fill(line.length), excluded: true });
			continue;
		}
		if (inMath) {
			if (body.includes("$$")) inMath = false;
			out.push({ ...base, masked: fill(line.length), excluded: true });
			continue;
		}
		if (!inComment) {
			const fm = FENCE_RE.exec(body);
			if (fm) {
				// ``` 펜스의 info 문자열에는 백틱이 올 수 없다
				const info = body.slice(fm[0].length);
				if (!(fm[1][0] === "`" && info.includes("`"))) {
					fence = { ch: fm[1][0], len: fm[1].length };
					out.push({ ...base, masked: fill(line.length), excluded: true });
					continue;
				}
			}
			const trimmed = body.trimStart();
			if (trimmed.startsWith("$$")) {
				if (!trimmed.slice(2).includes("$$")) inMath = true;
				out.push({ ...base, masked: fill(line.length), excluded: true });
				continue;
			}
		}

		// 1) 인라인 코드 가리기
		let work = maskInlineCode(line);
		// 2) 앵커는 주석으로 세지 않도록 잠시 자리표시
		const anchors: { index: number; text: string }[] = [];
		work = work.replace(ANCHOR_RE, (m0, _id, idx: number) => {
			anchors.push({ index: idx, text: m0 });
			return "\u0000".repeat(m0.length);
		});
		// 3) %% 주석 가리기 (줄을 넘어 이어질 수 있음)
		let res = "";
		let k = 0;
		while (k < work.length) {
			if (work[k] === "%" && work[k + 1] === "%") {
				inComment = !inComment;
				res += fill(2);
				k += 2;
				continue;
			}
			res += inComment ? MASK_CHAR : work[k];
			k++;
		}
		// 4) 주석 밖에 남은 앵커를 원래대로
		for (const a of anchors) {
			if (res.charCodeAt(a.index) === 0) {
				res = res.slice(0, a.index) + a.text + res.slice(a.index + a.text.length);
			}
		}

		let heading: string | null = null;
		if (!res.startsWith(MASK_CHAR)) {
			const hm = HEADING_RE.exec(line);
			if (hm && res.trimStart().startsWith("#")) heading = cleanHeading(hm[2]);
		}
		out.push({ ...base, masked: res, heading });
	}
	return out;
}

/** [from, to) 구간에 가린 문자가 하나라도 있거나 제외 줄에 걸치면 true */
export function rangeTouchesExcluded(lines: LineInfo[], from: number, to: number): boolean {
	for (const l of lines) {
		const lEnd = l.start + l.text.length;
		if (lEnd < from || l.start > to) continue;
		if (l.excluded) return true;
		const a = Math.max(from, l.start) - l.start;
		const b = Math.min(to, lEnd) - l.start;
		for (let i = a; i < b; i++) {
			if (l.masked[i] === MASK_CHAR) return true;
		}
	}
	return false;
}
