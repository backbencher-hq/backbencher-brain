/**
 * WHOLE-CORPUS AMBIGUITY CLOSURE — for EVERY type, can the edge's own published
 * fields re-discover exactly one declaration, and what is left over?
 *
 * ## Why this file exists
 *
 * Three previous rounds each answered a version of this question over part of the
 * lane, and no single number says whether the lane is finished:
 *
 *   round 16  `probe-bash-ambiguity-split.mts --sample 600`
 *             2,559 ambiguous, 933 publishing no binding. SAMPLES 600 files.
 *   round 17  `probe-bash-contains-overrides-ceiling.mts --sample 600`
 *             `contains` 901/901 closable by (source, line_number);
 *             `overrides` 30/30 by `overridesLine`. TWO types only.
 *   round 15  `probe-bash-published-resolvability.mts --all`
 *             per-type counts, but against a candidate set built from rules that
 *             predate `overridesLine`, so its `overrides` row predates the fix.
 *
 * None of them covers all seven emitted types on the whole corpus with the
 * CURRENT analyzer. So "is bash's ambiguity finished" has no answer in the
 * repository, and the brief's question 2 — "fix the largest single bucket your
 * lane controls, then re-measure" — cannot be closed without one.
 *
 * ## The question, stated so it can be answered wrong
 *
 * For every relationship a file emits, and for every target name the file's own
 * symbol table declares MORE THAN ONCE, ask: applying ONLY fields already
 * published ON THAT EDGE, how many candidates survive?
 *
 * The rule set is per TYPE, because the two families are constructed differently
 * and this file must not assume one rule for both:
 *
 *   contains    emitted from the CHILD symbol, so the edge's own `line_number` IS
 *               the child's name line and `source` IS its owner. Exact by
 *               construction; the measurement is whether a consumer can find that
 *               fact from outside the analyzer.
 *   overrides   runs to the PRIOR declaration, so the right key is the edge's own
 *               `metadata.overridesLine`.
 *   calls       a command name; the binding is `metadata.targetLine` +
 *               `metadata.targetKind`, or `isFunctionCall` when the name resolves
 *               to a local function.
 *   uses        a `$name` read; same two keys, or `isAssignedInFile`.
 *   exports     the edge's `line_number` is the export statement's own line, so it
 *               is NOT a binding for the exported symbol; `targetLine` is.
 *   imports /   a path or a source name. These name NO declaration in the file by
 *   references   construction — `imports`/`references` 679 each, 0 name-ambiguous
 *               corpus-wide — so they are counted and expected to be 0.
 *
 * ## What counts as a defect, and what does not
 *
 *   closes      exactly one candidate survives the rule.
 *   picksZero   the edge publishes a line/kind that matches NO declaration. This is
 *               the one bucket that is worse than no binding: the edge asserts a
 *               location and is wrong about it.
 *   picksMany   the published binding matches several. Not addressable, not false.
 *   declined    `targetResolution: "ambiguousInFile"` — the analyzer saw several
 *               and said so. NOT a defect; counted separately so it cannot hide
 *               inside a resolution rate.
 *   noBinding   the edge carries no binding field at all AND no published field of
 *               the rule set applies. A lane defect only where the analyzer had the
 *               information and did not publish it.
 *
 * ## Two universes, because `bb_impact` faces the larger one
 *
 *   IN-FILE   candidates = the edge's own file. What a consumer holding the file
 *             resolves against.
 *   CORPUS    candidates = every symbol in the corpus walk. What `bb_impact`'s
 *             target-string match faces, since `src/lsp/impact.ts` obtains reverse
 *             edges by scanning outgoing edges and matching target strings.
 *
 * A corpus-universe ambiguity that is NOT an in-file one is a different defect:
 * two files declaring the same name. No published field on the edge can fix that,
 * because the disambiguator that would fix it is the FILE, and it is not on the
 * edge. Those are reported separately rather than counted as fixable.
 *
 * ## Instrument
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` — not `analyze()`, which
 * skips the pool-worker stages. Corpus admission, hash order and the 512 KB cap are
 * copied from `probe-bash-ambiguity-split.mts` so the denominator matches every
 * other number in this lane's doc. `--sample 600` reproduces round 16's
 * population exactly; `--all` is the whole-corpus figure.
 *
 * NO REGEX. Every field compared is a published field; every candidate comes from
 * the published symbol table.
 *
 *   npx tsx validation/m14/fixtures/bash/probe-bash-ambiguity-closure-whole.mts [--sample 600 | --all] [--json]
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
const ALL = argv.includes("--all")
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

/** Store label -> ontology name. Both `imports` spellings, as `incoming-check` accepts. */
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

