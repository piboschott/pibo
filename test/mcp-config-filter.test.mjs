import assert from "node:assert/strict";
import test from "node:test";
import { filterTools, isToolAllowed } from "../dist/mcp/config.js";

const baseConfig = { command: "node", args: ["server.js"] };
const tools = [
	{ name: "read_file", title: "Read" },
	{ name: "read_dir", title: "List" },
	{ name: "write_file", title: "Write" },
	{ name: "delete_file", title: "Delete" },
	{ name: "read_A", title: "Read one" },
	{ name: "read_ab", title: "Read two" },
];

test("MCP tool filtering allows every tool when no filters are configured", () => {
	assert.deepEqual(filterTools(tools, baseConfig).map((tool) => tool.name), tools.map((tool) => tool.name));
	assert.equal(isToolAllowed("write_file", baseConfig), true);
});

test("MCP allowedTools restricts tools by glob pattern", () => {
	const config = { ...baseConfig, allowedTools: ["read_*"] };

	assert.deepEqual(filterTools(tools, config).map((tool) => tool.name), [
		"read_file",
		"read_dir",
		"read_A",
		"read_ab",
	]);
	assert.equal(isToolAllowed("read_file", config), true);
	assert.equal(isToolAllowed("write_file", config), false);
});

test("MCP disabledTools takes precedence over allowedTools", () => {
	const config = { ...baseConfig, allowedTools: ["*_file"], disabledTools: ["write_*"] };

	assert.deepEqual(filterTools(tools, config).map((tool) => tool.name), ["read_file", "delete_file"]);
	assert.equal(isToolAllowed("write_file", config), false);
	assert.equal(isToolAllowed("delete_file", config), true);
});

test("MCP tool glob matching is case-insensitive", () => {
	const config = { ...baseConfig, allowedTools: ["READ_*"] };

	assert.equal(isToolAllowed("read_file", config), true);
	assert.deepEqual(filterTools([{ name: "read_file" }, { name: "WRITE_FILE" }], config), [
		{ name: "read_file" },
	]);
});

test("MCP question-mark glob matches exactly one character", () => {
	const config = { ...baseConfig, allowedTools: ["read_?"] };

	assert.equal(isToolAllowed("read_A", config), true);
	assert.equal(isToolAllowed("read_ab", config), false);
	assert.deepEqual(filterTools(tools, config).map((tool) => tool.name), ["read_A"]);
});
