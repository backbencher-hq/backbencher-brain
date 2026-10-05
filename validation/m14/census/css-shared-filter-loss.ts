/**
 * HOW MANY CSS RELATIONSHIPS THE SHARED SANITIZER DELETES, AND WHICH.
 *
 * ## The finding
 *
 * `src/ast/pool-worker.ts:643` reads
 *
 *     if (target.length > 200 || target.includes("\n")) return false
 *
 * inside the universal relationship filter, under the comment "Block garbage
 * targets: source code snippets, malformed names". It runs AFTER the analyzer and
 * BEFORE the store, so a relationship the analyzer emitted can be deleted on the
 * production path while every analyzer-level instrument still counts it.
 *
 * For CSS the clause is not a garbage test. A `contains` edge's target is a
 * SELECTOR, and a comma group of real selectors passes 200 characters routinely.
 * Measured minimum reproduction, `pico/css/pico.classless.blue.css:1928-1965`
 * (`@supports selector(:has(*))`), 5 rule_sets, production `parseFile`:
 *
 *   analyze()   5 @supports `contains` edges   targets 189, 476, 157, 732, 327
 *   parseFile() 2 @supports `contains` edges   targets 189, 157
 *   deleted     3, every one of them > 200 characters
 *
 * The 200 boundary was bracketed by construction rather than assumed: a generated
 * single-part selector of exactly 200 characters survives and 202 does not, and the
 * same holds through 7 parts / 201 chars and 40 parts / 228 chars.
 *
 * ## Why this instrument compares the two entry points
 *
 * The task's own rule is that every count must come from production `parseFile`,
 * because `analyze()` skips the pipeline. That rule is correct for measuring what
 * the lane EMITS. Here the question is the opposite one — which STAGE removes an
 * edge — and for that the two must be compared, because the deletion is invisible
 * from either side alone: `parseFile` cannot report an edge it never received, and
 * `analyze` reports edges the store will never see. Each side alone yields a clean
 * and misleading answer.
 *
 * ## What is counted
 *
 * For each admitted corpus file: the analyzer's own relationship list, split by
 * whether the target trips either clause of the shared filter. The trip count is
 * an UPPER bound on the deletion, not the deletion itself — a target can also be
 * dropped by a later clause. It is reported as such, and `parseFile` is run on the
 * same files so the two lists can be diffed and the actual deletion measured rather
 * than inferred.
 *
 * ## Rules honoured
 *
 * Zero regular expressions: the newline test is `indexOf("\n") >= 0` and every
 * other test is a length comparison.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../src/ast/language-detection"
import { RealCssAnalyzer } from "../../../src/ast/real-css-analyzer"
import { parseFile, filterNoiseRelationships } from "../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const LIMIT = Number(process.argv[2] ?? 250)
const SIZE_CAP = 512 * 1024
const WASM = path.join(process.cwd(), "wasm", "tree-sitter-css.wasm")
/** The shared filter's own threshold, restated here so the two sides can be compared. */
const SHARED_MAX_TARGET = 200

// ---------------------------------------------------------------------------- corpus

const files: { repo: string; abs: string; rel: string }[] = []
for (const repo of readdirSync(CR).sort()) {
  const rd = path.join(CR, repo)
  let rs: any
  try {
    rs = statSync(rd)
  } catch {
    continue
  }
  if (!rs.isDirectory()) continue
  const stack: string[] = [rd]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let ents: any[]
    try {
      ents = readdirSync(dir, { withFileTypes: true }) as any[]
    } catch {
      continue
    }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue
        stack.push(p)
      } else if (e.isFile()) {
        let st: any
        try {
          st = statSync(p)
        } catch {
          continue
        }
        if (st.size > SIZE_CAP) continue
        const rel = path.relative(rd, p)
        if (detectLanguageFromPath(rel) === "css") files.push({ repo, abs: p, rel })
      }
    }
  }
}
files.sort((a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : a.rel < b.rel ? -1 : 1))
const stride = Math.max(1, Math.floor(files.length / LIMIT))
const picked: typeof files = []
for (let i = 0; i < files.length && picked.length < LIMIT; i += stride) picked.push(files[i])

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({
  locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
})
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(WASM)))

// ---------------------------------------------------------------------------- run

console.log(`css shared-sanitizer deletion census — pool-worker.ts:643, target > ${SHARED_MAX_TARGET} chars or containing a newline`)
console.log(`corpus ${files.length} css files; stride sample ${picked.length} (stride ${stride})\n`)

