// Q7 — COMPLETENESS LEDGER vs MEASUREMENT. The vue grammar's full node-type
// surface, classified by what the analyzer actually does with each type, and
// compared against script/m14/spec/vue-completeness.json.
import * as fs from "fs"
import * as path from "path"
import { loadLang } from "./harness"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"

function filesUnder(root: string, exts: string[], limit: number): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    let es: fs.Dirent[]
    try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === "node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

/** What the analyzer's source literally names, so the classification is derived not declared. */
function analyzerMentions(): Set<string> {
  const s = fs.readFileSync(path.join(ROOT, "src/ast/real-vue-analyzer.ts"), "utf8")
  return new Set([...s.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default
  const vue = await loadLang("vue")
  const files = [
    ...filesUnder(path.join(CORPUS_ROOT, "element-plus"), [".vue"], 250),
    ...filesUnder(path.join(CORPUS_ROOT, "vue-element-admin"), [".vue"], 131),
    ...filesUnder(path.join(CORPUS_ROOT, "vue-core"), [".vue"], 50),
  ]
  const seen = new Map<string, number>()
  const sample = new Map<string, string>()
  const isMissing = new Set<string>()
  let withError = 0
  const mk = () => { const p = new Parser(); p.setLanguage(vue); return p }
  for (const f of files) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const p = mk()
    const tree = p.parse(src)
    if (tree.rootNode.hasError) withError++
    const stack = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      const t = n.type
      seen.set(t, (seen.get(t) ?? 0) + 1)
      if (!sample.has(t)) sample.set(t, path.relative(CORPUS_ROOT, f) + ":" + (n.startPosition.row + 1))
      if (n.isMissing) isMissing.add(t)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }

  const mentions = analyzerMentions()
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/vue-completeness.json"), "utf8"))
  const handled = new Set<string>(spec.handled_verified.types)
  const silent = new Set<string>(spec.internal_silent.types)
  const ruled = new Set<string>((spec.design_decision?.decisions ?? []).map((d: any) => d.node_type).flatMap((t: string) => String(t).split(",")))

  const types = [...seen.entries()].sort((a, b) => b[1] - a[1])
  console.log(`=== Q7.1  MEASURED vue node-type surface over ${files.length} corpus files (${withError} with ERROR) ===`)
  console.log(`  distinct types observed: ${types.length}`)
  console.log(`  type                     count   ledger            named-in-analyzer`)
  for (const [t, n] of types) {
    const where = handled.has(t) ? "handled_verified" : silent.has(t) ? "internal_silent" : ruled.has(t) ? "design_decision" : "— UNCLASSIFIED —"
    const inSrc = mentions.has(t) ? "yes" : "no"
    console.log(`  ${t.padEnd(24)} ${String(n).padStart(7)}   ${where.padEnd(18)} ${inSrc}`)
  }

  const unclassified = types.filter(([t]) => !handled.has(t) && !silent.has(t) && !ruled.has(t))
  console.log(`\n  UNCLASSIFIED in the ledger: ${unclassified.length} -> ${unclassified.map(([t, n]) => `${t}(${n})`).join(" ")}`)
  const claimed = [...handled, ...silent]
  const neverSeen = claimed.filter((t) => !seen.has(t))
  console.log(`  ledger types NOT OBSERVED on this corpus: ${neverSeen.length} -> ${neverSeen.join(" ")}`)
  const missingTypes = [...isMissing].filter((t) => !handled.has(t) && !silent.has(t))
  console.log(`  MISSING-node types present: ${[...isMissing].join(" ") || "none"} (unclassified: ${missingTypes.join(" ") || "none"})`)

  console.log(`\n=== Q7.2  ledger totals vs measurement ===`)
  console.log(`  ledger: ${handled.size} handled_verified + ${silent.size} internal_silent = ${claimed.length} classified`)
  console.log(`  M14-COMPLETENESS-LEDGER.md claims "37/37 types"`)
  console.log(`  measured distinct types: ${types.length}`)

  console.log(`\n=== Q7.3  the same census for typescript (the reference lane) ===`)
  const ts = await loadLang("ts")
  const tsFiles = filesUnder(path.join(CORPUS_ROOT, "element-plus"), [".ts", ".tsx"], 250)
  const tsSeen = new Map<string, number>()
  for (const f of tsFiles) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    const p = new Parser(); p.setLanguage(ts)
    const tree = p.parse(src)
    const stack = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      tsSeen.set(n.type, (tsSeen.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
  const tsSpec = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/typescript-completeness.json"), "utf8"))
  console.log(`  typescript: ${tsFiles.length} files, ${tsSeen.size} distinct types`)
  console.log(`  ledger: ${(tsSpec.handled_verified?.types ?? []).length} handled + ${(tsSpec.internal_silent?.types ?? []).length} silent, gaps=${(tsSpec.gap?.gaps ?? []).length}`)

  console.log(`\n=== Q7.4  spec-table: does vue-spec-table.json describe the analyzer as it is? ===`)
  const tbl = JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/vue-spec-table.json"), "utf8"))
  console.log(`  top-level keys: ${Object.keys(tbl).join(" ")}`)
  console.log(`  typescript-spec-table keys: ${Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "script/m14/spec/typescript-spec-table.json"), "utf8"))).join(" ")}`)
  const stale = JSON.stringify(tbl).match(/gap V[0-9]/g)
  console.log(`  vue spec-table mentions "gap V…": ${stale ? [...new Set(stale)].join(" ") : "none"}`)
  console.log(`  (V1-V4 are all status=CLOSED in vue-completeness.json — the table still describes them as gaps)`)
}
main()
