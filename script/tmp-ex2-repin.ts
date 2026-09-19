// tmp-ex2-repin.ts — EX2-U2 expectation re-pin. After scope identity became
// module-qualified, `from` values that name a function scope change from the
// bare function name to `EnclosingScope.fn`. This script rewrites exactly
// those entries; ambiguity is REPORTED with candidates, never guessed (an
// OVERRIDES map resolves the reported cases explicitly). ex2-* fixtures are
// already authored under the new contract and are skipped.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
const DIR = path.join(ROOT, "validation", "m14", "fixtures", "elixir")

// Reported-ambiguous cases resolved by hand (run 1 prints what is needed).
const OVERRIDES: Record<string, string> = {
  // "base|from|target": "Scope"
}

function defsOf(srcFile: string) {
  const lines = fs.readFileSync(srcFile, "utf8").split("\n")
  let curModule: string | null = null
  let curScope: string | null = null
  const defs = new Map<string, string[]>()
  for (const line of lines) {
    const t = line.trim()
    let m: RegExpMatchArray | null
    if ((m = t.match(/^defmodule\s+([A-Za-z0-9_.]+)\s+do\b/))) { curModule = m[1]; curScope = m[1]; continue }
    if ((m = t.match(/^defimpl\s+([A-Za-z0-9_.]+)(?:\s*,\s*for:\s*([A-Za-z0-9_.]+))?\s+do\b/))) {
      curScope = m[2] ?? curModule
      continue
    }
    if ((m = t.match(/^def(?:p|macro|macrop|guard|guardp|delegate)?\s+([a-z_][a-z0-9_?!]*)/))) {
      if (curScope) {
        const arr = defs.get(m[1]) ?? []
        arr.push(curScope)
        defs.set(m[1], arr)
      }
    }
  }
  return defs
}

let changed = 0
const ambiguous: string[] = []
for (const f of fs.readdirSync(DIR).sort()) {
  if (!f.endsWith(".expectation.json")) continue
  const base = f.replace(/\.expectation\.json$/, "")
  if (base.startsWith("ex2-")) continue // authored under the new contract
  const exFile = path.join(DIR, `${base}.ex`)
  if (!fs.existsSync(exFile)) continue
  const defs = defsOf(exFile)
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"))
  let dirty = false
  for (const key of ["expectRelationships", "forbidRelationships"]) {
    for (const rel of j[key] ?? []) {
      if (typeof rel.from !== "string" || !/^[a-z]/.test(rel.from)) continue
      const cands = defs.get(rel.from)
      if (!cands) continue
      const ov = OVERRIDES[`${base}|${rel.from}|${rel.target}`]
      let pick: string | null = ov ?? null
      if (!pick) {
        if (cands.length === 1) pick = cands[0]
        else {
          const tSeg = typeof rel.target === "string" ? rel.target.split(".")[0] : ""
          pick = cands.find((s) => s === tSeg || s.endsWith("." + tSeg) || (defs.get(tSeg) ?? []).includes(s)) ?? null
        }
      }
      if (pick) {
        const next = `${pick}.${rel.from}`
        if (rel.from !== next) { rel.from = next; dirty = true; changed++ }
      } else {
        ambiguous.push(`${base}|${rel.from}|${rel.target}  candidates=${JSON.stringify(cands)}`)
      }
    }
  }
  if (dirty) {
    fs.writeFileSync(path.join(DIR, f), JSON.stringify(j, null, 2) + "\n")
    console.log(`repinned ${f}`)
  }
}
console.log(`changed ${changed}`)
if (ambiguous.length) {
  console.log("AMBIGUOUS (add to OVERRIDES):")
  for (const a of ambiguous) console.log("  " + a)
}
process.exit(0)