interface Bucket {
  n: number
  files: Set<string>
  longest: number
  examples: string[]
}
const tripBuckets = new Map<string, Bucket>()
const deletedByType = new Map<string, number>()
const emittedByType = new Map<string, number>()
const perFileRows: { repo: string; rel: string; n: number; longest: number }[] = []
const causeBuckets = new Map<string, number>()

/** The shared filter's leaf: last non-empty ":"-segment, then last "."-segment. */
function extractLeaf(name: string): string {
  let noLine = name
  let cut = 0
  for (let i = 0; i < name.length; i++) if (name.charAt(i) === ":") cut = i
  if (cut > 0) noLine = name.slice(0, cut)
  const segs: string[] = []
  for (const s of noLine.split(":")) if (s.length > 0) segs.push(s)
  const last = segs.length > 0 ? segs[segs.length - 1] : ""
  const dots = last.split(".")
  return dots.length > 0 ? dots[dots.length - 1] : ""
}

/** The shared filter's leaf character class `{ } \` < > and the whitespace run. */
function leafHasNoiseChar(leaf: string): boolean {
  for (const ch of leaf) {
    if (ch === "{" || ch === "}" || ch === "`" || ch === "<" || ch === ">") return true
    if (ch === "\n" || ch === "\r" || ch === "\t") return true
  }
  return false
}
const EXAMPLES = 3

let parsed = 0
let failures = 0
let degraded = 0
let emittedTotal = 0
let tripTotal = 0
let deletedTotal = 0

function bucketFor(key: string, file: string, targetLen: number, example: string) {
  let b = tripBuckets.get(key)
  if (!b) {
    b = { n: 0, files: new Set(), longest: 0, examples: [] }
    tripBuckets.set(key, b)
  }
  b.n++
  b.files.add(file)
  if (targetLen > b.longest) b.longest = targetLen
  if (b.examples.length < EXAMPLES) b.examples.push(example)
}

for (const f of picked) {
  const label = `${f.repo}/${f.rel}`
  let src: string
  try {
    src = readFileSync(f.abs, "utf8")
  } catch {
    failures++
    continue
  }
  let tree: any
  try {
    tree = parser.parse(src)
  } catch {
    failures++
    continue
  }
  let pre: any
  try {
    pre = new RealCssAnalyzer().analyze(tree.rootNode, src, f.abs)
  } catch {
    failures++
    continue
  }
  parsed++
  const preRels = (pre.relationships ?? []) as any[]

  // Which of the analyzer's own relationships trip the shared filter's two clauses.
  let fileTrips = 0
  let fileLongest = 0
  for (const r of preRels) {
    const t = typeof r.target === "string" ? r.target : ""
    emittedByType.set(r.type, (emittedByType.get(r.type) ?? 0) + 1)
    emittedTotal++
    const tooLong = t.length > SHARED_MAX_TARGET
    const hasNewline = t.indexOf("\n") >= 0
    if (!tooLong && !hasNewline) continue
    tripTotal++
    fileTrips++
    if (t.length > fileLongest) fileLongest = t.length
    const why = tooLong && hasNewline ? "LEN+NEWLINE" : tooLong ? "LEN" : "NEWLINE"
    bucketFor(`${r.type} ${why}`, label, t.length, `${label}  targetLen=${t.length}  ${JSON.stringify(t.slice(0, 80))}`)
  }
  if (fileTrips > 0) perFileRows.push({ repo: f.repo, rel: f.rel, n: fileTrips, longest: fileLongest })

  // Now the production path on the SAME file, so the deletion is measured rather
  // than inferred from the trip count.
  let post: any
  try {
    post = await parseFile(f.abs, src, "css")
  } catch {
    continue
  }
  if (post?.symbols?.[0]?.metadata?.fallback === true || (post as any)?.degraded === true) degraded++
  const postKeys = new Set(((post.relationships ?? []) as any[]).map((r: any) => `${r.type}|${r.source}|${r.target}`))
  for (const r of preRels) {
    if (postKeys.has(`${r.type}|${r.source}|${r.target}`)) continue
    deletedByType.set(r.type, (deletedByType.get(r.type) ?? 0) + 1)
    deletedTotal++
    // Attribute the deletion by asking the SHARED FILTER ITSELF, not a
    // reimplementation of it. A reimplementation would be a second copy of five
    // clauses that can drift, and this census exists to report a number about
    // shared machinery — the one thing a local copy cannot be trusted to say.
    const kept = filterNoiseRelationships([r], "css")
    if (kept.length > 0) {
      causeBuckets.set("SURVIVES the shared filter — absent for another reason (store key, merge, dedupe)", (causeBuckets.get("SURVIVES the shared filter — absent for another reason (store key, merge, dedupe)") ?? 0) + 1)
      continue
    }
    const t = typeof r.target === "string" ? r.target : ""
    const leaf = extractLeaf(t)
    let cause: string
    if (t.length > SHARED_MAX_TARGET || t.indexOf("\n") >= 0) cause = `TARGET-LEN/NEWLINE (> ${SHARED_MAX_TARGET} or has a newline)`
    else if (leaf.length > 80 || leaf.length < 1) cause = `LEAF-LEN (leaf ${leaf.length} chars)`
    else if (leafHasNoiseChar(leaf)) cause = "LEAF-CHARS (brace/angle/space class)"
    else if (leaf.startsWith(" ") || leaf.indexOf("  ") >= 0) cause = "LEAF-SPACE"
    else cause = "NOISE_TARGETS (a name in the shared noise list)"
    causeBuckets.set(cause, (causeBuckets.get(cause) ?? 0) + 1)
    bucketFor(`DELETED ${r.type} — ${cause}`, label, t.length, `${label}  targetLen=${t.length} leafLen=${leaf.length}  ${JSON.stringify(t.slice(0, 70))}`)
  }
}

