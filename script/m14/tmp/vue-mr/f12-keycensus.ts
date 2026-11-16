// K.4 — how often does a real corpus SFC produce two symbols the STORE cannot
// both hold (same file, same name, same startLine)? This is the identity hazard
// the symbol key imposes, measured over the restored corpora.
import * as fs from "fs"
import * as path from "path"

const CORPUS = "<corpus-root>/bb_tests/repositories"

function under(root: string, limit: number) {
  const out: string[] = []
  const walk = (d: string) => {
    if (out.length >= limit) return
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (out.length >= limit) return
      if (e.name === ".git" || e.name === ".node_modules" || e.name === "dist") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith(".vue")) out.push(p)
    }
  }
  walk(root)
  return out.sort()
}

async function main() {
  const { ASTEngine } = await import(path.resolve(import.meta.dirname ?? ".", "../../../..", "src/ast/engine.ts"))
  for (const repo of ["element-plus", "vue-element-admin", "vue-core"]) {
    const files = under(`${CORPUS}/${repo}`, 2000)
    let hitFiles = 0, hitRows = 0, total = 0
    const ex: string[] = []
    for (const f of files) {
      let r: any
      try { r = await ASTEngine.parseFile(f, fs.readFileSync(f, "utf8")) } catch { continue }
      total++
      const keys = new Map<string, any[]>()
      for (const s of r.symbols ?? []) {
        const k = `${s.name}:${s.range?.startLine}`
        if (!keys.has(k)) keys.set(k, [])
        keys.get(k)!.push(s)
      }
      const clashes = [...keys.entries()].filter(([, v]) => v.length > 1)
      if (!clashes.length) continue
      hitFiles++
      for (const [k, v] of clashes) {
        hitRows++
        if (ex.length < 6) ex.push(`${path.relative(CORPUS, f)}  key ${k}: ${v.map((s) => `${s.kind}/${s.ownerName ?? "-"}`).join("  |  ")}`)
      }
    }
    console.log(`=== K.4  ${repo}: ${total} files, ${hitFiles} with a store-key collision, ${hitRows} colliding keys`)
    for (const e of ex) console.log(`    ${e}`)
  }
}
main()
