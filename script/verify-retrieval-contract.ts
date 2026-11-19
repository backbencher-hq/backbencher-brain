// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — P2-1/P2-2 fix gate for `bb_doc` symbol-subject scope and
//   `bb_search` symbol-mode source/identity. Drives the REAL handlers over a
//   hermetic fixture project (same harness shape as script/m20/verify-doc-*.ts):
//     A. doc contract: ambiguous name => declaration-preferred subject or a
//        DECLARED union; qualified target => exactly one subject; `limit` never
//        changes the subject; `quality.scope` exists and cannot pass a doc whose
//        declared scope its own citations do not cover.
//     B. search contract: symbol mode returns a bounded `source` slice with
//        `sourceTruncated` (the descriptor's "exact symbol source" promise),
//        `fileId` is `<projectId>:<relativePath>` in every mode (never an
//        absolute path), and the generated/curated docs agree.
// Positive controls: a unique symbol keeps its exact title/subject; symbols,
//   content and file modes keep answering; the file mode still returns source.
//
// WHY IT IS SHAPED THIS WAY — the triage finding (ISSUE-07) measured a name-only
//   union presented as one subject and (ISSUE-08) an absolute `fileId` plus a
//   missing source field that the descriptor promised. Each property below is a
//   measured claim, not a grep: the fixture is indexed and the real handler is
//   called, so a regression in resolution or projection turns a check red.
//
// WHERE ITS EVIDENCE LIVES — docs/bb-bettercap-fix/evidence/retrieval/.
// RUN — BB_DATA_DIR=$PWD/.tools/triage-fix/retrieval/bbdata npx tsx script/verify-retrieval-contract.ts
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../src/cli/index"
import { indexProjectParallel } from "../src/ast/parallel-indexer"
import { BrainDatabase } from "../src/brain/database"
import { createToolHandlers } from "../src/mcp/tool-handlers"
import { descriptor as searchDescriptor } from "../src/mcp/tools/bb_search/descriptor"

let checks = 0
let failures = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) console.log(`  ok: ${label}`)
  else {
    failures++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
const json = (res: any): any => {
  if (res?.isError) throw new Error(String(res.content?.[0]?.text ?? "handler error"))
  return JSON.parse(String(res.content[0].text))
}
const repo = path.resolve((import.meta as any).dirname ?? path.dirname(new URL(import.meta.url).pathname), "..")

// ── fixture: an ambiguous name with a declaration AND a property (property's
// line_start is LOWER than the declaration's, so line-order resolution picks the
// property — the triage defect), a two-declaration union, a unique symbol, and a
// long symbol that must exercise the bounded source cap.
const root = mkdtempSync(path.join(tmpdir(), "bb-retrieval-contract-"))
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "session.ts"), `/** Canonical session type. */
// Declared below the field deliberately: line-order resolution
// would otherwise pick the declaration by accident.

export class Session {
  Started: boolean = false
}
`)
writeFileSync(path.join(root, "src", "module.ts"), `import { Session } from './session'

export class ModuleThing {
  Session: Session | null = null
}
`)
writeFileSync(path.join(root, "src", "u1.ts"), `export class Dup { kind = 1 }\n`)
writeFileSync(path.join(root, "src", "u2.ts"), `export class Dup { kind = 2 }\n`)
writeFileSync(path.join(root, "src", "unique.ts"), `export function UniqueThing(): number { return 1 }\n`)
writeFileSync(
  path.join(root, "src", "big.ts"),
  `export function BigSymbol(): number {\n${Array.from({ length: 120 }, (_, i) => `  const value${i} = ${i}`).join("\n")}\n  return value119\n}\n`,
)
const projectId = getProjectId(root)
const handler = createToolHandlers()

