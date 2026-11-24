// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { openedSuggests, type TFile } from "obsidian";
import { installDomHelpers } from "./dom";
import { setup, wait } from "./helpers";
import { fileName, isoWeek, periodLabel, shift, startOf } from "../src/goals/periods";
import { appendEdit, parseTasks, progressOf, toggleEdit } from "../src/goals/tasks";
import { GoalsStore } from "../src/goals/goalsStore";
import { GoalsView } from "../src/goals/goalsView";
import { mergeData } from "../src/settingsDefaults";
import { validateGoalFolder } from "../src/settings";

beforeAll(() => installDomHelpers());

const D = (y: number, m: number, d: number) => new Date(y, m - 1, d);
const fmt = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

describe("기간 계산 (한 주는 월요일 시작)", () => {
	it("startOf", () => {
		expect(fmt(startOf("week", D(2026, 11, 24)))).toBe("2026-11-23"); // 화 → 월
		expect(fmt(startOf("week", D(2026, 11, 29)))).toBe("2026-11-23"); // 일요일은 그 주의 마지막 날
		expect(fmt(startOf("week", D(2026, 11, 23)))).toBe("2026-11-23");
		expect(fmt(startOf("month", D(2026, 11, 24)))).toBe("2026-11-1");
		expect(fmt(startOf("year", D(2026, 11, 24)))).toBe("2026-1-1");
	});
	it("파일 이름", () => {
		const d = D(2026, 11, 24);
		expect(fileName("day", d)).toBe("2026-11-24");
		expect(fileName("week", d)).toBe("2026-W48");
		expect(fileName("month", d)).toBe("2026-11");
		expect(fileName("year", d)).toBe("2026");
	});
	it.each([
		[D(2026, 1, 1), 2026, 1], // 목요일
		[D(2025, 12, 29), 2026, 1], // 월요일, 다음 해 1주
		[D(2027, 1, 1), 2026, 53], // 금요일, 2026년은 53주까지
		[D(2027, 1, 4), 2027, 1],
		[D(2024, 12, 30), 2025, 1],
		[D(2021, 1, 3), 2020, 53], // 일요일
	])("ISO 주 %s → %i-W%i", (d, y, w) => {
		expect(isoWeek(d)).toEqual({ year: y, week: w });
	});
	it("shift: 월말·연말을 넘어도 첫날 기준", () => {
		expect(fmt(shift("month", D(2026, 1, 31), 1))).toBe("2026-2-1");
		expect(fmt(shift("month", D(2026, 1, 15), -1))).toBe("2025-12-1");
		expect(fmt(shift("week", D(2026, 12, 30), 1))).toBe("2027-1-4");
		expect(fmt(shift("day", D(2026, 2, 28), 1))).toBe("2026-3-1");
	});
	it("화면 이름", () => {
		expect(periodLabel("day", D(2026, 11, 24))).toBe("2026년 11월 24일 (화)");
		expect(periodLabel("week", D(2026, 11, 24))).toBe("2026년 48주 (11/23 ~ 11/29)");
		expect(periodLabel("month", D(2026, 11, 24))).toBe("2026년 11월");
	});
});

describe("체크박스 할 일", () => {
	const T = ["---", "tags: [x]", "---", "# 오늘", "- [ ] 운동", "- [x] 독서", "\t- [X] 30쪽", "* [ ] 별표 목록", "1. [ ] 번호 목록", "- 그냥 목록", "```", "- [ ] 코드 안", "```", "- [ ]", "> - [ ] 인용 안"].join("\n");
	it("parseTasks: 코드·frontmatter 안은 빼고, 하위 할 일도 하나로", () => {
		const ts = parseTasks(T);
		expect(ts.map((t) => [t.text, t.done, t.depth])).toEqual([
			["운동", false, 0],
			["독서", true, 0],
			["30쪽", true, 1],
			["별표 목록", false, 0],
			["번호 목록", false, 0],
			["", false, 0],
			["인용 안", false, 0],
		]);
		expect(progressOf(ts)).toEqual({ done: 2, total: 7 });
	});
	it("toggleEdit: [ ] 안 한 글자만 바꾼다", () => {
		const t = parseTasks(T)[0];
		const e = toggleEdit(T, t, true)!;
		const next = T.slice(0, e.from) + e.insert + T.slice(e.to);
		expect(next).toContain("- [x] 운동");
		expect(next.length).toBe(T.length);
	});
	it("toggleEdit: 그 사이 줄이 바뀌었으면 null", () => {
		const t = parseTasks(T)[0];
		expect(toggleEdit(T.replace("운동", "산책"), t, true)).toBeNull();
		expect(toggleEdit(T, t, false)).toBeNull(); // 이미 그 상태
	});
	it("appendEdit", () => {
		expect(appendEdit("", "새 일")).toEqual({ from: 0, to: 0, insert: "- [ ] 새 일\n" });
		expect(appendEdit("abc", "새 일")!.insert).toBe("\n- [ ] 새 일\n");
		expect(appendEdit("abc\n", "줄\n바꿈")!.insert).toBe("- [ ] 줄 바꿈\n");
		expect(appendEdit("abc", "   ")).toBeNull();
	});
});

