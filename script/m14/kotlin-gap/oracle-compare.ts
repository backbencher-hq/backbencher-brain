/**
 * KOTLIN_GAP — per-label oracle comparison + endpoint resolution census.
 *
 * Answers questions 3, 4 and 5 of the workstream doc per already-emitted type:
 *
 *   3 CORRECT  — an independent oracle agrees. The oracle here is
 *      differential.ts's OWN walker over the SAME parse (`deriveTreeEdges` plus
 *      the four kotlin oracles it registers). That makes it independent at the
 *      level of IMPLEMENTATION and NOT at the level of GRAMMAR: a grammar bug
 *      both walkers share is invisible here. Stated, not papered over.
 *
 *   4 LABELLED — the label the truth derives for the same (source, target) pair.
 *      Where truth and analyzer disagree about the LABEL of a shared target, the
 *      pair is counted under `labelDisagree`.
 *
 *   5 RESOLVED — both endpoints bind to a real symbol. Measured two ways:
 *      fileLocal  — the endpoint is a symbol THIS file declares (or its leaf)
 *      corpusLocal— the endpoint is a symbol some file in the admitted set
 *                    declares (a project index built here, NOT the engine's)
 *      neither    — neither, which includes library/stdlib targets
 *
 * TWO MATCHING RULES, both reported, because they answer different questions:
 *
 *   harness — `label + lastSegment(normTarget(target))`, differential.ts's OWN
 *             published rule (`normTarget` is IMPORTED from there, not restated).
 *             The SOURCE is not part of the key. This is the rule the published
 *             coverage number uses, so it is the column that says "the oracle
 *             agrees with the analyzer".
 *   strict  — `label + source + target-with-qualifier`, i.e. the same rule plus
 *             the source and minus the last-segment reduction. This is
 *             differential.ts's own sharpness argument (BB_F5_STRICT, strictKey)
 *             applied per label. It is NOT the published number.
 *
 * NO REGEX. Nothing here matches a pattern over source text; every key is built
 * from AST-derived names, enum values, and a hand-written bracket scan.
 *
 * Usage: bun run script/m14/kotlin-gap/oracle-compare.ts [fileCount] [--repo DIR]
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../../src/ast/engine"
import { RelationshipType } from "../../../src/ast/types"
import { RealKotlinAnalyzer } from "../../../src/ast/real-kotlin-analyzer"
import {
  deriveTreeEdges,
  deriveKotlinEdges,
  deriveKotlinUsesTruth,
  deriveKotlinContainsTruth,
  deriveKotlinReferencesTruth,
  normTarget,
} from "../differential"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const repoIdx = argv.indexOf("--repo")
const REPO_DIR = repoIdx >= 0 ? argv[repoIdx + 1] : "kotlin"
const want = Number(argv.find((a) => !a.startsWith("--")) ?? "200")

const tracked: string[] = execFileSync("git", ["-C", path.join(CR, REPO_DIR), "ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 512 * 1024 * 1024,
})
  .split("\0")
  .filter(Boolean)
const KT = [".kt", ".kts"]
const candidates = tracked.filter((rel) => KT.some((e) => path.extname(rel).toLowerCase() === e)).sort()
const stride = Math.max(1, Math.floor(candidates.length / want))
const files: string[] = []
for (let i = 0; i < candidates.length && files.length < want; i += stride) files.push(candidates[i])

// Labels the differential's allowlist admits for kotlin, read from its own rule
// rather than restated here (extends, implements, instantiates, overrides,
// calls, uses, contains, references).
const AUDITED = ["calls", "contains", "extends", "implements", "instantiates", "overrides", "references", "uses"]
const ALL = [...new Set(Object.values(RelationshipType))].sort()

const hKey = (label: string, target: string) => `${label}|${normTarget(target)}`

/** mirror of differential.ts strictTargetText, by hand: cut at the first '<' or '['. */
const strictTargetText = (t: string): string => {
  const s = String(t ?? "").trim()
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 60 /* < */ || c === 91 /* [ */) return s.slice(0, i).trim()
  }
  return s
}
const sKey = (label: string, from: string, target: string) => `${label}|${from}|${strictTargetText(target)}`

const leaf = (t: string): string => {
  const parts = t.split(".")
  return parts[parts.length - 1]
}

type Row = {
  truth: number
  analyzer: number
  matched: number
  missingTruth: number
  unexplainedAnalyzer: number
  labelDisagree: number
  examples: { missing: string[]; unexplained: string[]; labelDisagree: string[] }
}
const rows = new Map<string, Row>()
for (const t of ALL) rows.set(t, { truth: 0, analyzer: 0, matched: 0, missingTruth: 0, unexplainedAnalyzer: 0, labelDisagree: 0, examples: { missing: [], unexplained: [], labelDisagree: [] } })

type SRow = { truth: number; analyzer: number; matched: number; missing: number; unexplained: number; ex: { m: string[]; u: string[] } }
const sRows = new Map<string, SRow>()
for (const t of ALL) sRows.set(t, { truth: 0, analyzer: 0, matched: 0, missing: 0, unexplained: 0, ex: { m: [], u: [] } })

