const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ALPHABET = LETTERS + "0123456789";
export const ID_RE = /^[a-z0-9]{6}$/;

/** 균등 분포를 위해 256을 나눠떨어지게 하는 범위 밖 바이트는 버린다 */
function pick(chars: string): string {
	const limit = 256 - (256 % chars.length);
	const b = new Uint8Array(1);
	for (;;) {
		crypto.getRandomValues(b);
		if (b[0] < limit) return chars[b[0] % chars.length];
	}
}

/**
 * 무작위 6자 앵커 ID. exists가 true를 돌려주면 다시 만든다 (E17).
 * 첫 글자는 영문자로 둔다. 123456, 1e5432, 0x1abc 같은 ID는 YAML이 숫자로 읽어
 * mn-id가 문자열이 아니게 되기 때문이다.
 */
export function generateId(exists: (id: string) => boolean = () => false): string {
	for (let attempt = 0; attempt < 100; attempt++) {
		let id = pick(LETTERS);
		for (let i = 1; i < 6; i++) id += pick(ALPHABET);
		if (!exists(id)) return id;
	}
	throw new Error("앵커 ID를 만들지 못했어요");
}

export function isValidId(id: unknown): id is string {
	return typeof id === "string" && ID_RE.test(id);
}

/**
 * frontmatter의 mn-id 값을 ID 문자열로. 사용자가 숫자뿐인 ID를 직접 썼다면 YAML이
 * 숫자로 읽으므로(앞의 0은 사라짐) 6자리로 되돌려 본다.
 */
export function idFromProp(v: unknown): string | null {
	if (isValidId(v)) return v;
	if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1_000_000) return String(v).padStart(6, "0");
	return null;
}
