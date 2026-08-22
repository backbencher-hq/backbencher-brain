// script/m13/verify-edit-body.ts — M13.09 (E4).
//
// Proves inside-top/inside-bottom find the body region via tree-sitter body
// nodes (not a { } scan) and insert correctly across the three body styles:
// brace (TS), indentation (Python), and keyword-terminated (Ruby/Lua).
// Unsupported bodies (Elixir do/end) fail loudly, never silently no-op.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { parseForSafety } from "../../src/ast/safety-primitives"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.09",
  code: "E4",
  tool: "bb_edit",
  title: "bb_edit: language-aware insert body detection",
  layers: ["unit", "integration"],
  decisions: {
    bodySource: "tree-sitter body nodes (block / compound_statement / statement_block / function_body / body_statement / do_block / …) via parseForSafety.bodyRanges — no { } scan",
    brace: "body node starting with '{' → inside-top = open+1, inside-bottom = close-1",
    soft: "indented/keyword body → indented insert at body start/end",
    failLoud: "non-line-aligned bodies (e.g. Elixir do/end) and body-less anchors throw a clear error, never silently no-op",
  },
  limitations: [
    "Elixir do/end bodies are not yet inserted (do_block starts mid-line; the indentation anchor is ambiguous). Fails loudly.",
    "Expression-bodied functions without a block (e.g. Kotlin `fun f() = expr`) have no body block; insert inside them fails loudly.",
    "Lua `return` must be the last statement in a block, so inside-bottom after a return body is invalid Lua and the validator rejects it loudly (correct: no silent corruption).",
  ],
})

// ── UNIT: body ranges are detected per language ─────────────────────────────
const bodyFixtures: Array<{ lang: string; file: string; code: string; bodyType: string }> = [
  { lang: "typescript", file: "a.ts", code: `export function target(): number {\n  return 1\n}\n`, bodyType: "statement_block" },
  { lang: "java", file: "A.java", code: `class A { int target() { return 1; } }\n`, bodyType: "block" },
  { lang: "rust", file: "a.rs", code: `fn target() -> i32 { 1 }\n`, bodyType: "block" },
  { lang: "python", file: "a.py", code: `def target():\n    return 1\n`, bodyType: "block" },
  { lang: "ruby", file: "a.rb", code: `def target\n  return 1\nend\n`, bodyType: "body_statement" },
  { lang: "lua", file: "a.lua", code: `function target()\n  return 1\nend\n`, bodyType: "block" },
  { lang: "elixir", file: "a.ex", code: `def target do\n  1\nend\n`, bodyType: "do_block" },
]
for (const f of bodyFixtures) {
  const parsed = await parseForSafety(f.file, f.code)
  const hit = parsed.bodyRanges.some((b) => b.nodeType === f.bodyType)
  harness.check(`${f.lang}: body node "${f.bodyType}" is detected`, hit, parsed.bodyRanges.map((b) => b.nodeType).join(","))
}

