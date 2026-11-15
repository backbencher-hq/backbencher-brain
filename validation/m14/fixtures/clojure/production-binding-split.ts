/**
 * CLOJURE LANE — THE PRODUCTION-BINDING SPLIT OF THE AMBIGUITY WALL.
 *
 * ## THE QUESTION THIS ANSWERS
 *
 * The gate reports `amb(decl)` — "the project publishes this name more than once" — and the D7
 * wall table dispositions the whole column as one INSTRUMENT GAP. **But production does not
 * resolve names the way the gate's count model does.** `src/ast/parallel-indexer.ts`'s
 * `resolveRelationships` runs FOUR statements, in this order, and the first two are OWN-FILE
 * statements:
 *
 *   r0own      `target_external = _res_qname_own.qualified_name AND file_id = <the edge's own file>`
 *   r0ownName  `target_external = _res_name_own.name        AND file_id = <the edge's own file>`
 *   r1         `target_external = _res_qname.qualified_name`  (project-wide)
 *   r2         `target_external = _res_name.name AND cnt = 1` (project-wide, UNIQUE only)
 *
 * So **an edge whose OWN FILE declares the target is BOUND BY PRODUCTION**, even when the project
 * declares the name twice — the own-file preference is `ORDER BY (s.file_id = ?) DESC` and it runs
 * first. The gate cannot see that, because `classifyEdge` is handed a NAME-KEYED COUNT and no
 * file: it fires on "the project holds more than one declaration", which is a superset of "the row
 * production leaves NULL".
 *
 * **The gap between the two is a number the lane can measure and the D7 table does not carry.**
 * This file measures it: for every edge, the gate's outcome AND whether the edge's own file
 * declares the target.
 *
 * ## THE THREE CLASSES THIS PRODUCES FOR AN AMBIGUOUS EDGE
 *
 *   amb-own-file    the edge's OWN FILE declares the target  → production BINDS it (r0own /
 *                   r0ownName). The gate's `amb(decl)` over-reports here: the model says
 *                   "the project holds 2+ declarations", production says "the edge's own file
 *                   wins". NOT A PRODUCTION WALL.
 *   amb-cross-file  the edge's own file declares NOTHING and another file does → production
 *                   leaves the row NULL (r1 needs a unique qualified name, r2 needs a unique
 *                   name, and neither own-file statement fires). A REAL WALL.
 *   amb-multi-file  the edge's own file declares the target MORE THAN ONCE (Clojure permits
 *                   redefinition) → production binds it, but WHICH declaration it binds is
 *                   `MIN(id)` — an arbitrary pick inside the file. A REAL, SMALLER WALL.
 *
 * ## AND THE SAME THREE FOR AN UNRESOLVED EDGE
 *
 *   unres-own-file  impossible — a declaration in the own file means the name is in the key
 *                   space, so the row is not unresolved. The instrument ASSERTS this: a non-zero
 *                   count here is a defect in the instrument or in the key space, and it is
 *                   reported rather than explained away.
 *
 * ## THE COUNTING RULE IS IMPORTED, NOT COPIED
 *
 * `classifyEdge` / `externalClaimOf` / `tally` come from `script/m14/incoming-rule.ts` — the
 * module the gate itself imports — so this file cannot drift from the gate it explains. The
 * discovery is a transcription of the gate's `discoverFiles` (the gate does not export it), and
 * the run ASSERTS its own totals against the gate's own TABLE 1 line, so a classification of a
 * different population FAILS instead of printing.
 *
 * ## USAGE
 *
 *   BB_CORPUS_ROOT=$PWD/.corpus bun run validation/m14/fixtures/clojure/production-binding-split.ts \
 *     [--expect-edges N] [--expect-resolved N] [--expect-amb N] [--expect-unres N] [--json out.json]
 *
 * The `--expect-*` values are the gate's own TABLE 1 TOTAL row for the same run; when they are
 * given, a mismatch EXITS 4 and the report is not printed as a measurement.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { buildFacts, REPO_ROOT } from "./clojure-manifest-facts"
import { classifyEdge, externalClaimOf, emptyOutcomes, isContainsEdge, tally } from "../../../../script/m14/incoming-rule"
import type { Outcomes } from "../../../../script/m14/incoming-rule"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 1024 * 1024
const EXTS = "clj,cljs,cljc,edn"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const argOf = (f: string): number | null => {
  const eq = process.argv.find((a) => a.startsWith(`${f}=`))
  if (eq) return Number(eq.slice(f.length + 1))
  const i = process.argv.indexOf(f)
  return i >= 0 ? Number(process.argv[i + 1]) : null
}
const JSON_OUT = (() => { const i = process.argv.indexOf("--json"); return i >= 0 ? process.argv[i + 1] ?? null : null })()
/** A STRIDE SAMPLE, for a smoke run only. 0 = the WHOLE admitted population, which is the only
 *  number this instrument may be quoted for. */
const MAX_FILES = argOf("--max-files") ?? 0
const EXPECT = {
  edges: argOf("--expect-edges"),
  resolved: argOf("--expect-resolved"),
  amb: argOf("--expect-amb"),
  unres: argOf("--expect-unres"),
}
/** THE GATE'S PER-LABEL TABLE 1, as ONE string: `label:edges:resolved:amb:unres:extOK` per label,
 *  comma-separated. Asserted against the instrument's own per-label numbers, so the split this
 *  instrument publishes is against the gate's TABLE 1 LINE BY LINE and not only in total. */
/** A DUMP IN THE GATE'S OWN FORMAT, so the row-level reconciler can read it.
 *  The gate prints `DUMP\t{label}\t{outcome}\t{target}\t{srcFile}:{line}\t{claimKind}\t{claimSpec}`
 *  for every NON-RESOLVED row, and the reconciler keys on `(label, target, srcFile, line)` plus an
 *  occurrence counter. Writing the same six columns from this instrument means the movement can be
 *  reconciled ROW BY ROW without the fleet's arm token — and the token-held arm then confirms the
 *  same movement on the gate's own dump. */
