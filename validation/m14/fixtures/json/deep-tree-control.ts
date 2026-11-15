// DEEP-TREE CONTROL — the analyzer must terminate on the corpus's adversarial deep file, and the
// control must be able to FAIL when it does not.
//
// WHY IT EXISTS. `otp/lib/stdlib/test/json_SUITE_data/n_structure_open_array_object.json` is 50,000
// unclosed `[` — the grammar error-recovers it into an ERROR root with 50,000 named children — and
// `pool-worker.parseFile` spent **349,705 ms** on it, past the engine's 120 s analyzer timeout, and
// returned **0 symbols**. The incoming gate counts that as a DEGRADED file, and a PASS over a
// population containing one is not claimable: json's 120-file stride read `44337 of 44339 resolved,
// 0 ambiguous, 0 unresolved, extOK 2` and **exited 1 on this one file**.
//
// THE CAUSE, MEASURED (2026-10-13, synthetic `'[{"":' x N` through production `parseFile`):
// `namedChild(i)` is **O(i)** in this binding, so a `for (i = 0; i < namedChildCount; i++)` loop over
// a node's children is **O(k^2)**, while one `node.namedChildren` read is O(k) and a cursor walk is
// O(k). On the 20,000-child ERROR root: the index loop **60,297 ms**, one `namedChildren` read
// **90 ms**, cursor walk **84 ms** — and `nextNamedSibling` is O(n) per step too (**115,833 ms**).
// The analyzer's fourteen index loops are now single `namedChildren` reads (same nodes, same order), and
// the corpus file runs in **5,558 ms** with no timeout.
//
// WHAT THIS PINS, AND WHY THE MUTATION HARNESS CANNOT. The fix is behaviour-preserving: every
// symbol, edge and line is identical before and after, so no output-shaped fixture or mutant can
// tell the two revisions apart. What changed is TERMINATION, and that is what this control measures:
//   * a 20,000-level synthetic must parse UN-DEGRADED in under BOUND_20K_MS (measured 1.5-6 s; the
//     index-loop revision needs 54 s and would fail this before the engine's 120 s timeout fires);
//   * the corpus file, when present, must parse UN-DEGRADED in under BOUND_CORPUS_MS (measured
//     5.6 s; the index-loop revision needs 349.7 s);
//   * both directions are checked through the ENGINE'S OWN parser first — the root really is an
//     ERROR node with >= 20,000 named children — so a control that stopped exercising the
//     adversarial shape fails instead of passing vacuously.
//
// USAGE: npx tsx validation/m14/fixtures/json/deep-tree-control.ts
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

const REPO = process.env.BB_REPO || "/home/ishaq2321/mcp/backbencher-brain"
const { parseFile } = await import(`${REPO}/src/ast/pool-worker.ts`)
const { getParser } = await import(`${REPO}/src/ast/engine.ts`)

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CORPUS_FILE = join(CR, "otp", "lib", "stdlib", "test", "json_SUITE_data", "n_structure_open_array_object.json")

const LEVELS_20K = 20_000
const BOUND_20K_MS = 30_000
const BOUND_CORPUS_MS = 60_000

const ROOT = join(REPO, ".tmp-json", "deep-tree-control")
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(ROOT, { recursive: true })
const deepFile = join(ROOT, `deep-${LEVELS_20K}.json`)
writeFileSync(deepFile, '[{"":'.repeat(LEVELS_20K) + "\n")

const control = { ok: true, failures: [] as string[] }
const check = (label: string, got: unknown, want: unknown): void => {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) {
    console.log(`  PASS  ${label}`)
    return
  }
  control.ok = false
  control.failures.push(`${label}: got ${g}, want ${w}`)
  console.log(`  FAIL  ${label}: got ${g}, want ${w}`)
}
const checkTrue = (label: string, cond: boolean, detail: string): void => check(`${label} (${detail})`, cond, true)

const parser = await getParser("json")

// 1. THE PRECONDITION, measured with the engine's own parser: the synthetic and the corpus file
//    really do error-recover into wide ERROR roots. If the grammar ever stops doing that, this
//    control fails rather than asserting the happy path twice.
const pr = await parser.parse(await readFile(deepFile, "utf8"), deepFile)
const root: any = pr.rootNode
check("synthetic: engine reports hasError", root.hasError, true)
checkTrue("synthetic: the ERROR root is WIDE", root.namedChildCount >= LEVELS_20K, `namedChildCount=${root.namedChildCount}`)

// 2. THE MEASUREMENT THAT MATTERS: production `parseFile` terminates, un-degraded.
{
  const t0 = Date.now()
  const res: any = await parseFile(deepFile, ROOT)
  const ms = Date.now() - t0
  const degraded = res?.degraded === true || res?.fallback === true
  check(`${LEVELS_20K}-level synthetic: NOT degraded`, degraded, false)
  checkTrue("synthetic: it yields symbols", (res?.symbols ?? []).length >= 1, `symbols=${(res?.symbols ?? []).length}`)
  checkTrue(`synthetic: under the ${BOUND_20K_MS} ms bound`, ms < BOUND_20K_MS, `${ms} ms`)
  console.log(`         measured ${ms} ms (index-loop revision: ~54,000 ms; engine timeout: 120,000 ms)`)
}

// 3. THE FILE THAT FOUND IT, when the corpus is present. This is the input whose root really does
//    carry 50,000 children, and a control that pins the real case is worth more than one that pins
//    a shape invented here.
if (!existsSync(CORPUS_FILE)) {
  console.log(`  SKIP  corpus file not present: ${CORPUS_FILE}`)
} else {
  const prc = await parser.parse(await readFile(CORPUS_FILE, "utf8"), CORPUS_FILE)
  check("corpus file: the tree really does carry an ERROR root", prc.rootNode.hasError, true)
  checkTrue("corpus file: its ERROR root is WIDE", prc.rootNode.namedChildCount >= 50_000, `namedChildCount=${prc.rootNode.namedChildCount}`)
  const t0 = Date.now()
  const res: any = await parseFile(CORPUS_FILE, join(CR, "otp"))
  const ms = Date.now() - t0
  const degraded = res?.degraded === true || res?.fallback === true
  check("corpus file: NOT degraded (was DEGRADED at 349,705 ms)", degraded, false)
  checkTrue("corpus file: it yields symbols", (res?.symbols ?? []).length >= 1, `symbols=${(res?.symbols ?? []).length}`)
  checkTrue(`corpus file: under the ${BOUND_CORPUS_MS} ms bound`, ms < BOUND_CORPUS_MS, `${ms} ms`)
  console.log(`         measured ${ms} ms`)
}

console.log(`\n${control.ok ? "CONTROL PASS" : "CONTROL FAIL"} — ${control.failures.length} failure(s)`)
for (const f of control.failures) console.log(`  ${f}`)
process.exit(control.ok ? 0 : 3)
