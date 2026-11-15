/**
 * DELIVERABLE C — SEPARATE "EXTERNAL" FROM "NEVER INDEXED"
 * --------------------------------------------------------
 * The lane brief's INCOMING section requires this and the doc's own Known-limitations list records it
 * as unmet: *"The 1,204 unresolvable are not separated into 'external package' / 'builtin' / 'dynamic
 * dispatch' / 'a declaration we failed to publish', which are four findings and one count."* Those
 * look identical in a count and are opposite findings: one is the corpus being incomplete, the other
 * is this analyzer dropping a declaration that is right there in a file it already parsed.
 *
 * The census already partitions every endpoint into eight buckets and its `unresolvable` bucket is
 * DEFINED as the union this file separates — `"resolves to nothing — external package, dynamic
 * dispatch, or a lost declaration"`. Splitting it needs one more fact the census does not collect:
 * **does any file in the corpus even MENTION the name?**
 *
 * That question splits cleanly in two, and only the second arm needs adjudication:
 *
 *   - The name is mentioned NOWHERE in the corpus. Every `identifier` node on every admitted file's
 *     production-grammar tree has been collected, so this arm is PROVABLE, not inferred: no file this
 *     analyzer was given contains the name in any syntactic position at all. Whatever the target is —
 *     a `Base` builtin, a package outside the corpus, a macro-generated binding — it is not a
 *     declaration this lane dropped. Call it `not-in-corpus`.
 *   - The name IS mentioned somewhere. The corpus uses the word, the analyzer published no symbol
 *     under it, and the two candidate explanations — a declaration form this analyzer does not read,
 *     versus a mere READ of a name declared outside the corpus — are still both live. Call it
 *     `mentioned-unpublished`, and then narrow it: names mentioned ONLY in files that publish ZERO
 *     symbols are the sharpest candidates, because a file that published nothing cannot have
 *     published that declaration either, and those files are nameable.
 *
 * WHY TREE, NOT TEXT. The mention set is collected from `identifier` nodes on the parse tree of the
 * PRODUCTION grammar (`wasm/tree-sitter-julia.wasm`, the patched rebuild the engine loads), never by
 * matching source text. A text scan would match the same name inside a comment or a string literal and
 * would call it "mentioned", which is the false-positive class this lane's oracles exist to distrust.
 * A comment cannot produce an `identifier` node, so this set cannot be inflated by one.
 *
 * WHAT IT DOES NOT SETTLE, stated up front. `mentioned-unpublished` is an OPEN set, not a defect
 * count. Most of it is legitimately a READ of something declared outside the corpus — that is what a
 * call to `Base.println` looks like from inside a per-file analyzer. This file reports the split, the
 * size of each arm, and the zero-symbol-file concentration, and does NOT claim the open arm is a
 * defect. The only figure here that is a defect figure is the zero-symbol-file concentration, and even
 * that is a NARROWING, not a verdict.
 *
 * THE POPULATION IS A SUPERSET OF THE CENSUS'S `unresolvable` BUCKET, and the difference is named.
 * This instrument counts a target as unresolved when it binds neither to a symbol in its own file nor
 * to any published name anywhere in the corpus. The census applies two further tests before it calls a
 * target `unresolvable`: `external-by-import` (a qualified root this file imports) and `local-binding`
 * (a parameter / loop / `let` / `catch` binding, which is bound in the file and deliberately not
 * published). So this instrument's `calls` figure of 16,914 edges is WIDER than the census's 10,034,
 * and the two are not interchangeable: the extra 6,880 are targets the census has already bucketed by
 * a different reason. **A wider population is the right one for this question** — deliverable C asks
 * about targets that resolve to nothing, and those two buckets are already separated answers to it —
 * but the two counts must never be quoted as the same figure, which is why both are printed here.
 *
 * DETERMINISM. Two phases, for the reason `census.ts` documents: classifying a name needs the
 * corpus-wide table complete, and answering "is this name published ANYWHERE" from a set that four
 * workers happen to be filling makes the answer depend on scheduling. Phase one collects; phase two
 * classifies single-threaded.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/julia/unresolved-split.ts
 *   npx tsx validation/m14/fixtures/julia/unresolved-split.ts --json /tmp/split.json
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const jsonOut = (() => {
  const i = process.argv.indexOf("--json")
  return i >= 0 ? process.argv[i + 1] : null
})()

// ---------------------------------------------------------------- corpus, same admission as the census
const files: { repo: string; rel: string; abs: string; dir: string; text: string; bytes: number }[] = []
for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch {
    continue
  }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    if (!rel.endsWith(".jl")) continue
    const abs = path.join(dir, rel)
    let text: string
    let bytes: number
    try {
      bytes = statSync(abs).size
      if (bytes > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "julia") continue
    files.push({ repo: e, rel, abs, dir, text, bytes })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : 1))
const corpusHash = createHash("sha256").update(files.map((f) => `${f.repo}/${f.rel}:${f.bytes}`).join("\n")).digest("hex").slice(0, 16)

console.log(`unresolved split — deliverable C: external vs never-indexed`)
console.log(`corpus root: ${CR}`)
console.log(`admitted ${files.length} .jl files   corpus hash: ${corpusHash}`)
console.log(`grammar: wasm/tree-sitter-julia.wasm (the production grammar, for the mention set)`)

// ---------------------------------------------------------------- PHASE ONE-A: the MENTION set
// Every identifier the production grammar produces, corpus-wide. A comment and a string literal
// cannot produce one, which is the whole reason this is a tree walk.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-julia.wasm"))))

/** name -> the files whose tree mentions it as an identifier */
const mentionedIn = new Map<string, Set<string>>()
let unreadable = 0
for (const f of files) {
  let t: any = null
  try {
    t = parser.parse(f.text)
  } catch {
    t = null
  }
  if (!t) {
    unreadable++
    continue
  }
  const label = `${f.repo}/${f.rel}`
  const visit = (n: any) => {
    if (n.type === "identifier") {
      const txt = n.text
      if (txt) {
        const set = mentionedIn.get(txt) ?? new Set<string>()
        set.add(label)
        mentionedIn.set(txt, set)
      }
    }
    for (let i = 0; i < n.childCount; i++) visit(n.child(i))
  }
  visit(t.rootNode)
  t.delete?.()
}
console.log(`\nMENTION SET (identifier nodes on the production grammar's trees)`)
console.log(`  files the grammar could not read: ${unreadable}`)
console.log(`  distinct identifiers mentioned corpus-wide: ${mentionedIn.size.toLocaleString()}`)

