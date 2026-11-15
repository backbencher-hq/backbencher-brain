/**
 * HOW MANY admitted dart files can `script/m14/ontology-coverage-gate.ts` Instrument A
 * NOT descend — and which ones.
 *
 * ## Why this exists
 *
 * The gate's Instrument A is unbounded recursion over parse-tree depth:
 *
 *     const v = (n) => { grammarNodeTypes.set(n.type, ...); for (let i=0;i<n.childCount;i++) v(n.child(i)) }
 *     v(t.rootNode)                                                     // gate:339
 *
 * Instrument A's own diagnostic value for THIS lane is zero: `grammarNodeTypes` is read
 * only at gate:494 and gate:505, both inside the branch for a type that is NOT emitted and
 * HAS a ruling, and `DART_RULED` is empty because all ten types are emitted. So for dart the
 * pass is pure dead work — and it is the pass that kills the gate.
 *
 * One file was already known to blow the stack (`deep_nesting_statement_test.dart`, iterative
 * tree depth 20,005, `instrument-a-depth-probe.ts`). REMOVING IT FROM A PROBE CORPUS DID NOT
 * FIX THE GATE: the run still died with the identical RangeError. So "one file" was an
 * undercount, and this census is what replaces it with a number.
 *
 * ## What it measures
 *
 * For every file the gate would admit (`git ls-files`, size <= 512 KiB, `.dart`), using the
 * gate's own `detectLanguageFromPath` and the gate's own wasm grammar:
 *
 *   - iterative tree depth — an explicit stack, never recursion, so this probe cannot itself
 *     overflow on the file that overflows the gate;
 *   - under `--verify` only: whether the gate's own recursive `v` survives the file, and the
 *     largest depth ceiling at which it does, each probe in its own child process so the
 *     RangeError is data rather than the end of this census;
 *   - node count.
 *
 * `--verify` is opt-in because it costs one node startup plus one parse per PROBE and a
 * bisection is log2(depth) probes, so it is bounded by `--verify N` over the N deepest files
 * and is never run over the corpus. The census's primary column — iterative depth, zero child
 * processes — is what sizes the blast radius, and it covers all 33,692 admitted files. The
 * verify pass then confirms on the deepest files found that the depth column actually predicts
 * survival, and supplies the threshold the column is read against.
 *
 * If a future run wants the verify verdict for every file, the honest form is one child per
 * file with a single full-depth descent (~33,700 spawns); bisecting all of them would be
 * ~450,000. The depth column already bounds that set to the files worth spawning for.
 *
 * ## The threshold is measured, not assumed
 *
 * `--verify` reports, per file, the largest recursion depth at which `v` still survives,
 * found by BISECTION ON THE DEPTH CEILING with one child process per probe (§ `measureCeiling`).
 * That turns "deep files are risky" into "the gate survives depth D and dies at D+1", which is
 * the number a shared-machinery fix has to be written against.
 *
 * The threshold is a property of the HOST, not of the corpus: it is V8's stack limit times the
 * per-frame cost of `n.child(i)` on this machine. Re-run it on the machine the gate will run
 * on before quoting it as that machine's number. What IS a property of the corpus is the
 * DISTRIBUTION — how many files sit near the threshold — and that is the census's primary
 * column, which needs no child processes.
 *
 * Run:
 *   npx tsx validation/m14/fixtures/dart/instrument-a-depth-census.ts > /tmp/depth-census.txt
 *   npx tsx validation/m14/fixtures/dart/instrument-a-depth-census.ts --verify 40 > /tmp/depth-verify.txt
 */
import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "dart"
const VERIFY_N = Number(process.argv.find((a) => /^--verify/.test(a))?.split("=")[1] ?? 40)
const DO_VERIFY = process.argv.some((a) => a.startsWith("--verify"))
const GRAMMAR = "tree-sitter-dart.wasm"

// ---------------------------------------------------------------- corpus, the gate's rule
const files: { repo: string; rel: string; abs: string; text: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    files.push({ repo: e, rel, abs, text })
  }
}

// ---------------------------------------------------------------- parser, the gate's grammar
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
const WSP_ROOT = path.join(process.cwd(), "node_modules", "web-tree-sitter")
await WSP.init({ locateFile: () => path.join(WSP_ROOT, "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", GRAMMAR))))

