import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createWebAnnotationsWebApp } from "../web-annotations/api.js";
import { WEB_ANNOTATION_TOOL_NAMES, createWebAnnotationToolProfiles } from "../web-annotations/tools.js";
import { definePiboPlugin } from "./registry.js";

const PIBO_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function webAnnotationsSkillPath(): string {
	return resolve(PIBO_PACKAGE_ROOT, "skills", "builtin", "web-annotations", "SKILL.md");
}

export const piboWebAnnotationsPlugin = definePiboPlugin({
	id: "pibo.web-annotations",
	name: "Pibo Web Annotations",
	register(api) {
		api.registerTools(createWebAnnotationToolProfiles());
		api.registerWebApp(createWebAnnotationsWebApp());
		api.registerCapabilityPackage({
			name: "web-annotation-agent-tools",
			description: "Expose session-scoped Web Annotation tools for listing, reading, watching, and lifecycle updates.",
			toolNames: [...WEB_ANNOTATION_TOOL_NAMES],
		});
		api.registerSkill({
			name: "web-annotations",
			path: webAnnotationsSkillPath(),
			kind: "builtin",
		});
	},
});
