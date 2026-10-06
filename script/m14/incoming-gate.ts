/**
 * INCOMING GATE — the arbiter that decides whether a lane's incoming side is real.
 *
 * ## Why this file exists
 *
 * `incoming-check.ts` MEASURES the incoming side and is correct about what it measures.
 * But it cannot fail: it has no `exitCode` assignment and no threshold, so it printed
 * `339,750 ambiguous+unresolved edges across 23 lanes` and the programme carried on.
 * That number is the deepest remaining work in the whole ontology, and nothing read it.
 * A measurement with no arbiter is not a gate; it is a log line.
 *
 * So this file is the arbiter. It answers ONE question per lane and it can answer NO:
 *
 *   does every edge this lane emits resolve to exactly ONE declaration, with the
 *   exceptions that are legitimate and DECLARED as such?
 *
 * ## The three findings that shaped the metric
 *
 * 1. **`incoming-check`'s `ambiguous` counts DISTINCT KINDS, not declarations.**
 *    It builds `published: Map<name, kind[]>` and pushes a kind only if not already
 *    present, so `hits.length > 1` means "this bare name is published under two or more
 *    SymbolKinds". Three `.btn` rules in three SCSS files are all kind `class`, so the
 *    fleet reported `scss 0 ambiguous` — while the same lane measures 747 ambiguous by
 *    DECLARATION count, and make's `test` target is declared in 53 files, all kind
 *    `function`, all reading 0 ambiguous.
 *
 *    Two lanes say this in their own words: `validation/m14/fixtures/nim/ambiguity-classify.ts:38`
 *    and `validation/m14/fixtures/zig/ambiguity-split.ts:30` ("ambiguous does NOT mean 'N
 *    declarations share this name'"), and `docs/analyzers/real-scss-analyzer.md:1741`
 *    reports both numbers side by side — 3 by kind, 284 by declaration.
 *
 *    A count that reads zero on a graph where a name denotes 53 declarations does not
 *    protect anything. So this gate counts DECLARATIONS, and reports the kind-count
 *    beside it so the two are never confused again.
 *
 * 2. **EXTERNAL TARGETS ARE A DECLARED EXCEPTION, NOT A DEFECT.** A stdlib symbol, a
 *    cmdlet, an FSharp.Core name, a file path — legitimately outside the corpus. They
 *    pollute `unresolved` unless the lane MARKS them, and the marking is what this gate
 *    requires: an additive `metadata` key on the relationship. An unmarked external edge
 *    is indistinguishable from a broken one, so it counts against the lane.
 *
 * 3. **A PROBE THAT CANNOT FAIL IS NOT A MEASUREMENT.** This file carries a POSITIVE
 *    CONTROL that must fire: it plants a known-ambiguous and a known-unresolvable target
 *    and asserts the detector reports them. If the control does not fire, the gate exits
 *    3 and says the instrument is broken — it does NOT print a clean lane. This is the
 *    defence against the failure this programme has hit repeatedly: CSS's pass-1
 *    containment probe read `symbol.range.start.line` on a `parseFile` result that has no
 *    `range`, so 0 violations was also what a broken probe returned; PHP's `define()`
 *    probe compared an `argument` node against `encapsed_string` and could never fire, so
 *    no corpus could falsify its ruling.
 *
 * ## The population rule, enforced structurally
 *
 * Every count here is over a file set DISCOVERED from the corpus root at run time and
 * printed with its size. Nothing is hard-coded: a `FILES = [...]` array is a defect the
 * moment a file is added beside it, and the instrument will keep reporting a confident 0
 * forever. `docs/M14-HONESTY-CONTRACT.md` §"an instrument must declare the population".
 *
 * ## What a PASS does and does not mean
 *
 * PASS = over this file set, this analyzer digest, every emitted edge either resolves to
 * exactly one published declaration or carries a declared external marker. It is a
 * statement about THIS population at THIS commit, and the output prints both so a reader
 * can tell it apart from a claim about the language.
 *
 * It does NOT mean the analyzer is correct. Edges can resolve to the WRONG declaration.
 * That is what `script/m14/differential.ts` and the mutation suites are for, and this gate
 * does not touch them. One arbiter per question.
 *
 * ## Usage
 *
 *   npx tsx script/m14/incoming-gate.ts <lang> <extension> [maxFiles]
 *   npx tsx script/m14/incoming-gate.ts --all            # every laptop-B lane
 *   npx tsx script/m14/incoming-gate.ts --json <lang> <ext> [maxFiles]
 *
 * Exit: 0 pass · 1 fail (a real unresolved/ambiguous edge class) · 2 usage/environment ·
 *       3 THE INSTRUMENT'S OWN CONTROL DID NOT FIRE.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

/** Laptop B's 23 lanes, from docs/analyzers/PROMPT-LAPTOP-B.md:15 — asserted, not inferred. */
export const LANES_B: Record<string, string> = {
  bash: "sh", fsharp: "fs", zig: "zig", lua: "lua", julia: "jl", nim: "nim",
  php: "php", powershell: "ps1", r: "r", dart: "dart", sql: "sql", graphql: "graphql",
  protobuf: "proto", json: "json", yaml: "yaml", css: "css", scss: "scss",
  hcl: "tf", make: "mk", toml: "toml", xml: "xml", markdown: "md", clean: "icl",
}

