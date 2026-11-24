const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ID_RE = /^[a-z0-9]{6}$/;

/** 무작위 6자 앵커 ID. exists가 true를 돌려주면 다시 만든다 (E17). */
export function generateId(exists: (id: string) => boolean = () => false): string {
	for (let attempt = 0; attempt < 100; attempt++) {
		const bytes = new Uint8Array(6);
		crypto.getRandomValues(bytes);
		let id = "";
		for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
		if (!exists(id)) return id;
	}
	throw new Error("앵커 ID를 만들지 못했어요");
}

export function isValidId(id: unknown): id is string {
	return typeof id === "string" && ID_RE.test(id);
}