function goalsEnv() {
	const e = setup();
	const goals = new GoalsStore({
		app: e.app as never,
		folders: () => e.settings.goalFolders,
		writer: e.writer,
		store: e.store,
		getLiveText: () => null,
	});
	return { ...e, goals };
}

describe("GoalsStore", () => {
	const today = D(2026, 11, 24);

	it("경로는 사용자가 고른 폴더 + 정한 파일 이름", () => {
		const t = goalsEnv();
		t.settings.goalFolders = { day: "할일/매일", week: "할일/매주", month: "할일/매월", year: "할일/매년" };
		expect(t.goals.pathFor("day", today)).toBe("할일/매일/2026-11-24.md");
		expect(t.goals.pathFor("week", today)).toBe("할일/매주/2026-W48.md");
		expect(t.goals.isGoalPath("할일/매월/2026-11.md")).toBe(true);
		expect(t.goals.isGoalPath("다른/2026-11.md")).toBe(false);
	});

	it("추가: 노트와 폴더가 없으면 만들고, 체크하면 노트에 반영", async () => {
		const t = goalsEnv();
		expect((await t.goals.read("day", today)).file).toBeNull();
		await t.goals.add("day", today, "운동");
		await t.goals.add("day", today, "독서");
		expect(t.app.vault.text("Goals/일/2026-11-24.md")).toBe("- [ ] 운동\n- [ ] 독서\n");
		const note = await t.goals.read("day", today);
		expect(note.progress).toEqual({ done: 0, total: 2 });
		expect(await t.goals.setDone("day", today, note.tasks[1], true)).toBe(true);
		expect(t.app.vault.text("Goals/일/2026-11-24.md")).toBe("- [ ] 운동\n- [x] 독서\n");
	});

	it("열린 편집기가 있으면 편집기에서 고친다", async () => {
		const t = goalsEnv();
		const f = t.app.vault.seed("Goals/일/2026-11-24.md", "- [ ] 운동\n") as TFile;
		const view = t.app.workspace.open(f, "- [ ] 운동\n");
		const note = await t.goals.read("day", today);
		await t.goals.setDone("day", today, note.tasks[0], true);
		expect(view.editor.getValue()).toBe("- [x] 운동\n");
	});

	it("통계: 지금 기간, 최근 30일·12주, 올해 월별, 이번 달 합계", async () => {
		const t = goalsEnv();
		const v = t.app.vault;
		v.seed("Goals/일/2026-11-24.md", "- [x] a\n- [ ] b\n"); // 50%
		v.seed("Goals/일/2026-11-23.md", "- [x] a\n- [x] b\n"); // 100%
		v.seed("Goals/일/2026-11-20.md", "메모만"); // 할 일 없음
		v.seed("Goals/일/2026-11-01.md", "- [ ] a\n"); // 0%
		v.seed("Goals/일/2026-10-30.md", "- [x] a\n"); // 지난달 (30일 안)
		v.seed("Goals/주/2026-W48.md", "- [x] a\n- [ ] b\n- [ ] c\n- [ ] d\n");
		v.seed("Goals/월/2026-11.md", "- [x] a\n");
		v.seed("Goals/월/2026-03.md", "- [ ] a\n");
		const s = await t.goals.stats(today);

		expect(s.current.day.rate).toBe(0.5);
		expect(s.current.week.rate).toBe(0.25);
		expect(s.current.month.rate).toBe(1);
		expect(s.current.year.progress).toBeNull(); // 년 노트 없음

		expect(s.days).toHaveLength(30);
		expect(fmt(s.days[0].date)).toBe("2026-10-26");
		expect(fmt(s.days[29].date)).toBe("2026-11-24");
		expect(s.days[29].rate).toBe(0.5);
		expect(s.days[28].rate).toBe(1);
		expect(s.days.find((d) => fmt(d.date) === "2026-11-20")!.rate).toBeNull();
		expect(s.days.find((d) => fmt(d.date) === "2026-11-20")!.progress).toEqual({ done: 0, total: 0 });
		expect(s.days.find((d) => fmt(d.date) === "2026-10-30")!.rate).toBe(1);

		expect(s.weeks).toHaveLength(12);
		expect(s.weeks[11].rate).toBe(0.25);
		expect(s.months.map((m) => m.rate)).toEqual([null, null, 0, null, null, null, null, null, null, null, 1, null]);

		// 이번 달 일별 노트: 11/1(0/1), 11/23(2/2), 11/24(1/2). 11/20은 할 일 없음이라 제외
		expect(s.monthTotals).toEqual({ total: 5, done: 3, avgRate: (0 + 1 + 0.5) / 3, daysWithTasks: 3 });
	});

	it("폴더 검증", () => {
		expect(validateGoalFolder("", ".obsidian")).not.toBeNull();
		expect(validateGoalFolder(".obsidian/x", ".obsidian")).not.toBeNull();
		expect(validateGoalFolder("할일/매일", ".obsidian")).toBeNull();
	});

	it("예전 설정에는 기본 폴더를 채운다", () => {
		expect(mergeData({ settings: {} }).settings.goalFolders).toEqual({ day: "Goals/일", week: "Goals/주", month: "Goals/월", year: "Goals/년" });
		expect(mergeData({ settings: { goalFolders: { day: "내 폴더" } } }).settings.goalFolders.day).toBe("내 폴더");
	});
});

