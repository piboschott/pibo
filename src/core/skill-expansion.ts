import { readFileSync } from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";

export function expandInlineSkills(text: string, skills: Skill[]): string {
	try {
		const pattern = /(?<!\\)\$([a-z0-9-]+)/g;
		const matches = [...text.matchAll(pattern)];

		const seen = new Set<string>();
		const toExpand: Skill[] = [];

		for (const match of matches) {
			const name = match[1];
			if (seen.has(name)) continue;
			const skill = skills.find((s) => s.name === name);
			if (!skill) continue;
			seen.add(name);
			toExpand.push(skill);
		}

		if (toExpand.length === 0) return text;

		const appendices = toExpand.map((skill) => {
			try {
				const content = readFileSync(skill.filePath, "utf-8");
				const body = stripFrontmatter(content).trim();
				return `---\n\n$${skill.name}\n${body}`;
			} catch {
				return `---\n\n$${skill.name}\n[Error: could not load skill content]`;
			}
		});

		return `${text}\n\n${appendices.join("\n\n")}`;
	} catch {
		return text;
	}
}

function stripFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const endIndex = content.indexOf("---", 3);
	if (endIndex === -1) return content;
	return content.slice(endIndex + 3).trimStart();
}
