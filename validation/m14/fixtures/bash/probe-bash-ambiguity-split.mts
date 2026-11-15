/**
 * AMBIGUITY SPLIT — one ambiguous target, three defects, and what the edge
 * already says about it.
 *
 * ## Why this file exists
 *
 * `incoming-check.ts` reads 623 ambiguous targets for bash over 600 files and the
 * round brief asks for the SPLIT, because the causes have different owners:
 *
 *   S  N declarations share a name in DIFFERENT SCOPES  — a scoping failure. The
 *                                                       lane can fix it.
 *   M  a name is declared under >1 KIND in one scope    — a labelling failure.
 *                                                       The lane can fix it.
 *   X  same name, same scope, same kind                 — the name cannot address
 *                                                       one of them, so the LINE
 *                                                       is the only discriminator.
 *
 * A number that mixes them is not actionable and a fix aimed at the wrong one
 * cannot move it.
 *
 * ## Two questions, and they have different answers
 *
 *   Q1  HOW MANY edges are ambiguous to a NAME-MATCHING consumer? That is the
 *       count `bb_impact` feels: `src/lsp/impact.ts` obtains reverse edges by
 *       scanning outgoing edges and matching target strings, so it sees a name
 *       and nothing else.
 *
 *   Q2  HOW MANY of those are still ambiguous once the edge's own published
 *       metadata is read? The lane publishes `targetLine` / `targetKind` /
 *       `targetResolution` on a name this file declares more than once — see
 *       `resolveDeclaration` in the analyzer. So the number that decides whether
 *       there is work left is not Q1, it is Q1 minus Q2.
 *
 * Q1 and Q2 differing is the point of the file, and the direction of the
 * difference is a finding about the CONSUMER, not about the analyzer: a consumer
 * that matches target strings alone is wrong on every edge where the edge itself
 * already said which declaration it meant.
 *
 * ## The three buckets, decided from data
 *
 * Each candidate carries `(ownerName, kind, startLine)` — published fields, not a
 * judgement — and the buckets are computed from them:
 *
 *   S   candidates disagree on `ownerName`
 *   M   candidates agree on `ownerName`, differ on `kind`
 *   X   candidates agree on owner AND kind
 *
 * ## The binding test, and what counts as a defect
 *
 * For an ambiguous edge the binding is `metadata.targetLine` + `metadata.targetKind`.
 * Counted against the PUBLISHED symbol table of the edge's own file:
 *
 *   closes            exactly one symbol at that line with that name and kind
 *   picksZero         the published line holds no such symbol — the edge published
 *                     a line that is not a declaration. This is a LANE DEFECT: an
 *                     edge that asserts a location and is wrong about it.
 *   picksMany         the published line holds more than one — the binding does
 *                     not discriminate
 *   noBindingField    the edge carries neither key, so a consumer reading the edge
 *                     has nothing to go on. LANE DEFECT.
 *   declined          `targetResolution: "ambiguousInFile"` — the analyzer
 *                     deliberately declined to pick, and published that it did. Not
 *                     a defect: it is the honest row, and it is counted separately
 *                     so it cannot hide inside a resolution rate.
 *
 * ## Two universes
 *
 *   IN-FILE   candidates are the symbols in the edge's own file — what a consumer
 *             holding the file resolves against.
 *   CORPUS    candidates are every symbol in the 600-file sample — what
 *             `bb_impact`'s target-string match faces.
 *
 * `incoming-check.ts` measures a THIRD thing, worth naming because its number is
 * the one in the brief: its `published` map is name -> DISTINCT KINDS
 * (`if (!arr.includes(kind)) arr.push(kind)`), so it calls a target ambiguous only
 * when the name is published under more than one KIND. Two functions of the same
 * name in two files read as ONE hit there and are not counted. 623 is a
 * kind-ambiguity count, and this file reports the full candidate counts beside it.
 *
 * ## Instrument
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` — not `analyze()`, which
 * skips the pipeline stages. Corpus admission and hash order are copied from
 * `probe-bash-ambiguity.mts` (512 KB cap, content-form `detectLanguageFromPath`)
 * so the denominator matches every other number in this lane's doc, and
 * `--sample 600` matches the whole-corpus incoming sweep's file count so the two
 * are comparable.
 *
 * NO REGEX: admission is the production router; candidates and bindings are
 * published fields.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-ambiguity-split.mts [--sample 600] [--json]
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num("sample", 600)
const JSON_OUT = argv.includes("--json")

const TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

/** Store label -> ontology name. Both `imports` spellings, as incoming-check does. */
const LABEL_ALIASES: Record<string, string> = {
  calls: "calls",
  call: "calls",
  uses: "uses",
  contains: "contains",
  composition: "contains",
  part_of: "contains",
  imports: "imports",
  brain_import: "imports",
  references: "references",
  depends_on: "references",
  related: "references",
  exports: "exports",
  provides: "exports",
  extends: "extends",
  inheritance: "extends",
  implements: "implements",
  implementation: "implements",
  overrides: "overrides",
  override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): string | null => LABEL_ALIASES[raw] ?? null

