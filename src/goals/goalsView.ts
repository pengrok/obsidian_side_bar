import { Component, ItemView, MarkdownRenderer, MarkdownView, Notice, setIcon, setTooltip, TFile, type WorkspaceLeaf } from "obsidian";
import type MarginNotesPlugin from "../main";
import type { GoalsTab } from "../types";
import { debounceFn } from "../utils/debounce";
import type { ChartPoint, GoalStats } from "./goalsStore";
import { periodLabel, PERIOD_LABEL, PERIODS, samePeriod, shift, shortLabel, type Period } from "./periods";
import type { Task } from "./tasks";

export const VIEW_TYPE_GOALS = "margin-notes-goals";

const TAB_LABEL: Record<GoalsTab, string> = { ...PERIOD_LABEL, stats: "통계" };
const CURRENT_LABEL: Record<Period, string> = { day: "오늘", week: "이번 주", month: "이번 달", year: "올해" };

const pct = (r: number) => `${Math.round(r * 100)}%`;

/** 목표 사이드바: 일·주·월·년 노트의 체크박스 할 일과 통계 */
export class GoalsView extends ItemView {
	private tabsEl!: HTMLElement;
	private bodyEl!: HTMLElement;
	private cursor: Record<Period, Date>;
	private renderToken = 0;
	private comp: Component | null = null;
	/** 할 일 추가 칸에 쓰던 내용 (다시 그려도 유지) */
	private draft = "";

	readonly refresh = debounceFn(() => void this.render(), 200);

	constructor(
		leaf: WorkspaceLeaf,
		private plugin: MarginNotesPlugin,
		private now: () => Date = () => new Date(),
	) {
		super(leaf);
		const today = this.now();
		this.cursor = { day: today, week: today, month: today, year: today };
	}

	getViewType(): string {
		return VIEW_TYPE_GOALS;
	}
	getDisplayText(): string {
		return "목표";
	}
	getIcon(): string {
		return "target";
	}

	private get tab(): GoalsTab {
		return this.plugin.uiState.goalsTab;
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("mn-goals");
		this.tabsEl = root.createDiv({ cls: "mn-tabs" });
		this.bodyEl = root.createDiv({ cls: "mn-goals-body" });
		this.buildTabs();

		const goals = this.plugin.goals;
		const onFile = (path: string) => {
			if (goals.isGoalPath(path)) this.refresh();
		};
		this.registerEvent(this.app.vault.on("modify", (f) => onFile(f.path)));
		this.registerEvent(this.app.vault.on("create", (f) => onFile(f.path)));
		this.registerEvent(this.app.vault.on("delete", (f) => onFile(f.path)));
		this.registerEvent(this.app.vault.on("rename", (f, old) => (onFile(f.path), onFile(old))));
		this.registerEvent(
			this.app.workspace.on("editor-change", (_e, info) => {
				if (info.file) onFile(info.file.path);
			}),
		);
		await this.render();
	}

	async onClose(): Promise<void> {
		this.refresh.cancel();
		this.comp?.unload();
	}

	private buildTabs(): void {
		this.tabsEl.empty();
		for (const t of ["day", "week", "month", "year", "stats"] as GoalsTab[]) {
			const el = this.tabsEl.createDiv({ cls: "mn-tab", text: TAB_LABEL[t], attr: { "data-tab": t } });
			el.toggleClass("is-active", this.tab === t);
			el.addEventListener("click", () => this.showTab(t));
		}
	}

	showTab(t: GoalsTab, date?: Date): void {
		if (date && t !== "stats") this.cursor[t] = date;
		this.plugin.uiState.goalsTab = t;
		this.plugin.saveUiSoon();
		this.buildTabs();
		void this.render();
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		const tab = this.tab;
		// 다시 그려도 추가 칸의 포커스·글을 지킨다
		const input = this.bodyEl.querySelector<HTMLInputElement>(".mn-goal-add input");
		const hadFocus = !!input && activeDocument.activeElement === input;
		const sel = input ? [input.selectionStart, input.selectionEnd] : null;
		if (input) this.draft = input.value;

		const comp = new Component();
		comp.load();
		const frag = createDiv();
		if (tab === "stats") {
			const stats = await this.plugin.goals.stats(this.now());
			if (token !== this.renderToken) return comp.unload();
			this.drawStats(frag, stats);
		} else {
			const note = await this.plugin.goals.read(tab, this.cursor[tab]);
			if (token !== this.renderToken) return comp.unload();
			this.drawPeriod(frag, tab, note.file, note.tasks, comp);
		}
		this.bodyEl.empty();
		while (frag.firstChild) this.bodyEl.appendChild(frag.firstChild);
		this.comp?.unload();
		this.comp = comp;

		const next = this.bodyEl.querySelector<HTMLInputElement>(".mn-goal-add input");
		if (next && hadFocus) {
			next.focus();
			if (sel && sel[0] !== null) next.setSelectionRange(sel[0], sel[1] ?? sel[0]);
		}
	}

