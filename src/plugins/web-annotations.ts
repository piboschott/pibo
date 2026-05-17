import { WEB_ANNOTATION_TOOL_NAMES, createWebAnnotationToolProfiles } from "../web-annotations/tools.js";
import { definePiboPlugin } from "./registry.js";

export const piboWebAnnotationsPlugin = definePiboPlugin({
	id: "pibo.web-annotations",
	name: "Pibo Web Annotations",
	register(api) {
		api.registerTools(createWebAnnotationToolProfiles());
		api.registerCapabilityPackage({
			name: "web-annotation-agent-tools",
			description: "Expose session-scoped Web Annotation tools for listing, reading, watching, and lifecycle updates.",
			toolNames: [...WEB_ANNOTATION_TOOL_NAMES],
		});
	},
});