interface FileRec {
  repo: string
  rel: string
  abs: string
  dir: string
  hash: string
}
const files: FileRec[] = []
let scanned = 0
const repoNames = new Set<string>()
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
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    scanned++
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    repoNames.add(e)
    files.push({ repo: e, rel, abs, dir, hash: createHash("sha256").update(`${e}/${rel}`).digest("hex") })
  }
}
files.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
const sample = files.slice(0, SAMPLE)

interface Cand {
  file: string
  name: string
  kind: string
  owner: string
  line: number
  qualified: string
}

interface Row {
  edges: number
  // Q1 — name-matching
  inFileTargetPresent: number
  ambiguous: number
  S: number
  M: number
  X: number
  // Q2 — the edge's own published binding
  bindingCloses: number
  bindingPicksZero: number
  bindingPicksMany: number
  noBindingField: number
  closesViaEdgeLine: number
  declinedByChoice: number
  // corpus universe
  corpusAmbiguous: number
  corpusAmbiguousAlsoInFile: number
  corpusAmbiguousOnlyForeign: number
  corpusUnresolved: number
}
const rows = new Map<string, Row>()
const get = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      edges: 0,
      inFileTargetPresent: 0,
      ambiguous: 0,
      S: 0,
      M: 0,
      X: 0,
      bindingCloses: 0,
      bindingPicksZero: 0,
      bindingPicksMany: 0,
      noBindingField: 0,
      declinedByChoice: 0,
      corpusAmbiguous: 0,
      corpusAmbiguousAlsoInFile: 0,
      corpusAmbiguousOnlyForeign: 0,
      corpusUnresolved: 0,
    }
    rows.set(t, r)
  }
  return r
}

let failures = 0
let degraded = 0
let symbols = 0

const exNoBinding: string[] = []
const exPicksZero: string[] = []
const exPicksMany: string[] = []
const exDeclined: string[] = []

/**
 * One pass: parse, publish every symbol into both universes, keep the edge list
 * for resolution once the whole sample is known. Resolving in a second parse
 * would double the cost of the measurement for the same numbers, and a census
 * whose two halves can disagree is not a census.
 */
const pending: { fkey: string; pub: Pub; rels: any[] }[] = []
interface Pub {
  byFileName: Map<string, Cand[]>
  byName: Map<string, Cand[]>
}
const pubs = new Map<string, Pub>()

for (const f of sample) {
  let p: any
  try {
    p = await parseFile(f.abs, f.dir)
  } catch {
    failures++
    continue
  }
  if (!p || p.success === false || !Array.isArray(p.symbols)) {
    if (p?.fallback === true) degraded++
    continue
  }
  const pub: Pub = { byFileName: new Map(), byName: new Map() }
  pubs.set(f.abs, pub)
  const fkey = `${f.repo}/${f.rel}`
  for (const s of p.symbols) {
    const n = String(s?.name ?? "")
    if (!n) continue
    symbols++
    const c: Cand = {
      file: fkey,
      name: n,
      kind: String(s.kind ?? ""),
      owner: String(s.ownerName ?? ""),
      line: Number(s.startLine ?? 0),
      qualified: String(s.qualifiedName ?? ""),
    }
    const local = pub.byFileName.get(n) ?? []
    local.push(c)
    pub.byFileName.set(n, local)
    const glob = pub.byName.get(n) ?? []
    glob.push(c)
    pub.byName.set(n, glob)
    // incoming-check also indexes the qualified name as an addressable target,
    // so a qualified-name target must be resolvable here too or the two
    // instruments disagree on a population.
    if (c.qualified.length > 0 && c.qualified !== n) {
      const gq = pub.byName.get(c.qualified) ?? []
      gq.push(c)
      pub.byName.set(c.qualified, gq)
    }
  }
  pending.push({ fkey, pub, rels: Array.isArray(p.relationships) ? p.relationships : [] })
}