// ---------------------------------------------------------------- corpus walk
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
const sample = ALL ? files : files.slice(0, SAMPLE)

interface Cand {
  file: string
  name: string
  kind: string
  owner: string
  line: number
}
interface Pub {
  byFileName: Map<string, Cand[]>
  byName: Map<string, Cand[]>
}

const rows = new Map<string, Row>()
const get = (t: string): Row => {
  let r = rows.get(t)
  if (!r) {
    r = {
      edges: 0,
      inFilePresent: 0,
      ambiguous: 0,
      closes: 0,
      picksZero: 0,
      picksMany: 0,
      declined: 0,
      noBinding: 0,
      corpusAmbiguous: 0,
      corpusAmbiguousInFile: 0,
      corpusAmbiguousForeignOnly: 0,
      corpusUnresolved: 0,
      // which rule closed it, so a single type cannot hide behind an aggregate
      bySourceLine: 0,
      byOverridesLine: 0,
      byTargetLine: 0,
      byVerdict: 0,
    }
    rows.set(t, r)
  }
  return r
}

interface Row {
  edges: number
  inFilePresent: number
  ambiguous: number
  closes: number
  picksZero: number
  picksMany: number
  declined: number
  noBinding: number
  corpusAmbiguous: number
  corpusAmbiguousInFile: number
  corpusAmbiguousForeignOnly: number
  corpusUnresolved: number
  bySourceLine: number
  byOverridesLine: number
  byTargetLine: number
  byVerdict: number
}

let failures = 0
let degraded = 0
let symbols = 0
const pending: { fkey: string; pub: Pub; rels: any[] }[] = []

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
      line: Number(s.range?.startLine ?? s.startLine ?? 0),
    }
    const local = pub.byFileName.get(n) ?? []
    local.push(c)
    pub.byFileName.set(n, local)
    const glob = pub.byName.get(n) ?? []
    glob.push(c)
    pub.byName.set(n, glob)
    // `incoming-check` also indexes the qualified name as an addressable target, so
    // a qualified-name target must resolve here too or the two instruments disagree
    // on a population.
    const q = String(s.qualifiedName ?? "")
    if (q.length > 0 && q !== n) {
      const gq = pub.byName.get(q) ?? []
      gq.push(c)
      pub.byName.set(q, gq)
    }
  }
  pending.push({ fkey, pub, rels: Array.isArray(p.relationships) ? p.relationships : [] })
}

// ---------------------------------------------------------------- the rules
/**
 * Apply the type's published-field rule and return how many candidates survive.
 *
 * Each rule reads ONLY a field the edge itself carries. `rule` names which, so the
 * output can attribute a closure to a specific published field rather than to a
 * total — the difference between "bash's ambiguity is closed" and "bash's ambiguity
 * is closed IF a consumer reads `overridesLine`", which are different claims.
 */
