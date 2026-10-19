/**
 * GO STDLIB MULTI-SEGMENT CLAIM CENSUS + ARBITER VERIFICATION (task-38).
 *
 * Lead ruling 2026-10-19 (Option A-modified): the lane cites multi-segment standard-library
 * imports through `languageNamespace`/`strict-absent` PLUS the opt-in `languageNamespaceSlash`
 * marker; the arbiter splits the target on `/` only for edges carrying that marker. This instrument
 * does the two measurements the arm needs:
 *
 *   1. COUNT (default): the EXACT number of eligible rows in every per-repo chunk dump already
 *      recorded (`.tmp-go/dumps/<repo>.txt`), plus an optional cap-N dump. "Eligible" is recomputed
 *      from the CLOSED `GO_STDLIB_TOP_LEVEL` set and the dump's own import literal — never from a
 *      run's claim — so the number is an independent count, not a restatement of the emission.
 *   2. VERIFY (`--verify`): end-to-end classification of the claim shapes against the CURRENT
 *      arbiter: claimed multi-segment stdlib -> externalVerified; UNCLAIMED -> unresolved;
 *      third-party/project path unclaimed -> unresolved; WRONG root -> externalRefuted (fail-closed);
 *      single-segment `fmt` keeps the old isStdlib route. If the arbiter's opt-in marker support is
 *      not present yet, it says so and exits 2 instead of reporting a misleading refutation.
 *
 * Usage:
 *   bun run script/m14/go-stdlib-multisegment-census.ts                    # count over chunk dumps
 *   bun run script/m14/go-stdlib-multisegment-census.ts --cap400 <dump>    # add a cap-N dump
 *   bun run script/m14/go-stdlib-multisegment-census.ts --verify           # arbiter verification
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { GO_STDLIB_TOP_LEVEL } from "../../src/ast/real-go-analyzer"
import { externalClaimOf, classifyEdge } from "./incoming-rule"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : process.cwd()
const DUMPS = path.join(ROOT, ".tmp-go", "dumps")

type Eligible = { file: string; target: string; outcome: string }
function isMultiSegmentStdlib(module: string): boolean {
  const segs = module.split("/")
  return segs.length >= 2 && !!segs[0] && segs[0] !== "." && segs[0] !== ".." && GO_STDLIB_TOP_LEVEL.has(segs[0])
}
function scanDump(file: string): Eligible[] {
  const out: Eligible[] = []
  let text: string
  try { text = fs.readFileSync(file, "utf8") } catch { return out }
  for (const line of text.split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const f = line.split("\t")
    if (f.length < 5 || f[1] !== "imports") continue
    const outcome = f[2] ?? ""
    const target = f[3] ?? ""
    if (isMultiSegmentStdlib(target)) out.push({ file, target, outcome })
  }
  return out
}

function countMode(cap400: string | null): void {
  const chunks: string[] = []
  try {
    for (const repo of fs.readdirSync(DUMPS)) {
      if (repo.endsWith(".txt")) chunks.push(path.join(DUMPS, repo))
    }
  } catch { /* none recorded yet */ }
  chunks.sort()
  let total = 0
  const perChunk: Record<string, number> = {}
  for (const file of chunks) {
    const rows = scanDump(file)
    perChunk[path.basename(file)] = rows.length
    total += rows.length
  }
  console.log(`ELIGIBLE (multi-segment stdlib imports, closed GO_STDLIB_TOP_LEVEL set) — ${chunks.length} chunk dump(s) recorded of 27:`)
  for (const [file, n] of Object.entries(perChunk)) console.log(`  ${file}: ${n}`)
  console.log(`  CHUNK-UNION EXACT: ${total}`)
  if (cap400) {
    const rows = scanDump(cap400)
    console.log(`  cap-400 dump (${path.basename(cap400)}): ${rows.length} eligible (stride sample, for cross-check)`)
  }
  console.log("  Whole-population count = the sum over the 27 per-repo chunk dumps once all are recorded; this number is exact for the dumps present.")
}

