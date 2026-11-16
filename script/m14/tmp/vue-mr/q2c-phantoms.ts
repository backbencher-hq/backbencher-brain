// Q2c — the phantom-name question, measured over the RESTORED corpus, with the
// spelling rules the lane-surface-audit itself documents as its weak point.
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories"

function under(root: string, exts: string[], limit: number) {
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

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const files = [...under(`${CORPUS}/element-plus`, [".vue"], 400), ...under(`${CORPUS}/vue-element-admin`, [".vue"], 131)]
  const ghosts: Array<{ f: string; n: string; k: string; L: number }> = []
  const ghostTargets: Array<{ f: string; label: string; t: string; L: number }> = []
  const noOwner: Array<{ f: string; n: string; k: string; L: number }> = []
  const danglingOwner = new Set<string>()
  const byKind = new Map<string, number>()
  let total = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    let r: any
    try { r = await ASTEngine.parseFile(f, src) } catch { continue }
    total++
    const classNames = new Set((r.symbols ?? []).filter((s: any) => s.kind === "class").map((s: any) => s.name))
    for (const s of r.symbols ?? []) {
      byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + 1)
      if (typeof s.name === "string" && s.name && !src.includes(s.name)) {
        ghosts.push({ f: path.relative(CORPUS, f), n: s.name, k: s.kind, L: s.range?.startLine })
      }
      if (s.ownerName && !classNames.has(String(s.ownerName)) && !new Set((r.symbols ?? []).map((x: any) => x.name)).has(String(s.ownerName))) {
        danglingOwner.add(`${s.ownerName} <- ${s.name} (${s.kind}) in ${path.relative(CORPUS, f)}`)
      }
      if (!s.ownerName && (s.kind === "method" || s.kind === "property" || s.kind === "event")) {
        noOwner.push({ f: path.relative(CORPUS, f), n: s.name, k: s.kind, L: s.range?.startLine })
      }
    }
    for (const rel of r.relationships ?? []) {
      const t = String(rel.target)
      if (t && !src.includes(t) && !/^[\s]*$/.test(t)) {
        ghostTargets.push({ f: path.relative(CORPUS, f), label: String(rel.type), t, L: (rel as any).line_number })
      }
    }
  }

  console.log(`=== Q2c.1  PHANTOM SYMBOL NAMES over ${total} corpus files ===`)
  console.log(`  symbols whose name never occurs in their own file: ${ghosts.length}`)
  const byReason = new Map<string, number>()
  for (const g of ghosts) {
    const stem = path.basename(g.f).replace(/\.vue$/, "")
    byReason.set(g.n === stem ? "the file stem (the SFC component symbol)" : "other", (byReason.get(g.n === stem ? "the file stem (the SFC component symbol)" : "other") ?? 0) + 1)
  }
  for (const [k, v] of byReason) console.log(`    ${k}: ${v}`)
  const other = ghosts.filter((g) => g.n !== path.basename(g.f).replace(/\.vue$/, ""))
  console.log(`  NOT the file stem: ${other.length}`)
  for (const g of other.slice(0, 20)) console.log(`    ${g.k} "${g.n}" @${g.L}  ${g.f}`)

  console.log(`\n=== Q2c.2  GHOST relationship TARGETS ===`)
  console.log(`  edges whose target never occurs in their own file: ${ghostTargets.length}`)
  const byLabel = new Map<string, number>()
  for (const g of ghostTargets) byLabel.set(g.label, (byLabel.get(g.label) ?? 0) + 1)
  for (const [k, v] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
  for (const g of ghostTargets.slice(0, 15)) console.log(`    ${g.label} -> "${g.t}" @${g.L}  ${g.f}`)

  console.log(`\n=== Q2c.3  DANGLING ownerName: members owned by a symbol that does not exist ===`)
  console.log(`  ${danglingOwner.size}`)
  for (const d of [...danglingOwner].slice(0, 15)) console.log(`    ${d}`)

  console.log(`\n=== Q2c.4  member symbols with no owner at all ===`)
  console.log(`  ${noOwner.length}`)
  const byK = new Map<string, number>()
  for (const n of noOwner) byK.set(n.k, (byK.get(n.k) ?? 0) + 1)
  for (const [k, v] of byK) console.log(`    ${k}: ${v}`)
  for (const n of noOwner.slice(0, 12)) console.log(`    ${n.k} ${n.n} @${n.L}  ${n.f}`)

  console.log(`\n=== Q2c.5  kind census ===`)
  for (const [k, v] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k}: ${v}`)
}
main()
