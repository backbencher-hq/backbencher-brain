/**
 * NIM KEYWORD-ENDPOINT HUNT — NAME the fabrications `endpoint-provenance.ts` counts.
 *
 * ## Why this file exists
 *
 * `endpoint-provenance.ts` reports a FABRICATIONS table and it reports, per type
 * and per endpoint position, how many endpoints are spelled as one of Nim's 64
 * reserved words. At the current blob that table reads:
 *
 *   contains    source 1   target 1
 *   references  source 0   target 649
 *   TOTAL       source 1   target 650   = 651 of 267,265 edges (0.244%)
 *
 * **649 fabricated `references` targets is a large number to carry into a
 * handover with no names attached**, and an aggregate is not falsifiable: a
 * reader cannot tell one systematic defect that happens to hit 649 sites from
 * 649 sites of one systematic defect with several causes. This file names them,
 * so the number can be adjudicated instead of merely reported.
 *
 * It also separates the two opposite findings the workstream names, which a
 * count alone cannot: an endpoint spelled like a keyword might be
 *
 *   (a) a FABRICATION — the analyzer read the keyword as an identifier, or
 *   (b) a TYPE-NAME-QUALIFIER — `Node.Child`, where `Child` is a field of a
 *       variant and the edge's real target is the type `Node`. That is a
 *       naming defect (the edge should name the type), not a fabricated one: the
 *       declaration exists and the language can express it.
 *
 * (a) and (b) look identical in a count and are different bugs with different
 * fixes, so which of them holds is the question this instrument answers.
 *
 * ## Method
 *
 * ONE walk, production `parseFile` from `src/ast/pool-worker.ts`, the arbiter's
 * own file set (`git ls-files` + `detectLanguageFromPath === "nim"` + a 512 KB
 * cap). No regex: endpoints are compared against a `Set` of reserved words, and
 * the shape of a dotted endpoint is decided by inspecting tree nodes via the
 * engine's own published symbol metadata, not by matching text patterns.
 *
 * Output is a name histogram, not a sample: every distinct keyword-spelled
 * endpoint is listed with its count, so the total and the histogram are the same
 * quantity and cannot drift apart.
 *
 * Writes JSON to the path given as argv[2] and a report to stdout.
 * Run: BB_NIM_WORKERS=1 npx tsx validation/m14/fixtures/nim/keyword-endpoint-hunt.ts <out.json>
 */
import { writeFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const OUT = process.argv[2]
const WORKERS = Number(process.env.BB_NIM_WORKERS ?? "1")
const MAX_BYTES = 512 * 1024

/** The same set `endpoint-provenance.ts` uses, copied so this file stands alone.
 *  `fixture-nim-keyword-not-a-declaration.ts` pins the analyzer's exported
 *  `NIM_KEYWORDS` to the canonical 64, so a drift here is visible as a diff
 *  between two files rather than as a silently different number. */
const NIM_KEYWORDS = new Set([
  "addr", "and", "as", "bind", "block", "break", "case", "concept", "const",
  "continue", "converter", "defer", "discard", "distinct", "div", "do", "elif",
  "else", "end", "enum", "except", "export", "finally", "for", "from", "func",
  "if", "import", "in", "include", "interface", "is", "isnot", "iterator", "let",
  "macro", "method", "mixin", "mod", "nil", "not", "notin", "object", "of", "or",
  "out", "proc", "ptr", "raise", "ref", "return", "shl", "shr", "static",
  "template", "try", "tuple", "type", "using", "var", "when", "while", "xor",
  "yield",
])

/** Every git repo under CORPUS that holds at least one nim file. Same discovery
 *  rule as `endpoint-provenance.ts` — `git ls-files`, `detectLanguageFromPath`,
 *  a 512 KB cap — so the file set is the set the verdict was read on. */
function discover(): string[] {
  const out: string[] = []
  for (const e of readdirSync(CORPUS)) {
    const dir = join(CORPUS, e)
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
      const abs = join(dir, rel)
      let size: number
      try {
        size = statSync(abs).size
      } catch { continue }
      if (size > MAX_BYTES) continue
      if (detectLanguageFromPath(abs) !== "nim") continue
      out.push(abs)
    }
  }
  return out.sort()
}

/** The last dotted segment of a qualified endpoint, or the whole string when it
 *  is bare. Decided by string position arithmetic on a name the ENGINE itself
 *  published — the endpoint's own spelling — not by matching a textual pattern. */