// ── INTEGRATION: insert across the three body styles ────────────────────────
async function insertAndRead(label: string, file: string, code: string, symbol: string, position: "inside-top" | "inside-bottom", content: string): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e4-${label}-`))
  const dir = path.dirname(file)
  if (dir !== ".") mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, file), code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    await executeEdit(root, projectId, { mode: "insert", targetSymbolName: symbol, filePath: file, position, newContent: content, format: false })
    return readFileSync(path.join(root, file), "utf8")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

// brace (TS)
{
  const after = await insertAndRead("ts", "a.ts", `export function target(): number {\n  return 1\n}\n`, "target", "inside-bottom", "const insertedLine = true")
  harness.check("TS brace: inside-bottom inserts inside the braces", after.includes("const insertedLine = true") && after.indexOf("insertedLine") < after.lastIndexOf("}"), after)

  // nested blocks: insert must land in the OUTER function body, not the inner if-block
  const nested = await insertAndRead("ts-nested", "a.ts", `export function target(): number {\n  if (true) {\n    return 1\n  }\n  return 0\n}\n`, "target", "inside-bottom", "const insertedLine = true")
  harness.check(
    "TS nested: inside-bottom lands in the outermost body (after return 0, before final brace)",
    /return 0\n  const insertedLine = true\n}/.test(nested),
    JSON.stringify(nested),
  )

  // single-line brace body → exploded to multi-line on insert
  const javaSingle = await insertAndRead("java-single", "A.java", `class A { int target() { return 1; } }\n`, "target", "inside-bottom", "return 2;")
  harness.check(
    "Java single-line brace: inside-bottom explodes and inserts before the closing brace",
    /int target\(\) \{\n  return 1;\n  return 2;\n\}/.test(javaSingle),
    JSON.stringify(javaSingle),
  )
  const rustSingle = await insertAndRead("rust-single", "a.rs", `fn target() -> i32 { 1 }\n`, "target", "inside-top", "let x = 2;")
  harness.check(
    "Rust single-line brace: inside-top explodes and inserts before the body",
    /fn target\(\) -> i32 \{\n  let x = 2;\n  1\n}/.test(rustSingle),
    JSON.stringify(rustSingle),
  )
}

// indentation (Python)
{
  const afterTop = await insertAndRead("py-top", "a.py", `def target():\n    return 1\n`, "target", "inside-top", "inserted_line = True")
  harness.check("Python: inside-top inserts an indented line before the body", /def target\(\):\n    inserted_line = True\n    return 1/.test(afterTop), JSON.stringify(afterTop))
  const afterBottom = await insertAndRead("py-bottom", "a.py", `def target():\n    return 1\n`, "target", "inside-bottom", "inserted_line = True")
  harness.check("Python: inside-bottom inserts an indented line after the body", /def target\(\):\n    return 1\n    inserted_line = True/.test(afterBottom), JSON.stringify(afterBottom))
}

// keyword (Ruby + Lua)
{
  const afterRb = await insertAndRead("ruby", "a.rb", `def target\n  return 1\nend\n`, "target", "inside-bottom", "inserted_line = true")
  harness.check("Ruby: inside-bottom inserts before end", /def target\n  return 1\n  inserted_line = true\nend/.test(afterRb), JSON.stringify(afterRb))
  const afterLuaTop = await insertAndRead("lua", "a.lua", `function target()\n  local x = 1\nend\n`, "target", "inside-top", "local inserted_line = true")
  harness.check("Lua: inside-top inserts an indented line before the body", /function target\(\)\n  local inserted_line = true\n  local x = 1\nend/.test(afterLuaTop), JSON.stringify(afterLuaTop))
  const afterLua = await insertAndRead("lua", "a.lua", `function target()\n  local x = 1\nend\n`, "target", "inside-bottom", "local inserted_line = true")
  harness.check("Lua: inside-bottom inserts before end", /function target\(\)\n  local x = 1\n  local inserted_line = true\nend/.test(afterLua), JSON.stringify(afterLua))
}

// ── INTEGRATION: unsupported bodies fail loudly ──────────────────────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-e4-elixir-"))
  writeFileSync(path.join(root, "a.ex"), `def target do\n  1\nend\n`)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    await harness.rejectsAsync(
      "Elixir do/end body fails loudly (no silent no-op)",
      () => executeEdit(root, projectId, { mode: "insert", targetSymbolName: "target", filePath: "a.ex", position: "inside-bottom", newContent: "1", format: false }),
      "unsupported body form",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

// expression-bodied function (no block) fails loudly
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-e4-kotlin-"))
  writeFileSync(path.join(root, "A.kt"), `fun target() = 42\n`)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    await harness.rejectsAsync(
      "Kotlin expression body fails loudly (no body block, no silent no-op)",
      () => executeEdit(root, projectId, { mode: "insert", targetSymbolName: "target", filePath: "A.kt", position: "inside-bottom", newContent: "1", format: false }),
      "cannot insert inside target",
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

harness.emit()
