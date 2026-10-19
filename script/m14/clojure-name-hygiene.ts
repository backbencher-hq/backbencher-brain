/**
 * CLOJURE PART B — the A1–A5 analyzer-defect classes as a RED-CAPABLE whole-population gate.
 *
 * The accepted D1–D6 draws declared 34 analyzer-defect rows in five classes; the follow-up
 * (task-35 Part B) fixes them in the analyzer. This instrument re-derives each class from the
 * analyzer's own output over the whole admitted population, prints its size, and EXITS NONZERO
 * if any class is non-empty — so a regression re-opens the exact class the fix closed.
 *
 * Classes (measured pre-fix at whole population, `clojure-armA-dump`/census round):
 *   A1 exports of a METHOD IMPL symbol (isMethodImpl / isProtocolMethodImpl / isRecordMethod)
 *   A2 exports of a PRIVATE declaration (visibility is private on the exported symbol)
 *   A3 exports/contains of a NON-IDENTIFIER name (string/reader-conditional node text)
 *   A4 contains of a FORWARD DECLARATION (`declare`)
 *   A5 imports of a DYNAMIC require argument (bare unqualified symbol the file declares)
 *
 * Usage: BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/clojure-name-hygiene.ts [--json out]
 */
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealClojureAnalyzer } from "../../src/ast/real-clojure-analyzer"
import { isPublishableName } from "../../src/ast/real-clojure-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const jsonIdx = process.argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const parser = await ASTEngine.getParser("clojure" as any)
const classes: Record<string, { count: number; samples: string[] }> = {
  A1_method_impl_exports: { count: 0, samples: [] },
  A2_private_exports: { count: 0, samples: [] },
  A3_non_identifier_names: { count: 0, samples: [] },
  A4_forward_declaration_contains: { count: 0, samples: [] },
  A5_dynamic_require_imports: { count: 0, samples: [] },
}
const bump = (k: string, s: string): void => { const c = classes[k]!; c.count++; if (c.samples.length < 3) c.samples.push(s) }
let files = 0
for (const repo of ["clj-kondo", "clojure", "nvim-treesitter"]) {
  const dir = path.join(CR, repo)
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(clj|cljs|cljc|edn)$/.test(rel)) continue
    const abs = path.join(dir, rel)
    const content = fs.readFileSync(abs, "utf8")
    if (content.length > 1024 * 1024) continue
    files++
    const tree = parser.parse(content)
    if (!tree) continue
    const res: any = new RealClojureAnalyzer().analyze(tree.rootNode, content, abs)
    const lines = content.split("\n")
    const symbols = res.symbols ?? []
    const byName = (n: string) => symbols.filter((s: any) => s.name === n)
    for (const r of res.relationships ?? []) {
      const type = String(r.type)
      const target = String(r.target)
      const tag = `${repo}/${rel}:${r.line_number ?? "?"} ${type} ${String(r.source)}->${target}`
      if (type === "exports") {
        const sym = byName(target)[0]
        if (sym && (sym.metadata?.isMethodImpl === true || sym.metadata?.isProtocolMethodImpl === true || sym.metadata?.isRecordMethod === true)) bump("A1_method_impl_exports", tag)
        if (sym && sym.visibility === "private") bump("A2_private_exports", tag)
        if (!isPublishableName(target)) bump("A3_non_identifier_names", tag)
      }
      if (type === "contains") {
        const at = byName(target)
        // A name can be declared AND later defined; the edge names the defining symbol.
        // Flag only when EVERY symbol of that name for this owner is a forward declaration.
        const own = at.filter((s: any) => s.ownerName === String(r.source))
        const pool = own.length > 0 ? own : at
        if (pool.length > 0 && pool.every((s: any) => s.metadata?.isForwardDeclaration === true)) bump("A4_forward_declaration_contains", tag)
        if (!isPublishableName(target)) bump("A3_non_identifier_names", tag)
      }
      if (type === "imports") {
        const declared = symbols.some((s: any) => s.name === target && s.kind !== "module")
        if (declared && !target.includes(".") && !target.includes("/")) bump("A5_dynamic_require_imports", tag)
      }
    }
    void lines
  }
}
console.log(`CLOJURE NAME HYGIENE (A1–A5) over ${files} admitted files:`)
let total = 0
for (const [k, c] of Object.entries(classes)) {
  total += c.count
  console.log(`  ${String(c.count).padStart(5)}  ${k}`)
  for (const s of c.samples) console.log(`           e.g. ${s}`)
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ files, classes }, null, 2))
if (total > 0) { console.log(`FAIL — ${total} analyzer-defect row(s) of class A remained`); process.exit(1) }
console.log("PASS — no A1–A5 analyzer-defect rows at whole population")
