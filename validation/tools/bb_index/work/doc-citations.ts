// Inventory of `path:line` citations in the docs this lane owns, and whether the target still has that line.
import { readFileSync, readdirSync, existsSync } from "node:fs"
import path from "node:path"
const ROOT = process.cwd()
const docs = ["docs/tools/bb_index.md", ...readdirSync("docs/indexing").filter(f => f.endsWith(".md")).map(f => path.join("docs/indexing", f))]
const citeRe = /([A-Za-z0-9_./-]+\.(?:ts|mjs|js|sh|json|md))(?::(\d+)(?:-(\d+))?)?/g
const rows: any[] = []
for (const doc of docs) {
  const text = readFileSync(doc, "utf8")
  text.split("\n").forEach((line, i) => {
    citeRe.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = citeRe.exec(line))) {
      const target = m[1]
      if (!target.startsWith("src/") && !target.startsWith("script/") && !target.startsWith("test/")) continue
      const full = path.join(ROOT, target)
      if (!existsSync(full)) { rows.push({ doc, docLine: i + 1, target, citedLine: m[2] ?? null, status: "missing-file" }); continue }
      if (!m[2]) continue
      const n = Number(m[3] ?? m[2])
      const total = readFileSync(full, "utf8").split("\n").length
      rows.push({ doc, docLine: i + 1, target, citedLine: n, fileLines: total, status: n > total ? "stale-line" : "ok" })
    }
  })
}
console.log(JSON.stringify({ stale: rows.filter(r => r.status !== "ok"), okCount: rows.filter(r => r.status === "ok").length }, null, 1))