	// ── 일·주·월·년 ─────────────────────────────────────

	private drawPeriod(root: HTMLElement, p: Period, file: TFile | null, tasks: Task[], comp: Component): void {
		const date = this.cursor[p];
		const today = this.now();

		const nav = root.createDiv({ cls: "mn-goal-nav" });
		const prev = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "이전" } });
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => this.move(p, -1));
		const label = nav.createDiv({ cls: "mn-goal-label", text: periodLabel(p, date) });
		const isNow = samePeriod(p, date, today);
		label.toggleClass("is-current", isNow);
		if (!isNow) {
			setTooltip(label, `${CURRENT_LABEL[p]}(으)로`);
			label.addEventListener("click", () => {
				this.cursor[p] = today;
				void this.render();
			});
		}
		const next = nav.createEl("button", { cls: "clickable-icon", attr: { "aria-label": "다음" } });
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => this.move(p, 1));

		if (!file) {
			const empty = root.createDiv({ cls: "mn-empty" });
			empty.createDiv({ text: "이 기간의 노트가 없어요." });
			empty.createDiv({ cls: "mn-goal-path", text: this.plugin.goals.pathFor(p, date) });
			const btn = empty.createEl("button", { text: "노트 만들기", cls: "mod-cta" });
			btn.addEventListener("click", () => void this.createNote(p, date));
		} else {
			const done = tasks.filter((t) => t.done).length;
			const head = root.createDiv({ cls: "mn-goal-progress" });
			const track = head.createDiv({ cls: "mn-goal-track" });
			const fill = track.createDiv({ cls: "mn-goal-fill" });
			fill.setCssProps({ width: tasks.length ? pct(done / tasks.length) : "0%" });
			head.createDiv({
				cls: "mn-goal-count",
				text: tasks.length ? `${done} / ${tasks.length} 완료 (${pct(done / tasks.length)})` : "할 일이 없어요",
			});

			const list = root.createDiv({ cls: "mn-goal-list" });
			for (const t of tasks) this.drawTask(list, p, date, file, t, comp);

			const open = root.createDiv({ cls: "mn-goal-open" });
			const a = open.createEl("a", { text: "노트 열기", href: "#" });
			a.addEventListener("click", (e) => {
				e.preventDefault();
				void this.openAt(file, null, e.ctrlKey || e.metaKey);
			});
		}

		const add = root.createDiv({ cls: "mn-goal-add" });
		const input = add.createEl("input", { attr: { type: "text", placeholder: "할 일 추가 (Enter)" } });
		input.value = this.draft;
		input.addEventListener("input", () => (this.draft = input.value));
		const submit = () => {
			const text = input.value.trim();
			if (!text) return;
			input.value = "";
			this.draft = "";
			void this.plugin.goals.add(p, date, text).then(() => this.refresh());
		};
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				submit();
			}
		});
		const btn = add.createEl("button", { text: "추가" });
		btn.addEventListener("click", submit);
	}

	private drawTask(list: HTMLElement, p: Period, date: Date, file: TFile, t: Task, comp: Component): void {
		const row = list.createDiv({ cls: "mn-goal-task" + (t.done ? " is-done" : ""), attr: { "data-line": String(t.line) } });
		row.setCssProps({ "--mn-goal-depth": String(t.depth) });
		const cb = row.createEl("input", { cls: "task-list-item-checkbox", attr: { type: "checkbox" } });
		cb.checked = t.done;
		cb.addEventListener("change", () => {
			const want = cb.checked;
			void this.plugin.goals.setDone(p, date, t, want).then((ok) => {
				if (!ok) {
					new Notice("노트가 바뀌어 할 일을 찾지 못했어요. 다시 확인해 주세요");
					cb.checked = !want;
				}
				this.refresh();
			});
		});
		const text = row.createDiv({ cls: "mn-goal-text" });
		void MarkdownRenderer.render(this.app, t.text || " ", text, file.path, comp).then(() => {
			const only = text.children.length === 1 ? text.firstElementChild : null;
			if (only && only.tagName === "P") only.addClass("mn-inline-p");
		});
		text.addEventListener("click", (e) => {
			if ((e.target as HTMLElement).closest("a")) return;
			void this.openAt(file, t.line, e.ctrlKey || e.metaKey);
		});
	}

	private move(p: Period, n: number): void {
		this.cursor[p] = shift(p, this.cursor[p], n);
		void this.render();
	}

	private async createNote(p: Period, date: Date): Promise<void> {
		try {
			await this.plugin.goals.ensure(p, date);
		} catch (e) {
			new Notice(`노트를 만들지 못했어요: ${(e as Error).message}`);
		}
		await this.render();
	}

	private async openAt(file: TFile, line: number | null, newTab: boolean): Promise<void> {
		const leaf = await this.plugin.actions.openFile(file, newTab);
		const view = leaf.view;
		if (line === null || !(view instanceof MarkdownView) || view.getMode() !== "source") return;
		const pos = { line, ch: view.editor.getLine(line).length };
		view.editor.setCursor(pos);
		view.editor.scrollIntoView({ from: pos, to: pos }, true);
		view.editor.focus();
	}

	// ── 통계 ────────────────────────────────────────────

	private drawStats(root: HTMLElement, s: GoalStats): void {
		// 1. 지금 기간 달성률
		const now = root.createDiv({ cls: "mn-stat-section" });
		now.createDiv({ cls: "mn-stat-title", text: "지금 기간 달성률" });
		for (const p of PERIODS) {
			const pt = s.current[p];
			const row = now.createDiv({ cls: "mn-stat-row", attr: { "data-period": p } });
			row.createDiv({ cls: "mn-stat-label", text: CURRENT_LABEL[p] });
			const track = row.createDiv({ cls: "mn-goal-track" });
			track.createDiv({ cls: "mn-goal-fill" }).setCssProps({ width: pt.rate === null ? "0%" : pct(pt.rate) });
			row.createDiv({ cls: "mn-stat-value", text: this.pointText(pt) });
			row.addEventListener("click", () => this.showTab(p, this.now()));
			setTooltip(row, `${CURRENT_LABEL[p]} 노트 보기`);
		}

		// 2. 이번 달 합계
		const m = s.monthTotals;
		const tot = root.createDiv({ cls: "mn-stat-section" });
		tot.createDiv({ cls: "mn-stat-title", text: `이번 달 합계 (일별 노트 ${m.daysWithTasks}일)` });
		const tiles = tot.createDiv({ cls: "mn-stat-tiles" });
		const tile = (label: string, value: string) => {
			const t = tiles.createDiv({ cls: "mn-stat-tile" });
			t.createDiv({ cls: "mn-stat-tile-value", text: value });
			t.createDiv({ cls: "mn-stat-tile-label", text: label });
		};
		tile("할 일", String(m.total));
		tile("끝낸 일", String(m.done));
		tile("평균 달성률", m.avgRate === null ? "–" : pct(m.avgRate));

		// 3·4. 추이
		this.drawChart(root, "최근 30일 일별 달성률", s.days, "day", (i, n) => i % 5 === 4 || i === n - 1);
		this.drawChart(root, "최근 12주 주별 달성률", s.weeks, "week", (i) => i % 2 === 1);
		this.drawChart(root, `${s.months[0].date.getFullYear()}년 월별 달성률`, s.months, "month", () => true);
		root.createDiv({ cls: "mn-chart-note", text: "막대 = 끝낸 할 일 비율 · 점 = 노트나 할 일 없음 · 막대를 누르면 그 기간으로 이동" });
	}

	private pointText(pt: ChartPoint): string {
		if (!pt.progress) return "노트 없음";
		if (pt.progress.total === 0) return "할 일 없음";
		return `${pt.progress.done}/${pt.progress.total} · ${pct(pt.rate ?? 0)}`;
	}

	/** 달성률 막대그래프 (0~100%, 한 가지 색). 노트·할 일이 없는 기간은 막대 없이 점만 */
	private drawChart(root: HTMLElement, title: string, points: ChartPoint[], p: Period, showLabel: (i: number, n: number) => boolean): void {
		const sec = root.createDiv({ cls: "mn-stat-section" });
		sec.createDiv({ cls: "mn-stat-title", text: title });
		const chart = sec.createDiv({ cls: "mn-chart", attr: { role: "img", "aria-label": title } });
		const plot = chart.createDiv({ cls: "mn-chart-plot" });
		for (const g of [1, 0.5]) plot.createDiv({ cls: "mn-chart-grid" }).setCssProps({ bottom: pct(g) });
		const axis = chart.createDiv({ cls: "mn-chart-axis" });
		const today = this.now();
		points.forEach((pt, i) => {
			const col = plot.createDiv({ cls: "mn-chart-col", attr: { "data-index": String(i) } });
			const tip = `${periodLabel(p, pt.date)} · ${this.pointText(pt)}`;
			col.setAttr("aria-label", tip);
			setTooltip(col, tip);
			if (pt.rate === null) col.addClass("is-empty");
			else col.createDiv({ cls: "mn-chart-bar" }).setCssProps({ height: pt.rate === 0 ? "2px" : pct(pt.rate) });
			if (samePeriod(p, pt.date, today)) col.addClass("is-current");
			col.addEventListener("click", () => this.showTab(p, pt.date));
			axis.createDiv({ cls: "mn-chart-tick", text: showLabel(i, points.length) ? shortLabel(p, pt.date) : "" });
		});
	}
}