/** Max depth + node count via an explicit stack. Cannot overflow on any input. */
function walkIterative(root: any): { depth: number; nodes: number } {
  let depth = 0
  let nodes = 0
  const stack: [any, number][] = [[root, 1]]
  while (stack.length) {
    const [n, d] = stack.pop()!
    nodes++
    if (d > depth) depth = d
    const cc = n.childCount
    for (let i = 0; i < cc; i++) stack.push([n.child(i), d + 1])
  }
  return { depth, nodes }
}

// The gate's exact descent, plus a depth ceiling, so a CHILD can bisect the surviving depth.
const WSP_CJS = path.join(WSP_ROOT, "tree-sitter.cjs")
const WSP_WASM = path.join(WSP_ROOT, "tree-sitter.wasm")

/**
 * One probe: run the gate's own `v` shape, refusing to recurse past `CEILING`, in a child
 * process, and report whether it survived. Prints exactly `OK` or `RANGE`.
 *
 * ## Why a child per probe, and not a bisection inside one child
 *
 * The obvious implementation catches the RangeError and retries in-process. This does not,
 * for a reason worth writing down: a probe that overflows tells you the stack was exhausted
 * at an unknown depth *inside that descent*, and reusing the recovered process makes the
 * result depend on how much stack the previous overflow left behind. One fresh child per
 * ceiling makes each data point independent. The cost is that the child re-parses the file,
 * so a full bisection is log2(depth) parses, not one.
 *
 * `CEILING` is substituted by the CALLER before this string is used. It must not appear
 * anywhere else in the source text.
 */
const PROBE_SRC = (abs: string, ceiling: number) => `
  const wts = require(${JSON.stringify(WSP_CJS)});
  const fs = require("fs");
  const CEILING = ${ceiling};
  (async () => {
    await wts.Parser.init({ locateFile: () => ${JSON.stringify(WSP_WASM)} });
    const p = new wts.Parser();
    p.setLanguage(await wts.Language.load(fs.readFileSync(${JSON.stringify(path.join(process.cwd(), "wasm", GRAMMAR))})));
    const t = p.parse(fs.readFileSync(${JSON.stringify(abs)}, "utf8"));
    // gate:339, verbatim in shape, with the ceiling this probe varies:
    //   const v = (n) => { grammarNodeTypes.set(n.type, ...); for (let i=0;i<n.childCount;i++) v(n.child(i)) }
    const v = (x, d) => {
      if (d > CEILING) return;
      for (let i = 0; i < x.childCount; i++) v(x.child(i), d + 1);
    };
    try { v(t.rootNode, 1); process.stdout.write("OK"); }
    catch (e) { if (e instanceof RangeError) process.stdout.write("RANGE"); else process.stdout.write("ERR:" + e.message); }
  })();
`

/** Runs the gate's descent shape with a hard depth ceiling. One child process. */
function probeCeiling(abs: string, ceiling: number): "OK" | "RANGE" | "ERR" {
  try {
    const out = execFileSync(process.execPath, ["-e", PROBE_SRC(abs, ceiling)], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      cwd: process.cwd(),
    })
    if (out === "OK" || out === "RANGE") return out
    return "ERR"
  } catch {
    return "ERR"
  }
}

/**
 * The largest tree depth at which the gate's descent still survives, by bisection on the
 * ceiling. Monotonic by construction: a smaller ceiling means a shallower recursion, so
 * "survives at L" is monotone in L. Returns `{survivedUpTo, safeAtFullDepth, probes, err}`
 * where `survivedUpTo === D` means the file's FULL depth is survivable.
 */
function measureCeiling(abs: string, fullDepth: number): {
  survivedUpTo: number
  safeAtFullDepth: boolean
  probes: number
  err: boolean
} {
  let probes = 0
  let err = false
  if (probeCeiling(abs, fullDepth) === "OK") {
    return { survivedUpTo: fullDepth, safeAtFullDepth: true, probes: 1, err: false }
  }
  let lo = 0 // known to survive (ceiling 0 = no recursion at all)
  let hi = fullDepth // known NOT to survive
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    const r = probeCeiling(abs, mid)
    probes++
    if (r === "OK") lo = mid
    else if (r === "RANGE") hi = mid
    else { err = true; break }
  }
  return { survivedUpTo: lo, safeAtFullDepth: false, probes, err }
}

