/**
 * SWIFT R7 ENDPOINT PROBE — every relationship endpoint whose text a
 * placeholder-detector would flag, named, located, and checked against the
 * source that produced it.
 *
 * WHY THIS EXISTS. Standing rule R7 asks for no placeholder-literal edge
 * endpoints. The lane's census counts them, and its counters are NOT zero:
 * over the 1,256-file draw it reports `unknownTargetEdges: 34`,
 * `unknownSourceEdges: 2` and `placeholderTargetEdges: 6` — 42 endpoints in
 * total. The committed analyzer doc nevertheless states "0 unknown endpoints, 0
 * placeholder-literal endpoints". Those two statements cannot both be true as
 * written, and the difference between them is exactly the difference between
 * "the analyzer invents a name for something it could not resolve" (a defect)
 * and "a real Swift identifier happens to be spelled like a placeholder word"
 * (not a defect). Counting the word is not enough to tell them apart, so this
 * probe resolves each one to a file, a line, and the SOURCE TEXT at that line,
 * and asks whether the same file declares the name as an identifier.
 *
 * The two flag sets are the census's, kept verbatim so the two instruments
 * cannot drift:
 *   R7_LITERALS      the endpoints that are not names at all (`<unknown>`,
 *                    `TODO`, `???`, ...) — a real R7 hit if one ever appears.
 *   LOOKS_PLACEHOLDER words an ordinary identifier can be spelled like
 *                    (`unknown`, `null`, `nil`, `undefined`, `None`, `self`,
 *                    `super`, `true`, `false`, `TODO`, `this`) — needing
 *                    corroboration, not condemnation.
 *
 * Swift's reserved words include `nil` but NOT `unknown`, `null`, `undefined`
 * or `None`, and the analyzer takes every name from an identifier node's own
 * text, so an endpoint spelled `unknown` can only have come from an identifier
 * spelled `unknown`. That is the argument; this is the measurement.
 *
 * WRITES validation/m14/tmp/swift-r7-endpoints.json. Nothing else.
 *
 * Usage: bun script/m14/swift-r7-endpoint-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = "validation/m14/tmp/swift-r7-endpoints.json"
const REPOS = [
  { repo: "swift-nio", cap: Number.POSITIVE_INFINITY },
  { repo: "alamofire", cap: Number.POSITIVE_INFINITY },
  { repo: "swift-corpus", cap: 600 },
]

const R7_LITERALS = new Set(["<unknown>", "<internal>", "<unresolved>", "TODO", "FIXME", "???", "?", "", "undefined", "N/A", "n/a", "<anonymous>"])
const LOOKS_PLACEHOLDER = new Set(["unknown", "null", "nil", "undefined", "None", "true", "false", "self", "this", "super", "TODO"])

function admittedFiles(repo: string, cap: number): string[] {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { return [] }
  const out: string[] = []
  for (const rel of tracked) {
    if (!rel.endsWith(".swift")) continue
    try { const st = statSync(path.join(dir, rel)); if (st.isFile() && st.size > 0) out.push(rel) } catch { continue }
  }
  return out.slice(0, cap)
}

interface FileRef { repo: string; rel: string; abs: string; dir: string }
const files: FileRef[] = []
const pins: Record<string, string> = {}
for (const { repo, cap } of REPOS) {
  const rels = admittedFiles(repo, cap)
  if (rels.length === 0) { console.error(`! corpus missing or empty: ${repo}`); process.exit(2) }
  try { pins[repo] = execFileSync("git", ["-C", path.join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { pins[repo] = "unknown" }
  for (const rel of rels) files.push({ repo, rel, abs: path.join(CR, repo, rel), dir: path.join(CR, repo) })
}
console.log(`swift R7 endpoint probe — ${files.length} files`)

interface Hit {
  file: string; line: number | null; type: string; endpoint: string; side: "source" | "target"
  flag: "r7-literal" | "looks-placeholder"
  declaredInSameFile: boolean
  sourceText: string
}
const hits: Hit[] = []
let emptySource = 0, emptyTarget = 0, emptySymbolName = 0
let filesWithHits = 0
let idx = 0

async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    const lines = text.split(/\r?\n/)
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    if (r.fallback) continue

    const declared = new Set<string>()
    for (const s of r.symbols ?? []) {
      const nm = String(s.name ?? "")
      if (nm) declared.add(nm)
      else emptySymbolName++
    }
    let fileHit = false
    for (const rel of r.relationships ?? []) {
      const type = String(rel.type ?? rel.relationshipType ?? "")
      for (const side of ["source", "target"] as const) {
        const v = String(rel[side] ?? "")
        if (v === "") { if (side === "source") emptySource++; else emptyTarget++; fileHit = true; continue }
        const isR7 = R7_LITERALS.has(v)
        const looks = LOOKS_PLACEHOLDER.has(v)
        if (!isR7 && !looks) continue
        const line = typeof rel.line_number === "number" ? rel.line_number : null
        hits.push({
          file: label, line, type, endpoint: v, side,
          flag: isR7 ? "r7-literal" : "looks-placeholder",
          declaredInSameFile: declared.has(v),
          sourceText: line && lines[line - 1] ? lines[line - 1].trim().slice(0, 120) : "",
        })
        fileHit = true
      }
    }
    if (fileHit) filesWithHits++
  }
}
await Promise.all(Array.from({ length: 8 }, () => worker()))

const bySpelling = new Map<string, { count: number; files: Set<string>; declaredInSameFile: number; examples: string[] }>()
for (const h of hits) {
  const k = h.endpoint
  const e = bySpelling.get(k) ?? { count: 0, files: new Set<string>(), declaredInSameFile: 0, examples: [] }
  e.count++
  e.files.add(h.file)
  if (h.declaredInSameFile) e.declaredInSameFile++
  if (e.examples.length < 4) e.examples.push(`${h.file}:${h.line ?? "-"} ${h.type} ${h.side}='${h.endpoint}' | ${h.sourceText}`)
  bySpelling.set(k, e)
}
const r7LiteralHits = hits.filter((h) => h.flag === "r7-literal")
const out = {
  at: new Date().toISOString(),
  instrument: "script/m14/swift-r7-endpoint-probe.ts",
  corpus: { root: CR, repos: Object.entries(pins).map(([repo, pin]) => ({ repo, pin })), files: files.length },
  question: "R7: are there unknown symbols, empty names, or placeholder-literal edge endpoints?",
  counts: {
    emptySourceEndpoints: emptySource,
    emptyTargetEndpoints: emptyTarget,
    emptySymbolNames: emptySymbolName,
    endpointsInR7LiteralSet: r7LiteralHits.length,
    endpointsThatOnlyLookLikePlaceholders: hits.length - r7LiteralHits.length,
    filesWithAnyFlaggedEndpoint: filesWithHits,
    // the number that decides R7: an endpoint spelled like a placeholder word
    // that the analyzer INVENTED rather than read out of the tree.
    flaggedEndpointsNotDeclaredInTheirOwnFile: hits.filter((h) => !h.declaredInSameFile).length,
  },
  bySpelling: Object.fromEntries([...bySpelling.entries()].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [k, {
    count: v.count, files: v.files.size, declaredInSameFile: v.declaredInSameFile, examples: v.examples,
  }])),
  everyHit: hits,
}
writeFileSync(OUT, JSON.stringify(out, null, 2))
console.log(`wrote ${OUT}\n`)
console.log(`empty source endpoints:        ${emptySource}`)
console.log(`empty target endpoints:        ${emptyTarget}`)
console.log(`symbols with an empty name:    ${emptySymbolName}`)
console.log(`endpoints in the R7 LITERAL set (not names at all): ${r7LiteralHits.length}`)
for (const h of r7LiteralHits.slice(0, 20)) console.log(`  ${h.file}:${h.line ?? "-"} ${h.type} ${h.side}='${h.endpoint}' | ${h.sourceText}`)
console.log(`\nendpoints that merely LOOK like placeholders: ${hits.length - r7LiteralHits.length}`)
console.log(`  of those, NOT declared as an identifier in their own file: ${hits.filter((h) => !h.declaredInSameFile).length}`)
for (const [k, v] of Object.entries(out.bySpelling)) {
  console.log(`  '${k}' x${v.count} in ${v.files} file(s), declared-in-own-file ${v.declaredInSameFile}`)
  for (const e of v.examples.slice(0, 2)) console.log(`      ${e}`)
}