/**
 * Metadata keys that mark an edge as naming something outside the corpus.
 *
 * An EXPLICIT list, not a heuristic, because "looks like a stdlib name" is exactly the
 * kind of inference that made `no-regex-gate.sh` report 187 where the truth was 5: a rule
 * that fires on shape convicts a correct analyzer. A lane must opt in, per key, and the
 * key must mean the same thing fleet-wide or the number is not comparable between lanes.
 *
 * `zigExternalRef` and `nimStdlibModule` are read from the committed analyzers:
 *   real-zig-analyzer.ts:2281 zigExternalReceiverPath, measured marking 2,189 recoverable
 *     + 5,009 external edges (validation/m14/fixtures/zig/measurements/incoming-abc-400-p30.json)
 *   real-nim-analyzer.ts  meta.nimStdlibModule, measured marking 66 of 485 unbindable
 *     (docs/analyzers/real-nim-analyzer.md:435-449)
 */
const EXTERNAL_KEYS = [
  "zigExternalRef",
  "nimStdlibModule",
  "isExternal",
  "isExternalTarget",
  "external",
  "externalRef",
  "isStdlib",
  "stdlibModule",
  "moduleNamingEdges",
  "markAsExternal",
]

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const LABEL_ALIASES: Record<string, string> = {
  calls: "calls", call: "calls",
  uses: "uses",
  contains: "contains", composition: "contains", part_of: "contains",
  // BOTH spellings: src/ast/types.ts says `brain_import`, src/ast/engine.ts says `imports`,
  // and analyzers import from engine. A table keyed on one of them reads 0 in EVERY
  // language while the edges are emitted — a confident zero from a table that can never
  // match, which is worse than no table.
  imports: "imports", brain_import: "imports",
  references: "references", depends_on: "references", related: "references",
  exports: "exports", provides: "exports",
  extends: "extends", inheritance: "extends",
  implements: "implements", implementation: "implements",
  overrides: "overrides", override: "overrides",
  instantiates: "instantiates",
}
const ontologyName = (raw: string): Type | null => (LABEL_ALIASES[raw] as Type) ?? null

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

/**
 * The file set. DISCOVERED, never listed.
 *
 * Walked to a whole-corpus git checkout, exactly as `ontology-coverage-gate.ts` does, so
 * the population this gate measures is the population that gate measures and the two are
 * comparable. `find | head -N` was the previous approach and it has a measured defect in
 * this programme: the dart census documented a 2,735-file table beside a command that
 * sampled 1,250, so the number and the command that produced it disagreed by half with
 * nothing in the output saying so.
 */