const parser = await getParser("kotlin")

// pass 1: analyze, keep the result and the per-file symbol name set
const res = new Map<string, any>()
const perFile: { rel: string; names: Set<string> }[] = []
const corpusNames = new Map<string, number>()
let filesDone = 0
for (const rel of files) {
  const p = path.join(CR, REPO_DIR, rel)
  let content: string
  try { content = readFileSync(p, "utf8") } catch { continue }
  let tree: any
  try { tree = await parser.parse(content, p) } catch { continue }
  if (!tree) continue
  let r: any
  try { r = new RealKotlinAnalyzer().analyze(tree.rootNode, content, p) } catch { tree.delete?.(); continue }
  tree.delete?.()
  filesDone++
  res.set(rel, r)
  const names = new Set<string>()
  for (const s of r.symbols ?? []) {
    names.add(s.name)
    corpusNames.set(s.name, (corpusNames.get(s.name) ?? 0) + 1)
    if (s.ownerName) names.add(`${s.ownerName}.${s.name}`)
  }
  perFile.push({ rel, names })
}

// pass 2: truth needs a live tree, so each file is re-parsed (a kotlinc file
// holds millions of nodes; holding 200 trees is not affordable)
for (const rel of files) {
  if (!res.has(rel)) continue
  const p = path.join(CR, REPO_DIR, rel)
  let content: string
  try { content = readFileSync(p, "utf8") } catch { continue }
  let tree: any
  try { tree = await parser.parse(content, p) } catch { continue }
  if (!tree) continue
  let truth: { label: string; from: string; target: string }[] = []
  try {
    truth = [
      ...deriveTreeEdges(tree.rootNode, "kotlin"),
      ...deriveKotlinEdges(tree.rootNode),
      ...deriveKotlinUsesTruth(tree.rootNode),
      ...deriveKotlinContainsTruth(tree.rootNode),
      ...deriveKotlinReferencesTruth(tree.rootNode),
    ]
  } catch { tree.delete?.(); continue }
  tree.delete?.()

  const analyzer = (res.get(rel)?.relationships ?? []).map((x: any) => ({
    label: String(x.type ?? x.relationshipType ?? ""),
    from: String(x.source ?? ""),
    target: String(x.target ?? ""),
  }))

  const truthPairs = new Map<string, string[]>()
  for (const t of truth) {
    const k = hKey(t.label, t.target)
    const arr = truthPairs.get(k) ?? []
    arr.push(t.label)
    truthPairs.set(k, arr)
  }
  const analyzerPairs = new Map<string, string[]>()
  for (const a of analyzer) {
    const k = hKey(a.label, a.target)
    const arr = analyzerPairs.get(k) ?? []
    arr.push(a.label)
    analyzerPairs.set(k, arr)
  }
  const truthStrict = new Set<string>()
  for (const t of truth) truthStrict.add(sKey(t.label, t.from, t.target))
  const analyzerStrict = new Set<string>()
  for (const a of analyzer) analyzerStrict.add(sKey(a.label, a.from, a.target))

  for (const a of analyzer) {
    const row = rows.get(a.label)
    if (!row) continue
    row.analyzer++
    const tl = truthPairs.get(hKey(a.label, a.target))
    if (tl) {
      row.matched++
      if (tl.length && !tl.includes(a.label)) {
        row.labelDisagree++
        if (row.examples.labelDisagree.length < 4) {
          row.examples.labelDisagree.push(`${rel}: ${a.from} -> ${a.target} analyzer=${a.label} truth=${tl.join("/")}`)
        }
      }
    } else {
      row.unexplainedAnalyzer++
      if (row.examples.unexplained.length < 4) row.examples.unexplained.push(`${rel}: ${a.from} -> ${a.target} (${a.label})`)
    }
    const sr = sRows.get(a.label)!
    sr.analyzer++
    if (truthStrict.has(sKey(a.label, a.from, a.target))) sr.matched++
    else {
      sr.unexplained++
      if (sr.ex.u.length < 4) sr.ex.u.push(`${rel}: ${a.from} -> ${a.target} (${a.label})`)
    }
  }

  const seenTruth = new Set<string>()
  for (const t of truth) {
    const row = rows.get(t.label) ?? rows.get("calls")!
    row.truth++
    const k = hKey(t.label, t.target)
    if (seenTruth.has(k)) continue
    seenTruth.add(k)
    if (!analyzerPairs.has(k)) {
      row.missingTruth++
      if (row.examples.missing.length < 4) row.examples.missing.push(`${rel}: ${t.from} -> ${t.target} (${t.label})`)
    }
    const sr = sRows.get(t.label) ?? sRows.get("calls")!
    sr.truth++
    if (!analyzerStrict.has(sKey(t.label, t.from, t.target))) {
      sr.missing++
      if (sr.ex.m.length < 4) sr.ex.m.push(`${rel}: ${t.from} -> ${t.target} (${t.label})`)
    }
  }
}

