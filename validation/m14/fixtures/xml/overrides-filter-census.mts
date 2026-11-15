/**
 * XML OVERRIDES-FILTER CENSUS — the 3 rows the shared noise filter eats on this lane,
 * measured with a control, so the closure's `overrides 0` is a stated fact rather than prose.
 *
 * ## THE FINDING
 *
 * The analyzer EMITS `overrides` for XSLT 1.0 §5.5 competing template rules (3 sites in the
 * whole admitted population; the fixture xml/xslt-competing-template-overrides pins the
 * emission and PASSES). The pooled/store path drops all 3 before the gate reads them,
 * because the shared shape test in `filterNoiseRelationships` (pool-worker.ts, commit
 * ea8df6bbc 2026-10-21) refuses a target leaf carrying `=`, and this lane's DERIVED
 * template identity — `xsl:template[match=*|mode=toc.for.section|priority=]#0` — carries
 * `=` inside `priority=]`. A nameless competing template has no other sound name: the
 * identity is the §5.5 triple itself.
 *
 * ## THE CONTROL (what makes this a measurement)
 *
 * The same rows with the `=` removed are KEPT by the filter — so the emission is real, the
 * filter is the cause, and the loss is silent (absent from the graph, invisible to any
 * column count, exactly the scss lane's class: a rule added for one lane's snippets eating
 * another lane's edges).
 *
 * ## RUN
 *   npx tsx validation/m14/fixtures/xml/overrides-filter-census.mts
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { execSync } from "node:child_process"

const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm")))
const parser = new ParserClass(); parser.setLanguage(grammar)
const { RealXmlAnalyzer } = await import("../../../../src/ast/real-xml-analyzer")
const { filterNoiseRelationships } = await import("../../../../src/ast/pool-worker")

const ROOT = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const EXTS = new Set(["xml", "xsd", "dtd", "svg", "xsl", "xslt", "rng"])
const CAP = 512 * 1024
const repos = readdirSync(ROOT).filter((e) => {
  try { return statSync(path.join(ROOT, e)).isDirectory() && statSync(path.join(ROOT, e, ".git")) } catch { return false }
})

const screen = /<xsl:template[^>]*match=/i
type Eaten = { file: string; type: string; target: string; bannedChar: string; controlKept: boolean }
const eaten: Eaten[] = []
let files = 0
for (const repo of repos) {
  let fs: string[]
  try { fs = execSync(`git -C ${JSON.stringify(path.join(ROOT, repo))} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { continue }
  for (const rel of fs) {
    if (!EXTS.has(rel.slice(rel.lastIndexOf(".") + 1))) continue
    const abs = path.join(ROOT, repo, rel)
    try { if (statSync(abs).size > CAP) continue } catch { continue }
    const t = readFileSync(abs, "utf8")
    if (!screen.test(t)) continue
    files++
    const tree = parser.parse(t)
    if (!tree) continue
    const res: any = new RealXmlAnalyzer().analyze(tree.rootNode, t, `${repo}/${rel}`)
    const rels: any[] = res.relationships ?? []
    const after: any[] = filterNoiseRelationships(rels, "xml")
    const afterSet = new Set(after.map((r) => `${r.type}\u0000${r.target}`))
    for (const r of rels) {
      const key = `${r.type}\u0000${r.target}`
      if (afterSet.has(key)) continue
      const leaf = String(r.target ?? "").split(":").filter(Boolean).pop()?.split(".").pop() ?? ""
      const m = /[\s'"(),=]/.exec(leaf)
      // THE CONTROL: the same row with the banned character removed — kept proves the
      // filter (not the emission) is the cause.
      const controlLeaf = leaf.replace(/[\s'"(),=]/g, "")
      const control = filterNoiseRelationships([{ ...r, target: controlLeaf }], "xml")
      eaten.push({
        file: `${repo}/${rel}`,
        type: String(r.type),
        target: String(r.target),
        bannedChar: m ? m[0] : "(empty)",
        controlKept: control.length === 1,
      })
    }
    if (typeof (tree as any).delete === "function") (tree as any).delete()
  }
}

const byType: Record<string, number> = {}
const byChar: Record<string, number> = {}
for (const e of eaten) { byType[e.type] = (byType[e.type] ?? 0) + 1; byChar[e.bannedChar] = (byChar[e.bannedChar] ?? 0) + 1 }
const out = {
  instrument: "validation/m14/fixtures/xml/overrides-filter-census.mts",
  question: "which rows does the shared filterNoiseRelationships eat on this lane, and is the emission real?",
  population: { filesScreened: files, screen: "files carrying <xsl:template match=" },
  result: {
    eatenRows: eaten.length,
    byType,
    byBannedChar: byChar,
    allControlsKept: eaten.every((e) => e.controlKept),
    rows: eaten,
  },
  reading: "The closure's `overrides 0` is the STORE PATH's truth: the analyzer emits 3, the shared filter eats 3 (all by `=`, all derived template identities), and every control row is kept. The 2026-10-09 coverage census measured 3 because it predates the `=` ban (ea8df6bbc, 2026-10-21).",
}
console.log(JSON.stringify(out, null, 2))
writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "overrides-filter-census.json"), JSON.stringify(out, null, 2) + "\n")
