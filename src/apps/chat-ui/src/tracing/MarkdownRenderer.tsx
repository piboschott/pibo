import ReactMarkdown, { defaultUrlTransform, type Components, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import prism from "../context/prism-client";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

type MarkdownRendererProps = {
	children: string;
};

const allowedElements = [
	"p",
	"br",
	"strong",
	"em",
	"a",
	"ul",
	"ol",
	"li",
	"blockquote",
	"code",
	"pre",
	"h1",
	"h2",
	"h3",
	"h4",
	"hr",
	"table",
	"thead",
	"tbody",
	"tr",
	"th",
	"td",
	"input",
	"del",
];

const components: Components = {
	p({ children, node: _node, ...props }) {
		return <p data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="p" {...props}>{children}</p>;
	},
	ul({ children, node: _node, ...props }) {
		return <ul data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="ul" {...props}>{children}</ul>;
	},
	ol({ children, node: _node, ...props }) {
		return <ol data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="ol" {...props}>{children}</ol>;
	},
	li({ children, node: _node, ...props }) {
		return <li data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="li" {...props}>{children}</li>;
	},
	blockquote({ children, node: _node, ...props }) {
		return <blockquote data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="blockquote" {...props}>{children}</blockquote>;
	},
	pre({ children, node: _node, ...props }) {
		return <pre data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="pre" {...props}>{children}</pre>;
	},
	a({ href, children }) {
		return (
			<a href={href} target="_blank" rel="noreferrer" data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="a">
				{children}
			</a>
		);
	},
	code({ className, children, node: _node, ...props }) {
		const language = languageFromClassName(className);
		const code = String(children).replace(/\n$/, "");
		if (!language) {
			return (
				<code className={className} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="code" {...props}>
					{children}
				</code>
			);
		}
		const grammar = prism.languages[language];
		if (!grammar) {
			return (
				<code className={className} data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="code" {...props}>
					{children}
				</code>
			);
		}
		return (
			<code
				className={`language-${language}`}
				data-pibo-component="MarkdownRenderer"
				data-pibo-markdown-node="code"
				dangerouslySetInnerHTML={{ __html: prism.highlight(code, grammar, language) }}
				{...props}
			/>
		);
	},
	th({ children, node: _node, ...props }) {
		return <th data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="th" {...props}>{children}</th>;
	},
	td({ children, node: _node, ...props }) {
		return <td data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="td" {...props}>{children}</td>;
	},
	input({ checked, node: _node, ...props }) {
		return <input type="checkbox" checked={Boolean(checked)} readOnly disabled data-pibo-component="MarkdownRenderer" data-pibo-markdown-node="input" {...props} />;
	},
};

function languageFromClassName(className?: string): string | undefined {
	const match = /language-(\S+)/.exec(className ?? "");
	if (!match) return undefined;
	const language = match[1].toLowerCase();
	if (language === "sh" || language === "shell") return "bash";
	if (language === "js") return "javascript";
	if (language === "ts") return "typescript";
	if (language === "md") return "markdown";
	if (language === "yml") return "yaml";
	return language;
}

const safeUrlTransform: UrlTransform = (url, key, node) => {
	if (node.tagName !== "a" || key !== "href") return "";
	const transformed = defaultUrlTransform(url);
	if (!transformed) return "";
	if (transformed.startsWith("/") || transformed.startsWith("#")) return transformed;
	try {
		const parsed = new URL(transformed);
		return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:" ? transformed : "";
	} catch {
		return "";
	}
};

export function MarkdownRenderer({ children }: MarkdownRendererProps) {
	return (
		<ReactMarkdown
			allowedElements={allowedElements}
			components={components}
			remarkPlugins={[remarkGfm]}
			skipHtml
			urlTransform={safeUrlTransform}
		>
			{children}
		</ReactMarkdown>
	);
}