// ---------------------------------------------------------------- question 5
const resolve = new Map<string, { n: number; fileLocal: number; corpusLocal: number; none: number; ex: string[] }>()
for (const t of ALL) resolve.set(t, { n: 0, fileLocal: 0, corpusLocal: 0, none: 0, ex: [] })
for (const { rel, names } of perFile) {
  const r = res.get(rel)
  for (const x of r?.relationships ?? []) {
    const label = String(x.type ?? x.relationshipType ?? "")
    const bucket = resolve.get(label)
    if (!bucket) continue
    const s = String(x.source ?? "")
    const g = String(x.target ?? "")
    const sOk = names.has(s) || names.has(leaf(s))
    const tOk = names.has(g) || names.has(leaf(g))
    const sCorpus = corpusNames.has(s) || corpusNames.has(leaf(s))
    const tCorpus = corpusNames.has(g) || corpusNames.has(leaf(g))
    bucket.n++
    if (sOk && tOk) bucket.fileLocal++
    else if (sCorpus && tCorpus) bucket.corpusLocal++
    else {
      bucket.none++
      if (bucket.ex.length < 3) bucket.ex.push(`${rel}: ${label} ${s} -> ${g}`)
    }
  }
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`kotlin oracle comparison — corpus ${REPO_DIR}, ${filesDone}/${files.length} files analyzed`)
console.log(`oracle = differential.ts deriveTreeEdges + 4 kotlin oracles, over the SAME parse`)
console.log(`audited labels for kotlin: ${AUDITED.join(" ")}\n`)

console.log("MATCHING RULE = the harness's own: label + lastSegment(normTarget(target)); source not in the key")
console.log(`${w("type", 14)}${w("truth", 9)}${w("analyzer", 10)}${w("matched", 9)}${w("MISSING", 9)}${w("UNEXPL", 9)}${w("labelDis", 9)}`)
console.log("-".repeat(80))
for (const t of ALL) {
  const r = rows.get(t)!
  console.log(`${w(t, 14)}${w(String(r.truth), 9)}${w(String(r.analyzer), 10)}${w(String(r.matched), 9)}${w(String(r.missingTruth), 9)}${w(String(r.unexplainedAnalyzer), 9)}${w(String(r.labelDisagree), 9)}`)
}
console.log("-".repeat(80))
console.log("MISSING = truth edge with no analyzer edge of that label on that target (a drop)")
console.log("UNEXPL  = analyzer edge with no truth edge of that label on that target\n")

console.log("MATCHING RULE = strict: label + source + target-with-qualifier (source IS in the key)")
console.log(`${w("type", 14)}${w("truth", 9)}${w("analyzer", 10)}${w("matched", 9)}${w("MISSING", 9)}${w("UNEXPL", 9)}`)
console.log("-".repeat(60))
for (const t of ALL) {
  const r = sRows.get(t)!
  console.log(`${w(t, 14)}${w(String(r.truth), 9)}${w(String(r.analyzer), 10)}${w(String(r.matched), 9)}${w(String(r.missing), 9)}${w(String(r.unexplained), 9)}`)
}
console.log("-".repeat(60))

console.log(`\nENDPOINT RESOLUTION`)
console.log(`${w("type", 14)}${w("edges", 9)}${w("fileLocal", 12)}${w("corpusLocal", 13)}${w("neither", 9)}`)
console.log("-".repeat(60))
for (const t of ALL) {
  const r = resolve.get(t)!
  if (!r.n) { console.log(`${w(t, 14)}${w("0", 9)}`); continue }
  console.log(`${w(t, 14)}${w(String(r.n), 9)}${w(String(r.fileLocal), 12)}${w(String(r.corpusLocal), 13)}${w(String(r.none), 9)}`)
}
console.log("-".repeat(60))
console.log("fileLocal = both endpoints are symbols THIS file declares (or their leaf)")
console.log("corpusLocal = not file-local, but both appear in the admitted corpus symbol set")
console.log("neither = at least one endpoint binds to nothing (includes library/stdlib targets)\n")

for (const t of ALL) {
  const r = rows.get(t)!
  if (r.examples.missing.length) console.log(`MISSING ${t}: ${r.examples.missing.join(" | ")}`)
  if (r.examples.unexplained.length) console.log(`UNEXPL  ${t}: ${r.examples.unexplained.join(" | ")}`)
  if (r.examples.labelDisagree.length) console.log(`LABELDIS ${t}: ${r.examples.labelDisagree.join(" | ")}`)
  const sr = sRows.get(t)!
  if (sr.ex.m.length) console.log(`STRICT-MISSING ${t}: ${sr.ex.m.join(" | ")}`)
}
for (const t of ALL) {
  const r = resolve.get(t)!
  if (r.ex.length) console.log(`UNRESOLVED ${t}: ${r.ex.join(" | ")}`)
}
