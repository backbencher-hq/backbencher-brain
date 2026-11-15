/**
 * F# ONE-CHARACTER CALLS — adversarial probe A4, on its own so it can be re-run cheaply.
 *
 * ## The question
 *
 * `ontology-probe.ts` counts the POPULATION: 5,313 `application_expression` nodes over the
 * whole 6,619-file corpus whose callee is one character long (`f getLines`, `f arg2`). The
 * `calls` rule is gated on `fnName.length > 1`, so every one of those is dropped, and the
 * gate has no structural reason — the grammar has already said the callee is a NAME by the
 * time the rule sees it.
 *
 * A population is not a decision, though. 5,313 extra edges that bind to nothing would be
 * 5,313 rows of noise in every graph consumer, and the workstream's rule is explicit that a
 * narrow graph which is true beats a wide graph which is not. So this measures the thing
 * that decides it: **does the dropped call bind to a symbol the same file publishes?**
 *
 * Two rates, and both are needed, because they answer different questions:
 *   * IN-FILE  — the callee name is a symbol this file declares. That is the rate at which
 *     the dropped edge would have been resolvable by a consumer reading this file.
 *   * ANY-TYPE — the callee name appears as ANY symbol name anywhere in the draw, including a
 *     PARAMETER or a LOCAL of the callee itself. This is the upper bound on usefulness and
 *     it is deliberately generous: a high ANY-TYPE with a low IN-FILE means the population is
 *     mostly one-letter lambdas, which is a fact about F# style rather than about edges.
 *
 * Method: the same seeded draw the census uses (`ontology-census.ts`, seed 0x5f5a1), each
 * file parsed TWICE — once through production `parseFile` for the symbols it publishes, and
 * once through the wired grammar for the applications. Two parses because `parseFile` does
 * not return the tree, and the alternative — reading the analyzer's own emitted edges — would
 * measure nothing, since these edges are exactly the ones it does not emit.
 *
 * READ-ONLY. Writes nothing.
 *
 *   BB_FSHARP_SAMPLE=120 npx tsx validation/m14/fixtures/fsharp/one-char-calls.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "fsharp"
const SAMPLE = Number(process.env.BB_FSHARP_SAMPLE ?? 120)

function admitted(): { rel: string; abs: string }[] {
  const out: { rel: string; abs: string }[] = []
  for (const e of readdirSync(CR).sort()) {
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      if (rel.endsWith("/test-data") || rel.includes("/obj/") || rel.includes("/bin/")) continue
      let size: number
      try { size = statSync(abs).size } catch { continue }
      if (size > 512 * 1024) continue
      if (detectLanguageFromPath(abs) !== LANG) continue
      out.push({ rel: `${e}/${rel}`, abs })
    }
  }
  return out
}

/** Mulberry32 — the census's own shuffle, so the two instruments draw the SAME files. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const a2 = items.slice()
  for (let i = a2.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[a2[i], a2[j]] = [a2[j]!, a2[i]!]
  }
  return a2
}

const pool = admitted()
const sample = seededShuffle(pool, 0x5f5a11 >>> 0).slice(0, SAMPLE)
console.log(`fsharp one-character calls — adversarial probe A4`)
console.log(`admitted ${pool.length}; sampled ${sample.length} (the census's own draw, seed 0x5f5a1)\n`)

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-fsharp.wasm"))))

const txt = (n: any) => (n?.text ?? "").replace(/\s+/g, " ").trim()
const namedKids = (n: any) => { const o: any[] = []; for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) o.push(c) } return o }

let oneChar = 0
let oneCharInFile = 0
const allNames = new Set<string>()
const perFileRows: { file: string; n: number; resolved: number; names: string[] }[] = []
let filesParsed = 0
let filesFailed = 0

for (const f of sample) {
  let symbols: any[] = []
  try {
    const r: any = await parseFile(f.abs, path.dirname(f.abs))
    symbols = r?.symbols ?? []
    filesParsed++
  } catch { filesFailed++; continue }
  const fileNames = new Set<string>()
  for (const s of symbols) { if (s?.name) { fileNames.add(s.name); allNames.add(s.name) } }
  let src: string
  try { src = readFileSync(f.abs, "utf8") } catch { continue }
  let t: any
  try { t = parser.parse(src) } catch { continue }
  let n = 0
  let resolved = 0
  const names: string[] = []
  const stack: any[] = [t.rootNode]
  while (stack.length > 0) {
    const x = stack.pop()
    if (x.type === "application_expression") {
      const fn = namedKids(x)[0]
      const nm = fn ? txt(fn) : ""
      if (nm.length === 1) {
        n++
        if (fileNames.has(nm)) { resolved++; names.push(nm) }
      }
    }
    for (const c of namedKids(x)) stack.push(c)
  }
  t.delete?.()
  oneChar += n
  oneCharInFile += resolved
  if (n > 0) perFileRows.push({ file: f.rel, n, resolved, names: [...new Set(names)].slice(0, 6) })
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(1)}%`)
console.log(`parseFile: ${filesParsed} files, ${filesFailed} failed`)
console.log(`one-character applications in the draw: ${oneChar}`)
console.log(`  resolving to a symbol THIS file publishes: ${oneCharInFile} (${pct(oneCharInFile, oneChar)})`)
console.log(`  name appears as ANY published name in the draw: ${pct(
  perFileRows.reduce((a, r) => a + r.names.length, 0) + oneCharInFile,
  oneChar,
)} (an UPPER bound: it counts distinct resolvable names per file, not occurrences)`)
console.log(`files carrying at least one: ${perFileRows.length}`)
const examples = perFileRows.filter((r) => r.resolved > 0).slice(0, 8)
for (const r of examples) console.log(`  ${r.file}  ${r.n} one-char applications, ${r.resolved} in-file: ${r.names.join(", ")}`)
const unresolved = perFileRows.filter((r) => r.resolved === 0).slice(0, 5)
for (const r of unresolved) console.log(`  0-in-file example: ${r.file}  (${r.n} applications)`)
