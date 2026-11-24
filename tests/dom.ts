/** jsdom에 옵시디언이 HTMLElement에 덧붙이는 헬퍼를 흉내 낸다 (화면 테스트 전용) */

type ElOpts = { cls?: string | string[]; text?: string; attr?: Record<string, string>; href?: string; type?: string; title?: string } | string;

function applyOpts(el: HTMLElement, o?: ElOpts) {
	if (!o) return;
	if (typeof o === "string") {
		el.className = o;
		return;
	}
	if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
	if (o.text !== undefined) el.textContent = o.text;
	if (o.attr) for (const [k, v] of Object.entries(o.attr)) el.setAttribute(k, String(v));
	if (o.href) el.setAttribute("href", o.href);
	if (o.type) el.setAttribute("type", o.type);
	if (o.title) el.setAttribute("title", o.title);
}

export function installDomHelpers(): void {
	const P = HTMLElement.prototype as any;
	const N = Node.prototype as any;
	N.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	N.detach = function () {
		this.parentNode?.removeChild(this);
	};
	N.createEl = function (tag: string, o?: ElOpts) {
		const el = document.createElement(tag);
		applyOpts(el, o);
		this.appendChild(el);
		return el;
	};
	N.createDiv = function (o?: ElOpts) {
		return this.createEl("div", o);
	};
	N.createSpan = function (o?: ElOpts) {
		return this.createEl("span", o);
	};
	N.appendText = function (t: string) {
		this.appendChild(document.createTextNode(t));
	};
	P.addClass = function (...c: string[]) {
		this.classList.add(...c.flatMap((x) => x.split(" ").filter(Boolean)));
	};
	P.removeClass = function (...c: string[]) {
		this.classList.remove(...c);
	};
	P.toggleClass = function (c: string, v: boolean) {
		this.classList.toggle(c, v);
	};
	P.hasClass = function (c: string) {
		return this.classList.contains(c);
	};
	P.setText = function (t: string) {
		this.textContent = t;
	};
	P.setAttr = function (k: string, v: string) {
		this.setAttribute(k, v);
	};
	P.setCssProps = function (props: Record<string, string>) {
		for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
	};
	const g = globalThis as any;
	g.createEl = (tag: string, o?: ElOpts) => {
		const el = document.createElement(tag);
		applyOpts(el, o);
		return el;
	};
	g.createDiv = (o?: ElOpts) => g.createEl("div", o);
	g.createSpan = (o?: ElOpts) => g.createEl("span", o);
	g.activeDocument = document;
	if (!g.CSS) g.CSS = {};
	if (!g.CSS.escape) g.CSS.escape = (s: string) => s.replace(/["\\]/g, "\\$&");
	if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = function () {};
	if (!g.requestAnimationFrame) g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);
}
