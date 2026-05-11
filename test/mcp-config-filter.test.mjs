import assert from "node:assert/strict";
import test from "node:test";
import { filterTools, isToolAllowed } from "../dist/mcp/config.js";

const TOOLS = [
	{ name: "read_file" },
	{ name: "read_dir" },
	{ name: "write_file" },
	{ name: "admin.reset" },
];

test("MCP config filtering allows every tool when no filters are configured", () => {
	assert.deepEqual(filterTools(TOOLS, {}).map((tool) => tool.name), [
		"read_file",
		"read_dir",
		"write_file",
		"admin.reset",
	]);
	assert.equal(isToolAllowed("read_file", {}), true);
});

test("MCP config filtering applies allowedTools glob patterns", () => {
	const config = { allowedTools: ["read_*"] };

	assert.deepEqual(filterTools(TOOLS, config).map((tool) => tool.name), ["read_file", "read_dir"]);
	assert.equal(isToolAllowed("read_file", config), true);
	assert.equal(isToolAllowed("write_file", config), false);
});

test("MCP config filtering gives disabledTools precedence over allowedTools", () => {
	const config = { allowedTools: ["*_file", "admin.*"], disabledTools: ["write_*", "admin.*"] };

	assert.deepEqual(filterTools(TOOLS, config).map((tool) => tool.name), ["read_file"]);
	assert.equal(isToolAllowed("read_file", config), true);
	assert.equal(isToolAllowed("write_file", config), false);
	assert.equal(isToolAllowed("admin.reset", config), false);
});

test("MCP config filtering matches globs case-insensitively", () => {
	const config = { allowedTools: ["READ_*"] };

	assert.deepEqual(filterTools(TOOLS, config).map((tool) => tool.name), ["read_file", "read_dir"]);
	assert.equal(isToolAllowed("read_file", config), true);
});

test("MCP config filtering treats ? as exactly one character", () => {
	const config = { allowedTools: ["read_?ir"] };

	assert.deepEqual(filterTools(TOOLS, config).map((tool) => tool.name), ["read_dir"]);
	assert.equal(isToolAllowed("read_dir", config), true);
	assert.equal(isToolAllowed("read_file", config), false);
});