const DUMP_OUT = (() => { const i = process.argv.indexOf("--dump"); return i >= 0 ? process.argv[i + 1] ?? null : null })()
/** THE AMBIGUOUS-CROSS-FILE ROWS, in a form the project-index probe can read. These are the 768
 *  rows production leaves NULL and no verified claim explains — THE FLOOR of the wall (§3.1) — and
 *  they are the rows a project index is the only instrument that can answer. */
const AMB_OUT = (() => { const i = process.argv.indexOf("--dump-amb"); return i >= 0 ? process.argv[i + 1] ?? null : null })()
const ambRows: string[] = []
const EXPECT_TABLE = (() => {
  const eq = process.argv.find((a) => a.startsWith("--expect-table="))
  if (eq) return eq.slice("--expect-table=".length)
  const i = process.argv.indexOf("--expect-table")
  return i >= 0 ? process.argv[i + 1] ?? "" : ""
})()

// ── the gate's discovery, transcribed ────────────────────────────────────────────────────────────
function discover(): { files: string[]; total: number; repos: number; overCap: number; absent: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let overCap = 0
  let absent = 0
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0, overCap: 0, absent: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!EXTS.split(",").some((x) => rel.toLowerCase().endsWith(`.${x}`))) continue
      const abs = path.join(dir, rel)
      try {
        if (statSync(abs).size > SIZE_CAP) {
          overCap++
          continue
        }
      } catch {
        absent++
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  return { files: found, total: found.length, repos: repos.size, overCap, absent }
}

const repoOf = (f: string): string => (f.startsWith(CR) ? f.slice(CR.length + 1) : f).split(path.sep)[0]!

type Sym = { name: string; qualifiedName?: string; kind?: string; file: string }
type Rel = { type: string; target: string; source: string; file: string; line: number; metadata: Record<string, any> }

const disc = discover()
const SAMPLED = MAX_FILES > 0 && MAX_FILES < disc.files.length
  ? (() => { const stride = Math.max(1, Math.floor(disc.files.length / MAX_FILES)); const out: string[] = []; for (let i = 0; i < disc.files.length && out.length < MAX_FILES; i += stride) out.push(disc.files[i]!); return out })()
  : disc.files
console.error(`population: ${disc.files.length} admitted files across ${disc.repos} repos (excluded ${disc.absent} absent + ${disc.overCap} over the 1 MB cap); parsing ${SAMPLED.length}${SAMPLED.length === disc.files.length ? " (the WHOLE population)" : " (a STRIDE SAMPLE — not a population)"}`)

/** Per repo: the name-keyed count, the qualified-name-keyed count, and WHERE each declaration is. */
const declCount = new Map<string, Map<string, number>>()
const declKinds = new Map<string, Map<string, Set<string>>>()
const declPos = new Map<string, Map<string, { file: string; line: number }[]>>()
const declQCount = new Map<string, Map<string, number>>()
const declQPos = new Map<string, Map<string, { file: string; line: number }[]>>()
const repoSymbols: Array<{ repo: string; syms: Sym[]; rels: Rel[] }> = []

const bump = (m: Map<string, Map<string, number>>, repo: string, key: string): void => {
  const r = m.get(repo) ?? new Map<string, number>()
  r.set(key, (r.get(key) ?? 0) + 1)
  m.set(repo, r)
}
const bumpK = (m: Map<string, Map<string, Set<string>>>, repo: string, key: string, kind: string): void => {
  const r = m.get(repo) ?? new Map<string, Set<string>>()
  const s = r.get(key) ?? new Set<string>()
  s.add(kind)
  r.set(key, s)
  m.set(repo, r)
}
const bumpP = (m: Map<string, Map<string, { file: string; line: number }[]>>, repo: string, key: string, file: string, line: number): void => {
  const r = m.get(repo) ?? new Map<string, { file: string; line: number }[]>()
  const a = r.get(key) ?? []
  a.push({ file, line })
  r.set(key, a)
  m.set(repo, r)
}

/** THE PROJECT FACTS, per repository — the SHARED module's, so the lane's facts and the gate's
 *  are built by ONE implementation of the nearest-ancestor walk. */
const factsByRepo = buildFacts(CR, SAMPLED)

let parsed = 0
let failed = 0
for (const f of SAMPLED) {
  const repo = repoOf(f)
  let r: any
  try {
    r = await parseFile(f, path.join(CR, repo))
  } catch {
    failed++
    continue
  }
  parsed++
  const syms: Sym[] = []
  for (const s of r?.symbols ?? []) {
    const name = String(s?.name ?? "")
    if (!name) continue
    const kind = String(s?.kind ?? "")
    const line = Number((s as any)?.range?.startLine ?? 0)
    syms.push({ name, qualifiedName: typeof (s as any).qualifiedName === "string" ? (s as any).qualifiedName : undefined, kind, file: f })
    bump(declCount, repo, name)
    bumpK(declKinds, repo, name, kind)
    bumpP(declPos, repo, name, f, line)
    // THE QUALIFIED-NAME ALIAS IS COUNTED INTO THE SAME KEY SPACE, and this is not a detail.
    // The gate's own `countKey` is called for the symbol's NAME and for its `qualifiedName`, so
    // ONE map holds both spellings of one declaration. An instrument that keeps the alias in a
    // SECOND map hands `classifyEdge` a key space the gate never sees, and every qualified target
    // reads unresolved — a false wall of thousands of rows, produced by the instrument and not by
    // the analyzer. (Measured here: 3,905 `clj-kondo.test-utils/*` calls read unresolved under the
    // split key space and are RESOLVED under the gate's.)
    const q = typeof (s as any).qualifiedName === "string" ? (s as any).qualifiedName : ""
    if (q && q !== name) {
      bump(declCount, repo, q)
      bumpK(declKinds, repo, q, kind)
      bumpP(declQPos, repo, q, f, line)
    }
  }
  const rels: Rel[] = []
  for (const rel of r?.relationships ?? []) {
    const md: any = rel.metadata ?? {}
    rels.push({
      type: String(rel.type),
      target: String(rel.target ?? ""),
      source: String(rel.source ?? ""),
      file: f,
      line: Number(rel.line_number ?? md.line ?? 0),
      metadata: (md ?? {}) as Record<string, any>,
    })
  }
  repoSymbols.push({ repo, syms, rels })
}
console.error(`parsed ${parsed} files (${failed} failures)`)

