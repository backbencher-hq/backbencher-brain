/**
 * RUST lane — what does the F5 TRUTH side actually derive, per label?
 *
 * The lane's F5 numbers are reported as "tree-truth=N covered=N (100%)". That
 * sentence is only as strong as the LABEL SET on the truth side, and the
 * analyzer-side allowlist that decides which analyzer edges can be called
 * "unexplained" is a local expression in differential.ts (nothing else can see
 * it — the same trap the csharp note records). This prints both halves for real
 * files, so the claim's scope is measured rather than assumed.
 */
import * as fs from "node:fs"
import * as path from "node:path"
const ROOT = "/home/sano/ishaq/backbencher-brain"
const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const N = Number(arg("files") ?? "12")
const DIR = arg("dir") ?? "/home/sano/ishaq/bb_rust_corpora/cargo"

async function main() {
  // the COMMITTED oracle snapshot, never the live shared harness (another lane
  // edits it continuously; it was mid-edit and unparseable twice during this run)
  const diff: any = await import("./rust-oracles.snapshot.ts")
  const rustMod: any = await import(path.join(ROOT, "src/ast/real-rust-analyzer.ts"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? (wts.default as any)?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-rust.wasm")))
  const parser = new P(); parser.setLanguage(g)

  const files: string[] = []
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === ".git" || e.name === "target") continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith(".rs") && fs.statSync(p).size > 0) files.push(p) } }
  walk(DIR)
  const take = files.sort().slice(0, N)

  const truthByLabel: Record<string, number> = {}
  const analyzerByLabel: Record<string, number> = {}
  for (const f of take) {
    const text = fs.readFileSync(f, "utf8")
    const root = parser.parse(text).rootNode
    for (const e of diff.deriveRustEdges(root) ?? []) truthByLabel[e.label] = (truthByLabel[e.label] ?? 0) + 1
    for (const e of diff.deriveRustBareUses(root) ?? []) truthByLabel[e.label] = (truthByLabel[e.label] ?? 0) + 1
    if (diff.deriveRustDeclaredTypeRefs) for (const e of diff.deriveRustDeclaredTypeRefs(root) ?? []) truthByLabel[e.label] = (truthByLabel[e.label] ?? 0) + 1
    const res: any = await new rustMod.RealRustAnalyzer().analyze(root, text, f)
    for (const r of res.relationships ?? []) analyzerByLabel[r.type] = (analyzerByLabel[r.type] ?? 0) + 1
  }
  const labels = new Set([...Object.keys(truthByLabel), ...Object.keys(analyzerByLabel)])
  console.log(`\n######## RUST F5 LABEL SCOPE — ${take.length} files from ${path.basename(DIR)}`)
  console.log("  label        truth-derived   analyzer-emitted   in-comparison?")
  for (const l of [...labels].sort()) {
    const t = truthByLabel[l] ?? 0, a = analyzerByLabel[l] ?? 0
    const cmp = l === "references" ? "YES (analyzer-side allowlist)" : (["extends", "implements", "instantiates", "overrides"].includes(l) ? "truth side only (analyzer side not allowlisted)" : "NO")
    console.log(`  ${l.padEnd(12)} ${String(t).padStart(9)} ${String(a).padStart(16)}   ${cmp}`)
  }
  const tTot = Object.values(truthByLabel).reduce((x, y) => x + y, 0)
  const aTot = Object.values(analyzerByLabel).reduce((x, y) => x + y, 0)
  console.log(`  TOTAL        ${String(tTot).padStart(9)} ${String(aTot).padStart(16)}`)
  const audited = (truthByLabel["references"] ?? 0)
  console.log(`\n  F5 compares, for rust: truth rows on the audited label(s) = ${audited}; analyzer edges eligible to be called UNEXPLAINED = ${analyzerByLabel["references"] ?? 0}`)
  console.log(`  analyzer edges OUTSIDE the compared set (never able to be unexplained) = ${aTot - (analyzerByLabel["references"] ?? 0)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