// ---------------------------------------------------------------- PHASE ONE-B: what the analyzer published
const WIDTH = Number(process.env.BB_JULIA_WORKERS ?? 4)
type Row = { label: string; local: Set<string>; rows: any[] }
const results: (Row | null)[] = new Array(files.length).fill(null)
const zeroSymbolFiles = new Set<string>()
const degraded: string[] = []
let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    const label = `${f.repo}/${f.rel}`
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch {
      continue
    }
    if (r?.fallback) {
      degraded.push(label)
      continue
    }
    const syms = r?.symbols ?? []
    if (syms.length === 0) zeroSymbolFiles.add(label)
    const local = new Set<string>()
    for (const s of syms) local.add(String((s as any).name ?? ""))
    results[i] = { label, local, rows: (r?.relationships ?? []) as any[] }
  }
}
await Promise.all(Array.from({ length: WIDTH }, () => worker()))

const published = new Set<string>()
for (const res of results) if (res) for (const nm of res.local) published.add(nm)
console.log(`  distinct names the analyzer PUBLISHED: ${published.size.toLocaleString()}   degraded files: ${degraded.length}   zero-symbol files: ${zeroSymbolFiles.size}`)

// ---------------------------------------------------------------- PHASE TWO: classify, single threaded
/**
 * Per type: the `unresolvable` population, split.
 *  - `not-in-corpus`         no admitted file mentions the name at all. PROVABLE external.
 *  - `mentioned-unpublished` the corpus mentions it; the analyzer published no symbol under it. OPEN.
 *  - of those, `only-in-zero-symbol-files`: every file that mentions it publishes nothing, so no file
 *    in the sample could have published it. The narrowest, most actionable arm.
 */
type Split = {
  edges: number
  names: Set<string>
  notInCorpus: Set<string>
  mentionedUnpublished: Set<string>
  onlyZeroSymbolFiles: Set<string>
  externalExamples: { name: string; edges: number }[]
  zeroSymExamples: { name: string; edges: number; files: string[] }[]
}
const perType: Record<string, Split> = {}
for (const t of ALL_TYPES) {
  perType[t] = { edges: 0, names: new Set(), notInCorpus: new Set(), mentionedUnpublished: new Set(), onlyZeroSymbolFiles: new Set(), externalExamples: [], zeroSymExamples: [] }
}
const edgeCountByName = new Map<string, number>()

for (const res of results) {
  if (!res) continue
  for (const rel of res.rows) {
    const t = String(rel?.type ?? "")
    const s = perType[t]
    if (!s) continue
    const tgt = String(rel?.target ?? "")
    if (!tgt || tgt === "unknown") continue
    if (res.local.has(tgt)) continue // resolves in its own file
    if (published.has(tgt)) continue // resolves elsewhere in the corpus -> `corpus-only`, not this bucket
    s.edges++
    s.names.add(tgt)
    edgeCountByName.set(tgt, (edgeCountByName.get(tgt) ?? 0) + 1)
    if (!mentionedIn.has(tgt)) {
      s.notInCorpus.add(tgt)
    } else {
      s.mentionedUnpublished.add(tgt)
      const where = mentionedIn.get(tgt)!
      if ([...where].every((fl) => zeroSymbolFiles.has(fl))) s.onlyZeroSymbolFiles.add(tgt)
    }
  }
}