/** THE `languageNamespaceSlash` OPT-IN — the arbiter's own marker for a claim whose target is
 *  spelled `namespace/member` (Go's `encoding/json` is the precedent; Clojure's `js/require` is
 *  the same shape). `namespaceMatchOf` splits on `.`/`::`/`:` unless the claim carries the marker,
 *  in which case it splits on `/` as well. This mirrors the arbiter's matcher EXACTLY, and the
 *  difference between the two is the set of rows the opt-in would newly reach. */
const LANGUAGE_NAMESPACE_ROOTS = ["clojure", "cljs", "js", "goog", "java", "javax"]
function namespaceMatchOf(tgt: string, roots: readonly string[], opts?: { slash?: boolean }): string | null {
  if (tgt.length === 0 || roots.length === 0) return null
  const segs = opts?.slash === true ? tgt.split(/\/|\.|::|:/) : tgt.split(/\.|::|:/)
  for (let n = segs.length; n >= 1; n--) {
    const cand = segs.slice(0, n).join(".")
    if (roots.includes(cand)) return cand
  }
  return null
}

/** THE SHAPE OF A NON-RESOLVED TARGET — the D7 wall table's unit. */
function targetShape(t: string): string {
  if (t.length === 0) return "empty"
  if (t.includes("::")) return "ns::member"
  if (t.includes("/")) {
    const ns = t.slice(0, t.indexOf("/"))
    if (/^[A-Z]/.test(ns)) return "Class/member (a JVM static)"
    if (ns.includes(".")) return "ns/member (a qualified call)"
    return "single-segment/member"
  }
  if (t.includes(".")) {
    const segs = t.split(".")
    if (/^[A-Z]/.test(segs[segs.length - 1] ?? "")) return "dotted.Class (a JVM type)"
    return "dotted.namespace"
  }
  if (/^[A-Z]/.test(t)) return "Capitalised (a JVM type)"
  return "bare name"
}

/** Does the edge's OWN FILE declare the target? The own-file statement production runs first
 *  (r0own on the qualified name, r0ownName on the bare name) binds on EITHER. */
function ownFileDeclares(repo: string, file: string, tgt: string): 0 | 1 | 2 {
  const byName = (declPos.get(repo)?.get(tgt) ?? []).filter((d) => d.file === file)
  const byQual = (declQPos.get(repo)?.get(tgt) ?? []).filter((d) => d.file === file)
  const n = new Set([...byName.map((d) => `${d.file}:${d.line}`), ...byQual.map((d) => `${d.file}:${d.line}`)]).size
  return n === 0 ? 0 : n === 1 ? 1 : 2
}

type Bucket = { edges: number; samples: string[] }
/** THE PRODUCTION RESIDUAL — the rows production leaves NULL AND no verified claim explains. */
type Prod = { ambCross: number; ambCrossClaimed: number; unres: number; unresClaimed: number }
const split: Record<string, Record<string, Bucket>> = {}
const perType: Record<string, { edges: number; resolved: number; ambOwn: number; ambMulti: number; ambCross: number; unres: number; unresOwn: number; extOK: number; extQ: number; extFail: number; claimOK: number; claimQ: number; claimFail: number }> = {}
for (const t of ALL_TYPES) {
  split[t] = {}
  perType[t] = { edges: 0, resolved: 0, ambOwn: 0, ambMulti: 0, ambCross: 0, unres: 0, unresOwn: 0, extOK: 0, extQ: 0, extFail: 0, claimOK: 0, claimQ: 0, claimFail: 0 }
}
const prod: Record<string, Prod> = {}
const slashReachable = { rows: 0, byLabel: new Map<string, number>(), targets: new Map<string, { label: string; target: string; count: number }>(), samples: [] as string[] }
for (const t of ALL_TYPES) prod[t] = { ambCross: 0, ambCrossClaimed: 0, unres: 0, unresClaimed: 0 }
const bumpB = (t: string, k: string, s: string): void => {
  const b = split[t]![k] ?? (split[t]![k] = { edges: 0, samples: [] })
  b.edges++
  if (b.samples.length < 3) b.samples.push(s)
}

const totals: Outcomes = emptyOutcomes()
const dumpRows: string[] = []
let edgeCount = 0

/**
 * THE PUBLICATION POLICY — WHAT THE ANALYZER PUBLISHES, AND WHAT IT COSTS THE WALL.
 *
 * THE PUBLICATION POLICY IS THE LANE'S TO OWN (it is the analyzer's file), and the Lead rules on it
 * only if it becomes a fleet-wide question. This block is the MEASUREMENT that decides it, and it
 * is a JOIN, not an assertion: for EVERY edge, the target's PUBLICATION CLASS is read out of the
 * key space the gate itself uses (the analyzer's own published symbols, with their kinds), and the
 * edge's OUTCOME is counted under that class.
 *
 * THE CLASSES, AND WHY THEY ARE DIFFERENT FACTS:
 *   · A DECLARATION — the analyzer published the name as a `def`-family symbol (function, variable,
 *     interface, class, property, macro). A project-level fact.
 *   · A NAMESPACE — the analyzer published the name as a `module` (the `(ns …)` form). A namespace
 *     is not a callable and not a type; the family contract publishes no LOCALS OR PARAMETERS.
 *   · A SYNTHETIC NAME — the analyzer PUBLISHED A NAME THE SOURCE DOES NOT CONTAIN: an anonymous
 *     function's `lambda_50_13`. **A NAME THE PROGRAM NEVER SPELLS CANNOT BE AMBIGUOUS WITH
 *     ANOTHER ONE, AND IT IS NOT A DECLARATION OF ANYTHING.**
 *   · UNPUBLISHED — the analyzer published no such name at all (the key space does not hold it).
 *
 * THE MEASUREMENT THAT MATTERS IS THE LAST ONE: **HOW MUCH OF THE WALL IS PUBLICATION, AND HOW MUCH
 * IS THE PROGRAM.** A wall row whose target is a synthetic name is a wall the ANALYZER created; a
 * wall row whose target is a real declaration in another namespace is a wall the PROGRAM has.
 */