async function viewEnv() {
	const t = goalsEnv();
	const { uiState } = mergeData({});
	const opened: string[] = [];
	const plugin = {
		app: t.app,
		goals: t.goals,
		settings: t.settings,
		uiState,
		saveUiSoon: () => {},
		saveAll: async () => {},
		actions: { openFile: async (f: TFile) => (opened.push(f.path), { view: null }) },
	};
	const view = new GoalsView({ app: t.app } as never, plugin as never, () => D(2026, 11, 24));
	document.body.appendChild(view.containerEl);
	await view.onOpen();
	return { ...t, view, root: view.contentEl, plugin, opened };
}

const texts = (root: HTMLElement, sel: string) => Array.from(root.querySelectorAll(sel)).map((e) => e.textContent);

describe("목표 사이드바 화면", () => {
	it("탭: 일·주·월·년·통계, 노트가 없으면 만들기 버튼", async () => {
		const t = await viewEnv();
		expect(texts(t.root, ".mn-tab")).toEqual(["일", "주", "월", "년", "통계"]);
		expect(t.root.querySelector(".mn-goal-label")!.textContent).toBe("2026년 11월 24일 (화)");
		expect(t.root.querySelector(".mn-empty")!.textContent).toContain("이 기간의 노트가 없어요.");
		(t.root.querySelector(".mn-empty button") as HTMLElement).click();
		await wait(20);
		expect(t.app.vault.getAbstractFileByPath("Goals/일/2026-11-24.md")).not.toBeNull();
		expect(t.root.querySelector(".mn-goal-count")!.textContent).toBe("할 일이 없어요");
	});

	it("할 일 추가(Enter) → 목록·진행률, 체크하면 노트에 반영", async () => {
		const t = await viewEnv();
		const input = t.root.querySelector<HTMLInputElement>(".mn-goal-add input")!;
		input.focus();
		input.value = "운동";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		await wait(300);
		expect(texts(t.root, ".mn-goal-text")).toEqual(["운동"]);
		expect(t.root.querySelector(".mn-goal-count")!.textContent).toBe("0 / 1 완료 (0%)");
		// 다시 그려도 추가 칸 포커스 유지
		expect(activeDocument.activeElement).toBe(t.root.querySelector(".mn-goal-add input"));

		const cb = t.root.querySelector<HTMLInputElement>(".mn-goal-task input")!;
		cb.checked = true;
		cb.dispatchEvent(new Event("change"));
		await wait(300);
		expect(t.app.vault.text("Goals/일/2026-11-24.md")).toBe("- [x] 운동\n");
		expect(t.root.querySelector(".mn-goal-count")!.textContent).toBe("1 / 1 완료 (100%)");
		expect(t.root.querySelector(".mn-goal-task")!.classList.contains("is-done")).toBe(true);
	});

	it("노트를 직접 고치면 사이드바가 따라온다", async () => {
		const t = await viewEnv();
		const f = t.app.vault.seed("Goals/일/2026-11-24.md", "- [ ] a\n") as TFile;
		await t.view.render();
		await t.app.vault.modify(f, "- [ ] a\n- [x] b\n");
		await wait(300);
		expect(texts(t.root, ".mn-goal-text")).toEqual(["a", "b"]);
	});

	it("◀ ▶ 로 기간 이동, 가운데를 누르면 오늘로", async () => {
		const t = await viewEnv();
		(t.root.querySelector('[aria-label="이전"]') as HTMLElement).click();
		await wait(10);
		expect(t.root.querySelector(".mn-goal-label")!.textContent).toBe("2026년 11월 23일 (월)");
		(t.root.querySelector(".mn-goal-label") as HTMLElement).click();
		await wait(10);
		expect(t.root.querySelector(".mn-goal-label")!.textContent).toBe("2026년 11월 24일 (화)");
		(t.root.querySelector('.mn-tab[data-tab="week"]') as HTMLElement).click();
		await wait(10);
		expect(t.root.querySelector(".mn-goal-label")!.textContent).toBe("2026년 48주 (11/23 ~ 11/29)");
		expect(t.plugin.uiState.goalsTab).toBe("week");
	});

	it("할 일 글을 누르면 그 노트를 연다", async () => {
		const t = await viewEnv();
		t.app.vault.seed("Goals/일/2026-11-24.md", "- [ ] a\n");
		await t.view.render();
		(t.root.querySelector(".mn-goal-text") as HTMLElement).click();
		await wait(10);
		expect(t.opened).toEqual(["Goals/일/2026-11-24.md"]);
	});

	it("사이드바에서 탭별 노트 폴더를 바로 고른다", async () => {
		const t = await viewEnv();
		await t.app.vault.createFolder("내 할일");
		await t.app.vault.createFolder("내 할일/매일");
		t.app.vault.seed("내 할일/매일/2026-11-24.md", "- [ ] 고른 폴더의 할 일\n");
		const folder = t.root.querySelector<HTMLElement>(".mn-goal-folder")!;
		expect(folder.textContent).toBe("Goals/일");
		openedSuggests.length = 0;
		folder.click();
		const modal = openedSuggests.at(-1)!;
		const items = modal.getItems().map((f) => modal.getItemText(f));
		expect(items).toContain("내 할일/매일");
		expect(items).not.toContain(".obsidian");
		modal.onChooseItem(modal.getItems().find((f) => modal.getItemText(f) === "내 할일/매일")!);
		await wait(30);
		expect(t.settings.goalFolders.day).toBe("내 할일/매일");
		expect(t.settings.goalFolders.week).toBe("Goals/주"); // 다른 탭은 그대로
		expect(t.root.querySelector(".mn-goal-folder")!.textContent).toBe("내 할일/매일");
		expect(texts(t.root, ".mn-goal-text")).toEqual(["고른 폴더의 할 일"]);
		// 할 일을 추가하면 고른 폴더의 노트에 들어간다
		const input = t.root.querySelector<HTMLInputElement>(".mn-goal-add input")!;
		input.value = "추가";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		await wait(300);
		expect(t.app.vault.text("내 할일/매일/2026-11-24.md")).toBe("- [ ] 고른 폴더의 할 일\n- [ ] 추가\n");
		expect(t.app.vault.getAbstractFileByPath("Goals")).toBeNull();
	});

	it("통계 탭: 4가지 (지금 기간·이번 달 합계·30일·12주·월별 그래프)", async () => {
		const t = await viewEnv();
		t.app.vault.seed("Goals/일/2026-11-24.md", "- [x] a\n- [ ] b\n");
		(t.root.querySelector('.mn-tab[data-tab="stats"]') as HTMLElement).click();
		await wait(30);
		expect(texts(t.root, ".mn-stat-title")).toEqual([
			"지금 기간 달성률",
			"이번 달 합계 (일별 노트 1일)",
			"최근 30일 일별 달성률",
			"최근 12주 주별 달성률",
			"2026년 월별 달성률",
		]);
		expect(texts(t.root, ".mn-stat-row .mn-stat-value")).toEqual(["1/2 · 50%", "노트 없음", "노트 없음", "노트 없음"]);
		expect(texts(t.root, ".mn-stat-tile-value")).toEqual(["2", "1", "50%"]);
		const charts = t.root.querySelectorAll(".mn-chart");
		expect(charts[0].querySelectorAll(".mn-chart-col")).toHaveLength(30);
		expect(charts[1].querySelectorAll(".mn-chart-col")).toHaveLength(12);
		expect(charts[2].querySelectorAll(".mn-chart-col")).toHaveLength(12);
		const todayBar = charts[0].querySelectorAll<HTMLElement>(".mn-chart-col")[29];
		expect(todayBar.querySelector<HTMLElement>(".mn-chart-bar")!.style.height).toBe("50%");
		expect(todayBar.getAttribute("aria-label")).toBe("2026년 11월 24일 (화) · 1/2 · 50%");
		expect(charts[0].querySelectorAll(".mn-chart-col.is-empty")).toHaveLength(29);
		// 막대를 누르면 그 기간 탭으로
		charts[0].querySelectorAll<HTMLElement>(".mn-chart-col")[28].click();
		await wait(20);
		expect(t.plugin.uiState.goalsTab).toBe("day");
		expect(t.root.querySelector(".mn-goal-label")!.textContent).toBe("2026년 11월 23일 (월)");
	});
});