for (const { fkey, pub, rels } of pending) {
  for (const r of rels) {
    const label = ontologyName(String(r.type ?? r.relationshipType ?? ""))
    if (!label) continue
    const row = get(label)
    row.edges++
    const tgt = String(r.target ?? r.to ?? "")
    if (tgt.length === 0) continue

    // ---- corpus universe: what bb_impact's target-string match faces ----
    const corpusCands = pub.byName.get(tgt) ?? []
    if (corpusCands.length === 0) row.corpusUnresolved++
    else if (corpusCands.length > 1) {
      row.corpusAmbiguous++
      if (corpusCands.some((c) => c.file === fkey)) row.corpusAmbiguousAlsoInFile++
      else row.corpusAmbiguousOnlyForeign++
    }

    // ---- in-file universe ----
    const local = pub.byFileName.get(tgt) ?? []
    if (local.length === 0) continue
    row.inFileTargetPresent++
    if (local.length === 1) continue
    row.ambiguous++

    const owners = new Set(local.map((c) => c.owner))
    const kinds = new Set(local.map((c) => c.kind))
    if (owners.size > 1) row.S++
    else if (kinds.size > 1) row.M++
    else row.X++

    // ---- Q2: does the edge's own published binding close it? ----
    const md = (r.metadata ?? {}) as Record<string, unknown>
    const resolution = String(md.targetResolution ?? "")
    if (resolution === "ambiguousInFile") {
      row.declinedByChoice++
      if (exDeclined.length < 10)
        exDeclined.push(
          `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   ${local.length} candidates, declined`,
        )
      continue
    }
    const hasLine = md.targetLine !== undefined && md.targetLine !== null
    const hasKind = md.targetKind !== undefined && md.targetKind !== null
    if (!hasLine && !hasKind) {
      row.noBindingField++
      if (exNoBinding.length < 12)
        exNoBinding.push(
          `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   ${local.length} candidates, ` +
            `resolution=${resolution || "ABSENT"}  kinds {${[...kinds].join(" | ")}}  owners {${[...owners].join(" | ")}}`,
        )
      continue
    }
    const line = Number(md.targetLine ?? 0)
    const kind = String(md.targetKind ?? "")
    const hit = local.filter((c) => c.line === line && (kind.length === 0 || c.kind === kind))
    if (hit.length === 1) {
      row.bindingCloses++
    } else if (hit.length === 0) {
      row.bindingPicksZero++
      if (exPicksZero.length < 12)
        exPicksZero.push(
          `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   published targetLine=${line} ` +
            `targetKind=${kind || "ABSENT"} — candidates at lines ${[...new Set(local.map((c) => c.line))].join(",")}`,
        )
    } else {
      row.bindingPicksMany++
      if (exPicksMany.length < 12)
        exPicksMany.push(
          `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   published targetLine=${line} ` +
            `matches ${hit.length} declarations (lines ${[...new Set(hit.map((c) => c.line))].join(",")})`,
        )
    }
  }
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)

const totals = get("__TOTAL__")
for (const r of rows.values()) {
  if (r === totals) continue
  for (const k of Object.keys(totals) as (keyof Row)[]) totals[k] += r[k]
}

