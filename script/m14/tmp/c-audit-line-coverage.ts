// M59.A7 (c): after the change — per-type line coverage on the real corpora,
// plus the Tier-A predicate re-implemented here (the claimed line must contain
// the target's last segment as a token) so a wrong line cannot pass.
// Run: bun script/m14/tmp/c-audit-line-coverage.ts
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { parseFile } from "../../../src/ast/pool-worker"

const CORPORA: Array<[string, string, number]> = [
  ["sqlite", "<corpus-root>/bb_tests/repositories/sqlite", 60],
  ["jq", "<corpus-root>/bb_tests/repositories/jq", 60],
  ["zig", "<corpus-root>/bb_tests/repositories/zig", 100],
]

for (const [name, root, n] of CORPORA) {
  const files = execFileSync("bash", ["-c", `find ${root} -name '*.c' -not -path '*/.git/*' | sort | head -${n}`], { encoding: "utf8" }).split("\n").filter(Boolean)
  const perType: Record<string, { total: number; withLine: number; consistent: number; inconsistent: number }> = {}
  let rels = 0
  let withLine = 0
  let inconsistent = 0
  let notCheckable = 0
  const bad: string[] = []
  for (const f of files) {
    const src = readFileSync(f, "utf8")
    const lines = src.split("\n")
    const r: any = await parseFile(f, root)
    for (const rel of (r.relationships ?? [])) {
      rels++
      const t = rel.type ?? "?"
      const row = (perType[t] ??= { total: 0, withLine: 0, consistent: 0, inconsistent: 0 })
      row.total++
      const ln = rel.line_number
      if (typeof ln === "number" && ln > 0) {
        withLine++
        row.withLine++
        const raw = String(rel.target ?? "").trim()
        const token = raw.split("(")[0].split(".").pop() ?? ""
        const srcLine = lines[ln - 1] ?? ""
        if (!token || !/^[\w$#:@-]+$/.test(token)) {
          notCheckable++
        } else {
          const re = new RegExp(`(^|[^\\w$])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w$])`)
          if (re.test(srcLine)) row.consistent++
          else {
            row.inconsistent++
            inconsistent++
            if (bad.length < 6) bad.push(`${f.split("/").pop()}:${ln} ${t} ${rel.source} -> ${rel.target} :: ${srcLine.trim().slice(0, 60)}`)
          }
        }
      }
    }
  }
  console.log(`\n=== ${name}: ${files.length} files, ${rels} relationships, ${withLine} with a line (${((withLine / rels) * 100).toFixed(1)}%) ===`)
  for (const [t, row] of Object.entries(perType).sort()) {
    console.log(`  ${t.padEnd(11)} ${String(row.total).padStart(6)} edges, ${String(row.withLine).padStart(6)} lined, consistent ${row.consistent}, INCONSISTENT ${row.inconsistent}`)
  }
  console.log(`  notCheckable ${notCheckable}`)
  for (const b of bad) console.log("   BAD", b)
}