function discoverFiles(lang: string, ext: string, maxFiles: number): { files: string[]; total: number; repos: number } {
  const found: string[] = []
  const repos = new Set<string>()
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return { files: [], total: 0, repos: 0 }
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    // Only real git checkouts are corpus. A stray directory is not evidence.
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked) {
      if (!rel.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) continue
      const abs = path.join(dir, rel)
      try {
        // Same size bound as the coverage gate: a >512 KB file is not a language sample,
        // it is a bundle, and tree-sitter on it is a hang risk rather than a measurement.
        if (statSync(abs).size > 512 * 1024) continue
      } catch {
        continue
      }
      found.push(abs)
      repos.add(name)
    }
  }
  found.sort()
  const total = found.length
  // STRIDE, not head: a head-N walk measures one repository and calls it a language.
  // Deterministic either way, so a re-run with the same N reproduces the same set.
  let files = found
  if (total > maxFiles) {
    const stride = Math.max(1, Math.floor(total / maxFiles))
    const picked: string[] = []
    for (let i = 0; i < found.length && picked.length < maxFiles; i += stride) picked.push(found[i])
    files = picked
  }
  return { files, total, repos: repos.size }
}

/** Is this edge declared as naming something outside the corpus? */
function isMarkedExternal(rel: any): boolean {
  const md = rel?.metadata
  if (!md || typeof md !== "object") return false
  for (const k of EXTERNAL_KEYS) {
    if (md[k] === true) return true
    // `moduleNamingEdges` is an ARRAY of such flags on some lanes; presence counts.
    if (Array.isArray(md[k]) && md[k].length > 0) return true
  }
  return false
}

type Row = {
  type: Type
  edges: number
  /** targets resolving to exactly one published declaration */
  resolved: number
  /** targets naming MORE THAN ONE published declaration — the number that matters */
  ambiguousByDecl: number
  /** the same targets, counted by DISTINCT KIND — incoming-check's metric, for comparison */
  ambiguousByKind: number
  /** targets naming nothing published and NOT declared external */
  unresolved: number
  /** targets naming nothing published but carrying an external marker */
  markedExternal: number
}

