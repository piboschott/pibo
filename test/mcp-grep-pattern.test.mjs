import assert from "node:assert/strict";
import test from "node:test";

import { globToRegex } from "../dist/mcp/commands/grep.js";

function matches(pattern, value) {
  return globToRegex(pattern).test(value);
}

test("globToRegex matches simple tool-name globs case-insensitively", () => {
  assert.equal(matches("*file*", "read_file"), true);
  assert.equal(matches("*file*", "FileUtils"), true);
  assert.equal(matches("*file*", "read/tool"), false);
});

test("globToRegex keeps single-star matches within one slash segment", () => {
  assert.equal(matches("server/*", "server/tool"), true);
  assert.equal(matches("server/*", "server/sub/tool"), false);
});

test("globToRegex lets globstar match nested slash segments", () => {
  assert.equal(matches("server/**", "server/tool"), true);
  assert.equal(matches("server/**", "server/sub/tool"), true);
  assert.equal(matches("server/**", "other/server/tool"), false);
});

test("globToRegex escapes regex metacharacters in literal text", () => {
  assert.equal(matches("tools/read.file", "tools/read.file"), true);
  assert.equal(matches("tools/read.file", "tools/readXfile"), false);
});

test("globToRegex question mark matches exactly one non-slash character", () => {
  assert.equal(matches("tool-?", "tool-a"), true);
  assert.equal(matches("tool-?", "tool-ab"), false);
  assert.equal(matches("tool-?", "tool-/"), false);
});
