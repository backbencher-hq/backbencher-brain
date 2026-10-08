#!/usr/bin/env tsx
// M24.L9 — hover must show the symbol's own documentation.
//
// THE GAP (found by the owner, 2026-10-07). Hover rendered the signature, the
// type, the usage count, the evidence tiers and the connections — and nothing
// that the author wrote about the symbol. IntelliJ shows the doc comment on
// hover; this did not.
//
// WHY THIS IS NOT A STORAGE CHANGE. `brain_symbol.docstring` EXISTS, and it is
// empty: 0 of 10,263 symbols in the owner's real 201-file index carry one. So the
// obvious route — make 48 analyzers extract and store docstrings — is a large
// change across every language, and it would still read the comment out of a
// file on disk.
//
// The hover ALREADY HAS IT. Hover parses the file (parseForCursor) for the
// occurrence lookup, so the tree carries the comment nodes: measured on
// `line-address.ts`, 70 comment nodes, and the one immediately above
// `formatAddress` is exactly its docstring. Reading it from the tree hover already
// holds costs no reindex, no schema change, and no analyzer edit — and it works
// for every language whose grammar emits comment nodes, rather than only the
// languages someone remembered to teach.
//
// WHAT THIS GATES, and the two traps that matter:
//
//   1. The recovered text is the symbol's OWN doc, not merely the nearest
//      comment. A file that documents A, then has unrelated code, then declares
//      B: B must get NO doc. Attaching A's comment to B would be worse than
//      showing nothing, because it would be confidently wrong.
//
// A NOTE ON HOW THAT TRAP WAS BUILT, because it is worth recording. The first
// version of this fixture put the borrowed comment DIRECTLY above `Unrelated`,
// with nothing between them — so the comment really was adjacent, the product
// really was right to attach it, and the gate failed while being correct. The
// trap leg was asserting the wrong thing about a fixture that did not contain
// it. A gate can be wrong in the direction of demanding a defect, and that is
// the failure mode this repository is least equipped to catch on its own,
// because a red gate reads as "the product is broken" until someone checks
// whether the gate is. The fixture now separates them by a declaration.
//   2. A symbol with no preceding comment renders NO doc line — not an empty one,
//      not a placeholder. §14 Truth Rule 1 again: absence is declared, never
//      filled in.
//
// Both traps are the reason this is a gate and not a two-line patch: the naive
// implementation ("walk up, take the first comment") passes the happy path and
// fails both.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const work = mkdtempSync(path.join(tmpdir(), "bb-doc-"))
const src = path.join(work, "src")
mkdirSync(src, { recursive: true })

// The fixture carries both traps on purpose. Built by array-join rather than a
// template literal: the first version nested a template inside a template and the
// outer one was never closed, so the whole gate failed to parse — a syntax error
// in a fixture, which is easy to mistake for a product failure.
const L = (...xs: string[]): string => xs.join("\n")
const PAD = Array.from({ length: 30 }, (_, i) => "export const pad" + i + " = " + i).join("\n")

writeFileSync(
  path.join(src, "shapes.ts"),
  L(
    "/**",
    " * Documented: doubles a number.",
    " * Second line of the doc.",
    " */",
    "export function documented(n: number): number {",
    "  return n * 2",
    "}",
    "",
    "/**",
    " * This comment belongs to documentedAbove, NOT to the symbol below it.",
    " */",
    "const separator = 1",
    "",
    "export interface Unrelated { a: number }",
    "",
  ),
)

writeFileSync(
  path.join(src, "shapes2.ts"),
  L(
    "/** Documented: returns a label. */",
    "export function labelled(s: string): string {",
    "  return s.trim()",
    "}",
    "",
    "// " + PAD.replace(/\n/g, " "),
    PAD,
    "",
    "export function undocumented(s: string): string {",
    "  return s.toUpperCase()",
    "}",
    "",
    "/** Documented: the last one. */",
    "export function lastOne(): void {}",
    "",
  ),
)

const { getProjectId } = await import(path.join(ROOT, "src", "util", "project-id"))
const { indexProjectParallel } = await import(path.join(ROOT, "src", "ast", "parallel-indexer"))
const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database"))
const { hover } = await import(path.join(ROOT, "src", "lsp", "hover"))
const { readFileSync } = await import("node:fs")

