import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = "$HOME/fixtures/repositories"
const WIDE = path.join(process.cwd(), "script", "m14", "clean-wide-manifest.txt")
const files: string[] = []
const seen = new Set<string>()
for (const e of fs.readdirSync(CR)) {
  const d = path.join(CR, e)
  try { if (!fs.statSync(d).isDirectory()) continue } catch { continue }
  if (!fs.existsSync(path.join(d, ".git"))) continue
  const walk = (dd: string) => {
    let es: fs.Dirent[]
    try { es = fs.readdirSync(dd, { withFileTypes: true }) } catch { return }
    for (const en of es) {
      if (en.name === ".git") continue
      const p = path.join(dd, en.name)
      if (en.isDirectory()) walk(p)
      else if (en.name.endsWith(".icl") || en.name.endsWith(".dcl")) files.push(p)
    }
  }
  walk(d)
}
if (fs.existsSync(WIDE)) for (const l of fs.readFileSync(WIDE, "utf8").split("\n")) { const a = l.trim(); if (a && !seen.has(a) && fs.existsSync(a)) { seen.add(a); files.push(a) } }
files.sort()

const self: string[] = []
const emptyish: string[] = []
const weirdSym: string[] = []
let n = 0
for (const f of files) {
  let r: any
  try { r = await parseFile(f, path.dirname(f)) } catch { continue }
  const rel = path.relative(CR, f)
  for (const s of r.symbols ?? []) {
    const nm = String(s.name ?? "")
    // An instance/ADT name that is not a legal Clean identifier is an identity defect.
    if (nm && (/^[.\-*/+<>=!&|^~%$\\]/.test(nm) || nm.endsWith(".") || /[.\-*/+<>=!&|^~%$\\]/.test(nm)) && nm !== "(" && !/^[({[]/.test(nm)) {
      if (weirdSym.length < 30) weirdSym.push(`${rel}:${s.startLine} kind=${s.kind} name=${JSON.stringify(nm)} qn=${JSON.stringify(s.qualifiedName ?? "")}`)
    }
  }
  for (const x of r.relationships ?? []) {
    if (String(x.type).toLowerCase() !== "overrides") continue
    const so = String(x.source), to = String(x.target)
    if (so === to) { if (self.length < 20) self.push(`${rel}:${(x as any).line_number} ${so} -> ${to}  meta=${JSON.stringify(x.metadata)}`) }
    else if (/^[.\-*/+<>=!&|^~%$\\]/.test(so) || /^[.\-*/+<>=!&|^~%$\\]/.test(to)) {
      if (emptyish.length < 20) emptyish.push(`${rel}:${(x as any).line_number} ${so} -> ${to}  meta=${JSON.stringify(x.metadata)}`)
    }
  }
  if (++n % 200 === 0) process.stderr.write(".")
}
console.log("\n=== overrides SELF-EDGES (source === target) ===")
console.log(` count sampled ${self.length}${self.length === 20 ? " (capped)" : ""}`)
for (const s of self) console.log("  " + s)
console.log("\n=== overrides edges whose endpoint starts with an operator/punctuation char ===")
console.log(` count sampled ${emptyish.length}`)
for (const s of emptyish) console.log("  " + s)
console.log("\n=== SYMBOL names that are not plain identifiers (identity check) ===")
for (const s of weirdSym) console.log("  " + s)