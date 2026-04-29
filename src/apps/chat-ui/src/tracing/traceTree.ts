import type { Span } from "../types";

const shouldDisplaySpan = (span: Span): boolean => {
	if (span.spanType === "model.request") return false;
	if (span.spanType === "model.response") return true;
	return true;
};

export function processSpanTree(spans: Span[]): Span[] {
	const processed: Span[] = [];

	for (const span of sortByStartTime(spans)) {
		processed.push(...displaySpansFor(span));
	}

	return processed;
}

function displaySpansFor(span: Span): Span[] {
	const children = span.children ? processSpanTree(span.children) : [];
	const { promoted, remaining } = splitPromotedReasoning(span, children);

	if (!shouldDisplaySpan(span)) return [...promoted, ...remaining];
	return [...promoted, { ...span, children: remaining }];
}

function splitPromotedReasoning(span: Span, children: Span[]): { promoted: Span[]; remaining: Span[] } {
	if (span.spanType !== "model.response") return { promoted: [], remaining: children };
	return {
		promoted: children.filter((child) => child.spanType === "model.reasoning"),
		remaining: children.filter((child) => child.spanType !== "model.reasoning"),
	};
}

function sortByStartTime(spans: Span[]): Span[] {
	return [...spans].sort((left, right) => left.startTime - right.startTime);
}