console.log(`parsed ${parsed}/${picked.length}, failures ${failures}, degraded ${degraded}`)
console.log(`analyzer relationships on this sample: ${emittedTotal}`)
console.log(`  tripping the shared filter (LEN/NEWLINE): ${tripTotal}  (${((tripTotal / Math.max(1, emittedTotal)) * 100).toFixed(2)}% — an UPPER bound on the deletion)`)
console.log(`  ABSENT from parseFile (the measured deletion): ${deletedTotal}  (${((deletedTotal / Math.max(1, emittedTotal)) * 100).toFixed(2)}%)\n`)

console.log("analyzer relationships by type:")
for (const [k, v] of [...emittedByType.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)}${v}`)
console.log("\nEVERY measured deletion attributed, by asking the shared filter itself:")
for (const [k, v] of [...causeBuckets.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(6)}  ${k}`)

console.log("\nabsent from parseFile, by type:")
if (deletedByType.size === 0) console.log("  (none)")
for (const [k, v] of [...deletedByType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(14)}${v}   ${((v / Math.max(1, emittedByType.get(k) ?? 0)) * 100).toFixed(2)}% of the type`)
}

console.log("\ntripping relationships by cause:")
for (const [k, b] of [...tripBuckets.entries()].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${String(b.n).padStart(6)} in ${String(b.files.size).padStart(4)} files  longest=${String(b.longest).padStart(5)}  ${k}`)
  for (const ex of b.examples) console.log(`             ${ex}`)
}

console.log(`\nfiles with at least one tripping relationship: ${perFileRows.length} of ${parsed} (${((perFileRows.length / Math.max(1, parsed)) * 100).toFixed(1)}%)`)
perFileRows.sort((a, b) => b.n - a.n)
for (const r of perFileRows.slice(0, 10)) console.log(`  ${String(r.n).padStart(5)} longest=${String(r.longest).padStart(5)}  ${r.repo}/${r.rel}`)

const jsonAt = process.argv.indexOf("--json")
if (jsonAt >= 0 && process.argv[jsonAt + 1]) {
  writeFileSync(
    process.argv[jsonAt + 1],
    JSON.stringify(
      {
        corpus: { files: files.length, sampled: picked.length, stride, parsed, failures, degraded },
        sharedFilter: { maxTargetChars: SHARED_MAX_TARGET, alsoRejects: "target containing a newline", source: "src/ast/pool-worker.ts:643" },
        emittedTotal,
        tripTotal,
        deletedTotal,
        tripByCause: [...tripBuckets.entries()].map(([k, b]) => ({ cause: k, n: b.n, files: b.files.size, longest: b.longest })),
        emittedByType: Object.fromEntries(emittedByType),
        deletedByType: Object.fromEntries(deletedByType),
        deletionCauses: Object.fromEntries(causeBuckets),
        filesWithTrips: perFileRows.length,
      },
      null,
      2,
    ),
  )
}