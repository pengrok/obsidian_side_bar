import { App, Modal } from "obsidian";

export interface ConfirmButton {
	id: string;
	label: string;
	cta?: boolean;
	warning?: boolean;
}

export interface ConfirmOptions {
	title: string;
	message: string;
	buttons: ConfirmButton[];
	checkbox?: string;
}

export interface ConfirmResult {
	choice: string;
	checked: boolean;
}

/** 확인창. 닫으면(Esc) null */
export class ConfirmModal extends Modal {
	private result: ConfirmResult | null = null;
	private checked = false;

	constructor(
		app: App,
		private opts: ConfirmOptions,
		private resolve: (r: ConfirmResult | null) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("mn-confirm");
		this.setTitle(this.opts.title);
		this.contentEl.createEl("p", { text: this.opts.message });
		if (this.opts.checkbox) {
			const label = this.contentEl.createEl("label", { cls: "mn-confirm-check" });
			const cb = label.createEl("input", { attr: { type: "checkbox" } });
			label.appendText(" " + this.opts.checkbox);
			cb.addEventListener("change", () => (this.checked = cb.checked));
		}
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		for (const b of this.opts.buttons) {
			const btn = row.createEl("button", { text: b.label });
			if (b.cta) btn.addClass("mod-cta");
			if (b.warning) btn.addClass("mod-warning");
			btn.addEventListener("click", () => {
				this.result = { choice: b.id, checked: this.checked };
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(this.result);
	}
}

export function confirmDialog(app: App, opts: ConfirmOptions): Promise<ConfirmResult | null> {
	return new Promise((resolve) => new ConfirmModal(app, opts, resolve).open());
}
