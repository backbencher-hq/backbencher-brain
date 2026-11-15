// bb_tests/bb_edit/probe-e1-offset-units.mjs
// Are bb_edit's offsets bytes or characters?
//
// The engine's symbol spans are named byteStart/byteEnd and come from the
// indexer, which reads files as UTF-8. The plan layer then does
//
//   replaceRange(text, start, end, replacement)
//     return text.slice(0, start) + replacement + text.slice(end)
//
// and `text` is a JavaScript string read with readFileSync(path, "utf8"), whose
// indices are UTF-16 code units. For pure ASCII the two numbering schemes are
// identical and the difference is invisible. The moment a non-ASCII character
// appears BEFORE an edit target they diverge, and every span derived from the
// index points somewhere else in the file.
//
// Every one of the eighteen bb_edit gates is pure ASCII — grep -lP '[^\x00-\x7F]'
// over script/*/verify-edit-*.ts returns nothing — so no gate in the repository
// can see this. That is the question this probe answers: not "is there a bug in
// theory" but "where exactly does the numbering diverge, by how much, and what
// does the engine actually write to disk".
//
// Three layers are measured separately, because they can disagree with each other:
//   1. the INDEXER's byteStart for a symbol
//   2. tree-sitter's startIndex from parseForSafety
//   3. the JavaScript string index of the same declaration
// If (1) and (2) are bytes and (3) is UTF-16, the engine slices a string with a
// byte offset and the corruption is mechanical, not subtle.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const REPO = process.env.BB_REPO
const root = mkdtempSync(path.join(tmpdir(), "bb-e1-"))
mkdirSync(path.join(root, "src"), { recursive: true })

// A realistic file: a copyright line with an en-dash and an accent, a doc comment
// with a curly quote, then the target. The non-ASCII characters all sit BEFORE the
// declaration, which is the ordinary case and the one that matters.
const source = [
  "/* Copyright 2019-2024 Acme — all rights reserved. */",
  "//Ünïcödé header with áccents and a “curly quote”",
  "export function target(): number {",
  "  return 1",
  "}",
  "",
].join("\n")
const file = path.join(root, "src", "target.ts")
writeFileSync(file, source, "utf8")

const bytes = Buffer.from(source, "utf8")
console.log(`file: ${bytes.length} bytes, ${source.length} UTF-16 code units, ${[...source].length} code points`)
console.log(`      divergence: ${bytes.length - source.length} (a multi-byte char costs 3 bytes and 1 code unit)\n`)

// The true string index of the declaration.
const strIndex = source.indexOf("export function target")
const byteIndex = bytes.indexOf(Buffer.from("export function target", "utf8"))
console.log(`declaration of target():`)
console.log(`  JS string index   ${strIndex}`)
console.log(`  UTF-8 byte index  ${byteIndex}`)
console.log(`  difference        ${byteIndex - strIndex}\n`)

const { parseForSafety } = await import(path.join(REPO, "src/ast/safety-primitives.ts"))
const parsed = await parseForSafety(file, source)
const declOccurrence = parsed.occurrences.find((o) => o.text === "target")
console.log(`parseForSafety occurrences (${parsed.occurrences.length}):`)
for (const o of parsed.occurrences) {
  console.log(`  "${o.text}" startIndex=${o.startIndex} endIndex=${o.endIndex} line=${o.startLine} parent=${o.parentType}`)
}
if (declOccurrence) {
  console.log(`\n  tree-sitter startIndex for "target": ${declOccurrence.startIndex}`)
  console.log(`  JS string index of "target"        : ${source.indexOf("target")}`)
  console.log(`  => parseForSafety reports ${declOccurrence.startIndex === source.indexOf("target") ? "STRING indices" : "BYTE indices"}`)
}
console.log(`\n  bodyRanges: ${JSON.stringify(parsed.bodyRanges)}`)

// Now the real test: index the project and ask the engine to edit it.
const { getProjectId } = await import(path.join(REPO, "src/cli/index.ts"))
const { indexProjectParallel } = await import(path.join(REPO, "src/ast/parallel-indexer.ts"))
const { executeEdit } = await import(path.join(REPO, "src/intelligence/edit/edit-engine.ts"))

const projectId = getProjectId(root)
await indexProjectParallel(projectId, root, {})

const { ASTEngine } = await import(path.join(REPO, "src/ast/engine.ts"))
const found = await ASTEngine.findSymbol(projectId, "target", undefined, undefined)
const m = found?.matches?.[0]
console.log(`\nindexed symbol bounds: byteStart=${m?.byteStart} byteEnd=${m?.byteEnd} lineStart=${m?.lineStart}`)
console.log(`  the declaration's JS string index is ${strIndex}, and its byte index is ${byteIndex}`)

const before = readFileSync(file, "utf8")
let outcome
try {
  outcome = await executeEdit(root, projectId, { mode: "update", symbolName: "target", newContent: "return 42" })
  console.log(`\nedit reported: validated=${outcome.validated} reindexed=${outcome.reindexed}`)
} catch (e) {
  console.log(`\nedit THREW: ${e?.message ?? e}`)
}
const after = readFileSync(file, "utf8")
console.log(`\n--- file on disk after the edit ---`)
console.log(after)
console.log(`--- end ---`)
console.log(`\nchanged: ${before !== after}`)
console.log(`contains "return 42": ${after.includes("return 42")}`)
console.log(`still parses as the same function: ${/export function target\(\): number \{\s*return 42\s*\}/.test(after)}`)
if (after !== "export function target(): number {\n  return 1\n}\n") {
  console.log(`\nThe file is NOT the expected result. Expected exactly:`)
  console.log(JSON.stringify("export function target(): number {\n  return 42\n}\n"))
  console.log(`Got: ${JSON.stringify(after)}`)
}

rmSync(root, { recursive: true, force: true })
process.exit(before === after ? 0 : 1)
