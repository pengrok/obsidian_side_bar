import { App, Modal, Platform } from "obsidian";
import type { HighlightColor } from "../types";

export interface CommentModalOptions {
	title: string;
	quote: string;
	colors: HighlightColor[];
	color: string;
	body: string;
	sourcePath: string;
	onSubmit: (body: string, color: string) => void | Promise<void>;
	onCancel?: () => void;
}

/** 코멘트 입력창 (6.1절 4). Ctrl/Cmd+Enter = 저장, Esc = 취소 */
export class CommentModal extends Modal {
	private color: string;
	private submitted = false;
	private textarea!: HTMLTextAreaElement;

	constructor(
		app: App,
		private opts: CommentModalOptions,
	) {
		super(app);
		this.color = opts.colors.some((c) => c.key === opts.color) ? opts.color : opts.colors[0]?.key ?? opts.color;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("mn-modal");
		this.setTitle(this.opts.title);

		const quote = contentEl.createDiv({ cls: "mn-modal-quote" });
		quote.setText(this.opts.quote);
		this.applyQuoteColor(quote);

		const picker = contentEl.createDiv({ cls: "mn-color-picker" });
		for (const c of this.opts.colors) {
			const chip = picker.createEl("button", {
				cls: "mn-color-chip mn-color-" + c.key,
				attr: { "aria-label": c.name, type: "button", "data-key": c.key },
			});
			chip.createSpan({ cls: "mn-color-dot" });
			chip.createSpan({ text: c.name });
			if (c.key === this.color) chip.addClass("is-active");
			chip.addEventListener("click", () => {
				this.color = c.key;
				picker.querySelectorAll(".mn-color-chip").forEach((el) => el.removeClass("is-active"));
				chip.addClass("is-active");
				this.applyQuoteColor(quote);
			});
		}

		this.textarea = contentEl.createEl("textarea", {
			cls: "mn-modal-input",
			attr: { rows: "5", placeholder: "코멘트 (마크다운). 비워 둬도 저장돼요" },
		});
		this.textarea.value = this.opts.body;
		this.textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.submit();
			}
		});

		const footer = contentEl.createDiv({ cls: "mn-modal-buttons modal-button-container" });
		const hint = footer.createSpan({ cls: "mn-modal-hint" });
		hint.setText(Platform.isMacOS ? "⌘ + Enter 저장" : "Ctrl + Enter 저장");
		footer.createEl("button", { text: "취소" }).addEventListener("click", () => this.close());
		footer.createEl("button", { text: "저장", cls: "mod-cta" }).addEventListener("click", () => void this.submit());

		window.setTimeout(() => {
			this.textarea.focus();
			const end = this.textarea.value.length;
			this.textarea.setSelectionRange(end, end);
		}, 0);
	}

	private applyQuoteColor(el: HTMLElement): void {
		for (const c of this.opts.colors) el.removeClass("mn-color-" + c.key);
		el.addClass("mn-color-" + this.color);
	}

	private async submit(): Promise<void> {
		if (this.submitted) return;
		this.submitted = true;
		const body = this.textarea.value;
		this.close();
		await this.opts.onSubmit(body, this.color);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.submitted) this.opts.onCancel?.();
	}
}
