/** Does any `references` edge carry a constant-fetch / member-read flag? (doc ontology check) */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
const ROOT = "$HOME/backbencher-brain"
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const files: string[] = []
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    if (n.startsWith(".")) continue
    const p = path.join(d, n)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if (n.endsWith(".php")) files.push(p)
  }
}
for (const repo of ["phpunit", "phpmyadmin"]) walk(path.join("$HOME/fixtures/repositories", repo))
const flagsPerLabel = new Map<string, Map<string, number>>()
let n = 0
for (const f of files.slice(0, 1200)) {
  let src: string
  try { src = readFileSync(f, "utf8") } catch { continue }
  let res: any
  try { res = await ASTEngine.parseFile(f, src) } catch { continue }
  n++
  for (const r of res.relationships ?? []) {
    const l = String(r.type)
    let m = flagsPerLabel.get(l); if (!m) { m = new Map(); flagsPerLabel.set(l, m) }
    for (const [k, v] of Object.entries(r.metadata ?? {})) {
      if (typeof v === "boolean" && v) m.set(k, (m.get(k) ?? 0) + 1)
      else if (typeof v === "string") m.set(`${k}=${v}`, (m.get(`${k}=${v}`) ?? 0) + 1)
    }
  }
}
console.log(`files=${n}\n`)
for (const [l, m] of [...flagsPerLabel.entries()].sort()) {
  console.log(`${l}:`)
  for (const [k, v] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(34)} ${v}`)
}
process.exit(0)