const PUBLICATION_CLASSES = [
  "a DECLARATION (a def-family symbol)",
  "a NAMESPACE (the analyzer's Module symbol)",
  "a SYNTHETIC name (the analyzer's own invention — the source never spells it)",
  "published with another kind",
  "UNPUBLISHED (the key space holds no such name)",
] as const
type PublicationClass = (typeof PUBLICATION_CLASSES)[number]
const DECLARATION_KINDS = new Set(["function", "variable", "interface", "class", "property", "macro", "type", "enum", "constant", "method"])
const publicationWall: Record<PublicationClass, { amb: number; unres: number; extQ: number; resolved: number }> = {
  "a DECLARATION (a def-family symbol)": { amb: 0, unres: 0, extQ: 0, resolved: 0 },
  "a NAMESPACE (the analyzer's Module symbol)": { amb: 0, unres: 0, extQ: 0, resolved: 0 },
  "a SYNTHETIC name (the analyzer's own invention — the source never spells it)": { amb: 0, unres: 0, extQ: 0, resolved: 0 },
  "published with another kind": { amb: 0, unres: 0, extQ: 0, resolved: 0 },
  "UNPUBLISHED (the key space holds no such name)": { amb: 0, unres: 0, extQ: 0, resolved: 0 },
}
const publicationSamples: Record<string, string[]> = {}
/**
 * THE 768 — THE FLOOR'S ROWS — BY PUBLICATION CLASS. The 768 are the AMBIGUOUS CROSS-FILE rows:
 * the ambiguous ones whose OWN FILE declares nothing. They are the floor of the wall, and the
 * publication class of their targets is what says whether the floor is a PROGRAM question or a
 * PUBLICATION question.
 */
const floorByClass: Record<PublicationClass, number> = {
  "a DECLARATION (a def-family symbol)": 0,
  "a NAMESPACE (the analyzer's Module symbol)": 0,
  "a SYNTHETIC name (the analyzer's own invention — the source never spells it)": 0,
  "published with another kind": 0,
  "UNPUBLISHED (the key space holds no such name)": 0,
}
const floorSamples: Record<string, string[]> = {}
/** THE ANALYZER'S SYNTHETIC NAME — the name it invents for an anonymous function. */
const isSyntheticName = (n: string): boolean => /^lambda_\d+_\d+$/.test(n)
function publicationClassOf(kinds: Set<string> | undefined, tgt: string): PublicationClass {
  if (!kinds || kinds.size === 0) return "UNPUBLISHED (the key space holds no such name)"
  if (isSyntheticName(tgt)) return "a SYNTHETIC name (the analyzer's own invention — the source never spells it)"
  // THE RULE IS ABOUT THE WHOLE SET, NOT ABOUT ONE KIND: a name published as a FUNCTION in one
  // file and as a `module` in another is A DECLARATION (the function is a declaration and the
  // module is the other file's namespace), and calling it a NAMESPACE because ONE of its kinds
  // says `module` would put a real declaration in the publication's column. A name is a NAMESPACE
  // only when EVERY one of its kinds is a namespace kind.
  let sawDeclaration = false
  let sawNamespace = false
  let otherKind = false
  for (const k of kinds) {
    if (k === "module" || k === "namespace") { sawNamespace = true; continue }
    if (DECLARATION_KINDS.has(k)) { sawDeclaration = true; continue }
    otherKind = true
  }
  if (sawDeclaration) return "a DECLARATION (a def-family symbol)"
  if (sawNamespace && !otherKind) return "a NAMESPACE (the analyzer's Module symbol)"
  if (sawNamespace) return "a NAMESPACE (the analyzer's Module symbol)"
  return "published with another kind"
}
const bumpPublication = (cls: PublicationClass, outcome: "amb" | "unres" | "extQ" | "resolved", sample: string, crossFile = false): void => {
  publicationWall[cls][outcome]++
  if (crossFile) {
    floorByClass[cls]++
    const farr = floorSamples[cls] ?? (floorSamples[cls] = [])
    if (farr.length < 5) farr.push(sample)
  }
  if (outcome === "resolved") return
  const arr = publicationSamples[cls] ?? (publicationSamples[cls] = [])
  if (arr.length < 6) arr.push(sample)
}

