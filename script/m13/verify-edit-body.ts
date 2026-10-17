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
    // M71: the section appended to this gate at the bottom. It is in THIS file
    // because it answers the same question the rest of the gate does — which
    // region of the symbol does a mutation land in — for `update` instead of
    // insert, and the two share one parse of the file.
    m71: "update decides full-declaration vs body-fragment by PARSING newContent (declaredNames from each declaration's `name` field), never by a name-adjacent keyword regex; the mutated range is the DECLARATION range, which is wider than the indexed span in languages that index from the name (measured: Java, Kotlin)",
  },
  limitations: [
    "Elixir do/end bodies are not yet inserted (do_block starts mid-line; the indentation anchor is ambiguous). Fails loudly.",
    "Expression-bodied functions without a block (e.g. Kotlin `fun f() = expr`) have no body block; insert inside them fails loudly.",
    "Lua `return` must be the last statement in a block, so inside-bottom after a return body is invalid Lua and the validator rejects it loudly (correct: no silent corruption).",
    "M71: the declaration-range widening is refused across a newline, so a multi-line modifier/annotation prefix keeps the indexed span rather than being guessed at.",
    "M71: a grammar that exposes no declaration names structurally (measured: Elixir) still relies on the retained keyword fallback for full-declaration updates.",
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

// ── M71: full declaration vs body fragment (decided by PARSE, not keyword) ───
//
// `update` has to answer "is newContent the symbol's own declaration, or a
// fragment to splice into its body?". It used to answer with two regexes that
// required a keyword or modifier IMMEDIATELY before the symbol name. MEASURED
// defect (script/m71/probe-edit-review.ts, probe-method-shapes.ts):
//
//   kotlin  `fun target(): Int { … }`   → nested `fun target` INSIDE the old body, ok
//   csharp  `int Target() { … }`         → nested `int Target()`, ok
//   dart    `int target() { … }`         → nested `int target()`, ok
//
// Three languages accept a nested function, so the mangled file PARSED and the
// tool reported `validated: true` over a declaration that no longer existed.
// A second measured defect made Java and Kotlin full-declaration updates
// impossible: their INDEXED SPAN starts at the name (`target() {…}`), so
// replacing it with `int target() { … }` produced `int int target() { … }`.
//
// Every case below asserts the resulting FILE CONTENT, and the three corruption
// languages additionally assert the nested duplicate is ABSENT — the specific
// corruption, not merely "something changed". The fragment cases are negatives:
// the body-splice path must keep working, or the fix has traded one silent
// failure for another.

const squash = (text: string): string => text.replace(/\s+/g, " ").trim()
const occurrences = (text: string, needle: string): number => text.split(needle).length - 1

async function updateAndRead(label: string, file: string, code: string, symbol: string, content: string): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-e4-upd-${label}-`))
  const dir = path.dirname(file)
  if (dir !== ".") mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, file), code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    await executeEdit(root, projectId, { mode: "update", symbolName: symbol, filePath: file, newContent: content, format: false })
    return readFileSync(path.join(root, file), "utf8")
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

// Kotlin: `fun` is in NO keyword list — the parse must see the declaration.
{
  const after = await updateAndRead("kotlin", "a.kt", `fun target(): Int {\n    return 1\n}\n`, "target", `fun target(): Int {\n    return 2\n}`)
  harness.check("M71 Kotlin: full declaration replaces the declaration", squash(after) === "fun target(): Int { return 2 }", JSON.stringify(after))
  harness.negative("M71 Kotlin: the nested duplicate declaration is absent", occurrences(after, "fun target") === 1, JSON.stringify(after))
}

// C#: a bare method fragment parses as a LOCAL FUNCTION; the return type sits
// between any modifier and the name.
{
  const after = await updateAndRead("csharp", "A.cs", `class A {\n    int Target() {\n        return 1;\n    }\n}\n`, "Target", `int Target() {\n    return 2;\n}`)
  harness.check("M71 C#: full declaration replaces the method", squash(after) === "class A { int Target() { return 2; } }", JSON.stringify(after))
  harness.negative("M71 C#: the nested local function is absent", occurrences(after, "int Target") === 1, JSON.stringify(after))
}

// Dart: same failure mode as Kotlin (local functions are legal).
{
  const after = await updateAndRead("dart", "a.dart", `int target() {\n  return 1;\n}\n`, "target", `int target() {\n  return 2;\n}`)
  harness.check("M71 Dart: full declaration replaces the function", squash(after) === "int target() { return 2; }", JSON.stringify(after))
  harness.negative("M71 Dart: the nested local function is absent", occurrences(after, "int target") === 1, JSON.stringify(after))
}

// Java: the indexed span is name-anchored, so the declaration prefix must not be
// duplicated, and a CHANGED prefix (return type) must be honoured.
{
  const after = await updateAndRead("java", "A.java", `class A {\n    int target() {\n        return 1;\n    }\n}\n`, "target", `int target() {\n    return 2;\n}`)
  harness.check("M71 Java: full declaration replaces the method", squash(after) === "class A { int target() { return 2; } }", JSON.stringify(after))
  harness.negative("M71 Java: the return type is not duplicated (`int int`)", !after.includes("int int"), JSON.stringify(after))
  const retyped = await updateAndRead("java-retype", "A.java", `class A {\n    int target() {\n        return 1;\n    }\n}\n`, "target", `long target() {\n    return 2L;\n}`)
  harness.check("M71 Java: a changed return type is honoured (declaration range, not name range)", squash(retyped) === "class A { long target() { return 2L; } }", JSON.stringify(retyped))
}

// TypeScript / JavaScript class methods and an object-literal method: not
// statements, so the standalone parse is full of ERROR nodes and the parse of
// the wrapped fragment is what resolves them.
{
  const after = await updateAndRead("ts-method", "a.ts", `export class A {\n  target(): number {\n    return 1\n  }\n}\n`, "target", `target(): number {\n    return 2\n  }`)
  harness.check("M71 TS class method: full declaration replaces the method", squash(after) === "export class A { target(): number { return 2 } }", JSON.stringify(after))
  const js = await updateAndRead("js-method", "a.js", `export class A {\n  target() {\n    return 1\n  }\n}\n`, "target", `target() {\n    return 2\n  }`)
  harness.check("M71 JS class method: full declaration replaces the method", squash(js) === "export class A { target() { return 2 } }", JSON.stringify(js))
  const obj = await updateAndRead("ts-object-method", "a.ts", `export const api = {\n  target(): number {\n    return 1\n  },\n}\n`, "target", `target(): number {\n    return 2\n  }`)
  harness.check("M71 TS object-literal method: full declaration replaces the method", squash(obj) === "export const api = { target(): number { return 2 }, }", JSON.stringify(obj))
}

// Haskell: no keyword precedes the name, so no regex can find this declaration.
{
  const after = await updateAndRead("haskell", "a.hs", `target x = x + 1\n`, "target", `target x = x + 2\n`)
  harness.check("M71 Haskell: a bare binding is recognised as a full declaration", squash(after) === "target x = x + 2", JSON.stringify(after))
}

// ── fragments: the body path must keep working (negatives for the fix) ───────
{
  const ts = await updateAndRead("ts-fragment", "a.ts", `export function target(): number {\n  return 1\n}\n`, "target", `return 42`)
  harness.check("M71 TS body fragment still splices into the body", squash(ts) === "export function target(): number { return 42 }", JSON.stringify(ts))
  harness.negative("M71 TS body fragment does not replace the declaration", ts.includes("export function target(): number"), JSON.stringify(ts))

  const kotlin = await updateAndRead("kotlin-fragment", "a.kt", `fun target(): Int {\n    return 1\n}\n`, "target", `return 5`)
  harness.check("M71 Kotlin body fragment still splices into the brace body", squash(kotlin) === "fun target(): Int { return 5 }", JSON.stringify(kotlin))
  harness.negative("M71 Kotlin body fragment does not duplicate the declaration", occurrences(kotlin, "fun target") === 1, JSON.stringify(kotlin))

  const java = await updateAndRead("java-fragment", "A.java", `class A {\n    int target() {\n        return 1;\n    }\n}\n`, "target", `return 7;`)
  harness.check("M71 Java body fragment still splices into the body", squash(java) === "class A { int target() { return 7; } }", JSON.stringify(java))
}

// ── insert before/after anchor on the DECLARATION, not the name ──────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-e4-anchor-"))
  writeFileSync(path.join(root, "A.java"), `class A {\n    int target() {\n        return 1;\n    }\n}\n`)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    await executeEdit(root, projectId, { mode: "insert", targetSymbolName: "target", filePath: "A.java", position: "before", newContent: "int marker = 0;", format: false })
    const afterBefore = readFileSync(path.join(root, "A.java"), "utf8")
    harness.check("M71 Java insert before: lands before the return type, not between it and the name", afterBefore.indexOf("int marker") < afterBefore.indexOf("int target") && !afterBefore.includes("int int marker"), JSON.stringify(afterBefore))
    await executeEdit(root, projectId, { mode: "insert", targetSymbolName: "target", filePath: "A.java", position: "after", newContent: "int after = 0;", format: false })
    const afterAfter = readFileSync(path.join(root, "A.java"), "utf8")
    harness.check("M71 Java insert after: lands after the closing brace", /return 1;\s*\}\s*int after = 0;/.test(afterAfter), JSON.stringify(afterAfter))
    const edit2 = await executeEdit(root, projectId, { mode: "delete", symbolName: "target", filePath: "A.java", format: false }).catch((e: any) => e as Error)
    const afterDelete = readFileSync(path.join(root, "A.java"), "utf8")
    harness.negative("M71 Java delete: removes the whole declaration (no `int` left behind)", !(edit2 instanceof Error) && !afterDelete.includes("target") && !/\bint\s*;/.test(afterDelete), JSON.stringify(afterDelete) + " " + String((edit2 as any)?.message ?? ""))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

harness.emit()
