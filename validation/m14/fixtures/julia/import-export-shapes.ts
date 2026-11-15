/**
 * IMPORT/EXPORT SHAPE CENSUS — julia, lane-owned.
 *
 * ## Why this exists
 *
 * `script/m14/oracles/julia-imports.ts` and `julia-exports.ts` derive "this file imports that module"
 * and "this module exports that binding" independently of the analyzer. An independent derivation is
 * only independent if it is written from a DIFFERENT account of the grammar than the code under test,
 * and the two accounts have to start from the same facts or they are not comparable at all — so the
 * facts are measured here, once, and the oracle headers cite this instrument.
 *
 * The facts needed are: which named child types actually occur under each of julia's four statement
 * nodes, in what combinations, and how often. Everything else follows.
 *
 * ## Why a census and not the grammar file
 *
 * `grammars/tree-sitter-julia/grammar.js` states the rules; it does not say which of them the corpus
 * exercises. This lane has been bitten by the difference three times, each time in the same direction —
 * a branch written for a node the grammar CAN produce but the corpus never does reads exactly like a
 * branch that covers the construct:
 *
 *   - `list_litteral` in `exportableName()`, misspelled and unreachable: the grammar produces no such
 *     node over the corpus, and the two spellings that do exist (`tuple_expression`,
 *     `parenthesized_expression`) already covered the shapes.
 *   - `import_list`, filtered for inside `importTargets()` and then mapped with a TERNARY whose two
 *     branches were both `x.text.trim()` — a conditional that cannot choose, over a node that does
 *     not occur.
 *   - `import_path` alone, which matched 42% of the corpus's import statements and none of the other
 *     58%; `selected_import` is the single most common shape by a wide margin.
 *
 * So the census prints the observed distribution, not the grammar's rule list, and a node type that
 * appears here is one the oracle may rely on.
 *
 * ## What it cannot do
 *
 * It counts shapes on the corpus the router admits today. A construct that only a third project uses
 * is invisible here exactly as it is invisible to the oracle — the limit is stated where the oracles
 * are used rather than left for a reader to assume.
 *
 * READ-ONLY. Writes nothing. No regex: `node.type` and named children only.
 *
 *   npx tsx validation/m14/fixtures/julia/import-export-shapes.ts [--files 400]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const WANT = Number(argv[argv.indexOf("--files") + 1]) || 400

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

const kids = (n: any): any[] => {
  const out: any[] = []
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) out.push(c) }
  return out
}

// ---- the admitted population, discovered exactly as the census and the direct oracle check
// discover it, then SORTED so the draw is a function of the corpus and not of directory order.
const all: { label: string; abs: string }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    all.push({ label: `${e}/${rel}`, abs })
  }
}
all.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const step = all.length / WANT
const files: typeof all = []
for (let i = 0; i < WANT; i++) files.push(all[Math.min(all.length - 1, Math.floor(i * step))])

const TARGETS = ["import_statement", "using_statement", "export_statement", "public_statement"]

type Rec = { count: number; example: string; at: string }
const topLevel = new Map<string, Rec>()
const nested = new Map<string, Rec>()
const childTypeTotals = new Map<string, number>()
const stmtsByType = new Map<string, number>()
let unreadable = 0

const flat = (s: string): string => s.split("\n").join("\\n").slice(0, 120)

for (const f of files) {
  let text: string
  try { text = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = parser.parse(text) } catch { unreadable++; continue }
  if (!tree) { unreadable++; continue }

  const visit = (n: any): void => {
    if (TARGETS.includes(n.type)) {
      stmtsByType.set(n.type, (stmtsByType.get(n.type) ?? 0) + 1)
      const ks = kids(n)
      const sig = `${n.type} :: [${ks.map((c: any) => c.type).join(", ")}]`
      const rec = topLevel.get(sig) ?? { count: 0, example: flat(n.text), at: f.label }
      rec.count++
      topLevel.set(sig, rec)
      for (const c of ks) {
        childTypeTotals.set(c.type, (childTypeTotals.get(c.type) ?? 0) + 1)
        const ck = kids(c)
        if (!ck.length) continue
        const s2 = `${n.type} > ${c.type} :: [${ck.map((x: any) => x.type).join(", ")}]`
        const r2 = nested.get(s2) ?? { count: 0, example: flat(n.text), at: f.label }
        r2.count++
        nested.set(s2, r2)
      }
    }
    for (const c of kids(n)) visit(c)
  }
  visit(tree.rootNode)
  // Free the tree: this loop parses its sample in one process, and an unfreed tree-sitter tree is
  // held by the wasm module until the process ends. Measured by
  // `validation/m14/fixtures/julia/tree-lifetime-probe.ts` — retaining trees turns the third pass
  // over 1,985 files into 1,928 `Aborted()` throws, freeing every tree leaves 0. Everything
  // accumulated above is a string and a count, so nothing here reads the tree afterwards.
  try { tree.delete?.() } catch { /* already released */ }
}

const byCount = (m: Map<string, Rec>) => [...m.entries()].sort((a, b) => b[1].count - a[1].count)

let stmts = 0
for (const v of stmtsByType.values()) stmts += v

console.log(`IMPORT/EXPORT SHAPE CENSUS — julia`)
console.log(`population ${all.length} · sampled ${files.length} (evenly spaced, sorted) · unreadable ${unreadable}`)
console.log(`statements ${stmts}: ` + [...stmtsByType.entries()].sort().map(([k, v]) => `${k}=${v}`).join("  "))
console.log(`\n=== named child types, counted across all four statements ===`)
for (const [t, c] of [...childTypeTotals.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(c).padStart(7)}  ${t}`)

console.log(`\n=== STATEMENT SIGNATURES (${topLevel.size} distinct) ===`)
for (const [sig, r] of byCount(topLevel)) console.log(`${String(r.count).padStart(6)}  ${sig}\n          ex: ${r.example}\n          at: ${r.at}`)

console.log(`\n=== NESTED SIGNATURES (${nested.size} distinct) ===`)
for (const [sig, r] of byCount(nested)) console.log(`${String(r.count).padStart(6)}  ${sig}\n          ex: ${r.example}\n          at: ${r.at}`)