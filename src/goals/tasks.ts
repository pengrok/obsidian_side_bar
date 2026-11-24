/** 노트 안 체크박스 할 일 (순수 함수) */
import { analyzeLines } from "../parser/mask";

export interface Task {
	/** 0부터 시작하는 줄 번호 */
	line: number;
	/** 들여쓰기 단계 (탭 하나 또는 공백 4칸 = 1단계, 공백 2칸 이상도 1단계로 친다) */
	depth: number;
	done: boolean;
	text: string;
	/** [ ] 안 글자의 문서 오프셋 */
	mark: number;
}

const TASK_RE = /^(\s*)((?:>\s*)*)(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s+(.*))?$/;

function depthOf(ws: string): number {
	const width = ws.replace(/\t/g, "    ").length;
	return width === 0 ? 0 : Math.max(1, Math.floor(width / 4) || 1);
}

/** - [ ] / - [x] 할 일을 찾는다. 코드 블록·수식 블록·frontmatter 안은 뺀다 */
export function parseTasks(text: string): Task[] {
	const out: Task[] = [];
	for (const l of analyzeLines(text)) {
		if (l.excluded) continue;
		const m = TASK_RE.exec(l.text);
		if (!m) continue;
		const markIdx = l.text.indexOf("[", m[1].length + m[2].length) + 1;
		out.push({
			line: l.line,
			depth: depthOf(m[1]),
			done: m[3] !== " ",
			text: (m[4] ?? "").trim(),
			mark: l.start + markIdx,
		});
	}
	return out;
}

export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

/**
 * 할 일 체크 상태를 바꾸는 편집. 그 사이 노트가 바뀌어 같은 줄·같은 글이 아니면 null.
 */
export function toggleEdit(text: string, task: Pick<Task, "line" | "text" | "done">, done: boolean): TextEdit | null {
	const cur = parseTasks(text).find((t) => t.line === task.line && t.text === task.text);
	if (!cur || cur.done === done) return null;
	return { from: cur.mark, to: cur.mark + 1, insert: done ? "x" : " " };
}

/** 노트 끝에 할 일 한 줄을 붙이는 편집 */
export function appendEdit(text: string, taskText: string): TextEdit | null {
	const clean = taskText.replace(/[\r\n]+/g, " ").trim();
	if (!clean) return null;
	const sep = text.length === 0 || text.endsWith("\n") ? "" : "\n";
	return { from: text.length, to: text.length, insert: `${sep}- [ ] ${clean}\n` };
}

export interface Progress {
	done: number;
	total: number;
}

export function progressOf(tasks: Task[]): Progress {
	return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

/** 달성률 0~1. 할 일이 없으면 null */
export function rateOf(p: Progress | null): number | null {
	return p && p.total > 0 ? p.done / p.total : null;
}
