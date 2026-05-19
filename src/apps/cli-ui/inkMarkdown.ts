import type { CompactTerminalLine, TerminalInlineToken } from "../../session-ui/index.js";
import { sanitizeTerminalText, tokenizeJsonTextLine } from "./inkJson.js";

export type InkMarkdownOptions = {
	maxChars?: number;
	maxLines?: number;
	reasoning?: boolean;
};

export function renderInkMarkdownLines(markdown: string | undefined, options: InkMarkdownOptions = {}): string[] {
	return renderInkMarkdownTerminalLines(markdown, options).map((line) => line.tokens.map((token) => token.text).join(""));
}

export function renderInkMarkdownTerminalLines(markdown: string | undefined, options: InkMarkdownOptions = {}): CompactTerminalLine[] {
	const sourceLines = sanitizeTerminalText(markdown ?? "").split("\n");
	const result: CompactTerminalLine[] = [];
	let inCodeFence = false;
	let codeLanguage = "";
	for (const sourceLine of sourceLines) {
		const fence = sourceLine.trim().match(/^```\s*([\w-]+)?/);
		if (fence) {
			if (inCodeFence) {
				result.push(line([{ text: "└ code", tone: "dim" }]));
				inCodeFence = false;
				codeLanguage = "";
			} else {
				inCodeFence = true;
				codeLanguage = (fence[1] ?? "text").toLowerCase();
				result.push(line([{ text: `┌ code ${codeLanguage}`, tone: "dim" }]));
			}
			continue;
		}
		if (inCodeFence) {
			result.push(line(codeFenceTokens(sourceLine.replace(/\t/g, "    "), codeLanguage)));
			continue;
		}
		const trimmed = sourceLine.trim();
		if (!trimmed) {
			if (result.length > 0 && textForLine(result[result.length - 1]) !== "") result.push(line([{ text: "" }]));
			continue;
		}
		result.push(markdownLine(sourceLine, options));
	}
	while (result.length > 0 && textForLine(result[result.length - 1]) === "") result.pop();
	const bounded = options.maxLines ? result.slice(0, options.maxLines) : result;
	return bounded.length > 0 ? bounded : [line([{ text: "" }])];
}

export function tokenizeInkBashCommand(command: string): TerminalInlineToken[] {
	const chunks = sanitizeTerminalText(command).match(/\s+|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:&&|\|\||2>&1)|[|;<>]|[^\s|;<>]+/g) ?? [command];
	let seenCommand = false;
	return chunks.map((chunk) => {
		if (/^\s+$/.test(chunk)) return { text: chunk };
		if (/^(?:&&|\|\||[|;<>]|2>&1)$/.test(chunk)) return { text: chunk, tone: "red", weight: "semibold" };
		if (chunk.startsWith("-")) return { text: chunk, tone: "magenta" };
		if (chunk.startsWith("$") || /^\w+=/.test(chunk)) return { text: chunk, tone: "yellow" };
		if (/^['"]/.test(chunk)) return { text: chunk, tone: "green" };
		if (!seenCommand) {
			seenCommand = true;
			return { text: chunk, tone: "green", weight: "semibold" };
		}
		if (chunk.includes("/") || chunk.startsWith(".")) return { text: chunk, tone: "cyan" };
		return { text: chunk, tone: "default" };
	});
}

function markdownLine(sourceLine: string, options: InkMarkdownOptions): CompactTerminalLine {
	const indent = sourceLine.match(/^\s*/)?.[0] ?? "";
	const trimmed = sourceLine.trim();
	const reasoningTone = options.reasoning ? "amber" : undefined;
	const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
	if (heading) return line([{ text: `${heading[1]} `, tone: "dim" }, ...inlineMarkdownTokens(heading[2] ?? "", { weight: "semibold", tone: reasoningTone })]);
	const unordered = trimmed.match(/^([-*+])\s+(.*)$/);
	if (unordered) return line([{ text: indent, tone: "dim" }, { text: "• ", tone: options.reasoning ? "amber" : "cyan" }, ...inlineMarkdownTokens(unordered[2] ?? "", { tone: reasoningTone })]);
	const ordered = trimmed.match(/^(\d+[.)])\s+(.*)$/);
	if (ordered) return line([{ text: indent, tone: "dim" }, { text: `${ordered[1]} `, tone: options.reasoning ? "amber" : "cyan" }, ...inlineMarkdownTokens(ordered[2] ?? "", { tone: reasoningTone })]);
	const quote = trimmed.match(/^>\s?(.*)$/);
	if (quote) return line([{ text: "> ", tone: options.reasoning ? "amber" : "cyan" }, ...inlineMarkdownTokens(quote[1] ?? "", { tone: reasoningTone })]);
	if (/^\|.*\|$/.test(trimmed)) return line([{ text: trimmed, tone: "dim" }]);
	return line(inlineMarkdownTokens(trimmed, { tone: reasoningTone }));
}

function inlineMarkdownTokens(text: string, defaults: Pick<TerminalInlineToken, "tone" | "weight"> = {}): TerminalInlineToken[] {
	const tokens: TerminalInlineToken[] = [];
	const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
	let lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text))) {
		if (match.index > lastIndex) tokens.push({ text: text.slice(lastIndex, match.index), ...defaults });
		if (match[1] !== undefined) tokens.push({ text: `\`${match[1]}\``, tone: "cyan" });
		else if (match[2] !== undefined) tokens.push({ text: match[2], tone: "cyan" }, { text: ` (${match[3]})`, tone: "dim" });
		else if (match[4] !== undefined || match[5] !== undefined) tokens.push({ text: match[4] ?? match[5] ?? "", tone: defaults.tone, weight: "semibold" });
		else tokens.push({ text: match[6] ?? match[7] ?? "", tone: defaults.tone, italic: true });
		lastIndex = pattern.lastIndex;
	}
	if (lastIndex < text.length) tokens.push({ text: text.slice(lastIndex), ...defaults });
	return tokens.filter((token) => token.text.length > 0);
}

function codeFenceTokens(sourceLine: string, language: string): TerminalInlineToken[] {
	if (isBashLanguage(language)) return [{ text: "  " }, ...tokenizeInkBashCommand(sourceLine)];
	if (language === "json" || language === "jsonc") return [{ text: "  " }, ...tokenizeJsonTextLine(sourceLine)];
	return [{ text: `  ${sourceLine}`, tone: "default" }];
}

function isBashLanguage(language: string): boolean {
	return ["bash", "sh", "shell", "zsh"].includes(language);
}

function line(tokens: TerminalInlineToken[]): CompactTerminalLine {
	return { prefix: "none", tokens };
}

function textForLine(lineValue: CompactTerminalLine | undefined): string {
	return lineValue?.tokens.map((token) => token.text).join("") ?? "";
}
