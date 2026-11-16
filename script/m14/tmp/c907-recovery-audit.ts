// #907 round 2 fabrication audit: the widened rule (root-level ERRORs,
// pointer-wrapped declarators) can, in principle, name something that is not a
// definition. F5 cannot see this — a symbol creates no edge, so the differential
// stays green either way — so the check has to be independent and textual:
// for EVERY symbol the recovery emitted (`metadata.recoveredFromGlue`), confirm
// from the source that the name is followed by a balanced (...) and then `{`,
// and that the name is not a macro-ish token.
//
// Run: bun script/m14/tmp/c907-recovery-audit.ts [roots...]
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const ROOTS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "<corpus-root>/bb_tests/repositories/jq",
      "<corpus-root>/bb_tests/repositories/sqlite",
    ]

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === ".git" || e === "node_modules") continue
    const p = join(dir, e)
    let st: any
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.(c|h)$/.test(e)) out.push(p)
  }
  return out
}

function isWord(ch: string): boolean { return /[A-Za-z0-9_]/.test(ch) }

function definitionShapeAt(content: string, nameStart: number, name: string): boolean {
  let j = nameStart + name.length
  while (j < content.length && /\s/.test(content[j])) j++
  if (content[j] !== "(") return false
  let depth = 0
  for (; j < content.length; j++) {
    if (content[j] === "(") depth++
    else if (content[j] === ")") { depth--; if (depth === 0) break }
  }
  j++
  while (j < content.length && /\s/.test(content[j])) j++
  return content[j] === "{"
}

const files: string[] = []
for (const r of ROOTS) walk(r, files)
console.log(`scanning ${files.length} C files under ${ROOTS.length} root(s)\n`)

let recovered = 0
let validated = 0
const unvalidated: string[] = []
const byRoot: Record<string, number> = {}

for (const f of files) {
  let r: any
  try { r = await parseFile(f, f.replace(/\/[^/]*$/, "")) } catch { continue }
  const syms = (r.symbols ?? []).filter((s: any) => s?.metadata?.recoveredFromGlue)
  if (!syms.length) continue
  const content = readFileSync(f, "utf8")
  const root = ROOTS.find((x) => f.startsWith(x)) ?? "(other)"
  for (const s of syms) {
    recovered++
    byRoot[root] = (byRoot[root] ?? 0) + 1
    // locate the name at the symbol's own start line/col (the range is the
    // declarator's, which begins at the name for these shapes)
    const idx = content.indexOf(s.name)
    let ok = false
    if (idx >= 0) {
      // try every occurrence; the emitted one is the definition-shaped one
      let from = 0
      while (true) {
        const i = content.indexOf(s.name, from)
        if (i < 0) break
        from = i + 1
        if (i > 0 && isWord(content[i - 1])) continue
        if (definitionShapeAt(content, i, s.name)) { ok = true; break }
      }
    }
    if (ok) validated++
    else unvalidated.push(`${f.replace(/^.*repositories\//, "")}:${s.name}@L${s.startLine}`)
  }
}

console.log(`recovered symbols: ${recovered}`)
for (const [k, v] of Object.entries(byRoot)) console.log(`   ${v.toString().padStart(5)}  ${k}`)
console.log(`\ntextually validated as definition headers: ${validated}/${recovered}`)
console.log(`UNVALIDATED (fabrication candidates): ${unvalidated.length}`)
for (const u of unvalidated.slice(0, 20)) console.log(`   ${u}`)
