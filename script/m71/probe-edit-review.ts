// script/m71/probe-edit-review.ts — REVIEW PROBE for bb_edit (not a gate).
//
// Measures four hypotheses about `executeEdit` on the real engine, so the review
// of the tool rests on output rather than on reading:
//
//   H1  `update` decides "is newContent a full declaration or a body fragment?"
//       with two regexes that require a keyword or modifier IMMEDIATELY before
//       the symbol name. C-family methods with a return type in between
//       (`int target()`, `fun target()`, `int Target()`) match neither, so a
//       FULL declaration is spliced into the old BODY. Where local functions are
//       legal (Kotlin, C#, Dart) the result can parse without syntax errors and
//       the edit is reported as success.
//   H2  `refactor` on a symbol with zero extractable occurrences returns
//       ok:true with "0 site(s) across 0 file(s)" instead of refusing.
//   H3  symbol byte bounds are UTF-16 code-unit offsets; updates on files with
//       non-ASCII text before/inside the symbol must splice the right span.
//   H4  `write` over an existing file truncates it with no size/diff guard.
//
// Run: npx tsx script/m71/probe-edit-review.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { ASTEngine } from "../../src/ast/engine"
import { executeEdit, type EditRequest } from "../../src/intelligence/edit/edit-engine"

type Outcome = { outcome: "ok" | "error"; error?: string; after: string; syntaxErrors: number; warnings?: string[] }