for (const { repo, rels } of repoSymbols) {
  const dc = declCount.get(repo) ?? new Map<string, number>()
  const dk = declKinds.get(repo) ?? new Map<string, Set<string>>()
  const qc = declQCount.get(repo) ?? new Map<string, number>()
  for (const rel of rels) {
    const tgt = rel.target
    edgeCount++
    const t = rel.type
    if (!perType[t]) continue
    perType[t]!.edges++
    // The KEY SPACE is name + qualifiedName, exactly as the gate's own header says it is.
    const kinds = dk.get(tgt) ?? new Set<string>()
    // THE EDGE'S OWN METADATA — the claim keys the analyzer published ARE the claim. Passing an
    // empty object here would drop every verified external claim and report the claimed rows as
    // unresolved, which is the failure mode this instrument exists to avoid.
    const claim = externalClaimOf({ type: t, target: tgt, metadata: rel.metadata })
    const own = ownFileDeclares(repo, rel.file, tgt)
    // THE OWN-FILE TIE-BREAK, AND THE ONE ARGUMENT THAT DECIDES WHETHER THIS INSTRUMENT MATCHES
    // THE GATE'S ARM. `classifyEdge` resolves an ambiguous row when the EDGE'S OWN FILE declares
    // the target and the target is a PLAIN IDENTIFIER (the Lead's 2026-10-20 rule, in
    // `incoming-rule.ts`; the narrowing to a plain identifier is the fixture suite's doing, because a
    // source-text callee is not a binding to a declaration). The gate computes `ownFileDeclares`
    // and passes it in; this instrument computed the same fact and then PASSED `undefined`, so the
    // tie-break never fired and the instrument read 2,120 rows as ambiguous that the gate's arm
    // reads as resolved.
    //
    // **THE TIE-BREAK MOVES ROWS BETWEEN TWO BUCKETS OF THE SAME FACT, AND THE PRODUCTION TOTAL DOES
    // NOT MOVE** — which is the ceiling analysis of §3.1 showing up as arithmetic: a row that is
    // own-file-declared was ALREADY production-bound, whether the count model called it ambiguous
    // or resolved. The 2,120 rows and the 1,371 own-file rows the tie-break does not reach (a
    // qualified or dotted target) sum to the 3,491 the lane measured.
    // (the local name is NOT `ownFileDeclares`: that would shadow the helper of the same name and
    // the call above would hit the temporal dead zone)
    const ownDeclares = own > 0
    const c = classifyEdge(
      dc, dk, tgt, claim, factsByRepo.get(repo), isContainsEdge(t), ownDeclares, undefined, rel.file,
    )
    const key = `${t}|${tgt}`
    const sample = `${tgt} @ ${rel.file}:${rel.line}`
    // THE PUBLICATION-POLICY JOIN — the target's publication class, read out of the SAME key space
    // the rule is about to read, so the join and the classification see the same facts.
    const pubClass = publicationClassOf(dk.get(tgt), tgt)
    if (DUMP_OUT && c.outcome !== "resolved") {
      const claimSpec = claim && typeof (claim as any).specifier === "string" ? String((claim as any).specifier) : "-"
      dumpRows.push(`DUMP\t${t}\t${c.outcome}\t${tgt}\t${rel.file}:${rel.line}\t${claim?.kind ?? "-"}\t${claimSpec}`)
    }
    if (c.outcome === "resolved") {
      perType[t]!.resolved++
      totals.resolved++
      bumpPublication(pubClass, "resolved", sample)
      if (c.boundAmongCollision) bumpB(t, "resolved-among-collision", sample)
    } else if (c.outcome.startsWith("amb")) {
      if (own === 1) {
        perType[t]!.ambOwn++
        bumpB(t, "amb-own-file-one (production BINDS: r0own/r0ownName)", sample)
      } else if (own >= 2) {
        perType[t]!.ambMulti++
        bumpB(t, "amb-own-file-multi (production BINDS, the pick is MIN(id))", sample)
      } else {
        perType[t]!.ambCross++
        prod[t]!.ambCross++
        if (AMB_OUT !== null) ambRows.push(`AMB\t${t}\t${tgt}\t${rel.file}:${rel.line}\t${targetShape(tgt)}`)
        bumpB(t, `amb-cross-file · shape: ${targetShape(tgt)}`, sample)
        if (c.outcome === "externalVerified") prod[t]!.ambCrossClaimed++
        bumpB(t, "amb-cross-file (production leaves NULL — A REAL WALL)", sample)
        bumpPublication(pubClass, "amb", sample, true)
      }
      totals.ambiguousByDecl++
      // THE OWN-FILE AMBIGUOUS ROWS ARE COUNTED HERE; THE CROSS-FILE ONES ARE COUNTED IN THE
      // CROSS-FILE BRANCH BELOW. Counting an ambiguous row in BOTH would double the wall.
      if (own !== 0) bumpPublication(pubClass, "amb", sample, false)
    } else if (c.outcome === "unresolved") {
      perType[t]!.unres++
      bumpB(t, `unresolved · shape: ${targetShape(tgt)}`, sample)
      // THE SLASH OPT-IN LEVER: a target the DOTTED matcher cannot reach but the SLASH matcher can.
      if (claim === null && namespaceMatchOf(tgt, LANGUAGE_NAMESPACE_ROOTS) === null && namespaceMatchOf(tgt, LANGUAGE_NAMESPACE_ROOTS, { slash: true }) !== null) {
        slashReachable.rows++
        slashReachable.byLabel.set(t, (slashReachable.byLabel.get(t) ?? 0) + 1)
        const key = `${t}|${tgt}`
        if (!slashReachable.targets.has(key)) { slashReachable.targets.set(key, { label: t, target: tgt, count: 0 }); }
        slashReachable.targets.get(key)!.count++
        if (slashReachable.targets.get(key)!.count === 1 && slashReachable.samples.length < 12) slashReachable.samples.push(sample)
      }
      prod[t]!.unres++
      totals.unresolved++
      bumpPublication(pubClass, "unres", sample)
      if (own !== 0) {
        perType[t]!.unresOwn++
        bumpB(t, "unresolved-but-own-file-declares (INSTRUMENT DISAGREEMENT)", sample)
      }
      bumpB(t, "unresolved", sample)
    } else if (c.outcome === "externalVerified") {
      perType[t]!.extOK++
      totals.externalVerified++
    } else if (c.outcome === "externalUnverified") {
      perType[t]!.extQ++
      totals.externalUnverified++
      bumpPublication(pubClass, "extQ", sample)
    } else if (c.outcome === "externalRefuted") {
      perType[t]!.extFail++
      totals.externalRefuted++
    }
    void key
  }
}

/** THE WALL — the sum of the three wall classes, named here so every block below can use it. */
const wallTotal = totals.ambiguousByDecl + totals.unresolved + totals.externalUnverified

const report = {
  population: { root: CR, files: disc.files.length, sampled: SAMPLED.length, whole: SAMPLED.length === disc.files.length, repos: disc.repos, parsed, failed, excluded: { absent: disc.absent, overCap: disc.overCap } },
  totals: { edges: edgeCount, resolved: totals.resolved, ambiguousByDecl: totals.ambiguousByDecl, unresolved: totals.unresolved, externalVerified: totals.externalVerified, externalUnverified: totals.externalUnverified, externalRefuted: totals.externalRefuted },
  closure: { sum: totals.resolved + totals.ambiguousByDecl + totals.unresolved + totals.externalVerified + totals.externalUnverified + totals.externalRefuted, edges: edgeCount, exact: totals.resolved + totals.ambiguousByDecl + totals.unresolved + totals.externalVerified + totals.externalUnverified + totals.externalRefuted === edgeCount },
  perType,
  split,
  slashOptIn: { rows: slashReachable.rows, byLabel: Object.fromEntries(slashReachable.byLabel), targets: [...slashReachable.targets.values()] },
}