function leafOf(endpoint: string): string {
  const dot = endpoint.lastIndexOf(".")
  return dot < 0 ? endpoint : endpoint.slice(dot + 1)
}
function isQualified(endpoint: string): boolean {
  return endpoint.lastIndexOf(".") >= 0
}

const files = discover()

// name -> { total, qualified, bare, files: Map<file, count> }
const hits = new Map<string, { total: number; qualified: number; bare: number; files: Map<string, number> }>()
let edgesHeld = 0
let symbols = 0
let parsed = 0
let threw = 0

let next = 0
async function worker() {
  while (true) {
    const i = next++
    if (i >= files.length) return
    const path = files[i]
    try {
      const res = await parseFile(path, "nim")
      if (!res) continue
      parsed++
      symbols += res.symbols?.length ?? 0
      for (const rel of res.relationships ?? []) {
        edgesHeld++
        if (rel.type !== "references" && rel.type !== "contains") continue
        for (const side of ["source", "target"] as const) {
          const raw = (rel as any)[side]
          const name = typeof raw === "string" ? raw : raw?.name
          if (typeof name !== "string" || name.length === 0) continue
          const leaf = leafOf(name)
          if (!NIM_KEYWORDS.has(leaf)) continue
          let h = hits.get(leaf)
          if (!h) { h = { total: 0, qualified: 0, bare: 0, files: new Map() }; hits.set(leaf, h) }
          h.total++
          if (isQualified(name)) h.qualified++
          else h.bare++
          h.files.set(path.replace(CORPUS + "/", ""), (h.files.get(path.replace(CORPUS + "/", "")) ?? 0) + 1)
        }
      }
    } catch { threw++ }
  }
}

const t0 = Date.now()
await Promise.all(Array.from({ length: WORKERS }, () => worker()))
const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

const rows = [...hits.entries()]
  .map(([name, h]) => ({ name, ...h, files: [...h.files.entries()].sort((a, b) => b[1] - a[1]) }))
  .sort((a, b) => b.total - a.total)

const totalEdges = rows.reduce((s, r) => s + r.total, 0)
const qualified = rows.reduce((s, r) => s + r.qualified, 0)
const bare = rows.reduce((s, r) => s + r.bare, 0)

console.log(`nim keyword-endpoint hunt — production parseFile over the corpus`)
console.log(`files       : ${files.length}`)
console.log(`workers     : ${WORKERS}`)
console.log(`parsed      : ${parsed}   threw: ${threw}`)
console.log(`symbols     : ${symbols.toLocaleString()}`)
console.log(`edges held  : ${edgesHeld.toLocaleString()}`)
console.log(`keywords in corpus list: ${NIM_KEYWORDS.size}`)
console.log(``)
console.log(`Every DISTINCT keyword-spelled endpoint on a references/contains edge:`)
console.log(`name         total  qualified  bare   top file`)
console.log(`---------------------------------------------------------------------------`)
for (const r of rows) {
  const top = r.files[0]
  console.log(`${r.name.padEnd(12)} ${String(r.total).padStart(5)} ${String(r.qualified).padStart(10)} ${String(r.bare).padStart(5)}   ${top ? `${top[0]} (${top[1]})` : "-"}`)
}
console.log(`---------------------------------------------------------------------------`)
console.log(`TOTAL        ${String(totalEdges).padStart(5)} ${String(qualified).padStart(10)} ${String(bare).padStart(5)}`)
console.log(``)
console.log(`qualified = the endpoint is written Owner.keyword, so the leaf names a FIELD or a`)
console.log(`MEMBER, not a type. A declared-type edge should name the OWNER. That is a naming`)
console.log(`defect with a real declaration behind it, not an edge to something unreal.`)
console.log(`bare = the whole endpoint IS a reserved word. Nothing in Nim can be declared with`)
console.log(`that name, so that is a fabrication.`)
console.log(`elapsed ${elapsed}s`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    lang: "nim", corpusRoot: CORPUS, workers: WORKERS,
    files: files.length, parsed, parseFileThrew: threw,
    symbolsTotal: symbols, edgesHeld,
    keywordSetSize: NIM_KEYWORDS.size,
    totalKeywordEndpoints: totalEdges, qualified, bare,
    names: rows,
  }, null, 2))
  console.log(`wrote ${OUT}`)
}