try {
  await indexProjectParallel(projectId, root, {})
  const raw = await BrainDatabase.getRawInstance(projectId)
  const rows = raw
    .prepare("SELECT brain_symbol.id AS id, brain_symbol.name AS name, brain_symbol.symbol_type AS symbol_type, brain_file.relative_path AS relative_path, brain_symbol.line_start AS line_start, brain_symbol.qualified_name AS qualified_name FROM brain_symbol JOIN brain_file ON brain_file.id = brain_symbol.file_id WHERE brain_symbol.project_id = ?")
    .all(projectId) as Array<{ id: string; name: string; symbol_type: string; relative_path: string; line_start: number; qualified_name: string | null }>
  const declarations = rows.filter((r) => r.name === "Session" && ["class", "struct", "interface", "type", "enum"].includes(String(r.symbol_type)))
  const properties = rows.filter((r) => r.name === "Session" && String(r.symbol_type) === "property")
  const uniques = rows.filter((r) => r.name === "UniqueThing")
  const dups = rows.filter((r) => r.name === "Dup")
  // Fixture self-check: a gate over a fixture the analyzer did not produce the
  // intended shape of would grade the fixture, not the product.
  check("fixture: one declaration-kind Session row", declarations.length === 1, JSON.stringify(declarations))
  check("fixture: at least one property Session row", properties.length >= 1, JSON.stringify(properties))
  check("fixture: unique function row exists", uniques.length === 1 && String(uniques[0].symbol_type) === "function", JSON.stringify(uniques))
  check("fixture: two Dup declaration rows", dups.length === 2, JSON.stringify(dups.map((d) => d.relative_path)))
  if (!declarations.length || !properties.length || !uniques.length || dups.length < 2) throw new Error("fixture shape invalid")
  const declarationId = String(declarations[0].id)
  const propertyIds = new Set(properties.map((p) => String(p.id)))
  const propertyBeforeDeclaration = Math.min(...properties.map((p) => Number(p.line_start))) < Number(declarations[0].line_start)
  check("fixture: property precedes declaration in line order (defect trigger)", propertyBeforeDeclaration, "")

  // ── A. DOC CONTRACT ────────────────────────────────────────────────────────
  const doc = async (args: Record<string, unknown>): Promise<any> => json(await handler.bb_doc({ ...args, format: "json" }, { projectPath: root, projectId } as any))
  const symbolCitations = (result: any): string[] =>
    (result.citations ?? []).filter((c: any) => c.kind === "symbol").map((c: any) => `${c.path}:${c.lineStart}`)
  const citedIds = (result: any): Set<string> => new Set(symbolCitations(result))

  // A1: unique symbol — positive control, exact title/subject unchanged.
  const unique = await doc({ mode: "symbol", target: "UniqueThing" })
  check("A1 control: unique symbol title is `symbol: UniqueThing`", unique.title === "symbol: UniqueThing", unique.title)
  check("A1 control: unique symbol quality.passed", unique.quality?.passed === true, JSON.stringify(unique.quality?.passed))
  check("A1 control: unique symbol cites exactly its own declaration", symbolCitations(unique).length === 1 && symbolCitations(unique)[0] === "src/unique.ts:1", symbolCitations(unique).join(","))
  check("A1 control: unique symbol declares single scope", unique.quality?.scope?.declared === "single", JSON.stringify(unique.quality?.scope))

  // A2: ambiguous unqualified target — declaration preferred, subject declared.
  const ambiguous = await doc({ mode: "symbol", target: "Session" })
  const ambiguousScope = ambiguous.quality?.scope
  check("A2: ambiguous name documents a DECLARED scope", !!ambiguousScope && ["single", "union"].includes(ambiguousScope.declared), JSON.stringify(ambiguousScope))
  check("A2: declaration preferred over the property", citedIds(ambiguous).has(`src/session.ts:5`) && !citedIds(ambiguous).has(`src/module.ts:4`), [...citedIds(ambiguous)].join(","))
  check("A2: subject is the single declaration (not a silent union)", ambiguousScope?.declared === "single" && ambiguousScope?.subjects === 1, JSON.stringify(ambiguousScope))
  check("A2: summary states the resolved subject", typeof ambiguous.summary === "string" && ambiguous.summary.includes("Subject:"), ambiguous.summary?.slice(0, 160))

  // A3: `limit` is a per-section evidence cap, never the subject selector.
  const limited = await doc({ mode: "symbol", target: "Session", limit: 1 })
  check("A3: limit:1 keeps the SAME subject as the default call", JSON.stringify(limited.quality?.scope?.subjects) === JSON.stringify(ambiguousScope?.subjects) && limited.quality?.scope?.declared === ambiguousScope?.declared, JSON.stringify(limited.quality?.scope))
  check("A3: limit:1 still documents the declaration, not the first line-ordered property", citedIds(limited).has("src/session.ts:5"), [...citedIds(limited)].join(","))
  check("A3: limit:1 does not silently document a property", limited.sections?.find((s: any) => s.id === "api")?.facts?.every((f: any) => !/property Session/.test(f.statement)) === true, JSON.stringify(limited.sections?.find((s: any) => s.id === "api")?.facts?.map((f: any) => f.statement)))

  // A4: qualified target — must disambiguate to the qualified symbol. Analyzer
  // shapes differ across the corpora: the TS analyzer stores qualified names,
  // while the Go analyzer stores the BARE name (bettercap stores "Session"), so
  // both routes are exercised and both must select exactly one subject.
  const qualified = await doc({ mode: "symbol", target: "session.Session" })
  check("A4a: qualified target resolves exactly one subject", qualified.quality?.scope?.declared === "single" && qualified.quality?.scope?.subjects === 1, JSON.stringify(qualified.quality?.scope))
  check("A4a: qualified target documents the qualified declaration only", citedIds(qualified).has("src/session.ts:5") && !citedIds(qualified).has("src/module.ts:4"), [...citedIds(qualified)].join(","))
  raw.prepare("UPDATE brain_symbol SET qualified_name = name WHERE project_id = ?").run(projectId)
  const qualifiedBare = await doc({ mode: "symbol", target: "session.Session" })
  check("A4b: qualified target on a bare-name corpus shape resolves exactly one subject", qualifiedBare.quality?.scope?.declared === "single" && qualifiedBare.quality?.scope?.subjects === 1, JSON.stringify(qualifiedBare.quality?.scope))
  check("A4b: bare-name qualified resolution uses the namespace path", qualifiedBare.quality?.scope?.resolvedBy === "qualified-path", JSON.stringify(qualifiedBare.quality?.scope))
  check("A4b: bare-name qualified target documents the declaration only", citedIds(qualifiedBare).has("src/session.ts:5") && !citedIds(qualifiedBare).has("src/module.ts:4"), [...citedIds(qualifiedBare)].join(","))

  // A5: genuine union — two declarations with the same name => declared union.
  const union = await doc({ mode: "symbol", target: "Dup" })
  check("A5: two declarations produce a DECLARED union in the title", typeof union.title === "string" && /union of 2 indexed symbols/i.test(union.title), union.title)
  check("A5: declared union scope", union.quality?.scope?.declared === "union" && union.quality?.scope?.subjects === 2, JSON.stringify(union.quality?.scope))
  check("A5: union documents both declarations", citedIds(union).has("src/u1.ts:1") && citedIds(union).has("src/u2.ts:1"), [...citedIds(union)].join(","))

  // A6: quality.scope is a real term — a declared union the citations cannot
  // cover must not pass (limit:1 union: API cap 1 cites one of two subjects).
  const unionLimited = await doc({ mode: "symbol", target: "Dup", limit: 1 })
  check("A6: a declared union its citations cannot cover does not pass", unionLimited.quality?.scope?.passed === false || unionLimited.quality?.passed === false, JSON.stringify(unionLimited.quality?.scope))

  // A7: markdown carries the union declaration too (the caller-facing format).
  const mdUnion = await handler.bb_doc({ mode: "symbol", target: "Dup", format: "markdown" }, { projectPath: root, projectId } as any)
  check("A7: markdown heading declares the union", /union of 2 indexed symbols/i.test(String(mdUnion.content[0].text).split("\n")[0] ?? ""), String(mdUnion.content[0].text).split("\n")[0])

  // ── B. SEARCH CONTRACT ────────────────────────────────────────────────────
  const search = async (args: Record<string, unknown>): Promise<any> => json(await handler.bb_search(args, { projectPath: root, projectId } as any))
  const searchSymbol = async (query: string): Promise<any> => search({ mode: "symbol", query })
  const symbolUnique = await searchSymbol("UniqueThing")
  const su = symbolUnique.matches?.[0]
  const expectedFileId = `${projectId}:src/unique.ts`
  check("B1: symbol mode finds the unique symbol", symbolUnique.found === true && symbolUnique.matches?.length === 1, JSON.stringify(symbolUnique.matches?.length))
  check("B1: symbol-mode fileId is <projectId>:<relativePath>", su?.fileId === expectedFileId, su?.fileId)
  check("B1: symbol-mode fileId is never an absolute machine path", !!su && !String(su.fileId).startsWith("/") && !String(su.fileId).startsWith(path.sep), su?.fileId)
  check("B1: absolute path moved to absolutePath", su?.absolutePath === path.join(root, "src", "unique.ts"), su?.absolutePath)
  check("B1: symbol mode returns the source slice (descriptor promise)", typeof su?.source === "string" && su.source.includes("export function UniqueThing"), JSON.stringify(su?.source))
  check("B1: source declares its bound (sourceTruncated)", su?.sourceTruncated === false, JSON.stringify(su?.sourceTruncated))

  // B2: bounded source — a long symbol is capped and says so.
  const symbolBig = await searchSymbol("BigSymbol")
  const big = symbolBig.matches?.[0]
  check("B2: long symbol source is bounded", typeof big?.source === "string" && big.source.length <= 2000, String(big?.source?.length))
  check("B2: long symbol source is flagged truncated", big?.sourceTruncated === true, JSON.stringify(big?.sourceTruncated))

  // B3: identity gate — one file, one fileId, in every mode.
  const content = await search({ mode: "content", query: "UniqueThing", limit: 5 })
  const contentRow = (content.results ?? []).find((r: any) => r.file === "src/unique.ts")
  check("B3: content mode agrees on the fileId", contentRow?.fileId === expectedFileId, contentRow?.fileId)
  const fileMode = await search({ mode: "file", filePath: "src/unique.ts" })
  check("B3: file mode agrees on the fileId", fileMode.fileId === expectedFileId, fileMode.fileId)
  check("B3: no search-mode fileId is an absolute path", (content.results ?? []).every((r: any) => !String(r.fileId).startsWith("/")) && !String(fileMode.fileId).startsWith("/"), "")

  // B4: control — the sibling modes still answer.
  const symbolsText = await handler.bb_search({ mode: "symbols", query: "UniqueThing" }, { projectPath: root, projectId } as any)
  check("B4 control: symbols mode still lists the name", /UniqueThing/.test(String(symbolsText.content[0].text)), "")
  check("B4 control: file mode still returns source content", typeof fileMode.content === "string" && fileMode.content.includes("UniqueThing"), "")

  // ── C. DOCS/HONESTY: the written contract must match the measured behavior.
  const descriptorText = readFileSync(path.join(repo, "src", "mcp", "tools", "bb_search", "descriptor.ts"), "utf8")
  check("C1: descriptor still promises exact symbol source and documents the bound", /exact symbol source/.test(descriptorText) && /sourceTruncated/.test(descriptorText), "")
  check("C1: symbol-mode descriptor no longer claims byte bounds without source", /`symbol` returns the exact indexed symbol record\(s\) with a bounded source slice/.test(descriptorText), "")
  const bbSearchDoc = readFileSync(path.join(repo, "docs", "BB_SEARCH.md"), "utf8")
  check("C2: BB_SEARCH.md documents <projectId>:<relativePath> fileId", /`<projectId>:<relativePath>`/.test(bbSearchDoc), "")
  check("C2: BB_SEARCH.md documents the symbol source fields", /`source`/.test(bbSearchDoc) && /`sourceTruncated`/.test(bbSearchDoc), "")
  const bbDocDoc = readFileSync(path.join(repo, "docs", "BB_DOC.md"), "utf8")
  check("C3: BB_DOC.md documents quality.scope and the union title", /quality\.scope/.test(bbDocDoc) && /union of <n> indexed symbols|union of N indexed symbols/i.test(bbDocDoc), "")
  const toolPage = readFileSync(path.join(repo, "docs", "tools", "bb_search.md"), "utf8")
  check("C4: generated bb_search page documents the source fields", /sourceTruncated/.test(toolPage), "")

  console.log(`\nRETRIEVAL CONTRACT: ${checks - failures}/${checks} checks passed`)
  if (failures) process.exitCode = 1
} finally {
  try {
    const raw = await BrainDatabase.getRawInstance(projectId)
    raw.prepare("DELETE FROM brain_symbol WHERE project_id = ?").run(projectId)
  } catch { /* fixture cleanup is best effort */ }
  rmSync(root, { recursive: true, force: true })
}