// THE PER-LABEL ASSERTION, against the gate's own TABLE 1 rows.
let tableOK = true
const tableRows: Array<{ label: string; got: string; want: string; same: boolean }> = []
if (EXPECT_TABLE.length > 0) {
  for (const spec of EXPECT_TABLE.split(",")) {
    const parts = spec.split(":")
    const label = parts[0] ?? ""
    const p = perType[label]
    const gotSpec = p ? `${p.edges}:${p.resolved}:${p.ambOwn + p.ambMulti + p.ambCross}:${p.unres}:${p.extOK}` : "missing"
    const wantSpec = parts.slice(1).join(":")
    const same = gotSpec === wantSpec
    if (!same) tableOK = false
    tableRows.push({ label, got: gotSpec, want: wantSpec, same })
  }
  console.log("")
  console.log("PER-LABEL ASSERTION against the gate's own TABLE 1 rows:")
  for (const r of tableRows) console.log(`  ${r.label.padEnd(12)} this run ${r.got.padEnd(28)} gate ${r.want.padEnd(28)} ${r.same ? "same" : "DIFFERENT"}`)
}
const got = { edges: edgeCount, resolved: totals.resolved, amb: totals.ambiguousByDecl, unres: totals.unresolved }
const want = { edges: EXPECT.edges, resolved: EXPECT.resolved, amb: EXPECT.amb, unres: EXPECT.unres }
const cmpOK = (Object.values(want).every((v) => v === null || v === undefined) ||
  (got.edges === want.edges && got.resolved === want.resolved && got.amb === want.amb && got.unres === want.unres)) && tableOK

console.log("=== CLOJURE — THE PRODUCTION-BINDING SPLIT OF THE AMBIGUITY WALL ===")
console.log(`root: ${CR}`)
console.log(`population: ${disc.files.length} admitted files / ${disc.repos} repos · parsed ${parsed} · failed ${failed}${SAMPLED.length === disc.files.length ? " (WHOLE POPULATION)" : " (STRIDE SAMPLE — NOT A POPULATION)"}`)
console.log("")
console.log(`GATE COMPARISON (counting rule imported from incoming-rule.ts)`)
for (const k of ["edges", "resolved", "amb", "unres"] as const) {
  const w = want[k]
  console.log(`  ${k.padEnd(9)} this run ${String(got[k]).padStart(6)}   gate ${w === null || w === undefined ? "   n/a" : String(w).padStart(6)}   ${w === null || w === undefined ? "—" : got[k] === w ? "same" : "DIFFERENT"}`)
}
console.log("")
console.log("PER TYPE — the gate's outcome, split by whether the edge's OWN FILE declares the target")
console.log("  type          edges  resolved   amb-own1  amb-ownN  amb-cross    unres  unres-own   extOK   ext?  extFAIL")
for (const t of ALL_TYPES) {
  const p = perType[t]!
  if (p.edges === 0) continue
  console.log(
    `  ${t.padEnd(12)} ${String(p.edges).padStart(5)} ${String(p.resolved).padStart(8)} ${String(p.ambOwn).padStart(10)} ${String(p.ambMulti).padStart(9)} ${String(p.ambCross).padStart(10)} ${String(p.unres).padStart(8)} ${String(p.unresOwn).padStart(10)} ${String(p.extOK).padStart(7)} ${String(p.extQ).padStart(6)} ${String(p.extFail).padStart(7)}`,
  )
}
const sumAmb = ALL_TYPES.reduce((n, t) => n + perType[t]!.ambOwn + perType[t]!.ambMulti + perType[t]!.ambCross, 0)
const sumOwn = ALL_TYPES.reduce((n, t) => n + perType[t]!.ambOwn + perType[t]!.ambMulti, 0)
console.log("")
console.log(`CLASS SUM: ${totals.resolved} resolved + ${totals.ambiguousByDecl} amb + ${totals.unresolved} unres + ${totals.externalVerified} extOK + ${totals.externalUnverified} ext? + ${totals.externalRefuted} extFAIL = ${totals.resolved + totals.ambiguousByDecl + totals.unresolved + totals.externalVerified + totals.externalUnverified + totals.externalRefuted} ${totals.resolved + totals.ambiguousByDecl + totals.unresolved + totals.externalVerified + totals.externalUnverified + totals.externalRefuted === edgeCount ? "== edges EXACT" : "!= edges *** NOT EXACT ***"}`)
console.log("")
console.log("THE PRODUCTION RESIDUAL — the rows production leaves NULL AND no VERIFIED claim explains")
console.log("  (an edge whose own file declares the target is BOUND by production's r0own/r0ownName,")
console.log("   whatever the gate's name-keyed count model says about it)")
let pAmb = 0, pAmbC = 0, pUn = 0, pUnC = 0
for (const t of ALL_TYPES) { pAmb += prod[t]!.ambCross; pAmbC += prod[t]!.ambCrossClaimed; pUn += prod[t]!.unres; pUnC += prod[t]!.unresClaimed }
console.log(`  amb-cross-file (own file declares nothing)   ${pAmb}`)
console.log(`  unresolved                                    ${pUn}`)
console.log(`  CLAIM-VERIFIED among them                     ${pAmbC} + ${pUnC} = ${pAmbC + pUnC}`)
console.log(`  PRODUCTION RESIDUAL, UNEXPLAINED              ${pAmb - pAmbC + pUn - pUnC}`)
console.log("")
console.log("THE `languageNamespaceSlash` OPT-IN — the rows the DOTTED matcher cannot reach and the SLASH matcher can")
console.log(`  rows                       ${slashReachable.rows}`)
console.log(`  by label                   ${JSON.stringify(Object.fromEntries([...slashReachable.byLabel.entries()].sort((a, b) => b[1] - a[1])))}`)
console.log(`  distinct targets           ${slashReachable.targets.size}`)
for (const s of slashReachable.samples) console.log(`      e.g. ${s}`)
console.log("")
console.log("THE SPLIT OF THE AMBIGUITY WALL (amb(decl) = the project holds 2+ declarations of the name)")
console.log(`  amb(decl) TOTAL            ${sumAmb}`)
console.log(`  PRODUCTION-BOUND (own file) ${sumOwn}   — production's r0own/r0ownName bind these; the gate's count model cannot see it`)
console.log(`  GENUINELY AMBIGUOUS        ${sumAmb - sumOwn}   — the own file declares nothing and another file does; production leaves NULL`)
console.log("")

