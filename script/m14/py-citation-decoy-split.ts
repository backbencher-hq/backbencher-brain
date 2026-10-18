// The 379: citation rows that were RESOLVED before the stdlib citation. Absent-from-before-dump =
// was resolved = decoy by construction. Own-file-declared target = the narrowing case.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealPythonAnalyzer } from "../../src/ast/real-python-analyzer"
const argv = process.argv.slice(2)
const A = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const BEFORE = A("--before"), OUT = A("--out")
if (!BEFORE) { console.error("usage: --before <pre-citation dump> [--out json]"); process.exit(2) }
const text = readFileSync(BEFORE, "utf8")
const before = new Set<string>()
for (const line of text.split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const p = line.split("\t"); if (p.length < 6) continue
  const spec = p[4] ?? ""; const c = spec.lastIndexOf(":")
  before.add(`${c > 0 ? spec.slice(0, c) : spec}\u0000${p[1]}\u0000${c > 0 ? spec.slice(c + 1) : "0"}\u0000${p[3]}`)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.join(process.cwd(), ".corpus")
const files: string[] = []
const walk = (d: string, depth = 0): void => {
  if (depth > 12) return
  let es: string[]; try { es = readdirSync(d) } catch { return }
  for (const e of es) { if (e === ".git" || e === "node_modules" || e === ".corpus") continue; const p = path.join(d, e); let st: any; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, depth + 1); else if (st.isFile() && /\.(py|pyi|pyw)$/.test(e)) files.push(p) }
}
walk(CORPUS)
const parser: any = await ASTEngine.getParser("python")
const analyzer = new RealPythonAnalyzer()
let cited = 0, resolvedBefore = 0, nonResolvedBefore = 0, ownFile = 0
const decoySamples: string[] = [], ownSamples: string[] = [], otherSamples: string[] = []
for (const f of files) {
  let r: any, content = ""
  try { content = readFileSync(f, "utf8"); const tree = parser.parse(content); if (!tree) continue; r = analyzer.analyze(tree.rootNode, content, f) } catch { continue }
  if (!r) continue
  const ownNames = new Set<string>((r.symbols ?? []).map((s: any) => String(s.name)))
  for (const rel of r.relationships) {
    const md = rel.metadata; if (!md?.languageNamespace || !Array.isArray(md.languageNamespace) || md.languageNamespace.length === 0) continue
    cited++
    const line = Number(rel.line_number ?? 0)
    const key = `${f}\u0000${String(rel.type)}\u0000${line}\u0000${String(rel.target)}`
    if (before.has(key)) { nonResolvedBefore++; continue }
    resolvedBefore++
    const tgt = String(rel.target)
    const leaf = tgt.includes(":") ? tgt.slice(tgt.lastIndexOf(":") + 1) : tgt.slice(tgt.lastIndexOf(".") + 1)
    const sample = `${path.relative(CORPUS, f)}:${line} ${String(rel.type)} ${tgt}`
    if (ownNames.has(leaf) || ownNames.has(tgt.split(":")[0] ?? "")) { ownFile++; if (ownSamples.length < 3) ownSamples.push(sample) }
    else { if (decoySamples.length < 3) decoySamples.push(sample) }
    if (otherSamples.length < 3) otherSamples.push(sample)
  }
}
console.log(`citation-bearing rows=${cited} · non-resolved-before=${nonResolvedBefore} · RESOLVED-BEFORE(decoy class)=${resolvedBefore}`)
console.log(`  own-file-declared target (narrowing case)=${ownFile}`)
console.log(`  decoy samples: ${JSON.stringify(decoySamples)}`)
console.log(`  own-file samples: ${JSON.stringify(ownSamples)}`)
console.log(`  all-resolved-before samples: ${JSON.stringify(otherSamples)}`)
if (OUT) { writeFileSync(OUT, JSON.stringify({ cited, nonResolvedBefore, resolvedBefore, ownFile, decoySamples, ownSamples }, null, 2)); console.log(`wrote ${OUT}`) }
