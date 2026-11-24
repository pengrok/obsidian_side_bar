// 수동 테스트용 보관함 만들기 (10장 M20, 10.1절 샘플 노트)
// 사용: node scripts/make-test-vault.mjs <보관함 경로> [노트 수=500] [노트당 하이라이트=4]
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const [, , root, notesArg = "500", perArg = "4"] = process.argv;
if (!root) {
	console.error("사용: node scripts/make-test-vault.mjs <보관함 경로> [노트 수] [노트당 하이라이트]");
	process.exit(1);
}
const notes = Number(notesArg);
const per = Number(perArg);
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const iso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:00+09:00`;

mkdirSync(join(root, "테스트"), { recursive: true });
copyFileSync(new URL("../tests/fixtures/sample.md", import.meta.url), join(root, "테스트", "샘플.md"));

let k = 0;
for (let n = 0; n < notes; n++) {
	const dir = join(root, "부하", `폴더${n % 10}`);
	mkdirSync(dir, { recursive: true });
	const name = `노트 ${n}`;
	const lines = [`# ${name}`];
	for (let h = 0; h < per; h++, k++) {
		const id = "t" + k.toString(36).padStart(5, "0");
		lines.push(`## 절 ${h}`, `문장 ${h}: ==하이라이트 ${n}-${h}==%%mn:${id}%% 뒤에 이어지는 본문. ` + "채우는 글 ".repeat(30));
		if (h % 2 === 0) {
			const cdir = join(root, "Annotations", name);
			mkdirSync(cdir, { recursive: true });
			writeFileSync(
				join(cdir, `${name} - 하이라이트 ${n}-${h} - ${id}.md`),
				[
					"---",
					`mn-id: ${id}`,
					`mn-source: "[[${name}]]"`,
					`mn-source-path: "부하/폴더${n % 10}/${name}.md"`,
					`mn-quote: "하이라이트 ${n}-${h}"`,
					`mn-color: ${["yellow", "green", "blue", "red", "purple"][h % 5]}`,
					`mn-created: ${iso}`,
					`mn-updated: ${iso}`,
					"tags: []",
					"---",
					`노트 ${n}의 ${h}번째 코멘트`,
				].join("\n"),
			);
		}
	}
	writeFileSync(join(dir, `${name}.md`), lines.join("\n\n"));
}
console.log(`노트 ${notes}개, 하이라이트 ${notes * per}개, 코멘트 파일 ${Math.ceil(per / 2) * notes}개를 ${root}에 만들었어요.`);