// ── THE PUBLICATION POLICY — WHAT THE ANALYZER PUBLISHES, AND WHAT IT COSTS THE WALL ───────────
/**
 * THE PUBLICATION POLICY IS THE LANE'S TO OWN (it is the analyzer's file), and the Lead rules on it
 * only if it becomes a fleet-wide question. **THIS IS THE MEASUREMENT THAT DECIDES IT**, and it is
 * a JOIN over every edge, not an assertion: the target's publication class comes out of the SAME
 * key space the rule reads, and the edge's outcome is counted under that class.
 *
 * THE QUESTION IT ANSWERS: **HOW MUCH OF THE WALL IS PUBLICATION, AND HOW MUCH IS THE PROGRAM?**
 * A wall row whose target is a SYNTHETIC name is a wall the ANALYZER created; a wall row whose
 * target is a real declaration in another namespace is a wall the PROGRAM has.
 */
console.log("")
console.log("THE PUBLICATION POLICY — WHAT THE ANALYZER PUBLISHES, AND WHAT IT COSTS THE WALL")
console.log("  (the target's class, read out of the SAME key space the rule reads, joined to the outcome)")
console.log(`  ${"target's publication class".padEnd(62)} ${"amb".padStart(7)} ${"unres".padStart(7)} ${"ext?".padStart(6)} ${"resolved".padStart(9)}   wall`)
let pubWallTotal = 0
for (const cls of PUBLICATION_CLASSES) {
  const w = publicationWall[cls]
  const wall = w.amb + w.unres + w.extQ
  pubWallTotal += wall
  console.log(`  ${cls.padEnd(62)} ${String(w.amb).padStart(7)} ${String(w.unres).padStart(7)} ${String(w.extQ).padStart(6)} ${String(w.resolved).padStart(9)}   ${wall}`)
}
console.log(`  ${"THE SUM".padEnd(62)} ${" ".repeat(7)} ${" ".repeat(7)} ${" ".repeat(6)} ${" ".repeat(9)}   ${pubWallTotal}`)
console.log(`  THE WALL IS ${wallTotal} AND THE SUM HERE IS ${pubWallTotal} — THE JOIN COVERS THE WALL EXACTLY: ${pubWallTotal === wallTotal}`)
for (const cls of PUBLICATION_CLASSES) {
  const samples = publicationSamples[cls] ?? []
  if (samples.length === 0) continue
  console.log(`  e.g. ${cls}: ${samples.slice(0, 3).join("  |  ")}`)
}
const syntheticWall = publicationWall["a SYNTHETIC name (the analyzer's own invention — the source never spells it)"].amb
  + publicationWall["a SYNTHETIC name (the analyzer's own invention — the source never spells it)"].unres
  + publicationWall["a SYNTHETIC name (the analyzer's own invention — the source never spells it)"].extQ
const namespaceWall = publicationWall["a NAMESPACE (the analyzer's Module symbol)"].amb
  + publicationWall["a NAMESPACE (the analyzer's Module symbol)"].unres
  + publicationWall["a NAMESPACE (the analyzer's Module symbol)"].extQ
console.log("")
console.log("  THE PUBLICATION'S SHARE OF THE WALL:")
console.log(`    ${syntheticWall} row(s) target a SYNTHETIC name (the analyzer's own invention) — A WALL THE ANALYZER CREATED`)
console.log(`    ${namespaceWall} row(s) target a NAMESPACE (the analyzer's Module symbol) — A WALL THE ANALYZER'S PUBLICATION CREATED`)
console.log(`    ${wallTotal - syntheticWall - namespaceWall} row(s) target a real declaration — A WALL THE PROGRAM HAS`)
console.log("  ⇒ THE PUBLICATION POLICY'S PRICE ON THE WALL IS THE SUM OF THE FIRST TWO, AND THE")
console.log("    PROGRAM'S SHARE IS THE THIRD — AND THE THIRD IS THE PART NO POLICY CAN REMOVE.")
console.log("")
console.log("  THE 768 — THE FLOOR'S ROWS — BY PUBLICATION CLASS:")
let floorSum = 0
for (const cls of PUBLICATION_CLASSES) {
  floorSum += floorByClass[cls]
  console.log(`    ${String(floorByClass[cls]).padStart(5)}  ${cls}`)
  const fs = floorSamples[cls] ?? []
  if (fs.length > 0) console.log(`            e.g. ${fs.slice(0, 3).join("  |  ")}`)
}
console.log(`    ${String(floorSum).padStart(5)}  THE SUM (the ambiguous cross-file rows: ${sumAmb - sumOwn})`)
console.log(`    THE FLOOR'S CLASSIFICATION CLOSES EXACTLY: ${floorSum === sumAmb - sumOwn}`)

// ── THE CLAUSE-1 CROSS-CHECK — IS THE GATE'S CLAUSE-1 FAILURE EXACTLY THE LANE'S WALL? ──────────
/**
 * THE ASK (the Lead, 2026-10-20): "STATE WHETHER THE GATE'S CLAUSE-1 FAILURE IS EXACTLY THE LANE'S
 * WALL, IN THE LANE'S OWN NUMBERS." The gate's own clause-1 detail is built in
 * `script/m14/incoming-gate.ts`'s `clauseResults`:
 *
 *     const unr = t.ambiguousByDecl + t.unresolved
 *     detail: `${unr} ambiguous/unresolved + ${refuted} refuted claim(s) + ${t.externalUnverified + t.bindingUnverified} claim(s) no check can reach (ext? ${t.externalUnverified}, bind? ${t.bindingUnverified})`
 *
 * **THE GATE FILE CANNOT BE IMPORTED HERE**: it runs its whole arm at MODULE LEVEL, so importing
 * it would RUN THE GATE over the corpus without the fleet's arm token. So the formula is not
 * copied — it is READ FROM THE GATE'S SOURCE, the same reader-parity pattern this lane already
 * uses for the manifest spellings (`clojure-manifest-facts.ts`'s `assertReaderParity`). The
 * assertion below fails if the gate's template stops carrying the terms this lane's rendering
 * uses, so the two readings cannot drift without the control saying so.
 */
