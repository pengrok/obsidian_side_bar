import { AbstractInputSuggest, App, normalizePath, Notice, PluginSettingTab, Setting, TFolder } from "obsidian";
import type MarginNotesPlugin from "./main";
import { MAX_COLORS, nextColorKey } from "./settingsDefaults";
import { normalizeFolder, patternHasId, renderPattern, validateCommentFolder } from "./store/fileNaming";
import { formatDate, formatTime } from "./utils/time";
import { confirmDialog } from "./ui/confirmModal";

export { DEFAULT_SETTINGS } from "./settingsDefaults";

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private onPick: (path: string) => void,
	) {
		super(app, input);
	}
	getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path.toLowerCase().includes(q))
			.slice(0, 50);
	}
	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}
	selectSuggestion(folder: TFolder): void {
		this.input.value = folder.path;
		this.onPick(folder.path);
		this.close();
	}
}

export class MarginNotesSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: MarginNotesPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		const s = this.plugin.settings;
		containerEl.empty();

		// ── 코멘트 폴더 ──
		const folderSetting = new Setting(containerEl)
			.setName("코멘트 폴더")
			.setDesc("코멘트 파일을 저장할 폴더. 코멘트 파일은 이 폴더 안에 두세요.");
		const folderError = containerEl.createDiv({ cls: "mn-setting-error" });
		folderSetting.addText((t) => {
			t.setPlaceholder("Annotations").setValue(s.commentFolder);
			const apply = (value: string) => void this.changeCommentFolder(value, folderError, t.inputEl);
			new FolderSuggest(this.app, t.inputEl, apply);
			t.inputEl.addEventListener("change", () => apply(t.inputEl.value));
		});

		new Setting(containerEl)
			.setName("원본 노트별 하위 폴더")
			.setDesc("켜면 원본 노트 이름으로 하위 폴더를 만들어 넣어요. 이후 만드는 파일에만 적용돼요.")
			.addToggle((t) =>
				t.setValue(s.subfolderPerNote).onChange(async (v) => {
					s.subfolderPerNote = v;
					await this.plugin.saveAll();
					this.updatePreview();
				}),
			);

		// ── 파일 이름 패턴 ──
		const patternSetting = new Setting(containerEl)
			.setName("파일 이름 패턴")
			.setDesc("치환자: {{source}} {{quote}} {{id}} {{date}} {{time}}. {{id}}는 꼭 있어야 해요.");
		const patternError = containerEl.createDiv({ cls: "mn-setting-error" });
		this.previewEl = containerEl.createDiv({ cls: "mn-setting-preview" });
		patternSetting.addText((t) => {
			t.setValue(s.fileNamePattern).onChange(async (v) => {
				if (!patternHasId(v)) {
					patternError.setText("{{id}}가 빠지면 저장할 수 없어요 (이름 충돌 방지).");
					t.inputEl.addClass("mn-invalid");
					return;
				}
				patternError.setText("");
				t.inputEl.removeClass("mn-invalid");
				s.fileNamePattern = v;
				await this.plugin.saveAll();
				this.updatePreview();
			});
			t.inputEl.addClass("mn-pattern-input");
		});
		this.updatePreview();

		// ── 색상 ──
		new Setting(containerEl).setName("색상").setHeading();
		const colorsEl = containerEl.createDiv({ cls: "mn-setting-colors" });
		this.renderColors(colorsEl);

		new Setting(containerEl)
			.setName("기본 색")
			.setDesc("하이라이트를 만들 때 처음 골라져 있는 색")
			.addDropdown((d) => {
				for (const c of s.colors) d.addOption(c.key, c.name);
				d.setValue(s.defaultColor).onChange(async (v) => {
					s.defaultColor = v;
					await this.plugin.saveAll();
					this.plugin.onColorsChanged();
				});
			});

		// ── 동작 ──
		new Setting(containerEl).setName("동작").setHeading();
		new Setting(containerEl)
			.setName("선택하면 버튼 표시")
			.setDesc("글을 드래그하면 선택 위에 코멘트·하이라이트 버튼이 떠요.")
			.addToggle((t) =>
				t.setValue(s.showSelectionToolbar).onChange(async (v) => {
					s.showSelectionToolbar = v;
					await this.plugin.saveAll();
				}),
			);
		new Setting(containerEl).setName("만든 뒤 파일 열기").setDesc("코멘트를 만들면 코멘트 파일을 새 탭으로 열어요.").addToggle((t) =>
			t.setValue(s.openFileAfterCreate).onChange(async (v) => {
				s.openFileAfterCreate = v;
				await this.plugin.saveAll();
			}),
		);
		new Setting(containerEl).setName("하이라이트 제거 시").setDesc("코멘트 파일을 어떻게 할지").addDropdown((d) =>
			d
				.addOption("ask", "물어보기")
				.addOption("keep", "파일 남기기")
				.addOption("trash", "휴지통으로")
				.setValue(s.onRemoveHighlight)
				.onChange(async (v) => {
					s.onRemoveHighlight = v as typeof s.onRemoveHighlight;
					await this.plugin.saveAll();
				}),
		);
		new Setting(containerEl)
			.setName("일반 하이라이트 표시")
			.setDesc("코멘트가 없는 ==텍스트==도 사이드바에 보여요.")
			.addToggle((t) =>
				t.setValue(s.showPlainHighlights).onChange(async (v) => {
					s.showPlainHighlights = v;
					await this.plugin.saveAll();
					this.plugin.refreshView(true);
				}),
			);
		new Setting(containerEl)
			.setName("제외 폴더")
			.setDesc("하이라이트를 찾지 않을 폴더. 한 줄에 하나. 코멘트 폴더는 항상 빠져요.")
			.addTextArea((t) => {
				t.setValue(s.excludeFolders.join("\n"));
				t.inputEl.rows = 3;
				t.inputEl.addEventListener("change", () => {
					s.excludeFolders = t.inputEl.value
						.split("\n")
						.map((x) => normalizeFolder(x))
						.filter(Boolean);
					void this.plugin.saveAll().then(() => this.plugin.refreshView(true));
				});
			});
		new Setting(containerEl).setName("미리보기 줄 수").setDesc("카드에 보이는 코멘트 줄 수").addSlider((sl) =>
			sl
				.setLimits(1, 10, 1)
				.setValue(s.previewLines)
				.onChange(async (v) => {
					s.previewLines = v;
					await this.plugin.saveAll();
					this.plugin.refreshView(true);
				}),
		);
		new Setting(containerEl)
			.setName("따라가기 모드")
			.setDesc("편집기를 스크롤하면 가장 가까운 하이라이트 카드를 사이드바 가운데로 옮겨요.")
			.addToggle((t) =>
				t.setValue(s.followEditorScroll).onChange(async (v) => {
					s.followEditorScroll = v;
					await this.plugin.saveAll();
				}),
			);
	}

	private previewEl: HTMLElement | null = null;

	private updatePreview(): void {
		if (!this.previewEl) return;
		const s = this.plugin.settings;
		const now = new Date();
		const name = renderPattern(s.fileNamePattern, {
			source: "논문정리",
			quote: "셀프 어텐션만으로 시퀀스를 처리한다",
			id: "a1b2c3",
			date: formatDate(now),
			time: formatTime(now),
		});
		const folder = normalizeFolder(s.commentFolder) + (s.subfolderPerNote ? "/논문정리" : "");
		this.previewEl.setText(`미리보기: ${folder}/${name}.md`);
	}

	private renderColors(el: HTMLElement): void {
		el.empty();
		const s = this.plugin.settings;
		const save = async () => {
			await this.plugin.saveAll();
			this.plugin.onColorsChanged();
		};
		s.colors.forEach((c, i) => {
			const row = new Setting(el).setClass("mn-color-row");
			row.nameEl.createSpan({ cls: "mn-color-key", text: c.key });
			row.addText((t) =>
				t.setValue(c.name).onChange(async (v) => {
					c.name = v.trim() || c.key;
					await save();
				}),
			);
			row.addColorPicker((cp) =>
				cp.setValue(c.color).onChange(async (v) => {
					c.color = v;
					await save();
				}),
			);
			row.addExtraButton((b) =>
				b
					.setIcon("trash-2")
					.setTooltip("삭제")
					.setDisabled(s.colors.length <= 1)
					.onClick(async () => {
						if (s.colors.length <= 1) return;
						s.colors.splice(i, 1);
						if (s.defaultColor === c.key) s.defaultColor = s.colors[0].key;
						await save();
						this.display();
					}),
			);
		});
		new Setting(el).addButton((b) =>
			b
				.setButtonText("색 추가")
				.setDisabled(s.colors.length >= MAX_COLORS)
				.onClick(async () => {
					if (s.colors.length >= MAX_COLORS) return;
					const key = nextColorKey(s.colors);
					s.colors.push({ key, name: `색 ${s.colors.length + 1}`, color: "#90a4ae" });
					await save();
					this.display();
				}),
		);
		if (s.colors.length >= MAX_COLORS) el.createDiv({ cls: "setting-item-description", text: `색은 최대 ${MAX_COLORS}개까지예요.` });
	}

	/** 코멘트 폴더 변경 (E9) */
	private async changeCommentFolder(value: string, errorEl: HTMLElement, input: HTMLInputElement): Promise<void> {
		const s = this.plugin.settings;
		const err = validateCommentFolder(value, this.app.vault.configDir);
		if (err) {
			errorEl.setText(err);
			input.addClass("mn-invalid");
			return;
		}
		errorEl.setText("");
		input.removeClass("mn-invalid");
		const next = normalizePath(normalizeFolder(value));
		const prev = normalizeFolder(s.commentFolder);
		if (next === prev) return;
		const existing = this.plugin.index.all();
		s.commentFolder = next;
		await this.plugin.saveAll();
		this.updatePreview();
		if (existing.length) {
			const r = await confirmDialog(this.app, {
				title: "코멘트 폴더 변경",
				message: `기존 코멘트 ${existing.length}개를 새 폴더로 옮길까요? 옮기지 않으면 기존 파일은 사이드바에 나오지 않아요.`,
				buttons: [
					{ id: "move", label: "옮기기", cta: true },
					{ id: "keep", label: "그대로 두기" },
				],
			});
			if (r?.choice === "move") {
				let n = 0;
				for (const ann of existing) {
					const parent = ann.file.parent?.path ?? "";
					const rel = parent === prev ? "" : parent.startsWith(prev + "/") ? parent.slice(prev.length + 1) : "";
					try {
						await this.plugin.store.moveTo(ann.file, rel ? `${next}/${rel}` : next);
						n++;
					} catch (e) {
						console.error("[Margin Notes] 이동 실패", ann.file.path, e);
					}
				}
				new Notice(`코멘트 ${n}개를 옮겼어요`);
			} else {
				new Notice("기존 코멘트 파일은 옮기지 않았어요");
			}
		}
		await this.plugin.rebuildIndex();
	}
}
