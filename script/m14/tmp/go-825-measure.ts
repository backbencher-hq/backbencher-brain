// #825 (M59.A7) go line round — measure through the PRODUCTION entry
// (parseFile), the same authoritative path the c/cpp/zig lanes were measured on.
// Reports: how many relationships carry a line_number, per relationshipType,
// and whether any line falls outside its file (a foreign line is a defect, not
// a pass). Deterministic sample: files sorted by path, first N.
//
// Run: bun script/m14/tmp/go-825-measure.ts [repo ...]
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"

const REPOS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["go-tools", "terraform"]
const ROOT = "<corpus-root>/bb_tests/repositories"
const LIMIT = Number(process.env.LIMIT ?? 200)
const EXT = process.env.EXT ?? ".go"

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === ".git" || e === "vendor" || e === "node_modules") continue
    const p = path.join(dir, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (p.endsWith(EXT)) out.push(p)
  }
  return out
}

type Row = { repo: string; files: number; rels: number; lined: number; outOfFile: number; zero: number }
const rows: Row[] = []
const byType = new Map<string, { rels: number; lined: number }>()
let totalRels = 0, totalLined = 0, totalOut = 0, totalZero = 0

// The token check (the cpp lane's): does the TARGET actually appear on the
// claimed line? Conservative — leaf-splits `a.b`, `pkg.Fn`, `*T`, `[]T` — but it
// is what separates "a line is present" from "the line names this edge".
const leafOf = (t: string) => {
  let s = t.trim().replace(/\[\]|\*|\.\.\./g, "")
  const dot = s.lastIndexOf(".")
  if (dot !== -1) s = s.slice(dot + 1)
  const colon = s.lastIndexOf("::")
  if (colon !== -1) s = s.slice(colon + 2)
  return s
}
let tokenChecked = 0, tokenMiss = 0
const tokenSamples: string[] = []

for (const repo of REPOS) {
  const files = walk(path.join(ROOT, repo)).sort().slice(0, LIMIT)
  let rels = 0, lined = 0, outOfFile = 0, zero = 0
  for (const f of files) {
    const content = readFileSync(f, "utf8")
    const lineCount = content.split("\n").length
    let res: any
    try { res = await ASTEngine.parseFile(f, content) } catch { continue }
    const lines = content.split("\n")
    for (const r of res?.relationships ?? []) {
      rels++
      const rt = String((r.metadata ?? {}).relationshipType ?? r.type ?? "?")
      const t = byType.get(rt) ?? { rels: 0, lined: 0 }
      t.rels++
      const ln = r.line_number
      if (typeof ln === "number") {
        lined++
        t.lined++
        if (ln === 0) zero++
        if (ln < 1 || ln > lineCount) outOfFile++
        const target = String(r.target ?? "")
        if (target && ln >= 1 && ln <= lineCount) {
          tokenChecked++
          const leaf = leafOf(target).toLowerCase()
          if (leaf && !lines[ln - 1].toLowerCase().includes(leaf)) {
            tokenMiss++
            if (tokenSamples.length < 12) {
              tokenSamples.push(`${path.relative(ROOT, f)}:${ln}  ${r.source} -> ${target}  [${rt}]  line=${JSON.stringify(lines[ln - 1].trim().slice(0, 90))}`)
            }
          }
        }
      }
      byType.set(rt, t)
    }
  }
  rows.push({ repo, files: files.length, rels, lined, outOfFile, zero })
  totalRels += rels; totalLined += lined; totalOut += outOfFile; totalZero += zero
}

console.log("repo                       files    rels    lined   pct    out-of-file  zero")
for (const r of rows) {
  console.log(
    `${r.repo.padEnd(26)} ${String(r.files).padStart(5)} ${String(r.rels).padStart(7)} ${String(r.lined).padStart(8)} ${(r.rels ? (100 * r.lined / r.rels).toFixed(2) : "0.00").padStart(6)}% ${String(r.outOfFile).padStart(10)} ${String(r.zero).padStart(5)}`,
  )
}
console.log(`TOTAL rels=${totalRels} lined=${totalLined} (${totalRels ? (100 * totalLined / totalRels).toFixed(2) : "0.00"}%) out-of-file=${totalOut} zero=${totalZero}`)
console.log(`token check: ${tokenChecked} checked, ${tokenMiss} where the target's leaf is NOT written on the claimed line`)
for (const s of tokenSamples) console.log(`  MISS ${s}`)
console.log("\nper relationshipType:")
for (const [rt, t] of [...byType.entries()].sort((a, b) => b[1].rels - a[1].rels)) {
  console.log(`  ${rt.padEnd(36)} ${String(t.rels).padStart(7)} rels  ${String(t.lined).padStart(7)} lined (${t.rels ? (100 * t.lined / t.rels).toFixed(1) : "0.0"}%)`)
}
