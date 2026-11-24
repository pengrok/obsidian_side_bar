import type { HighlightColor } from "../types";

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** 팔레트 key 대신 직접 고른 색(#rrggbb)인가 */
export function isHexColor(v: string | null | undefined): boolean {
	return typeof v === "string" && HEX_RE.test(v);
}

/**
 * mn-color 값 → 화면에 쓸 색.
 * 팔레트 key면 그 key, 직접 고른 색이면 그 #hex, 알 수 없는 key면 기본색 key.
 */
export function resolveColor(value: string | null | undefined, colors: HighlightColor[], defaultKey: string): string {
	if (value && isHexColor(value)) return value.toLowerCase();
	if (value && colors.some((c) => c.key === value)) return value;
	if (colors.some((c) => c.key === defaultKey)) return defaultKey;
	return colors[0]?.key ?? "yellow";
}

/** 요소에 붙일 클래스와 CSS 변수. 팔레트 색은 클래스, 직접 고른 색은 --mn-hl-color */
export function colorAttrs(resolved: string): { cls: string; style: string | null } {
	if (isHexColor(resolved)) return { cls: "mn-color-custom", style: `--mn-hl-color: ${resolved}` };
	return { cls: `mn-color-${resolved}`, style: null };
}

/** HTML 요소에 색을 입힌다 (이전 색 클래스는 지운다) */
export function applyColor(el: HTMLElement, resolved: string): void {
	for (const c of Array.from(el.classList)) if (c.startsWith("mn-color-")) el.classList.remove(c);
	const { cls } = colorAttrs(resolved);
	el.classList.add(cls);
	if (isHexColor(resolved)) el.style.setProperty("--mn-hl-color", resolved);
	else el.style.removeProperty("--mn-hl-color");
}

/** 필터·묶기·카드에 보여 줄 이름 */
export function colorLabel(resolved: string, colors: HighlightColor[]): string {
	return colors.find((c) => c.key === resolved)?.name ?? resolved;
}
