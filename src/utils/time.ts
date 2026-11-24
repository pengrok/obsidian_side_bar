const pad = (n: number, w = 2) => String(Math.abs(n)).padStart(w, "0");

/** 로컬 시간대를 포함한 ISO 8601 (예: 2026-11-24T11:10:00+09:00) */
export function toLocalIso(d: Date): string {
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? "+" : "-";
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
		`T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
		`${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
	);
}

export function formatDate(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatTime(d: Date): string {
	return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** ISO 문자열의 날짜 부분 (YYYY-MM-DD). 못 읽으면 빈 문자열 */
export function isoDatePart(iso: string | undefined | null): string {
	if (!iso) return "";
	const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso));
	return m ? m[1] : "";
}

/** 정렬용 숫자. 못 읽으면 NaN */
export function isoToTime(iso: string | undefined | null): number {
	if (!iso) return NaN;
	return Date.parse(String(iso));
}