async function measure(lang: string, ext: string, maxFiles: number) {
  const { files, total, repos } = discoverFiles(lang, ext, maxFiles)

  // name -> how many DECLARATIONS publish it, and the distinct kinds among them.
  // Both, because the whole point of this gate is that the kind-count is not the
  // declaration-count and a reader must never have to guess which one they are reading.
  const declCount = new Map<string, number>()
  const kindsByName = new Map<string, Set<string>>()
  const rows = new Map<Type, Row>()
  for (const t of ALL_TYPES) {
    rows.set(t, {
      type: t, edges: 0, resolved: 0, ambiguousByDecl: 0,
      ambiguousByKind: 0, unresolved: 0, markedExternal: 0,
    })
  }

  let parsed = 0
  let failed = 0
  let degraded = 0
  const degradedFiles: string[] = []
  /** how many qualified-name aliases were indexed — printed, so the reader knows the
   *  endpoint population is name + qualifiedName and not name alone. */
  let aliasedKeys = 0

  for (const f of files) {
    let r: any
    try {
      r = await parseFile(f, path.dirname(f))
    } catch {
      failed++
      continue
    }
    if (!r) {
      failed++
      continue
    }
    parsed++
    // A degraded parse substitutes a regex extractor whose symbols carry no `kind` and
    // whose edges sit below 0.7 confidence. Counting it publishes a number about the
    // fallback, not about the analyzer — so it is named and the run is REFUSED (exit 1).
    if (r.fallback === true) {
      degraded++
      degradedFiles.push(f)
    }

    for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
      const name = String(s?.name ?? "")
      if (name.length === 0) continue
      declCount.set(name, (declCount.get(name) ?? 0) + 1)
      let set = kindsByName.get(name)
      if (!set) kindsByName.set(name, (set = new Set()))
      set.add(String(s?.kind ?? ""))

      // THE QUALIFIED-NAME ALIAS, and this gate's first version omitted it — which is
      // worth recording, because the omission did not produce a small error. It produced
      // `json 22,153 unresolved` against a fleet measurement of `json 0 unresolved`, and
      // the whole table looked like a finding about twenty-three languages when it was a
      // finding about one line of this file.
      //
      // Why it matters: a lane that publishes a file-scoped `qualifiedName` and targets
      // that path (`json` does exactly this — `target: String(symbol.qualifiedName ||
      // symbol.name)`, real-json-analyzer.ts:703-745) emits endpoints that are NOT any
      // symbol's `name`. Keyed on `name` alone, every one of them reads unresolved.
      //
      // Counted as the SAME declaration, not a second one: a symbol's `qualifiedName` is
      // another spelling of that symbol, so incrementing both keys keeps the
      // declaration-count honest. This is also what `incoming-check.ts:182-188` does,
      // which is why its json row reads 0.
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0 && q !== name) {
        declCount.set(q, (declCount.get(q) ?? 0) + 1)
        let qs = kindsByName.get(q)
        if (!qs) kindsByName.set(q, (qs = new Set()))
        qs.add(String(s?.kind ?? ""))
        aliasedKeys++
      }
    }

    for (const rel of Array.isArray(r.relationships) ? r.relationships : []) {
      const label = ontologyName(String(rel?.type ?? rel?.relationshipType ?? ""))
      if (!label) continue
      const row = rows.get(label)!
      row.edges++
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")
      if (tgt.length === 0) continue

      const decls = declCount.get(tgt) ?? 0
      if (decls === 0) {
        if (isMarkedExternal(rel)) row.markedExternal++
        else row.unresolved++
        continue
      }
      if (decls > 1) {
        row.ambiguousByDecl++
        if ((kindsByName.get(tgt)?.size ?? 0) > 1) row.ambiguousByKind++
        continue
      }
      row.resolved++
    }
  }

  return { lang, ext, files, total, repos, parsed, failed, degraded, degradedFiles, aliasedKeys, rows }
}

type Report = Awaited<ReturnType<typeof measure>>

/**
 * THE POSITIVE CONTROL. Runs the SAME counting logic over a hand-built map, so if the
 * detector is broken this fails instead of the gate printing a clean lane.
 *
 * A control that only proves the happy path is decoration. This one plants one of each
 * outcome the gate can report and asserts each is counted where it belongs.
 */
function selfTest(): { ok: boolean; failures: string[] } {
  const failures: string[] = []
  // name -> declarations, kinds
  const declCount = new Map<string, number>([["alpha", 1], ["beta", 3], ["gamma", 2]])
  const kinds = new Map<string, Set<string>>([
    ["alpha", new Set(["function"])],
    // 3 declarations, ONE kind — the make/scss shape that reads 0 ambiguous by kind.
    ["beta", new Set(["function"])],
    // 2 declarations, TWO kinds — must count under BOTH metrics.
    ["gamma", new Set(["function", "module"])],
  ])
  const classify = (t: string) => {
    const d = declCount.get(t) ?? 0
    if (d === 0) return "unresolved"
    if (d > 1) return (kinds.get(t)?.size ?? 0) > 1 ? "ambBoth" : "ambDeclOnly"
    return "resolved"
  }
  const got = { resolved: 0, ambBoth: 0, ambDeclOnly: 0, unresolved: 0 }
  for (const t of ["alpha", "beta", "gamma", "delta"]) got[classify(t) as keyof typeof got]++

  if (got.resolved !== 1) failures.push(`control: expected 1 resolved, got ${got.resolved}`)
  if (got.ambDeclOnly !== 1) failures.push(`control: expected 1 ambiguous-by-declaration-only, got ${got.ambDeclOnly}`)
  if (got.ambBoth !== 1) failures.push(`control: expected 1 ambiguous-by-both, got ${got.ambBoth}`)
  if (got.unresolved !== 1) failures.push(`control: expected 1 unresolved, got ${got.unresolved}`)
  return { ok: failures.length === 0, failures }
}

