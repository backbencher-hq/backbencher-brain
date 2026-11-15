/**
 * WHY DEEP NESTING COSTS THE ANALYZER SUPER-LINEARLY — counted, not timed
 *
 * ## Why not a timer
 *
 * The obvious instrument is wall-clock, and on this host it measures nothing but the
 * other five lanes. `loadavg` sat at 22–30 during the ladder run, and a ladder-ordered
 * attempt produced `n=1000 HUNG > 45 s` beside `n=4000 2,815 ms` — a cost function that
 * is not monotonic in its own input, which is not a measurement of anything.
 *
 * Six lanes saturating one box makes every millisecond claim unciteable, and an
 * unciteable number is worse than no number. So this census counts OPERATIONS: how many
 * times the analyzer crosses the WASM node boundary. That count is a deterministic
 * function of (tree shape, analyzer code), so it does not move when the machine is busy —
 * precisely the property a timing measurement lacks under load.
 *
 * ## What is counted, and why it is the cost
 *
 * `web-tree-sitter` exposes no bulk iterator. Every structural question about the tree
 * is a getter or a method that crosses into WASM and unmarshals a node:
 *
 *   node.parent        -> tree.js parent()      -> unmarshalNode
 *   node.child(i)      -> tree.js child()       -> unmarshalNode
 *   node.namedChild(i) -> tree.js namedChild()  -> unmarshalNode
 *   node.type          -> tree.js type          -> ts_node_type
 *
 * Each crossing is a FFI boundary plus an object materialization. So the crossing census
 * IS the cost model, and it is comparable across depths on a busy host.
 *
 * The analyzer's own tree walk is iterative (`stack: Frame[]`, real-dart-analyzer.ts:394),
 * which rules out a JS stack overflow; the hypothesis under test is that a per-node
 * ancestor CLIMB makes the total O(N x D).
 *
 * ## The prediction
 *
 * For a left-leaning spine of n nested `if (x == 0) {`:  N ~ 4n and D ~ 2n, both linear.
 *
 *   per-node ancestor climb  ->  crossings ~ N*D ~ n^2   (quadratic)
 *   per-node work only       ->  crossings ~ N   ~ n     (linear)
 *
 * ## A detail that cost a run to learn
 *
 * The prototype must be patched on the **ESM** build. `web-tree-sitter` ships two:
 * `tree-sitter.js` (import condition) and `tree-sitter.cjs` (require condition), and they
 * are SEPARATE class objects. Patching the CJS one silently counts zero — every crossing
 * goes through the other. The analyzer imports the ESM build, so this script does too,
 * in this same process, so both share one module instance and one prototype.
 *
 * Run: npx tsx validation/m14/fixtures/dart/node-crossing-census.ts
 */
import { mkdirSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const ROOT = process.cwd()

// ---- patch BEFORE any parse. Same module instance the engine uses.
const wts: any = await import("web-tree-sitter")
const g: any = globalThis
g.__x = { parent: 0, child: 0, namedChild: 0, type: 0, childCount: 0 }

function patch(proto: any, name: string, key: string) {
  const d = Object.getOwnPropertyDescriptor(proto, name)
  if (!d) { console.log(`  (note: ${name} is not an own property of the prototype — not patched)`); return }
  if (d.get) Object.defineProperty(proto, name, { configurable: true, get() { g.__x[key]++; return d.get.call(this) } })
  else if (typeof d.value === "function")
    Object.defineProperty(proto, name, { configurable: true, value: function (...a: any[]) { g.__x[key]++; return d.value.apply(this, a) } })
}

const NODE_PROTO = wts.Node?.prototype ?? wts.SyntaxNode?.prototype
if (!NODE_PROTO) throw new Error("web-tree-sitter exposed neither Node nor SyntaxNode; the census cannot run")
console.log(`patching prototype: ${(wts.Node ?? wts.SyntaxNode).name}`)
for (const [k, key] of [["parent", "parent"], ["child", "child"], ["namedChild", "namedChild"], ["type", "type"], ["childCount", "childCount"]] as const)
  patch(NODE_PROTO, k, key)

/** The real corpus file's shape at reduced nesting. */
function nestedIfs(n: number): string {
  let s = "var x = 0;\n\nmain() {\n"
  for (let i = 0; i < n; i++) s += `  if (x == 0) { //# 01: continued\n`
  s += "x = 1;\n" + "}\n".repeat(n) + "  return x;\n}\n"
  return s
}

const FIX = "/tmp/opencode/dart-generated"
mkdirSync(FIX, { recursive: true })
// Capped at 800: earlier ladders showed n >= 1000 does not terminate for parseFile at all,
// so a rung above that returns no census — it returns a timeout, which is its own finding.
const LADDER = [50, 100, 200, 400, 800]

console.log(`\nnode-crossing census — deterministic, load-independent`)
console.log(`population: ${LADDER.length} synthetic nested-if spines, one parseFile each\n`)
console.log(`  ${"n".padStart(5)}  ${"parent".padStart(10)}  ${"child".padStart(9)}  ${"named".padStart(8)}  ${"type".padStart(10)}  ${"childCnt".padStart(9)}  ${"TOTAL".padStart(11)}  ${"par/n^2".padStart(9)}  ${"tot/n^2".padStart(9)}`)

interface Row { n: number; parent: number; child: number; named: number; type: number; cc: number; total: number }
const rows: Row[] = []

for (const n of LADDER) {
  const f = path.join(FIX, `cross-${n}.dart`)
  writeFileSync(f, nestedIfs(n))
  for (const k of Object.keys(g.__x)) g.__x[k] = 0
  let ok = true
  try {
    const r: any = await parseFile(f, path.dirname(f))
    void r
  } catch (e: any) {
    ok = false
    console.log(`  ${String(n).padStart(5)}  THREW: ${String(e?.message ?? e).slice(0, 120)}`)
  }
  if (!ok) continue
  const x = g.__x
  const total = x.parent + x.child + x.namedChild + x.type + x.childCount
  rows.push({ n, ...x, total })
  console.log(
    `  ${String(n).padStart(5)}  ${String(x.parent).padStart(10)}  ${String(x.child).padStart(9)}  ` +
    `${String(x.namedChild).padStart(8)}  ${String(x.type).padStart(10)}  ${String(x.childCount).padStart(9)}  ` +
    `${String(total).padStart(11)}  ${(x.parent / (n * n)).toFixed(4).padStart(9)}  ${(total / (n * n)).toFixed(4).padStart(9)}`,
  )
}

console.log(`\nSCALING`)
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1], b = rows[i]
  const rn = b.n / a.n
  const ep = Math.log(b.parent / Math.max(a.parent, 1)) / Math.log(rn)
  const et = Math.log(b.total / Math.max(a.total, 1)) / Math.log(rn)
  console.log(`  n ${String(a.n).padStart(4)} -> ${String(b.n).padStart(4)} (x${rn.toFixed(1)})   parent ~ n^${ep.toFixed(2)}   total ~ n^${et.toFixed(2)}`)
}

const last = rows[rows.length - 1]
if (last) {
  console.log(`
READING IT
  At n=${last.n} the analyzer made ${last.parent.toLocaleString()} \`parent\` crossings —
  ${(last.parent / last.n).toFixed(1)} per nesting level, and ${(last.parent / (last.n * last.n)).toFixed(3)} per n^2.

  A walk that checks each node's own parent a constant number of times gives parent ~ n^1.
  A walk that CLIMBS to an ancestor for each of the ~4n nodes on a spine of depth ~2n
  gives parent ~ n^2. The exponent above decides which one this is, and it is a property
  of the code plus the tree shape, so it holds regardless of how busy this host is.`)
}

console.log(`
NOT EVIDENCE ON THIS HOST: any millisecond figure. loadavg was 22–30 with five other lanes
running, and a ladder-ordered timing run produced n=1000 HUNG > 45 s beside
n=4000 2,815 ms — non-monotonic in its own input, therefore a measurement of load.`)