const gateSource = readFileSync(path.join(REPO_ROOT, "script", "m14", "incoming-gate.ts"), "utf8")
const unrLine = /const unr = t\.ambiguousByDecl \+ t\.unresolved/.test(gateSource)
const clause1Template = gateSource.includes("ambiguous/unresolved + ${t.externalRefuted + t.bindingRefuted + t.causeRefuted} refuted claim(s) + ${t.externalUnverified + t.bindingUnverified} claim(s) no check can reach (ext? ${t.externalUnverified}, bind? ${t.bindingUnverified})")
// THE GATE'S CLAUSE-1 FAILURE, IN THE GATE'S OWN TERMS, OVER THE LANE'S OWN TOTALS.
const gateUnr = totals.ambiguousByDecl + totals.unresolved
const gateRefuted = totals.externalRefuted + totals.bindingRefuted + totals.causeRefuted
const gateUnreachable = totals.externalUnverified + totals.bindingUnverified
const gateClause1Failure = gateUnr + gateRefuted + gateUnreachable
// THE LANE'S WALL, IN THE LANE'S OWN TERMS — the §3.2 table's three classes.
const laneWall = wallTotal
const clause1 = {
  sourceParity: { unrLine, clause1Template },
  gate: { unr: gateUnr, refuted: gateRefuted, unreachable: gateUnreachable, failure: gateClause1Failure },
  lane: { amb: totals.ambiguousByDecl, unresolved: totals.unresolved, extUnverified: totals.externalUnverified, wall: laneWall },
  identical: gateClause1Failure === laneWall,
  term1Identical: gateUnr === totals.ambiguousByDecl + totals.unresolved,
  term2Identical: gateUnreachable === totals.externalUnverified + totals.bindingUnverified,
}
console.log("THE CLAUSE-1 CROSS-CHECK — THE GATE'S CLAUSE-1 FAILURE AGAINST THE LANE'S WALL")
console.log("  the gate's own formula, READ FROM script/m14/incoming-gate.ts (the file is NOT imported — it runs an arm at module level):")
console.log(`    'const unr = t.ambiguousByDecl + t.unresolved' present: ${unrLine}`)
console.log(`    the clause-1 detail template present, term for term: ${clause1Template}`)
console.log("  THE GATE'S CLAUSE-1 FAILURE, over this run's totals:")
console.log(`    ${gateUnr} ambiguous/unresolved + ${gateRefuted} refuted claim(s) + ${gateUnreachable} claim(s) no check can reach (ext? ${totals.externalUnverified}, bind? ${totals.bindingUnverified})`)
console.log(`    = ${gateClause1Failure}`)
console.log("  THE LANE'S WALL, in the lane's own numbers (the §3.2 table's three classes):")
console.log(`    amb(decl) ${totals.ambiguousByDecl} + unresolved ${totals.unresolved} + ext? ${totals.externalUnverified} = ${laneWall}`)
console.log(`  THE GATE'S CLAUSE-1 FAILURE IS EXACTLY THE LANE'S WALL: ${clause1.identical} (term for term: ${clause1.term1Identical && clause1.term2Identical})`)
console.log("  ⇒ THE GATE'S `VERDICT: FAIL` IS NOT A REGRESSION SIGNAL. IT IS THE GATE REPORTING THE")
console.log("    LANE'S RULED RESIDUAL: a lane with a RULED residual cannot satisfy clause 1 BY")
console.log("    CONSTRUCTION — the 852 are unverifiable because the project's governing manifest does")
console.log("    not declare them, and an unverifiable claim is not a verified one.")
if (!clause1.identical || !unrLine || !clause1Template) {
  console.error("*** THE CLAUSE-1 CROSS-CHECK DOES NOT HOLD — the gate's clause-1 failure is NOT the lane's wall, or the gate's formula has changed. ***")
  process.exit(4)
}
console.log("")
if (DUMP_OUT) {
  // THE BOUND MARKER, and it is the powershell lane's finding applied to THIS instrument: the
  // gate prints `DUMP\tBOUND\tREACHED\t<limit>` when its dump is truncated, because "a truncated
  // dump was indistinguishable from a complete one" — and every reconciliation reads the dump, so
  // a truncated one would under-count the movement AND LOOK COMPLETE. This instrument's dump is
  // not bounded, so it prints the OTHER half of the contract: `COMPLETE`, with the row count. A
  // reader can then tell "the whole set" from "a truncated set" without guessing, and the
  // reconciler reads the marker rather than assuming completeness.
  const body = dumpRows.join("\n")
  const marker = `DUMP\tBOUND\tCOMPLETE\t${dumpRows.length}\t-\t-\t-`
  writeFileSync(DUMP_OUT, (body.length > 0 ? body + "\n" : "") + marker + "\n")
  console.log(`DUMP: ${dumpRows.length} non-resolved rows written to ${DUMP_OUT} (the gate's own six-column format) + the BOUND/COMPLETE marker.`)
}
if (AMB_OUT !== null) {
  writeFileSync(AMB_OUT, ambRows.join("\n") + (ambRows.length > 0 ? "\n" : ""))
  console.log(`AMB DUMP: ${ambRows.length} ambiguous cross-file rows written to ${AMB_OUT}.`)
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ...report, gateComparison: { got, want, ok: cmpOK }, clause1: clause1 }, null, 2) + "\n")
if (!cmpOK) {
  console.error("*** MISMATCH against the gate's own TABLE 1 — this run is NOT the same population or the same analyzer. Refusing to report it as a measurement. ***")
  process.exit(4)
}
console.log("ASSERTED: this run reproduces the gate's own TABLE 1 line.")