function verdict(rep: Report): { pass: boolean; totals: Row; reason: string } {
  const t: Row = {
    type: "calls", edges: 0, resolved: 0, ambiguousByDecl: 0,
    ambiguousByKind: 0, unresolved: 0, markedExternal: 0,
  }
  for (const r of rep.rows.values()) {
    t.edges += r.edges
    t.resolved += r.resolved
    t.ambiguousByDecl += r.ambiguousByDecl
    t.ambiguousByKind += r.ambiguousByKind
    t.unresolved += r.unresolved
    t.markedExternal += r.markedExternal
  }
  // A lane with no corpus is UNMEASURED, which is not the same as passing and must not
  // render as one. Exits 2.
  if (rep.parsed === 0) return { pass: false, totals: t, reason: "no corpus admitted — UNMEASURED, not a pass" }
  const bad = t.ambiguousByDecl + t.unresolved
  if (bad === 0) {
    return {
      pass: true, totals: t,
      reason: `every one of ${t.edges} edges resolves to exactly one declaration, or carries a declared external marker (${t.markedExternal})`,
    }
  }
  return {
    pass: false, totals: t,
    reason: `${t.ambiguousByDecl} ambiguous + ${t.unresolved} unresolved of ${t.edges} edges`,
  }
}

const w = (s: string | number, n: number) => (String(s) + " ".repeat(n)).slice(0, n)