async function runCase(label: string, file: string, code: string, request: EditRequest): Promise<Outcome> {
  const root = mkdtempSync(path.join(tmpdir(), `bb-review-${label}-`))
  const dir = path.dirname(file)
  if (dir !== ".") mkdirSync(path.join(root, dir), { recursive: true })
  writeFileSync(path.join(root, file), code)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const requestWithPath: EditRequest = { ...request, filePath: file }
    let outcome: "ok" | "error" = "ok"
    let error: string | undefined
    let warnings: string[] | undefined
    try {
      const result = await executeEdit(root, projectId, requestWithPath)
      warnings = result.warnings
    } catch (e: any) {
      outcome = "error"
      error = e?.message ?? String(e)
    }
    const after = readFileSync(path.join(root, file), "utf8")
    let syntaxErrors = -1
    try {
      const parsed = await ASTEngine.parseFile(path.join(root, file), after)
      syntaxErrors = (parsed.errors ?? []).filter((x: any) => /syntax error/i.test(x.message ?? "")).length
    } catch { /* parse failure is itself a finding; leave -1 */ }
    return { outcome, error, after, syntaxErrors, warnings }
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

function report(label: string, o: Outcome, expect?: string) {
  const lines = [
    `── ${label}`,
    `   outcome=${o.outcome}${o.error ? ` error=${JSON.stringify(o.error)}` : ""} syntaxErrors=${o.syntaxErrors}`,
    ...(o.warnings?.length ? [`   warnings=${JSON.stringify(o.warnings)}`] : []),
    `   after=${JSON.stringify(o.after)}`,
  ]
  if (expect) lines.push(`   expectation: ${expect}`)
  console.log(lines.join("\n"))
}

// ── H1: full-declaration updates, one language family per case ──────────────
const H1: Array<{ label: string; file: string; code: string; newContent: string; expect: string }> = [
  {
    label: "H1 kotlin: full declaration `fun target(): Int {…}`",
    file: "a.kt",
    code: `fun target(): Int {\n    return 1\n}\n`,
    newContent: `fun target(): Int {\n    return 2\n}`,
    expect: "declaration replaced; it is NOT in the keyword/modifier lists, so a naive check reads it as a body fragment",
  },
  {
    label: "H1 csharp: method `int Target() {…}` (no modifiers)",
    file: "a.cs",
    code: `class A {\n    int Target() {\n        return 1;\n    }\n}\n`,
    newContent: `int Target() {\n    return 2;\n}`,
    expect: "declaration replaced; C# local functions are legal, so a body splice can pass the syntax validator",
  },
  {
    label: "H1 dart: `int target() {…}`",
    file: "a.dart",
    code: `int target() {\n  return 1;\n}\n`,
    newContent: `int target() {\n  return 2;\n}`,
    expect: "declaration replaced; Dart local functions are legal",
  },
  {
    label: "H1 java: `int target() {…}` (no modifiers)",
    file: "A.java",
    code: `class A {\n    int target() {\n        return 1;\n    }\n}\n`,
    newContent: `int target() {\n    return 2;\n}`,
    expect: "declaration replaced; Java forbids nested methods, so a body splice should fail the syntax validator",
  },
  {
    label: "H1 typescript: class method `target(): number {…}`",
    file: "a.ts",
    code: `export class A {\n  target(): number {\n    return 1\n  }\n}\n`,
    newContent: `target(): number {\n    return 2\n  }`,
    expect: "declaration replaced",
  },
  {
    label: "H1 go control: `func target() int {…}`",
    file: "a.go",
    code: `package main\n\nfunc target() int {\n\treturn 1\n}\n`,
    newContent: `func target() int {\n\treturn 2\n}`,
    expect: "declaration replaced (`func` is in the keyword list)",
  },
  {
    label: "H1 python control: `def target(): …`",
    file: "a.py",
    code: `def target():\n    return 1\n`,
    newContent: `def target():\n    return 2\n`,
    expect: "declaration replaced (`def` is in the keyword list)",
  },
  {
    label: "H1 fsharp: `let target x = x + 1`",
    file: "a.fs",
    code: `let target x = x + 1\n`,
    newContent: `let target x = x + 2\n`,
    expect: "declaration replaced; `let` IS listed, so this should work",
  },
  {
    label: "H1 haskell: `target x = x + 1` (bare binding)",
    file: "a.hs",
    code: `target x = x + 1\n`,
    newContent: `target x = x + 2\n`,
    expect: "declaration replaced; no keyword precedes the name in Haskell",
  },
]

for (const c of H1) {
  const o = await runCase(c.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase(), c.file, c.code, { mode: "update", symbolName: c.file === "a.hs" || c.file === "a.fs" ? "target" : "target", newContent: c.newContent, format: false })
  report(c.label, o, c.expect)
}

// C#/Dart names are capitalized in some cases; run the capitalized variant too.
{
  const o = await runCase("h1-csharp-cap", "b.cs", `class B {\n    int Target() {\n        return 1;\n    }\n}\n`, { mode: "update", symbolName: "Target", newContent: `int Target() {\n    return 2;\n}`, format: false })
  report("H1 csharp: `Target` (capitalized, matched by name)", o, "declaration replaced")
}

// ── H2: refactor where no occurrence can be extracted (yaml key) ────────────
{
  const o = await runCase("h2-yaml", "a.yaml", `target:\n  replicas: 1\n\nother:\n  ref: target\n`, { mode: "refactor", symbolName: "target", newName: "renamedTarget", format: false })
  report("H2 yaml: refactor of a mapping key", o, "if it reports ok with 0 sites renamed, the silent no-op is still live")
}
{
  const o = await runCase("h2-make", "Makefile", `target:\n\techo hi\n\nall: target\n`, { mode: "refactor", symbolName: "target", newName: "renamedTarget", format: false })
  report("H2 make: refactor of a rule target", o, "same class of check: a language whose grammar has no identifier node types")
}

// ── H3: non-ASCII bytes before/inside the edited symbol ─────────────────────
{
  const code = `const café = "héllo wörld"\nexport function target(): number {\n  return café.length\n}\n`
  const o = await runCase("h3-nonascii-before", "a.ts", code, { mode: "update", symbolName: "target", newContent: "return 42", format: false })
  report("H3 non-ascii BEFORE the symbol: body-fragment update", o, "the splice must land on `return café.length` and keep the café declaration intact")
  console.log(`   intact-declaration=${o.after.includes("const café = \"héllo wörld\"")} spliced=${o.after.includes("return 42")}`)
}
{
  const code = `export function target(): number {\n  const s = "wörld"\n  return 1\n}\n`
  const o = await runCase("h3-nonascii-inside", "a.ts", code, { mode: "insert", targetSymbolName: "target", position: "inside-bottom", newContent: "const after = café", format: false })
  report("H3 non-ascii INSIDE the symbol: insert inside-bottom", o, "insertion after `return 1`, before the final brace")
}

// ── H4: write over an existing file with much smaller content ──────────────
{
  const big = `// header\n` + Array.from({ length: 40 }, (_, i) => `export const v${i} = ${i}`).join("\n") + "\n"
  const o = await runCase("h4-write-over", "a.ts", big, { mode: "write", content: "export const v0 = 0\n", format: false })
  report("H4 write over an existing 41-line file with one line", o, "documented as 'replaced atomically'; recorded here because nothing guards the size change")
}

// ── H5: two sequential edits of the same file (index freshness) ────────────
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-review-seq-"))
  writeFileSync(path.join(root, "a.ts"), `export function one(): number {\n  return 1\n}\nexport function two(): number {\n  return 2\n}\n`)
  const projectId = getProjectId(root)
  try {
    await indexProjectParallel(projectId, root, {})
    const first = await executeEdit(root, projectId, { mode: "update", symbolName: "one", filePath: "a.ts", newContent: "return 11", format: false })
    console.log(`── H5 sequential: first edit reindexed=${first.reindexed}`)
    const second = await executeEdit(root, projectId, { mode: "update", symbolName: "two", filePath: "a.ts", newContent: "return 22", format: false })
    console.log(`── H5 sequential: second edit ok reindexed=${second.reindexed} warnings=${JSON.stringify(second.warnings ?? [])}`)
  } catch (e: any) {
    console.log(`── H5 sequential: second edit REFUSED error=${JSON.stringify(e?.message ?? String(e))}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

// ── H6: write mode on a project with no index at all (server gate is asserted, not the engine) ──
{
  const root = mkdtempSync(path.join(tmpdir(), "bb-review-noindex-"))
  const projectId = getProjectId(root)
  try {
    try {
      await executeEdit(root, projectId, { mode: "write", filePath: "fresh.ts", content: "export const a = 1\n", format: false })
      console.log(`── H6 engine write on an UNINDEXED project: ok, file exists=${existsSync(path.join(root, "fresh.ts"))}`)
    } catch (e: any) {
      console.log(`── H6 engine write on an UNINDEXED project: error=${JSON.stringify(e?.message ?? String(e))}`)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
  }
}

console.log("PROBE COMPLETE")
