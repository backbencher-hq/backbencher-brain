// dead-scan.mjs — find source files that nothing else imports.
import { readdirSync, readFileSync, statSync } from "fs"
import path from "path"

const files = []
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) {
      if (!["node_modules"].includes(e)) walk(p)
    } else if (e.endsWith(".ts") && !e.endsWith(".d.ts")) {
      files.push(p)
    }
  }
}
walk("src")
const all = files.map((f) => readFileSync(f, "utf8")).join("\n")

const dead = []
for (const f of files) {
  const stem = path.basename(f, ".ts")
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // match the stem as an import specifier: preceded by / or . and followed by
  // a quote, allowing an optional .js ESM suffix
  const re = new RegExp("[/.]" + esc(stem) + "(?:\\.js)?['\"]", "g")
  let refs = 0
  for (const src of files) {
    if (src === f) continue
    refs += (readFileSync(src, "utf8").match(re) || []).length
  }
  if (refs === 0) dead.push(f)
}
console.log("=== files with ZERO references from elsewhere ===")
dead.forEach((f) => console.log("  " + f))
console.log("total:", dead.length, "/", files.length)
