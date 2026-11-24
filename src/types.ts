import type { TFile } from "obsidian";

export interface HighlightColor {
	key: string; // 'yellow' — 파일에 저장되는 값, 영문 소문자
	name: string; // '중요' — 사용자가 붙이는 이름 (필터·그룹 표시용)
	color: string; // '#ffd54f' — 하이라이트 배경색
}

export interface Highlight {
	filePath: string; // 원본 노트 경로
	line: number; // 0부터 시작하는 줄 번호
	from: number; // 문서 오프셋: 여는 == 위치
	to: number; // 문서 오프셋: 닫는 == 뒤, ID가 있으면 %%mn:…%% 뒤
	textFrom: number; // 문구만의 시작 오프셋
	textTo: number; // 문구만의 끝 오프셋
	text: string; // 하이라이트 문구
	id: string | null; // 앵커 ID, 없으면 null (일반 하이라이트)
	heading: string | null; // 이 하이라이트 위의 가장 가까운 제목
	order: number; // 노트 안 순번 (0부터)
}

export interface Annotation {
	id: string;
	file: TFile; // 코멘트 파일
	sourcePath: string; // mn-source-path
	quote: string; // mn-quote
	color: string; // mn-color
	created: string; // mn-created
	updated: string; // mn-updated
	tags: string[];
	body: string | null; // 코멘트 본문 캐시. null = 아직 안 읽음
}

export type ItemStatus = "linked" | "plain" | "orphan";
// linked = 하이라이트 + 코멘트 파일, plain = ID 없는 하이라이트, orphan = 코멘트 파일만 있음

/** 필터·검색에서 쓰는 상태 (7.4절: 코멘트 있음 / 코멘트 없음 / 원문 없음) */
export type FilterStatus = "commented" | "plain" | "orphan";

export interface SidebarItem {
	key: string; // id 또는 `${filePath}:${from}` (plain)
	status: ItemStatus;
	highlight: Highlight | null;
	annotation: Annotation | null;
	/** 노트에 ID는 있는데 코멘트 파일이 없음 (E6, E11) */
	missingFile?: boolean;
	/** 같은 ID가 두 번 이상 나온 것 중 연결되지 않은 쪽 (E4) */
	duplicate?: boolean;
	/** 고아인데 원본 노트 자체가 없음 (E5) */
	sourceMissing?: boolean;
	/** 고아인데 노트에 `%%mn:id%%`만 남아 있음 (E2) */
	strayAnchor?: boolean;
	/** duplicate일 때 연결된 쪽의 코멘트 (새 ID로 분리할 때 복사 원본) */
	duplicateOf?: Annotation;
	/** 노트 경로 (원문이 없는 고아도 sourcePath로 채움) */
	notePath: string;
}

export interface MarginNotesSettings {
	commentFolder: string; // 기본 'Annotations'
	subfolderPerNote: boolean; // 기본 true
	fileNamePattern: string; // 기본 '{{source}} - {{quote}} - {{id}}'
	colors: HighlightColor[]; // 기본 5개
	defaultColor: string; // 기본 'yellow'
	openFileAfterCreate: boolean; // 기본 false
	onRemoveHighlight: "ask" | "keep" | "trash"; // 기본 'ask'
	showPlainHighlights: boolean; // 기본 true
	excludeFolders: string[]; // 기본 []
	previewLines: number; // 기본 3
	followEditorScroll: boolean; // 기본 false
}

export type TabId = "current" | "all";
export type GroupBy = "none" | "color" | "heading" | "note" | "folder" | "date";
export type SortBy = "position" | "created" | "updated" | "alpha";

export interface TabState {
	query: string;
	colorFilter: string[]; // 빈 배열 = 전부
	statusFilter: FilterStatus[]; // 빈 배열 = 전부
	groupBy: GroupBy;
	sortBy: SortBy;
	collapsedGroups: string[];
	searchVisible: boolean;
}

export interface UiState {
	activeTab: TabId;
	tabs: Record<TabId, TabState>;
}

export interface PluginData {
	settings: MarginNotesSettings;
	uiState: UiState;
}