function verifyMode(): void {
  const empty = new Map<string, number>()
  const kinds = new Map<string, Set<string>>()
  const claimed = (roots: string[], marker: boolean, module: string) => ({
    metadata: {
      languageNamespace: roots,
      languageNamespacePolicy: "strict-absent",
      ...(marker ? { languageNamespaceSlash: true } : {}),
      stdlibModule: module,
    },
  })
  const classify = (tgt: string, rel: any): string => {
    const claim = externalClaimOf(rel)
    return classifyEdge(empty, kinds, tgt, claim as any).outcome
  }
  const optInPresent = classify("encoding/json", claimed(["encoding"], true, "encoding/json")) === "externalVerified"
  if (!optInPresent) {
    console.log("ARBITER OPT-IN NOT PRESENT YET: `languageNamespaceSlash` is not read by the shared arbiter in this checkout.")
    console.log("  The lane emission is correct against the RULED mechanism, but a gate arm run now would REFUTE the claims (extFAIL) by design.")
    console.log("  Re-run --verify after the Lead lands the opt-in; expected results are listed in GO-STDLIB-CLAIM-PROPOSAL.md.")
    process.exit(2)
  }
  const rows: [string, any, string][] = [
    ["encoding/json", claimed(["encoding"], true, "encoding/json"), "externalVerified"],
    ["net/url", claimed(["net"], true, "net/url"), "externalVerified"],
    ["crypto/sha256", claimed(["crypto"], true, "crypto/sha256"), "externalVerified"],
    ["encoding/json", { metadata: {} }, "unresolved"],
    ["github.com/google/go-cmp/cmp", { metadata: {} }, "unresolved"],
    ["example.com/project/internal/util", { metadata: {} }, "unresolved"],
    // A root that matches NOTHING in the target refutes — the fail-closed direction. (`["github"]`
    // deliberately is NOT used as the wrong-root case: the shared splitter splits dots too, so
    // `github` IS a segment of `github.com`, and the row would verify. That leak is exactly why the
    // emission vocabulary is the CLOSED stdlib set; it is demonstrated below as a WARNING, not
    // counted as a pass.)
    ["github.com/google/go-cmp/cmp", claimed(["nope"], true, "github.com/google/go-cmp/cmp"), "externalRefuted"],
    ["fmt", { metadata: { isStdlib: true } }, "externalVerified"],
  ]
  let bad = 0
  for (const [tgt, rel, want] of rows) {
    const got = classify(tgt, rel)
    const ok = got === want
    if (!ok) bad++
    console.log(`${ok ? "PASS" : "FAIL"}  ${tgt.padEnd(38)} want ${want.padEnd(18)} got ${got}`)
  }
  // The documented consequence of the shared splitter (dot AND slash): a dotted third-party path
  // claimed with its own first DOT-segment verifies. The lane never cites such a root — the
  // emission vocabulary is the closed stdlib set — but the fact is printed rather than hidden,
  // because it is the REASON for that discipline.
  const leak = classify("github.com/google/go-cmp/cmp", claimed(["github"], true, "github.com/google/go-cmp/cmp"))
  console.log(`WARNING  dotted-root leak (not used by emission): github.com/... claimed with ["github"] reads ${leak}`)
  console.log("         Emission rule: imports edges only, ≥2 slash segments, first segment ∈ closed GO_STDLIB_TOP_LEVEL; no shape heuristic.")
  console.log(bad === 0 ? "\nVERIFY PASS — claim verifies, unclaimed stays unresolved, wrong root refutes (fail-closed), old isStdlib route intact." : `\nVERIFY FAIL — ${bad} row(s) disagree with the ruled mechanism.`)
  process.exit(bad === 0 ? 0 : 1)
}

const args = process.argv
if (args.includes("--verify")) verifyMode()
else {
  const i = args.indexOf("--cap400")
  countMode(i >= 0 ? args[i + 1] ?? null : null)
}
