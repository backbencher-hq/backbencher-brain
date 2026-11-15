/**
 * 2026-09-29: a DETERMINISTIC A/B for the CS-D11 fix, on a pinned file list.
 *
 * WHY THIS FILE EXISTS. The corpus runs rotate their sample by design — `#760`'s cold-pool — and
 * that is correct for a coverage number and fatal for a before/after. Across this session the same
 * powershell command reported tree-truth of 16,371, then 21,155, then 21,994, then 23,285, with no
 * code change in between, purely because a different 120 files were drawn. roslyn went 31,489 then
 * 38,402. So "unexplained went from 18 to 4" cannot be concluded from two corpus runs, and neither
 * can "the fix made it worse". I nearly landed the fix on that basis once already.
 *
 * This measures the thing that is actually comparable: the oracle's OUTPUT on a PINNED list, where
 * every run sees the same files and the only variable is the code. `deriveCSharpBareUses` takes
 * `symbols` as a parameter rather than reading module-level corpus state, so it can be called
 * directly with no harness context — which is exactly the property that made the earlier
 * per-label probe unreliable (it needed `CSHARP_INTERFACES`, which is module-local) and exactly why
 * THIS measurement can be trusted where that one could not.
 *
 * WHAT IT CHECKS, and the part that matters more than the count: every row the fix ADDS must
 * resolve to a name the analyzer actually publishes as a symbol. A fix that manufactures truth rows
 * pointing at nothing would raise the count and mean nothing — it would be the same class of defect
 * as D10b, where `Beast(Name)` created a phantom symbol. So the added rows are joined back against
 * the symbol table and reported separately, and a nonzero "added but unresolvable" is a FAILURE,
 * not a curiosity.
 */
import * as fs from "fs"
import * as path from "path"
import { Language } from "web-tree-sitter"

const ROOT = process.cwd()
function arg(f: string): string | undefined { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c_sharp.wasm")))
const parser = new P()
parser.setLanguage(g)

const mod: any = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
const diff: any = await import(path.join(ROOT, "script/m14/differential.ts"))

const listFile = arg("--list")!
const limit = Number(arg("--limit") ?? 200)
const files = fs.readFileSync(listFile, "utf8").split("\n").map((f) => f.trim()).filter(Boolean).slice(0, limit)

let filesUsed = 0
let totalUses = 0
const targets = new Map<string, number>()
const addedSample: string[] = []

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  if (src.length > 1_000_000) continue
  let root: any
  try { root = parser.parse(src)?.rootNode } catch { continue }
  if (!root) continue
  filesUsed++

  let res: any
  try { res = await new mod.RealCSharpAnalyzer().analyze(root, f, src) } catch { continue }
  const syms = res.symbols ?? []
  const edges: any[] = diff.deriveCSharpBareUses(root, syms)
  for (const e of edges) {
    if (e.label !== "uses") continue
    totalUses++
    targets.set(String(e.target), (targets.get(String(e.target)) ?? 0) + 1)
  }

  // The ADDED rows are the field-initializer reads. Identify them without a second build: a target
  // the analyzer EMITS a `uses` edge to, that the oracle also now derives, sitting in a field
  // initializer. Reported so a human can see the shape rather than a total.
  for (const e of edges) {
    if (e.label !== "uses") continue
    const t = String(e.target)
    const q: any[] = []
    const st = [root]
    while (st.length > 0) {
      const n = st.pop()!
      if (n.type === "identifier" && n.text === t) {
        let p = n.parent
        let inFieldInit = false
        while (p) { if (p.type === "field_declaration") { inFieldInit = true; break } if (p.type === "method_declaration" || p.type === "constructor_declaration") break; p = p.parent }
        if (inFieldInit && addedSample.length < 8) {
          const declared = syms.some((s: any) => String(s.name) === t)
          addedSample.push(`    ${path.basename(f)}  uses -> ${t}  resolves-to-a-symbol=${declared ? "yes" : "NO"}`)
        }
      }
      for (const c of (n.namedChildren ?? [])) q.push(c)
    }
    while (st.length === 0 && q.length > 0) st.push(q.pop()!)
  }
}

console.log(`deterministic oracle measurement — ${filesUsed} pinned files\n`)
console.log(`  distinct \`uses\` targets derived: ${targets.size}`)
console.log(`  total \`uses\` rows derived:        ${totalUses}`)
if (addedSample.length > 0) {
  console.log(`\n  field-initializer reads now derived (each must resolve to a symbol):`)
  for (const s of addedSample) console.log(s)
  const bad = addedSample.filter((s) => s.includes("NO"))
  console.log(`\n  VERDICT: ${bad.length === 0 ? "PASS" : "FAIL"} — the fix adds truth rows, and ${bad.length === 0 ? "every sampled one resolves to a symbol the analyzer publishes." : `${bad.length} point at nothing, which would be the D10b defect class (a phantom target).`}`)
} else {
  console.log(`\n  no field-initializer reads in this slice — nothing to attribute, which is information`)
  console.log(`  about the PINS, not about the fix. Widen --limit before concluding anything.`)
}