import { createRequire } from "node:module";
import type { TerminalInlineToken } from "../../session-ui/index.js";

const require = createRequire(import.meta.url);

type PrismToken = {
	type: string;
	content: PrismTokenContent;
	alias?: string | string[];
};

type PrismTokenContent = string | PrismToken | Array<string | PrismToken>;

type PrismInstance = {
	languages: Record<string, unknown>;
	tokenize(code: string, grammar: unknown): Array<string | PrismToken>;
};

const languageAliases = new Map<string, string>([
	["sh", "bash"],
	["shell", "bash"],
	["shellscript", "bash"],
	["zsh", "bash"],
	["js", "javascript"],
	["mjs", "javascript"],
	["cjs", "javascript"],
	["ts", "typescript"],
	["mts", "typescript"],
	["cts", "typescript"],
	["md", "markdown"],
	["yml", "yaml"],
	["jsonc", "json"],
	["py", "python"],
	["rs", "rust"],
]);

const grammarComponents: Record<string, string[]> = {
	bash: ["bash"],
	css: ["css"],
	go: ["go"],
	html: ["markup"],
	javascript: ["javascript"],
	json: ["json"],
	jsx: ["markup", "javascript", "jsx"],
	markdown: ["markup", "markdown"],
	python: ["python"],
	rust: ["rust"],
	sql: ["sql"],
	tsx: ["markup", "javascript", "jsx", "typescript", "tsx"],
	typescript: ["javascript", "typescript"],
	yaml: ["yaml"],
};

const loadedComponents = new Set<string>();
let prismInstance: PrismInstance | undefined;

export function highlightInkCodeLine(sourceLine: string, language: string): TerminalInlineToken[] | undefined {
	if (shouldUsePlainCodeTokens()) return [{ text: sourceLine, tone: "default" }];
	const normalizedLanguage = normalizeInkCodeLanguage(language);
	const prism = loadPrism();
	if (!loadGrammar(prism, normalizedLanguage)) return undefined;
	const grammar = prism.languages[normalizedLanguage];
	if (!grammar) return undefined;
	try {
		return flattenPrismTokens(prism.tokenize(sourceLine, grammar));
	} catch {
		return undefined;
	}
}

export function normalizeInkCodeLanguage(language: string): string {
	const normalized = language.trim().toLowerCase();
	return languageAliases.get(normalized) ?? normalized;
}

function loadPrism(): PrismInstance {
	prismInstance ??= require("prismjs") as PrismInstance;
	return prismInstance;
}

function loadGrammar(prism: PrismInstance, language: string): boolean {
	const components = grammarComponents[language];
	if (!components) return false;
	for (const component of components) {
		if (loadedComponents.has(component)) continue;
		require(`prismjs/components/prism-${component}.js`);
		loadedComponents.add(component);
	}
	return Boolean(prism.languages[language]);
}

function flattenPrismTokens(tokens: Array<string | PrismToken>, inheritedTone: TerminalInlineToken["tone"] = "default"): TerminalInlineToken[] {
	const result: TerminalInlineToken[] = [];
	for (const token of tokens) {
		if (typeof token === "string") {
			if (token.length > 0) result.push({ text: token, tone: inheritedTone });
			continue;
		}
		const tone = toneForPrismToken(token) ?? inheritedTone;
		appendPrismContent(result, token.content, tone);
	}
	return mergeAdjacentTokens(result);
}

function appendPrismContent(result: TerminalInlineToken[], content: PrismTokenContent, tone: TerminalInlineToken["tone"]): void {
	if (typeof content === "string") {
		if (content.length > 0) result.push({ text: content, tone });
		return;
	}
	if (Array.isArray(content)) {
		result.push(...flattenPrismTokens(content, tone));
		return;
	}
	const nestedTone = toneForPrismToken(content) ?? tone;
	appendPrismContent(result, content.content, nestedTone);
}

function toneForPrismToken(token: PrismToken): TerminalInlineToken["tone"] | undefined {
	const classes = [token.type, ...aliasesForToken(token)];
	for (const className of classes) {
		switch (className) {
			case "comment":
			case "prolog":
			case "doctype":
			case "cdata":
				return "dim";
			case "string":
			case "char":
			case "attr-value":
			case "url":
				return "green";
			case "number":
			case "boolean":
			case "constant":
				return "blue";
			case "keyword":
			case "operator":
			case "punctuation":
			case "important":
			case "atrule":
				return "magenta";
			case "function":
			case "method":
			case "selector":
			case "class-name":
				return "yellow";
			case "tag":
			case "property":
			case "attr-name":
			case "variable":
			case "regex":
				return "cyan";
			case "builtin":
			case "symbol":
			case "deleted":
				return "red";
			default:
				break;
		}
	}
	return undefined;
}

function aliasesForToken(token: PrismToken): string[] {
	if (!token.alias) return [];
	return Array.isArray(token.alias) ? token.alias : [token.alias];
}

function mergeAdjacentTokens(tokens: TerminalInlineToken[]): TerminalInlineToken[] {
	const merged: TerminalInlineToken[] = [];
	for (const token of tokens) {
		const previous = merged[merged.length - 1];
		if (previous && previous.tone === token.tone && previous.weight === token.weight && previous.italic === token.italic) {
			previous.text += token.text;
		} else {
			merged.push({ ...token });
		}
	}
	return merged;
}

function shouldUsePlainCodeTokens(): boolean {
	return Boolean(process.env.NO_COLOR) || process.env.TERM === "dumb" || process.env.PIBO_ASCII_PROGRESS === "1";
}
