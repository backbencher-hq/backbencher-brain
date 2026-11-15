// CS-DEEP-42 — DUPLICATE KEYS in the shared harness's exported maps.
//
// Found while verifying the merge repairs, and it is a class neither `bun build` nor `tsc` can
// see: a repeated key in an object literal is LEGAL JavaScript, the last one wins, and both
// tools stay silent. So the file parses, the type checks, the gate runs, and the lane measures
// the wrong corpus — with a comment directly above it asserting the opposite.
//
// The shape is not accidental. `LANG_REPOS` is typed `Record<string, string>`, so a lane that
// wants a PRIMARY and a SECOND corpus has nowhere to put the second one, and the merge left the
// second written as a second `bash:` key. The comment reads "bash's second corpus is the M12
// pin. See LANG_REPOS.bash for why the pin is kept rather than replaced" — and the code does the
// exact opposite of that comment: `otp` is declared first and `fsharp` wins.
//
// This probe reports, per exported map, every key declared more than once, the value that
// SURVIVES, and the value that was written first. Reading the file is not enough — only
// evaluation tells you which one the runtime sees.
import * as fs from "fs"
import * as path from "path"

const ROOT = process.cwd()

/** Scan a top-level `export const NAME ... = {` literal and report repeated keys with the line
 *  each was declared on. Depth-tracked so a nested object's keys are not confused with the
 *  outer ones. */
function duplicatesIn(src: string, name: string): Array<{ key: string; lines: number[]; values: string[] }> {
  const lines = src.split("\n")
  const decl = lines.findIndex((l) => new RegExp(`^export const ${name}\\b`).test(l))
  if (decl < 0) return []
  let start = decl
  while (start < lines.length && !lines[start].includes("{")) start++
  // `entered` is load-bearing, and its absence is why this detector reported "no duplicate
  // keys" on a file that HAS one. differential.ts declares
  //   export const LANGS: Record<string, { wasm: string; ... }> = {
  // and the RETURN-TYPE literal closes before the assignment brace opens, so depth touches 0
  // MID-LINE. The original test was `if (depth === 0) stop`, which fired on that transient
  // zero and ended the scan having read ZERO entries -- a silent false pass on the exact
  // file the detector exists for. Second time this session that a premature brace close
  // corrupted something: the first was an edit to differential.ts itself, which is why the
  // shape is named here rather than merely fixed.
  //
  // The rule: only a depth of 0 at the END of a line, after the literal has been entered,
  // closes the object. A return-type literal is balanced within its own line and must not be
  // able to end the walk.
  let depth = 0
  let entered = false
  const seen = new Map<string, { lines: number[]; values: string[] }>()
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]
    const code = raw.replace(/\/\/.*$/, "")
    for (const ch of code) {
      if (ch === "{") depth++
      else if (ch === "}") depth--
    }
    if (!entered) {
      if (depth > 0) entered = true
      continue
    }
    if (depth === 0) { i = lines.length; break }
    const m = code.match(/^\s{2}([A-Za-z0-9_+"'-]+):\s*(.+?),?\s*$/)
    if (!m) continue
    const key = m[1]
    const val = m[2].replace(/,$/, "")
    const rec = seen.get(key) ?? { lines: [], values: [] }
    rec.lines.push(i + 1)
    rec.values.push(val.length > 46 ? val.slice(0, 46) + "…" : val)
    seen.set(key, rec)
  }
  return [...seen.entries()].filter(([, v]) => v.lines.length > 1).map(([key, v]) => ({ key, ...v }))
}

const targets: Array<[string, string[]]> = [
  ["script/m14/differential.ts", ["LANG_REPOS", "LANGS"]],
  ["script/m14/mutate-analyzer.ts", ["MUTANTS", "REGISTRY"]],
]

let total = 0
for (const [file, names] of targets) {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) { console.log(`${file}: absent`); continue }
  const src = fs.readFileSync(p, "utf8")
  console.log(`\n=== ${file}`)
  for (const name of names) {
    const dups = duplicatesIn(src, name)
    if (dups.length === 0) { console.log(`  ${name}: no duplicate keys`); continue }
    console.log(`  ${name}: ${dups.length} key(s) declared more than once`)
    for (const d of dups) {
      total++
      console.log(`     ${d.key}`)
      for (let i = 0; i < d.lines.length; i++) {
        const tag = i === d.lines.length - 1 ? "WINS " : "loses"
        console.log(`       ${tag} line ${String(d.lines[i]).padStart(6)}  ${d.values[i]}`)
      }
    }
  }
}
console.log(`\ntotal duplicate keys found: ${total}`)