const open = (r: Row): number => r.bindingPicksZero + r.bindingPicksMany + r.noBindingField

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        sample: sample.length,
        admitted: files.length,
        scanned,
        repos: repoNames.size,
        symbols,
        failures,
        degraded,
        perType: Object.fromEntries([...rows.entries()].map(([k, v]) => [k, v])),
        totals,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`bash ambiguity split — production parseFile, ${sample.length} files`)
  console.log(
    `admitted ${files.length} / scanned ${scanned.toLocaleString()} / repos ${repoNames.size} / symbols ${symbols.toLocaleString()}`,
  )
  console.log(`parse failures ${failures}   degraded ${degraded}\n`)

  console.log("Q1  SPLIT — candidates are the symbols in the edge's own file")
  console.log(
    `${w("type", 12)}${w("edges", 9)}${w("tgt in file", 14)}${w("ambiguous", 14)}${w("S scope", 13)}${w("M kind", 12)}${w("X same", 12)}`,
  )
  console.log("-".repeat(86))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r) continue
    console.log(
      `${w(t, 12)}${w(r.edges.toLocaleString(), 9)}${w(`${r.inFileTargetPresent} ${pct(r.inFileTargetPresent, r.edges)}`, 14)}` +
        `${w(`${r.ambiguous} ${pct(r.ambiguous, r.inFileTargetPresent)}`, 14)}${w(`${r.S} ${pct(r.S, r.ambiguous)}`, 13)}` +
        `${w(`${r.M} ${pct(r.M, r.ambiguous)}`, 12)}${w(`${r.X} ${pct(r.X, r.ambiguous)}`, 12)}`,
    )
  }
  console.log(
    `${w("ALL", 12)}${w(totals.edges.toLocaleString(), 9)}${w(`${totals.inFileTargetPresent} ${pct(totals.inFileTargetPresent, totals.edges)}`, 14)}` +
      `${w(`${totals.ambiguous} ${pct(totals.ambiguous, totals.inFileTargetPresent)}`, 14)}${w(`${totals.S} ${pct(totals.S, totals.ambiguous)}`, 13)}` +
      `${w(`${totals.M} ${pct(totals.M, totals.ambiguous)}`, 12)}${w(`${totals.X} ${pct(totals.X, totals.ambiguous)}`, 12)}`,
  )

  console.log("\nQ2  DOES THE EDGE'S OWN PUBLISHED BINDING CLOSE IT — metadata.targetLine/targetKind")
  console.log(
    `${w("type", 12)}${w("ambiguous", 10)}${w("closes", 14)}${w("no binding", 15)}${w("picks ZERO", 15)}${w("picks many", 14)}${w("declined", 12)}${w("STILL OPEN", 14)}`,
  )
  console.log("-".repeat(96))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r) continue
    if (r.ambiguous === 0) continue
    console.log(
      `${w(t, 12)}${w(r.ambiguous, 10)}${w(`${r.bindingCloses} ${pct(r.bindingCloses, r.ambiguous)}`, 14)}` +
        `${w(`${r.noBindingField} ${pct(r.noBindingField, r.ambiguous)}`, 15)}${w(`${r.bindingPicksZero} ${pct(r.bindingPicksZero, r.ambiguous)}`, 15)}` +
        `${w(`${r.bindingPicksMany} ${pct(r.bindingPicksMany, r.ambiguous)}`, 14)}${w(`${r.declinedByChoice} ${pct(r.declinedByChoice, r.ambiguous)}`, 12)}` +
        w(`${open(r)} ${pct(open(r), r.ambiguous)}`, 14),
    )
  }
  console.log(
    `${w("ALL", 12)}${w(totals.ambiguous, 10)}${w(`${totals.bindingCloses} ${pct(totals.bindingCloses, totals.ambiguous)}`, 14)}` +
      `${w(`${totals.noBindingField} ${pct(totals.noBindingField, totals.ambiguous)}`, 15)}${w(`${totals.bindingPicksZero} ${pct(totals.bindingPicksZero, totals.ambiguous)}`, 15)}` +
      `${w(`${totals.bindingPicksMany} ${pct(totals.bindingPicksMany, totals.ambiguous)}`, 14)}` +
      `${w(`${totals.declinedByChoice} ${pct(totals.declinedByChoice, totals.ambiguous)}`, 12)}` +
      w(`${open(totals)} ${pct(open(totals), totals.ambiguous)}`, 14),
  )

  console.log("\nCORPUS universe — candidates are every symbol in the sample; this is bb_impact's match")
  console.log(
    `${w("type", 12)}${w("edges", 9)}${w("ambiguous", 14)}${w("in-file hit", 16)}${w("foreign only", 15)}${w("unresolved", 16)}`,
  )
  console.log("-".repeat(82))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r) continue
    console.log(
      `${w(t, 12)}${w(r.edges.toLocaleString(), 9)}${w(`${r.corpusAmbiguous} ${pct(r.corpusAmbiguous, r.edges)}`, 14)}` +
        `${w(`${r.corpusAmbiguousAlsoInFile} ${pct(r.corpusAmbiguousAlsoInFile, r.corpusAmbiguous)}`, 16)}` +
        `${w(`${r.corpusAmbiguousOnlyForeign} ${pct(r.corpusAmbiguousOnlyForeign, r.corpusAmbiguous)}`, 15)}` +
        w(`${r.corpusUnresolved} ${pct(r.corpusUnresolved, r.edges)}`, 16),
    )
  }
  console.log(
    `${w("ALL", 12)}${w(totals.edges.toLocaleString(), 9)}${w(`${totals.corpusAmbiguous} ${pct(totals.corpusAmbiguous, totals.edges)}`, 14)}` +
      `${w(`${totals.corpusAmbiguousAlsoInFile} ${pct(totals.corpusAmbiguousAlsoInFile, totals.corpusAmbiguous)}`, 16)}` +
      `${w(`${totals.corpusAmbiguousOnlyForeign} ${pct(totals.corpusAmbiguousOnlyForeign, totals.corpusAmbiguous)}`, 15)}` +
      w(`${totals.corpusUnresolved} ${pct(totals.corpusUnresolved, totals.edges)}`, 16),
  )

  for (const [title, ex] of [
    ["no binding field on an ambiguous edge — LANE DEFECT if the language decides this", exNoBinding],
    ["published targetLine points at no declaration — LANE DEFECT", exPicksZero],
    ["published targetLine matches more than one declaration", exPicksMany],
    ["declined by choice (targetResolution: ambiguousInFile)", exDeclined],
  ] as [string, string[]][]) {
    if (!ex.length) continue
    console.log(`\n${title}:`)
    for (const e of ex) console.log(`  ${e}`)
  }
}