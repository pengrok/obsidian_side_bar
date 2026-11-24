/**
 * 시스템 색상 선택기를 연다. 고르면(선택기를 닫으면) onPick(#rrggbb).
 * <input type="color">는 문서에 붙어 있어야 열리므로 잠깐 붙였다가 뗀다.
 */
export function pickColor(doc: Document, initial: string, onPick: (hex: string) => void): void {
	const input = doc.body.createEl("input", { cls: "mn-color-input", attr: { type: "color", tabindex: "-1", "aria-hidden": "true" } });
	input.value = /^#[0-9a-f]{6}$/i.test(initial) ? initial : "#ffd54f";
	let done = false;
	const finish = () => {
		if (done) return;
		done = true;
		const v = input.value.toLowerCase();
		input.remove();
		if (/^#[0-9a-f]{6}$/.test(v)) onPick(v);
	};
	input.addEventListener("change", finish);
	// 선택기를 취소하면 change가 오지 않는다. 다음에 포커스가 돌아오면 정리한다
	input.addEventListener("blur", () => window.setTimeout(() => !done && input.remove(), 300));
	input.click();
}
