/**
 * HTML LANE — SEAM-RUNTIME PROBE (the fixture lane cannot see this defect).
 *
 * WHY A SEPARATE FILE AND NOT A FIXTURE.
 *
 * The inline-block seam resolves its delegates with `require(...)`. `require` is a
 * CommonJS global; this package is `"type": "module"`, so under Node it does not
 * exist in an ESM module at all. The ReferenceError was swallowed by the seam's own
 * `catch` and disclosed as `metadata.unavailableEmbeddedLangs`, which made the loss
 * read as a property of the DOCUMENTS rather than of the runtime.
 *
 * Measured on this lane's assigned corpus, through `pool-worker`'s `parseFile` —
 * the entry `audit:pipeline`, `audit:cluster`, `audit:consistency` and
 * `script/m60/payload-matrix.ts` all run through — under `npx tsx`: 22 of
 * vuejs's 25 documents published `unavailableEmbeddedLangs: ["js"]` with no
 * embedded symbols, no embedded relationships and no delegate imports, and
 * `packages/vue/__tests__/e2e/hydration-strat-idle.html` fell from 11 symbols /
 * 31 relationships to 2 / 2. Under `bun run`, and in the `dist/` bundle where
 * esbuild inlines the delegates, it fired. So two REGISTERED GATES were measuring
 * a payload production never emits.
 *
 * THE INSTRUMENT HAS TO RUN TWICE, AND THAT IS THE POINT. Observed directly:
 * with the seam's `createRequire(import.meta.url)` fallback disabled, the whole
 * html fixture lane still reports 14/14 under `bun run`, and
 * `html/prototype-safe-names` is unaffected either way — because under Bun the
 * bare `require` exists. The same mutation under `npx tsx` takes
 * `inline-embedded-code` from 6 symbols / 6 embedded relationships to 3 / 2 with
 * `unavailableEmbeddedLangs: ["css", "js"]`. A fixture asserted in one runtime
 * is a fixture that cannot fail in the other, and this lane's own evidence
 * harness runs fixtures under `bun`.
 *
 * So this file takes no argument, asserts the CURRENT runtime, and exits
 * non-zero when the seam is dead in it. Run it under both:
 *
 *   bun run validation/m14/probes/html/seam-runtime.mts
 *   npx tsx validation/m14/probes/html/seam-runtime.mts
 *
 * A `package.json` script that runs both is a MASTER change (package.json is not
 * this lane's); the need is recorded in `docs/analyzers/html.md`.
 *
 * WHAT IT ASSERTS, and why each is a measurement rather than an assertion:
 *   1 a document with an inline `<script>` publishes delegate SYMBOLS — a seam
 *     that is dead publishes none, and 0 is indistinguishable from "this document
 *     has no code in it" without this file;
 *   2 `metadata.unavailableEmbeddedLangs` is ABSENT — the disclosure field is the
 *     one thing that turned a runtime failure into a silent corpus property, so it
 *     being absent is the positive signal;
 *   3 a document with an inline `<style>` publishes an `exports` row STAMPED to
 *     the delegate — the attribution the seam owes the index;
 *   4 the delegate's row is re-based onto FILE coordinates in both axes, so a
 *     byte offset and a line number on the same row agree about where it is.
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { ASTEngine } from "../../../../src/ast/engine"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../../../..")
const FIXTURES = path.join(ROOT, "validation", "m14", "fixtures", "html")
const runtime = process.execPath.includes("bun") ? "bun" : "node"

const problems: string[] = []
const check = (label: string, ok: boolean, detail: string): void => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`)
  if (!ok) problems.push(label)
}

async function parse(name: string): Promise<any> {
  const file = path.join(FIXTURES, name)
  return ASTEngine.parseFile(file, fs.readFileSync(file, "utf8"))
}

console.log(`html seam-runtime probe — runtime: ${runtime} (${process.versions.node})`)

const withScript = await parse("inline-embedded-code.html")
const embeddedSymbols = (withScript.symbols as any[]).filter((s) => s?.metadata?.htmlEmbedded === true)
check(
  "an inline <script> publishes delegate symbols",
  embeddedSymbols.length > 0,
  `${embeddedSymbols.length} embedded symbols, ${(withScript.symbols as any[]).length} total`,
)
check(
  "metadata.unavailableEmbeddedLangs is ABSENT (the seam is live in this process)",
  withScript.metadata?.unavailableEmbeddedLangs === undefined,
  `got ${JSON.stringify(withScript.metadata?.unavailableEmbeddedLangs)}`,
)
const embeddedRels = (withScript.relationships as any[]).filter((r) => r?.metadata?.htmlEmbedded === true)
check(
  "delegate relationships are stamped to their source language",
  embeddedRels.length > 0 && embeddedRels.every((r) => typeof r.metadata?.embeddedLang === "string"),
  `${embeddedRels.length} embedded relationships, langs ${[...new Set(embeddedRels.map((r) => r.metadata?.embeddedLang))].join(",")}`,
)

const exportsRows = (withScript.exports ?? []) as any[]
check(
  "every forwarded export names the delegate that wrote it",
  exportsRows.length > 0 && exportsRows.every((e) => e?.metadata?.htmlEmbedded === true && typeof e?.metadata?.embeddedLang === "string"),
  `${exportsRows.length} export rows, names ${exportsRows.map((e) => e?.name).join(", ")}`,
)

// Both axes, on the same row: a file LINE and a BYTE offset that disagree about
// where the selector is are the half-rebase this probe exists to catch.
const src = fs.readFileSync(path.join(FIXTURES, "inline-embedded-code.html"), "utf8")
const header = exportsRows.find((e) => e?.name === ".header")
if (!header) {
  check("the `.header` export row is present", false, "not found")
} else {
  const byteAt = src.slice(0, header.range.startIndex)
  const lineAt = byteAt.split("\n").length
  check(
    "an export row's byte offset and line number agree (both axes re-based)",
    lineAt === header.range.startLine && src.startsWith(".header", header.range.startIndex),
    `startIndex=${header.range.startIndex} resolves to line ${lineAt}; startLine=${header.range.startLine}`,
  )
}

const idref = await parse("idref-references.html")
const refs = (idref.relationships as any[]).filter((r) => r?.type === "references" && r?.metadata?.htmlSpecific === true)
check(
  "the IDREF class emits html-native `references` in this runtime",
  refs.length > 0 && refs.every((r) => r.confidence === 1.0 && r.line_number > 0),
  `${refs.length} native references, kinds ${[...new Set(refs.map((r) => r.metadata?.idrefKind))].join(",")}`,
)

const proto = await parse("prototype-safe-names.html")
check(
  "a document whose tag names are Object.prototype members still parses",
  (proto.symbols as any[]).length > 0 && proto.metadata?.elementCount > 0,
  `${(proto.symbols as any[]).length} symbols, elementCount ${proto.metadata?.elementCount}`,
)

if (problems.length > 0) {
  console.error(`\nSEAM-RUNTIME PROBE FAILS under ${runtime}: ${problems.join("; ")}`)
  console.error("Run it under the other runtime too — a seam that is dead in one of them is invisible to fixtures run in the other.")
  process.exit(1)
}
console.log(`\nall checks pass under ${runtime}`)