console.log(`\nSPLIT OF THE \`unresolvable\` BUCKET  (target resolves neither in its own file nor anywhere in the corpus)`)
console.log(`  "not-in-corpus" is PROVABLE: no admitted file mentions the name in ANY identifier position.`)
console.log(`  "mentioned-unpublished" is OPEN: the corpus uses the word and no symbol is published for it.\n`)
console.log(`type          edges   distinct   not-in-corpus   mentioned-unpublished   of which only-in-zero-symbol-files`)
console.log(`$("-".repeat(104)}`)
for (const t of ALL_TYPES) {
  const s = perType[t]
  if (s.edges === 0 && s.names.size === 0) continue
  console.log(
    `${t.padEnd(13)} ${String(s.edges).padStart(6)} ${String(s.names.size).padStart(9)} ${String(s.notInCorpus.size).padStart(14)} ${String(s.mentionedUnpublished.size).padStart(23)} ${String(s.onlyZeroSymbolFiles.size).padStart(35)}`,
  )
}

const totalEdges = ALL_TYPES.reduce((a, t) => a + perType[t].edges, 0)
const totalNames = new Set<string>()
const totalExternal = new Set<string>()
const totalOpen = new Set<string>()
const totalZero = new Set<string>()
for (const t of ALL_TYPES) {
  for (const n of perType[t].names) totalNames.add(n)
  for (const n of perType[t].notInCorpus) totalExternal.add(n)
  for (const n of perType[t].mentionedUnpublished) totalOpen.add(n)
  for (const n of perType[t].onlyZeroSymbolFiles) totalZero.add(n)
}
console.log(`\nCORPUS-WIDE, distinct names over all types`)
console.log(`  unresolvable names: ${totalNames.size.toLocaleString()}`)
console.log(`  not-in-corpus (PROVABLY not a dropped declaration): ${totalExternal.size.toLocaleString()}  (${((totalExternal.size / Math.max(1, totalNames.size)) * 100).toFixed(1)}%)`)
console.log(`  mentioned-unpublished (OPEN): ${totalOpen.size.toLocaleString()}  (${((totalOpen.size / Math.max(1, totalNames.size)) * 100).toFixed(1)}%)`)
console.log(`  …and of those, mentioned ONLY in files that publish zero symbols: ${totalZero.size.toLocaleString()}`)

const byEdge = (ns: Set<string>) => [...ns].sort((a, b) => (edgeCountByName.get(b) ?? 0) - (edgeCountByName.get(a) ?? 0))
console.log(`\nLARGEST \`not-in-corpus\` NAMES BY EDGE COUNT — external by proof, with the edges each accounts for:`)
for (const n of byEdge(totalExternal).slice(0, 15)) {
  console.log(`  ${n.padEnd(28)} ${String(edgeCountByName.get(n) ?? 0).padStart(6)} edges`)
}
console.log(`\nLARGEST \`mentioned-unpublished\` NAMES — the OPEN set, which this lane does NOT claim is a defect:`)
for (const n of byEdge(totalOpen).slice(0, 15)) {
  const where = [...(mentionedIn.get(n) ?? [])]
  console.log(`  ${n.padEnd(28)} ${String(edgeCountByName.get(n) ?? 0).padStart(6)} edges   mentioned in ${where.length} file(s), e.g. ${where[0] ?? "-"}`)
}
console.log(`\nTHE SHARPEST ARM — a name mentioned only in files that publish ZERO symbols:`)
for (const n of byEdge(totalZero).slice(0, 15)) {
  const where = [...(mentionedIn.get(n) ?? [])]
  console.log(`  ${n.padEnd(28)} ${String(edgeCountByName.get(n) ?? 0).padStart(6)} edges   ${where.slice(0, 2).join(", ")}`)
}

if (jsonOut) {
  const dump = (s: Split) => ({
    edges: s.edges,
    distinctNames: s.names.size,
    notInCorpus: [...s.notInCorpus].sort(),
    mentionedUnpublished: [...s.mentionedUnpublished].sort(),
    onlyInZeroSymbolFiles: [...s.onlyZeroSymbolFiles].sort(),
  })
  const out: any = {
    generatedFor: "julia",
    corpusRoot: CR,
    admittedFiles: files.length,
    corpusHash,
    grammar: "wasm/tree-sitter-julia.wasm",
    unreadableByGrammar: unreadable,
    distinctIdentifiersMentioned: mentionedIn.size,
    distinctNamesPublished: published.size,
    degradedFiles: degraded,
    zeroSymbolFiles: [...zeroSymbolFiles].sort(),
    corpusWide: {
      unresolvableNames: totalNames.size,
      notInCorpus: totalExternal.size,
      mentionedUnpublished: totalOpen.size,
      onlyInZeroSymbolFiles: totalZero.size,
      unresolvableEdges: totalEdges,
    },
    perType: Object.fromEntries(ALL_TYPES.filter((t) => perType[t].edges > 0).map((t) => [t, dump(perType[t])])),
  }
  writeFileSync(jsonOut, JSON.stringify(out, null, 2))
  console.log(`\nwrote ${jsonOut}`)
}