// ---------------------------------------------------------------- census
console.log(`# instrument-A depth census — ${LANG}`)
console.log(`# corpus root: ${CR}`)
console.log(`# admitted files: ${files.length}`)

type Row = { depth: number; nodes: number; bytes: number; repo: string; rel: string }
const rows: Row[] = []
let nullTrees = 0
const t0 = Date.now()
for (let i = 0; i < files.length; i++) {
  const f = files[i]
  const tree = parser.parse(f.text)
  if (!tree) { nullTrees++; continue }
  const { depth, nodes } = walkIterative(tree.rootNode)
  tree.delete?.()
  rows.push({ depth, nodes, bytes: f.text.length, repo: f.repo, rel: f.rel })
  if ((i + 1) % 2000 === 0) process.stderr.write(`  ...${i + 1}/${files.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`)
}
rows.sort((a, b) => b.depth - a.depth)

const pct = (n: number) => `${((n / rows.length) * 100).toFixed(4)}%`
console.log(`# parsed: ${rows.length}  nullTrees: ${nullTrees}  elapsed: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
console.log(`# depth distribution (cumulative files at or above each depth):`)
for (const th of [500, 1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000]) {
  const n = rows.filter((r) => r.depth >= th).length
  console.log(`#   >= ${String(th).padStart(6)} : ${String(n).padStart(5)}  ${pct(n)}`)
}
console.log(`#`)
console.log(`# deepest 40 files:`)
for (const r of rows.slice(0, 40)) console.log(`#   ${String(r.depth).padStart(6)}  ${String(r.nodes).padStart(8)}n  ${r.repo}/${r.rel}`)

if (DO_VERIFY) {
  console.log(`#`)
  console.log(`# verify: the gate's recursive v() run in a CHILD process, ceiling bisected, per file,`)
  console.log(`#         over the ${Math.min(VERIFY_N, rows.length)} deepest files. "survivableCeiling" is the`)
  console.log(`#         largest tree depth at which v() survives; equals the file's own depth iff safe.`)
  console.log(`#         probes = child spawns. Machine constants: this host, this node, --stack-size default.`)
  console.log(`#   fileDepth  safe  survivableCeiling  probes  file`)
  const target = rows.slice(0, VERIFY_N)
  const results: { f: string; d: number; safe: boolean; ceiling: number; probes: number; err: boolean }[] = []
  for (const r of target) {
    const abs = path.join(CR, r.repo, r.rel)
    const m = measureCeiling(abs, r.depth)
    results.push({ f: `${r.repo}/${r.rel}`, d: r.depth, safe: m.safeAtFullDepth, ceiling: m.survivedUpTo, probes: m.probes, err: m.err })
    console.log(
      `#   ${String(r.depth).padStart(7)}  ${m.safeAtFullDepth ? "YES" : "NO "}   ${String(m.survivedUpTo).padStart(17)}  ${String(m.probes).padStart(6)}  ${r.repo}/${r.rel}${m.err ? "  [ERR]" : ""}`,
    )
  }
  const unsafe = results.filter((r) => !r.safe)
  console.log(`#`)
  console.log(`# files in this verify set the gate's descent CANNOT complete: ${unsafe.length} of ${results.length}`)
  for (const u of unsafe) console.log(`#   UNSAFE depth=${u.d} survivableCeiling=${u.ceiling} ${u.f}`)
  const probesTotal = results.reduce((a, r) => a + r.probes, 0)
  console.log(`# child spawns: ${probesTotal}`)
  console.log(`# --- verify-ndjson ---`)
  for (const r of results) console.log(JSON.stringify({ f: r.f, d: r.d, safe: r.safe, ceil: r.ceiling, probes: r.probes, err: r.err }))
}

// machine-readable tail for downstream counting
console.log(`# --- ndjson ---`)
for (const r of rows) console.log(JSON.stringify({ d: r.depth, n: r.nodes, b: r.bytes, f: `${r.repo}/${r.rel}` }))