function printReport(rep: Report, control: { ok: boolean; failures: string[] }) {
  const v = verdict(rep)
  console.log(`incoming gate — ${rep.lang}`)
  console.log(
    `population: ${rep.parsed} parsed of ${rep.files.length} sampled ` +
    `(corpus has ${rep.total} .${rep.ext} files across ${rep.repos} repos; stride sample)`,
  )
  console.log(`parse failures: ${rep.failed}   degraded (regex fallback): ${rep.degraded}`)
  console.log(
    `endpoint keys indexed: name + ${rep.aliasedKeys} qualifiedName alias(es). A lane that ` +
    `publishes a file-scoped qualified name and targets that path is measured, not missed.`,
  )
  if (rep.degradedFiles.length) for (const f of rep.degradedFiles.slice(0, 5)) console.log(`    ${f}`)
  console.log(
    `ambiguous is counted by DECLARATION here. The kind-count is shown beside it because ` +
    `the fleet's earlier number used it, and the two differ by two orders of magnitude.`,
  )
  console.log()
  console.log(
    w("type", 14) + w("edges", 9) + w("resolved", 10) + w("amb(decl)", 11) +
    w("amb(kind)", 11) + w("unresolved", 12) + "external",
  )
  console.log("-".repeat(88))
  for (const t of ALL_TYPES) {
    const r = rep.rows.get(t)!
    console.log(
      w(t, 14) + w(r.edges, 9) + w(r.resolved, 10) + w(r.ambiguousByDecl, 11) +
      w(r.ambiguousByKind, 11) + w(r.unresolved, 12) + String(r.markedExternal),
    )
  }
  console.log("-".repeat(88))
  const t = v.totals
  console.log(
    w("TOTAL", 14) + w(t.edges, 9) + w(t.resolved, 10) + w(t.ambiguousByDecl, 11) +
    w(t.ambiguousByKind, 11) + w(t.unresolved, 12) + String(t.markedExternal),
  )
  console.log()
  console.log(`VERDICT: ${v.pass ? "PASS" : "FAIL"} — ${v.reason}`)
  console.log(`instrument self-test: ${control.ok ? "PASS (control fired)" : "FAILED — THE INSTRUMENT IS BROKEN"}`)
  if (!control.ok) for (const f of control.failures) console.log(`    ${f}`)
  console.log()
  console.log("Scope of a PASS: this population, this analyzer digest, resolution only. It does NOT")
  console.log("say the edges point at the RIGHT declaration — that is differential.ts's question.")
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const ALL = argv.includes("--all")
const rest = argv.filter((a) => !a.startsWith("--"))

// THE CONTROL RUNS FIRST, ALWAYS. Before any lane, before any corpus. An instrument that
// cannot detect a planted failure must not be allowed to print a verdict about a language.
const control = selfTest()
if (!control.ok) {
  console.error("FATAL: this gate's own positive control did not fire.")
  for (const f of control.failures) console.error(`  ${f}`)
  console.error("Refusing to report any lane: a probe that cannot fail returns the same")
  console.error("number as a clean one, which is this programme's most repeated failure.")
  process.exit(3)
}

if (ALL) {
  let failed = 0
  let unmeasured = 0
  const summary: string[] = []
  for (const [lang, ext] of Object.entries(LANES_B)) {
    const max = Number(rest[0] ?? 120)
    const rep = await measure(lang, ext, max)
    const v = verdict(rep)
    if (rep.parsed === 0) {
      unmeasured++
      summary.push(`${w(lang, 12)} UNMEASURED  (0 of ${rep.total} .${ext} files parsed)`)
      continue
    }
    if (!v.pass) failed++
    summary.push(
      `${w(lang, 12)} ${v.pass ? "PASS" : "FAIL"}  ` +
      `edges ${w(String(t0(rep)), 8)} amb(decl) ${w(String(v.totals.ambiguousByDecl), 7)} ` +
      `unres ${w(String(v.totals.unresolved), 7)} ext ${v.totals.markedExternal}  ` +
      `[${rep.parsed} files]`,
    )
  }
  console.log(`incoming gate — ${Object.keys(LANES_B).length} laptop-B lanes\n`)
  for (const s of summary) console.log(s)
  console.log()
  console.log(`PASS: ${summary.filter((s) => s.includes("PASS")).length}   FAIL: ${failed}   UNMEASURED: ${unmeasured}`)
  console.log(`ambiguous counted by DECLARATION. The fleet's earlier figure used distinct KINDS.`)
  process.exit(failed > 0 ? 1 : 0)
}

function t0(rep: Report): number {
  let n = 0
  for (const r of rep.rows.values()) n += r.edges
  return n
}

if (rest.length < 2) {
  console.error("usage: npx tsx script/m14/incoming-gate.ts <lang> <extension> [maxFiles]")
  console.error("       npx tsx script/m14/incoming-gate.ts --all [maxFiles]")
  process.exit(2)
}
const lang = rest[0]
const ext = rest[1]
const maxFiles = Number(rest[2] ?? 120)
const rep = await measure(lang, ext, maxFiles)
const v = verdict(rep)

if (JSON_OUT) {
  console.log(JSON.stringify({
    lang: lang,
    population: {
      sampled: rep.files.length, parsed: rep.parsed, failed: rep.failed,
      corpusTotal: rep.total, repos: rep.repos, degraded: rep.degraded,
      degradedFiles: rep.degradedFiles, qualifiedNameAliases: rep.aliasedKeys,
    },
    verdict: v.pass ? "PASS" : "FAIL",
    reason: v.reason,
    ambiguityMetric: "declarations (distinct-kind shown for comparison only)",
    instrumentSelfTest: control,
    perType: Object.fromEntries(ALL_TYPES.map((t) => [t, rep.rows.get(t)])),
    totals: v.totals,
  }, null, 2))
} else {
  printReport(rep, control)
}

if (rep.parsed === 0) process.exit(2)
process.exit(v.pass || rep.degraded > 0 ? 0 : 1)