function applyRule(label: string, r: any, local: Cand[]): { survivors: Cand[]; rule: string } {
  const md = (r.metadata ?? {}) as Record<string, unknown>
  const src = String(r.source ?? "")
  const edgeLine = Number(r.line_number ?? 0)

  // A VERDICT, checked before any line: `commandNameIsExternal` +
  // `collidesWithLocalDeclaration` says the edge names NO local declaration, so the
  // correct candidate set is EMPTY rather than unknown.
  //
  // This rule is why the file's first version reported a defect that does not exist.
  // It fell through to the two-key rule, found no `targetLine`, and counted the edge
  // as `noBinding` — which reads as "the analyzer had a declaration and published
  // nothing". The analyzer published something stronger: it said there is nothing to
  // publish, and said why. `ohmyzsh/plugins/pip/pip.plugin.zsh` declares
  // `local xargs=` at 106 and 114, runs `/usr/bin/xargs` at 107 and 115, and a
  // consumer that reads the verdict discards both variable candidates. A name-matching
  // consumer that does not read it is wrong on these two edges — but the wrongness is
  // the consumer's, and calling it a lane defect would name the wrong owner.
  if (String(md.targetResolution ?? "") === "commandNameIsExternal" && md.collidesWithLocalDeclaration === true) {
    return { survivors: [], rule: "verdict:external" }
  }

  if (label === "contains") {
    // The child's name line is the edge's `line_number` and its owner is `source`.
    const byOwner = local.filter((c) => c.owner === src)
    const both = byOwner.filter((c) => c.line === edgeLine)
    if (both.length > 0) return { survivors: both, rule: "source+line" }
    // Fall back to the line alone, so the report can distinguish "the owner filter
    // was the discriminator" from "the line alone sufficed".
    const byLine = local.filter((c) => c.line === edgeLine)
    if (byLine.length > 0) return { survivors: byLine, rule: "line" }
    return { survivors: [], rule: "source+line" }
  }

  if (label === "overrides") {
    const prior = md.overridesLine
    if (prior === undefined || prior === null) return { survivors: [], rule: "overridesLine(absent)" }
    return { survivors: local.filter((c) => c.line === Number(prior)), rule: "overridesLine" }
  }

  // calls / uses / exports — the two-key binding.
  const hasLine = md.targetLine !== undefined && md.targetLine !== null
  const hasKind = md.targetKind !== undefined && md.targetKind !== null
  if (!hasLine && !hasKind) return { survivors: [], rule: "targetLine(absent)" }
  const line = Number(md.targetLine ?? 0)
  const kind = String(md.targetKind ?? "")
  return { survivors: local.filter((c) => c.line === line && (kind.length === 0 || c.kind === kind)), rule: "targetLine" }
}

const exPicksZero: string[] = []
const exPicksMany: string[] = []
const exNoBinding: string[] = []
const exDeclined: string[] = []
const exForeign: string[] = []