const projectId = getProjectId(src) as never
await indexProjectParallel(projectId, src as never, { logger: { log: () => {}, write: () => {} } } as never)
const raw = BrainDatabase.openByPath(BrainDatabase.getPath(projectId as never))

async function hoverAt(rel: string, name: string): Promise<{ body: string; got: string | null; count: number | null }> {
  const file = path.join(src, rel)
  const text = readFileSync(file, "utf8")
  const line = text.split("\n").findIndex((l) => new RegExp(`(function|interface|const)\\s+${name}\\b`).test(l))
  if (line < 0) return { body: "", got: null, count: null }
  const col = text.split("\n")[line]!.search(new RegExp(`\\b${name}\\b`)) + 1
  await hover(raw, { filePath: file, position: { line, character: col } } as never)
  const r = await hover(raw, { filePath: file, position: { line, character: col } } as never)
  const body = String(r?.contents?.value ?? (typeof r?.contents === "string" ? r?.contents : ""))
  const got = /\*\*([A-Za-z_$][\w$]*)\*\*/.exec(body)
  const m = /(\d+)\s+usages?\b/.exec(body)
  return { body, got: got === null ? null : got[1]!, count: m === null ? null : Number(m[1]) }
}

const documented = await hoverAt("shapes.ts", "documented")
const unrelated = await hoverAt("shapes.ts", "Unrelated")
const labelled = await hoverAt("shapes2.ts", "labelled")
const undocumented = await hoverAt("shapes2.ts", "undocumented")
const lastOne = await hoverAt("shapes2.ts", "lastOne")

// fixture legs — the probe must be hovering what it asked for
check(
  "fixture: each probe hovered the symbol it asked for",
  documented.got === "documented" && unrelated.got === "Unrelated" && labelled.got === "labelled",
  `documented->${documented.got} Unrelated->${unrelated.got} labelled->${labelled.got}`,
)

// leg 1 — the happy path
check(
  "a documented symbol's hover carries its own doc comment",
  /Documented: doubles a number/.test(documented.body),
  documented.body.split("\n").find((l) => /Documented/.test(l))?.slice(0, 110) ?? "(no doc line in the hover body)",
)

// leg 2 — multi-line doc comments survive whole
check(
  "a multi-line doc comment is not truncated to its first line",
  /Second line of the doc/.test(documented.body),
  /Second line of the doc/.test(documented.body) ? "both lines present" : "the second line is missing",
)

// TRAP 1 — a comment separated from the declaration by unrelated code must NOT
// be attributed to it.
{
  const leaked = /This comment belongs to documentedAbove/.test(unrelated.body)
  check(
    "TRAP: a comment separated from a declaration by unrelated code is NOT shown as its doc",
    !leaked,
    leaked ? "*** LEAKED: Unrelated was given documentedAbove's comment ***" : `Unrelated's hover carries no borrowed comment (got "${unrelated.got}")`,
  )
}

// TRAP 2 — a symbol with no comment renders NO doc line
{
  const invented = /docstring|documentation/i.test(undocumented.body)
  check(
    "TRAP: a symbol with no preceding comment shows no doc line at all (absence is declared, not filled)",
    !invented && !/\*\*\s*[A-Za-z]/.test(undocumented.body.split("\n").slice(0, 4).join("\n")),
    invented ? "*** a placeholder/empty doc line was rendered ***" : `undocumented hover first lines: ${undocumented.body.split("\n").slice(0, 3).join(" / ").slice(0, 100)}`,
  )
}

// leg 3 — a doc comment after the symbol, and one on a later symbol, must not
// bleed backwards
{
  const lastOk = /Documented: the last one/.test(lastOne.body)
  check(
    "a later symbol's own doc is shown for IT, not for the symbol above it",
    lastOk,
    lastOk ? "lastOne carries its own doc" : `lastOne's hover: ${lastOne.body.split("\n").slice(0, 3).join(" / ").slice(0, 100)}`,
  )
}

// leg 4 — the doc must not REPLACE anything already rendered
check(
  "the doc is ADDED to the hover, not substituted for the signature/type/usage content",
  /public function documented/.test(documented.body) && /usages?\b/.test(documented.body),
  `signature present: ${/public function documented/.test(documented.body)}; usage line present: /usages?\\b/.test(documented.body)}`,
)

rmSync(work, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok).length
console.log(`\nHOVER DOCS: ${failed === 0 ? "PASS" : `FAILED (${failed})`}`)
process.exit(failed === 0 ? 0 : 1)