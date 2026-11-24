import { normalizePath, TFile, type App } from "obsidian";
import type { NoteWriter } from "../editor/noteWriter";
import type { AnnotationStore } from "../store/annotationStore";
import { normalizeFolder } from "../store/fileNaming";
import { fileName, PERIODS, shift, startOf, type Period } from "./periods";
import { appendEdit, parseTasks, progressOf, rateOf, toggleEdit, type Progress, type Task } from "./tasks";

export interface GoalsDeps {
	app: App;
	folders: () => Record<Period, string>;
	writer: NoteWriter;
	store: AnnotationStore;
	/** 편집기에 열려 있으면 저장 전 최신 텍스트 */
	getLiveText: (path: string) => string | null;
}

export interface PeriodNote {
	path: string;
	file: TFile | null;
	tasks: Task[];
	progress: Progress;
}

export interface ChartPoint {
	date: Date;
	/** 달성률 0~1, 그 기간 노트·할 일이 없으면 null */
	rate: number | null;
	progress: Progress | null;
}

export interface GoalStats {
	/** 오늘·이번 주·이번 달·올해 */
	current: Record<Period, ChartPoint>;
	/** 최근 30일 (오래된 날부터) */
	days: ChartPoint[];
	/** 최근 12주 (오래된 주부터) */
	weeks: ChartPoint[];
	/** 올해 1~12월 */
	months: ChartPoint[];
	/** 이번 달 일별 노트 합계 */
	monthTotals: { total: number; done: number; avgRate: number | null; daysWithTasks: number };
}

/** 일·주·월·년 노트 (목표 사이드바) */
export class GoalsStore {
	constructor(private deps: GoalsDeps) {}

	private get app() {
		return this.deps.app;
	}

	folderOf(p: Period): string {
		return normalizeFolder(this.deps.folders()[p]);
	}

	pathFor(p: Period, d: Date): string {
		const folder = this.folderOf(p);
		return normalizePath((folder ? `${folder}/` : "") + fileName(p, d) + ".md");
	}

	/** 목표 노트 폴더 안의 파일인가 (사이드바 갱신 판단용) */
	isGoalPath(path: string): boolean {
		return PERIODS.some((p) => {
			const f = this.folderOf(p);
			return f ? path.startsWith(f + "/") : !path.includes("/");
		});
	}

	fileFor(p: Period, d: Date): TFile | null {
		const f = this.app.vault.getAbstractFileByPath(this.pathFor(p, d));
		return f instanceof TFile ? f : null;
	}

	async textOf(file: TFile): Promise<string> {
		return this.deps.getLiveText(file.path) ?? (await this.app.vault.cachedRead(file));
	}

	async read(p: Period, d: Date): Promise<PeriodNote> {
		const path = this.pathFor(p, d);
		const file = this.fileFor(p, d);
		const tasks = file ? parseTasks(await this.textOf(file)) : [];
		return { path, file, tasks, progress: progressOf(tasks) };
	}

	/** 그 기간 노트를 만든다(폴더 포함). 이미 있으면 그 파일 */
	async ensure(p: Period, d: Date): Promise<TFile> {
		const existing = this.fileFor(p, d);
		if (existing) return existing;
		const folder = this.folderOf(p);
		if (folder) await this.deps.store.ensureFolder(folder);
		return this.app.vault.create(this.pathFor(p, d), "");
	}

	/** 체크박스를 바꾼다. 그 사이 노트가 바뀌어 할 일을 못 찾으면 false */
	async setDone(p: Period, d: Date, task: Task, done: boolean): Promise<boolean> {
		const file = this.fileFor(p, d);
		if (!file) return false;
		return this.deps.writer.modify(file, (text) => toggleEdit(text, task, done));
	}

	/** 노트 끝에 할 일을 붙인다. 노트가 없으면 만든다 */
	async add(p: Period, d: Date, text: string): Promise<boolean> {
		if (!text.trim()) return false;
		const file = await this.ensure(p, d);
		return this.deps.writer.modify(file, (t) => appendEdit(t, text));
	}

	private async point(p: Period, d: Date): Promise<ChartPoint> {
		const file = this.fileFor(p, d);
		if (!file) return { date: startOf(p, d), rate: null, progress: null };
		const progress = progressOf(parseTasks(await this.textOf(file)));
		return { date: startOf(p, d), rate: rateOf(progress), progress };
	}

	async stats(today: Date): Promise<GoalStats> {
		const current = {} as Record<Period, ChartPoint>;
		for (const p of PERIODS) current[p] = await this.point(p, today);

		const days: ChartPoint[] = [];
		for (let i = 29; i >= 0; i--) days.push(await this.point("day", shift("day", today, -i)));

		const weeks: ChartPoint[] = [];
		for (let i = 11; i >= 0; i--) weeks.push(await this.point("week", shift("week", today, -i)));

		const months: ChartPoint[] = [];
		const jan = startOf("year", today);
		for (let i = 0; i < 12; i++) months.push(await this.point("month", shift("month", jan, i)));

		// 이번 달 1일 ~ 오늘의 일별 노트
		let total = 0;
		let done = 0;
		const rates: number[] = [];
		const first = startOf("month", today);
		for (let d = first; d.getTime() <= startOf("day", today).getTime(); d = shift("day", d, 1)) {
			const pt = await this.point("day", d);
			if (!pt.progress || pt.progress.total === 0) continue;
			total += pt.progress.total;
			done += pt.progress.done;
			rates.push(pt.progress.done / pt.progress.total);
		}
		const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
		return { current, days, weeks, months, monthTotals: { total, done, avgRate, daysWithTasks: rates.length } };
	}
}