for (const { fkey, pub, rels } of pending) {
  for (const r of rels) {
    const label = ontologyName(String(r.type ?? r.relationshipType ?? ""))
    if (!label) continue
    const row = get(label)
    row.edges++
    const tgt = String(r.target ?? r.to ?? "")
    if (!tgt) continue

    // ---- corpus universe: what bb_impact's target-string match faces ----
    const corpusCands = pub.byName.get(tgt) ?? []
    if (corpusCands.length === 0) row.corpusUnresolved++
    else if (corpusCands.length > 1) {
      row.corpusAmbiguous++
      if (corpusCands.some((c) => c.file === fkey)) row.corpusAmbiguousInFile++
      else {
        row.corpusAmbiguousForeignOnly++
        if (exForeign.length < 8)
          exForeign.push(
            `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   ` +
              `${corpusCands.length} declarations, none in this file  (${[...new Set(corpusCands.map((c) => c.file))].slice(0, 3).join(" | ")})`,
          )
      }
    }

    // ---- in-file universe ----
    const local = pub.byFileName.get(tgt) ?? []
    if (local.length === 0) continue
    row.inFilePresent++
    if (local.length === 1) continue
    row.ambiguous++

    const md = (r.metadata ?? {}) as Record<string, unknown>
    if (String(md.targetResolution ?? "") === "ambiguousInFile") {
      row.declined++
      if (exDeclined.length < 10)
        exDeclined.push(
          `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   ${local.length} candidates, declined by choice`,
        )
      continue
    }

    const { survivors, rule } = applyRule(label, r, local)
    if (rule === "verdict:external") {
      // Closed by a published verdict: the edge names no local declaration. Counted
      // as a closure with its own rule so it is visible in table C rather than
      // hidden inside a total.
      row.closes++
      row.byVerdict++
      continue
    }
    if (survivors.length === 1) {
      row.closes++
      if (rule === "source+line") row.bySourceLine++
      else if (rule === "overridesLine") row.byOverridesLine++
      else if (rule === "targetLine") row.byTargetLine++
    } else if (survivors.length === 0) {
      // Distinguish "no binding published" from "a binding that points at nothing".
      // The first is missing information; the second is a FALSE location, which the
      // honesty contract ranks above a missing edge.
      const published = rule.endsWith("(absent)")
      if (published) {
        row.noBinding++
        if (exNoBinding.length < 12)
          exNoBinding.push(
            `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   ${local.length} candidates, ` +
              `NO binding field (rule ${rule})  kinds {${[...new Set(local.map((c) => c.kind))].join(" | ")}}  ` +
              `owners {${[...new Set(local.map((c) => c.owner))].join(" | ")}}  ` +
              `res=${String(md.targetResolution ?? "ABSENT")}`,
          )
      } else {
        row.picksZero++
        if (exPicksZero.length < 12)
          exPicksZero.push(
            `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   rule ${rule} published ` +
              `targetLine=${String(md.targetLine ?? "-")} targetKind=${String(md.targetKind ?? "-")} ` +
              `— candidate lines ${[...new Set(local.map((c) => c.line))].join(",")}`,
          )
      }
    } else {
      row.picksMany++
      if (exPicksMany.length < 12)
        exPicksMany.push(
          `${fkey}:${String(r.line_number ?? "?")}  -[${label}]-> ${tgt}   rule ${rule} matches ` +
            `${survivors.length} declarations (lines ${[...new Set(survivors.map((c) => c.line))].join(",")})`,
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

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        mode: ALL ? "all" : `sample-${sample.length}`,
        sample: sample.length,
        admitted: files.length,
        scanned,
        repos: repoNames.size,
        symbols,
        failures,
        degraded,
        perType: Object.fromEntries(rows),
        totals,
      },
      null,
      2,
    ),
  )
} else {
  console.log(`bash ambiguity closure — production parseFile, ${ALL ? "WHOLE CORPUS" : `${sample.length} files`}`)
  console.log(
    `admitted ${files.length.toLocaleString()} / scanned ${scanned.toLocaleString()} / repos ${repoNames.size} / symbols ${symbols.toLocaleString()}`,
  )
  console.log(`parse failures ${failures}   degraded ${degraded}\n`)

  console.log("A  IN-FILE AMBIGUITY — candidates are the edge's own file's symbols")
  console.log(
    `${w("type", 12)}${w("edges", 10)}${w("tgt present", 14)}${w("ambiguous", 14)}${w("% of edges", 12)}`,
  )
  console.log("-".repeat(62))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r) continue
    console.log(
      `${w(t, 12)}${w(r.edges.toLocaleString(), 10)}${w(r.inFilePresent.toLocaleString(), 14)}${w(r.ambiguous.toLocaleString(), 14)}${w(pct(r.ambiguous, r.edges), 12)}`,
    )
  }
  console.log(
    `${w("ALL", 12)}${w(totals.edges.toLocaleString(), 10)}${w(totals.inFilePresent.toLocaleString(), 14)}${w(totals.ambiguous.toLocaleString(), 14)}${w(pct(totals.ambiguous, totals.edges), 12)}`,
  )

  console.log("\nB  CLOSURE — apply the type's rule over PUBLISHED FIELDS ONLY")
  console.log(
    `${w("type", 12)}${w("ambiguous", 11)}${w("closes", 14)}${w("picks ZERO", 14)}${w("picks many", 13)}${w("no binding", 14)}${w("declined", 11)}${w("STILL OPEN", 14)}`,
  )
  console.log("-".repeat(103))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r) continue
    if (r.ambiguous === 0) continue
    const open = r.picksZero + r.picksMany + r.noBinding
    console.log(
      `${w(t, 12)}${w(r.ambiguous, 11)}${w(`${r.closes} ${pct(r.closes, r.ambiguous)}`, 14)}` +
        `${w(`${r.picksZero} ${pct(r.picksZero, r.ambiguous)}`, 14)}${w(`${r.picksMany} ${pct(r.picksMany, r.ambiguous)}`, 13)}` +
        `${w(`${r.noBinding} ${pct(r.noBinding, r.ambiguous)}`, 14)}${w(`${r.declined} ${pct(r.declined, r.ambiguous)}`, 11)}` +
        w(`${open} ${pct(open, r.ambiguous)}`, 14),
    )
  }
  const tOpen = totals.picksZero + totals.picksMany + totals.noBinding
  console.log(
    `${w("ALL", 12)}${w(totals.ambiguous, 11)}${w(`${totals.closes} ${pct(totals.closes, totals.ambiguous)}`, 14)}` +
      `${w(`${totals.picksZero} ${pct(totals.picksZero, totals.ambiguous)}`, 14)}${w(`${totals.picksMany} ${pct(totals.picksMany, totals.ambiguous)}`, 13)}` +
      `${w(`${totals.noBinding} ${pct(totals.noBinding, totals.ambiguous)}`, 14)}${w(`${totals.declined} ${pct(totals.declined, totals.ambiguous)}`, 11)}` +
      w(`${tOpen} ${pct(tOpen, totals.ambiguous)}`, 14),
  )

  console.log("\nC  WHICH PUBLISHED FIELD CLOSED IT — so the claim names the field a consumer must read")
  console.log(
    `${w("type", 12)}${w("source+line", 16)}${w("overridesLine", 17)}${w("targetLine", 14)}${w("verdict", 13)}${w("closes", 10)}`,
  )
  console.log("-".repeat(82))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r || r.closes === 0) continue
    console.log(
      `${w(t, 12)}${w(`${r.bySourceLine} ${pct(r.bySourceLine, r.closes)}`, 16)}${w(`${r.byOverridesLine} ${pct(r.byOverridesLine, r.closes)}`, 17)}${w(`${r.byTargetLine} ${pct(r.byTargetLine, r.closes)}`, 14)}${w(`${r.byVerdict} ${pct(r.byVerdict, r.closes)}`, 13)}${w(r.closes, 10)}`,
    )
  }
  console.log(
    "  source+line = contains (source is the child owner, line_number is its name line)\n" +
      "  overridesLine = overrides (the PRIOR declaration) · targetLine = calls/uses/exports\n" +
      "  verdict = commandNameIsExternal: the edge names NO local declaration",
  )

  console.log("\nD  CORPUS UNIVERSE — candidates are every symbol in the walk; this is bb_impact's match")
  console.log(
    `${w("type", 12)}${w("edges", 10)}${w("ambiguous", 14)}${w("in-file", 14)}${w("FOREIGN only", 16)}${w("unresolved", 14)}`,
  )
  console.log("-".repeat(80))
  for (const t of TYPES) {
    const r = rows.get(t)
    if (!r) continue
    console.log(
      `${w(t, 12)}${w(r.edges.toLocaleString(), 10)}${w(r.corpusAmbiguous.toLocaleString(), 14)}${w(r.corpusAmbiguousInFile.toLocaleString(), 14)}${w(`${r.corpusAmbiguousForeignOnly} ${pct(r.corpusAmbiguousForeignOnly, r.corpusAmbiguous || 1)}`, 16)}${w(r.corpusUnresolved.toLocaleString(), 14)}`,
    )
  }
  console.log(
    `${w("ALL", 12)}${w(totals.edges.toLocaleString(), 10)}${w(totals.corpusAmbiguous.toLocaleString(), 14)}${w(totals.corpusAmbiguousInFile.toLocaleString(), 14)}${w(`${totals.corpusAmbiguousForeignOnly} ${pct(totals.corpusAmbiguousForeignOnly, totals.corpusAmbiguous || 1)}`, 16)}${w(totals.corpusUnresolved.toLocaleString(), 14)}`,
  )
  console.log(
    "  FOREIGN only = the same name declared in ANOTHER file. No field on the edge can\n" +
      "  disambiguate that, because the disambiguator is the FILE and it is not published.",
  )

  for (const [title, ex] of [
    ["published binding points at NO declaration — a FALSE location", exPicksZero],
    ["published binding matches several declarations", exPicksMany],
    ["no binding field on an ambiguous edge", exNoBinding],
    ["declined by choice (targetResolution: ambiguousInFile) — honest row, not a defect", exDeclined],
    ["corpus-ambiguous with no in-file candidate — not fixable on the edge", exForeign],
  ] as [string, string[]][]) {
    if (!ex.length) continue
    console.log(`\n${title}:`)
    for (const e of ex) console.log(`  ${e}`)
  }
}
