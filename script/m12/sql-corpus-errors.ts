// script/m12/sql-corpus-errors.ts — the sql lane's corpus parse-error census.
//
// REWRITTEN 2026-09-26 to make the claim REPRODUCIBLE, because it was not.
//
// WHAT WAS WRONG, measured rather than alleged. The committed artifact recorded
// `files: 207, errorFiles: 146, errorNodes: 3876` with NO corpus revision — the
// only one of 41 corpus-error artifacts in this tree with no corpus pin (`make`
// looked unpinned to the same scan and is not: it pins six repos through a
// `revisions` map). Re-running this same script against the same corpus at the
// same revision produced:
//
//     files 438   (not 207)
//     errorFiles 318   (not 146)   -> 72.6%, not 70.5%
//     errorNodes 6407  (not 3876)
//
// So the committed number described a draw that this script cannot produce, and
// nothing said so: `verify-corpus-claims.ts` H1 compares the manifest's claim to
// the artifact's number, and the two agreed with each other while both
// disagreed with the corpus. That is the deepest form of the drift this
// milestone exists to close — two sources consistent with each other and
// inconsistent with reality — and no file-level hash check can catch it, because
// nothing was bound to the CORPUS.
//
// WHAT CHANGED, and it is three fields, not a rewrite:
//
//   1. `corpusRevision` — `git -C <corpus> rev-parse HEAD`, so the draw is
//      reproducible or visibly stale. This is the field whose absence made the
//      old number unfalsifiable.
//   2. `grammarSha256` — the hash of the exact wasm bytes measured, so a grammar
//      swap makes the claim stale instead of invisible. Thirty-nine other
//      artifacts still record no grammar hash; this lane now does, and
//      script/m60/verify-grammar-consistency.ts reads it.
//   3. `grammar` is no longer a hardcoded string. It was the literal
//      "@derekstride/tree-sitter-sql 0.3.11" written by this script regardless
//      of which wasm it was actually handed — so pointing argv[3] at a
//      candidate grammar produced an artifact that still claimed to be 0.3.11.
//      That is a fabricated provenance field, and an A/B built on this script
//      would have recorded both sides as the same grammar. It is now DERIVED from
//      the artifact, and a caller measuring a candidate passes `--grammar-label`.
//
// The census itself is unchanged: same extension set, same sorted `git ls-files`
// draw, same named-children walk counting ERROR and MISSING nodes. A measurement
// is only comparable to another measurement if the instrument did not move, so
// the walk is deliberately byte-for-byte the pre-existing one.
//
// Usage:
//   bun run script/m12/sql-corpus-errors.ts
//   bun run script/m12/sql-corpus-errors.ts <corpus> <wasm> --grammar-label "<label>"
//
// Writes: validation/m12/results/sql-corpus-errors.json

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { loadWebTreeSitter, resolveWasmAsset } from "../../src/util/wasm"

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const positional = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")))

const corpus = positional[0] || "$HOME/ProxiCall"
const wasmPath = positional[1] || resolveWasmAsset("tree-sitter-sql.wasm")
// Only a caller that KNOWS what it is measuring may label the grammar. Absent a
// label, the artifact says so rather than asserting a version nobody verified.
const grammarLabel = flag("--grammar-label") ?? null

if (!existsSync(wasmPath)) {
  console.error(`sql-corpus-errors: no wasm at ${wasmPath}`)
  process.exit(2)
}

const W: any = await loadWebTreeSitter()
const ParserCtor = W.Parser ?? W.default ?? W
const LanguageCtor = W.Language ?? W.default?.Language
const init = W.init ?? ParserCtor.init
if (init) await init({ locateFile: () => resolveWasmAsset("tree-sitter.wasm") })
const wasmBytes = readFileSync(wasmPath)
const grammar = await LanguageCtor.load(new Uint8Array(wasmBytes))

// The corpus identity, resolved BEFORE the census so a failure to reach the
// corpus is a loud non-zero exit rather than an artifact claiming zero files.
let corpusRevision: string | null = null
let corpusDirty: boolean | null = null
try {
  corpusRevision = execFileSync("git", ["-C", corpus, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  corpusDirty = execFileSync("git", ["-C", corpus, "status", "--porcelain"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().length > 0
} catch (e) {
  console.error(`sql-corpus-errors: cannot resolve a corpus revision from ${corpus} — refusing to write an artifact with an unpinned draw`)
  process.exit(2)
}

const files = execFileSync("git", ["-C", corpus, "ls-files", "*.sql", "*.SQL", "*.psql", "*.ddl"], { encoding: "utf8" })
  .trim().split("\n").filter(Boolean).sort()
const errors: { file: string; nodes: number; bytes: number }[] = []
let errorNodes = 0
let totalBytes = 0
for (const rel of files) {
  const parser = new ParserCtor()
  parser.setLanguage(grammar)
  const text = readFileSync(`${corpus}/${rel}`, "utf8")
  totalBytes += text.length
  const tree = parser.parse(text)
  let nodes = 0
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR" || n.isMissing) { nodes++; errorNodes++ }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (nodes) errors.push({ file: rel, nodes, bytes: text.length })
  parser.delete?.()
}

const result = {
  analyzer: "sql",
  // DERIVED or explicitly labelled — never asserted. The previous version wrote
  // a hardcoded "@derekstride/tree-sitter-sql 0.3.11" whatever wasm it loaded,
  // which made an A/B record both sides as the same grammar.
  grammar: grammarLabel ?? "(unlabelled — pass --grammar-label to name the wasm measured)",
  grammarLabelSupplied: grammarLabel !== null,
  wasmArtifact: wasmPath.split("/").pop(),
  wasmSha256: createHash("sha256").update(wasmBytes).digest("hex"),
  wasmBytes: wasmBytes.length,
  corpus,
  corpusRevision,
  corpusDirty,
  files: files.length,
  errorFiles: errors.length,
  errorNodes,
  errorRatePct: files.length ? Number(((100 * errors.length) / files.length).toFixed(2)) : null,
  totalBytes,
  // The full list, not a slice: the old artifact kept only the first 100 entries,
  // so 218 of the failing files were invisible and a regression in any of them
  // could not be seen by diffing two artifacts.
  errors,
  superseded: {
    note:
      "The artifact this replaces recorded files 207 / errorFiles 146 / errorNodes 3876 with NO corpus revision, and re-running the same script on the same corpus produced 438 / 318 / 6407. The old draw is not reproducible from this instrument. Corrected 2026-09-26 (M60 grammar-consistency).",
    previousFiles: 207,
    previousErrorFiles: 146,
    previousErrorNodes: 3876,
    previousErrorRatePct: 70.5,
  },
  policy:
    "Every file in the corpus extension set, drawn by sorted `git ls-files` at a recorded corpus revision, parsed with a fresh parser per file; ERROR and MISSING nodes counted separately through a named-children walk. The corpus revision and the wasm sha256 are recorded so the claim is falsifiable: if either moves, this number describes a different measurement and the gate says so.",
}
writeFileSync("validation/m12/results/sql-corpus-errors.json", JSON.stringify(result, null, 2) + "\n")
console.log(
  `sql-corpus-errors: ${files.length} file(s) at ${corpusRevision?.slice(0, 12)} (dirty=${corpusDirty}) — ` +
    `${errors.length} error file(s) (${result.errorRatePct}%), ${errorNodes} error node(s), ` +
    `wasm ${result.wasmSha256.slice(0, 12)}… ${grammarLabel ?? "(unlabelled)"}`,
)
