import type { HighlightColor, MarginNotesSettings, PluginData, TabState, UiState } from "./types";

export const DEFAULT_COLORS: HighlightColor[] = [
	{ key: "yellow", name: "노랑", color: "#ffd54f" },
	{ key: "green", name: "초록", color: "#81c784" },
	{ key: "blue", name: "파랑", color: "#64b5f6" },
	{ key: "red", name: "빨강", color: "#e57373" },
	{ key: "purple", name: "보라", color: "#ba68c8" },
];

/** 예전 버전이 미리 붙여 두던 뜻 이름. 사용자가 그대로 뒀으면 색 이름으로 바꾼다 */
const OLD_DEFAULT_NAMES: Record<string, string> = {
	yellow: "중요",
	green: "동의",
	blue: "정의·개념",
	red: "의문·반론",
	purple: "나중에 보기",
};

export const MAX_COLORS = 8;

export const DEFAULT_SETTINGS: MarginNotesSettings = {
	commentFolder: "Annotations",
	subfolderPerNote: true,
	fileNamePattern: "{{source}} - {{quote}} - {{id}}",
	colors: DEFAULT_COLORS,
	defaultColor: "yellow",
	openFileAfterCreate: false,
	onRemoveHighlight: "ask",
	showPlainHighlights: true,
	excludeFolders: [],
	previewLines: 3,
	followEditorScroll: false,
	showSelectionToolbar: true,
};

export function defaultTabState(tab: "current" | "all"): TabState {
	return {
		query: "",
		colorFilter: [],
		statusFilter: [],
		groupBy: tab === "all" ? "note" : "none",
		sortBy: "position",
		collapsedGroups: [],
		searchVisible: true,
	};
}

export const DEFAULT_UI_STATE: UiState = {
	activeTab: "current",
	tabs: { current: defaultTabState("current"), all: defaultTabState("all") },
};

/** data.json을 읽어 빠진 값을 기본값으로 채운다 (5.2절) */
export function mergeData(loaded: unknown): PluginData {
	const raw = (loaded && typeof loaded === "object" ? loaded : {}) as Partial<PluginData>;
	const settings: MarginNotesSettings = Object.assign({}, DEFAULT_SETTINGS, raw.settings ?? {});
	if (!Array.isArray(settings.colors) || settings.colors.length === 0) settings.colors = DEFAULT_COLORS.map((c) => ({ ...c }));
	else
		settings.colors = settings.colors.map((c) => {
			const fresh = DEFAULT_COLORS.find((d) => d.key === c.key);
			return fresh && OLD_DEFAULT_NAMES[c.key] === c.name ? { ...c, name: fresh.name } : { ...c };
		});
	if (!settings.colors.some((c) => c.key === settings.defaultColor)) settings.defaultColor = settings.colors[0].key;
	if (!Array.isArray(settings.excludeFolders)) settings.excludeFolders = [];
	settings.previewLines = Math.min(10, Math.max(1, Number(settings.previewLines) || 3));

	const ui = raw.uiState as Partial<UiState> | undefined;
	const uiState: UiState = {
		activeTab: ui?.activeTab === "all" ? "all" : "current",
		tabs: {
			current: Object.assign(defaultTabState("current"), ui?.tabs?.current ?? {}),
			all: Object.assign(defaultTabState("all"), ui?.tabs?.all ?? {}),
		},
	};
	return { settings, uiState };
}

/** 사용자가 추가한 색의 key: c1, c2, … 중 비어 있는 첫 번째 */
export function nextColorKey(colors: HighlightColor[]): string {
	for (let i = 1; ; i++) {
		const k = `c${i}`;
		if (!colors.some((c) => c.key === k)) return k;
	}
}
