/** 본문 하이라이트 숨기기 모드: body에 클래스를 달면 styles.css가 배경색을 없앤다 */
export const HIDE_CLASS = "mn-hide-highlights";

export function applyHighlightVisibility(body: HTMLElement, hidden: boolean): void {
	body.toggleClass(HIDE_CLASS, hidden);
}
