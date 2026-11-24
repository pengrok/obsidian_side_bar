/** 일·주·월·년 기간 계산 (순수 함수). 한 주는 월요일에 시작한다(ISO 8601). */

export type Period = "day" | "week" | "month" | "year";
export const PERIODS: Period[] = ["day", "week", "month", "year"];
export const PERIOD_LABEL: Record<Period, string> = { day: "일", week: "주", month: "월", year: "년" };

const pad = (n: number) => String(n).padStart(2, "0");
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 그 기간의 첫날 0시 (로컬 시간) */
export function startOf(p: Period, d: Date): Date {
	const y = d.getFullYear();
	const m = d.getMonth();
	switch (p) {
		case "day":
			return new Date(y, m, d.getDate());
		case "week": {
			const mondayOffset = (d.getDay() + 6) % 7; // 월=0 … 일=6
			return new Date(y, m, d.getDate() - mondayOffset);
		}
		case "month":
			return new Date(y, m, 1);
		case "year":
			return new Date(y, 0, 1);
	}
}

/** n 기간 앞/뒤의 첫날 */
export function shift(p: Period, d: Date, n: number): Date {
	const s = startOf(p, d);
	switch (p) {
		case "day":
			return new Date(s.getFullYear(), s.getMonth(), s.getDate() + n);
		case "week":
			return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7 * n);
		case "month":
			return new Date(s.getFullYear(), s.getMonth() + n, 1);
		case "year":
			return new Date(s.getFullYear() + n, 0, 1);
	}
}

/** ISO 주 번호와 그 주가 속한 해 (목요일이 속한 해) */
export function isoWeek(d: Date): { year: number; week: number } {
	const monday = startOf("week", d);
	const thursday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 3);
	const year = thursday.getFullYear();
	const jan1 = new Date(year, 0, 1);
	const dayOfYear = Math.round((thursday.getTime() - jan1.getTime()) / 86_400_000);
	return { year, week: Math.floor(dayOfYear / 7) + 1 };
}

/** 파일 이름 (확장자 제외): 2026-11-24 / 2026-W48 / 2026-11 / 2026 */
export function fileName(p: Period, d: Date): string {
	const s = startOf(p, d);
	switch (p) {
		case "day":
			return `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`;
		case "week": {
			const w = isoWeek(s);
			return `${w.year}-W${pad(w.week)}`;
		}
		case "month":
			return `${s.getFullYear()}-${pad(s.getMonth() + 1)}`;
		case "year":
			return `${s.getFullYear()}`;
	}
}

/** 화면에 보여 줄 기간 이름 */
export function periodLabel(p: Period, d: Date): string {
	const s = startOf(p, d);
	switch (p) {
		case "day":
			return `${s.getFullYear()}년 ${s.getMonth() + 1}월 ${s.getDate()}일 (${DOW[s.getDay()]})`;
		case "week": {
			const w = isoWeek(s);
			const e = shift("day", s, 6);
			return `${w.year}년 ${w.week}주 (${s.getMonth() + 1}/${s.getDate()} ~ ${e.getMonth() + 1}/${e.getDate()})`;
		}
		case "month":
			return `${s.getFullYear()}년 ${s.getMonth() + 1}월`;
		case "year":
			return `${s.getFullYear()}년`;
	}
}

/** 짧은 이름 (그래프 축용): 11/24 · W48 · 11 · 2026 (월은 숫자만: 12칸이 좁다) */
export function shortLabel(p: Period, d: Date): string {
	const s = startOf(p, d);
	switch (p) {
		case "day":
			return `${s.getMonth() + 1}/${s.getDate()}`;
		case "week":
			return `W${isoWeek(s).week}`;
		case "month":
			return `${s.getMonth() + 1}`;
		case "year":
			return `${s.getFullYear()}`;
	}
}

export function samePeriod(p: Period, a: Date, b: Date): boolean {
	return startOf(p, a).getTime() === startOf(p, b).getTime();
}
