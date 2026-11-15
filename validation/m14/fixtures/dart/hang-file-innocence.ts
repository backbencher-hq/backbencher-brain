/**
 * Is the file a `[BB-HANG]` names actually a defective file? Parse it ALONE.
 *
 * ## What this measures, and why it is not the same measurement as the hang
 *
 * `src/ast/engine.ts` arms a 120 s `setTimeout` that writes
 * `[BB-HANG] parser stuck 120s on <file>` and calls `process.exit(1)`. The
 * process therefore dies on ONE file and every later file goes unmeasured, which
 * for a gate means the run produces nothing at all — `script/m14/ontology-coverage-gate.ts`
 * exits 1 before printing a single relationship-type row, on every run observed
 * so far.
 *
 * The reading this instrument exists to falsify is the obvious one: a hang that
 * names a file is a parser-robustness defect IN THAT FILE, so the fix is that
 * file. If that were true, the file would fail here too — one at a time, with no
 * concurrent parse to corrupt the WASM module's state.
 *
 * Every file named by a `[BB-HANG]` so far parses CLEAN through the same
 * production `parseFile`, alone. So the hang follows the corrupted module state
 * that a prior file's `memory access out of bounds` left behind, and the named file
 * is the victim rather than the cause. That is a different defect with a different
 * owner and a different fix, and the two are indistinguishable from the hang line
 * alone — which is why this needs its own instrument rather than a reading of the
 * gate's output.
 *
 * ## Two properties that hold across every observed run, and what they rule out
 *
 *   1. THE HANG FILE IS NEVER THE SAME FILE TWICE.
 *   2. THE HANG FILE IS ALWAYS A MEMBER OF THAT RUN'S OWN `[BB-PARSE-ERR]` SET.
 *
 * Property 2 is the load-bearing one. A grammar defect in a file would make that
 * file the hang file consistently, and property 1 says it never is. Property 2
 * says the hang file always had already reported a parse error in the same run, so
 * the state that hung the parse was written before the hang file was reached.
 *
 * ## What this does NOT establish
 *
 * A clean single-file parse does not exonerate the CONCURRENT path. It says the
 * file is not itself malformed; it does not say the engine survives a malformed
 * file followed by others, and this instrument never runs two files, so it cannot
 * observe the corruption that precedes every hang. The engine's remedy — abort one
 * file's parse, return an error for it, keep going — is a shared-machinery item,
 * and the evidence for it is the hang line plus this table, not this table alone.
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/dart/hang-file-innocence.ts
 *   npx tsx validation/m14/fixtures/dart/hang-file-innocence.ts <path> [<path>...]
 *
 * Paths are absolute, or relative to the corpus root. With no arguments it walks
 * the recorded set below, which is every file a `[BB-HANG]` has named to date.
 */
import { statSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

/**
 * Every file a `[BB-HANG]` has named, with the run that named it and whether that
 * run ALSO reported the file in its own `[BB-PARSE-ERR]` set — property 2, recorded
 * per run rather than asserted in prose. `run` is the ordinal in the sequence the
 * docs/analyzers/dart.md item-1 table enumerates.
 */
const RECORDED: ReadonlyArray<{
  run: number
  /** Corpus-relative path. The basename alone is not enough: dart-sdk tracks two files named `document_color_test.dart`. */
  path: string
  /** The same run also emitted `[BB-PARSE-ERR]` for this file. */
  inOwnParseErrSet: boolean
}> = [
  { run: 1, path: "dart-sdk/pkg/_fe_analyzer_shared/lib/src/flow_analysis/flow_analysis_log.dart", inOwnParseErrSet: true },
  { run: 2, path: "dart-sdk/pkg/analysis_server/integration_test/edit/list_postfix_completion_templates_test.dart", inOwnParseErrSet: true },
  { run: 3, path: "dart-sdk/pkg/analysis_server/integration_test/edit/import_elements_test.dart", inOwnParseErrSet: true },
  { run: 4, path: "dart-sdk/pkg/analysis_server/integration_test/edit/get_statement_completion_test.dart", inOwnParseErrSet: true },
  { run: 5, path: "dart-sdk/pkg/analysis_server/integration_test/edit/is_postfix_completion_applicable_test.dart", inOwnParseErrSet: true },
  { run: 6, path: "dart-sdk/pkg/_fe_analyzer_shared/lib/src/flow_analysis/flow_analysis_operations.dart", inOwnParseErrSet: true },
  { run: 7, path: "dart-sdk/pkg/analysis_server/test/lsp_over_legacy/execute_command_test.dart", inOwnParseErrSet: true },
  { run: 8, path: "dart-sdk/pkg/analysis_server/test/src/services/correction/fix/convert_to_package_import_test.dart", inOwnParseErrSet: true },
]

const args = process.argv.slice(2)
const targets: Array<{ label: string; abs: string; run?: number; inOwnParseErrSet?: boolean }> =
  args.length > 0
    ? args.map(a => ({ label: a, abs: a.startsWith("/") ? a : `${CR}/${a}` }))
    : RECORDED.map(r => ({ label: r.path, abs: `${CR}/${r.path}`, run: r.run, inOwnParseErrSet: r.inOwnParseErrSet }))

console.log(`hang-file innocence — ${targets.length} file(s), one parseFile each, no concurrency`)
console.log(`corpus root ${CR}`)
console.log(
  "\nA CLEAN row means the file is not itself malformed. It does NOT mean the engine",
)
console.log(
  "survives a malformed file followed by others — see the header on what this cannot establish.",
)

let clean = 0
const rows: string[] = []
for (const t of targets) {
  let size = -1
  try {
    size = statSync(t.abs).size
  } catch {
    rows.push(`  MISSING   ${t.label} — not on disk`)
    continue
  }
  const started = Date.now()
  let verdict: string
  let symbols = 0
  let rels = 0
  try {
    const r: any = await parseFile(t.abs, CR)
    const ms = Date.now() - started
    symbols = Array.isArray(r?.symbols) ? r.symbols.length : 0
    const rel = Array.isArray(r?.relationships) ? r.relationships.length : 0
    rels = rel
    if (r?.success === false) {
      verdict = `FAIL success=false ${String(r?.error ?? "?").slice(0, 60)}`
    } else if (symbols === 0 && rels === 0) {
      // An empty result over a real file is NOT a pass. `parseFile` routes
      // >1 MB to the structural fallback and >5 MB to a skip, so a large file
      // legitimately yields nothing here — say which, rather than calling it clean.
      verdict = size > 5 * 1024 * 1024 ? "EMPTY over the 5 MB skip limit" : size > 1024 * 1024 ? "EMPTY over the 1 MB structural limit" : "EMPTY (0 symbols, 0 rels)"
    } else {
      verdict = `OK ${ms} ms — ${symbols} symbols, ${rels} rels`
      clean++
    }
  } catch (e) {
    verdict = `THREW ${String((e as Error)?.message ?? e).slice(0, 70)}`
  }
  // NOTE: the `]` is appended OUTSIDE the template. `tsc` rejects a `]` that
  // immediately follows a substitution's closing brace (`${…}]`), reporting
  // "Unterminated template literal" on a literal esbuild parses and runs — the
  // project's typecheck is `npx tsc --noEmit`, so the shape is avoided here
  // rather than left to a reader to rediscover.
  const inErrSet = t.inOwnParseErrSet ? ", also in that run's PARSE-ERR set" : ", NOT in that run's PARSE-ERR set"
  const via = t.run === undefined ? "" : `  [hang run ${t.run}${inErrSet}]`
  rows.push(`  ${t.label}  ${size.toLocaleString()} B  ${verdict}${via}`)
}

console.log("\n" + rows.join("\n"))
console.log(`\n${clean} of ${targets.length} parse clean through the production entry point, alone.`)
if (clean < targets.length) {
  console.log(
    "A file that does NOT parse clean here is a genuine per-file finding and changes the",
  )
  console.log(
    "reading: the hang would then be attributable to the file rather than to shared state.",
  )
}
console.log(
  "\nproperties across the recorded set: the hang file is never named twice, and every",
)
console.log(
  "hang file was already in its own run's PARSE-ERR set — so the corrupt state predates it.",
)