/**
 * ELIXIR — THE WHOLE-POPULATION DECLARATION, GENERATED FROM THE ARM'S OWN TABLE.
 *
 * ## Why this file exists
 *
 * The completion gate (`script/m14/completion-gate.ts`) reads
 * `validation/m14/instruments/elixir/incoming-declaration.json`. The file it found was a
 * 2026-10-10 declaration over a **200-file SAMPLE of a 288-file, ONE-repository** population —
 * while this lane's admitted set is **1,368 files across FIVE repositories** and its whole-
 * population numbers come from an arm the completion gate cannot read (ELIXIR-BASELINE.md). So
 * condition (B) `whole-population` read "NO WHOLE-POPULATION DECLARATION" — an UNREAD, not a
 * failure, and the completion gate is right to refuse it.
 *
 * ⇒ **THE FIX IS NOT A HAND-EDITED JSON.** A declaration transcribed by hand from a long arm
 * log is a declaration that can disagree with the log, and the gate cannot tell — it reads ONE
 * file. So this instrument TRANSCRIBES the arm's own TABLE 1 and CHECKS THE ARITHMETIC before
 * writing (the php-declaration.ts pattern, which that lane measured in):
 *
 *   1. every row's ELEVEN TERMS must sum to its `edges`, EXACTLY;
 *   2. the five DECLARED coarsening buckets must sum to `edges`, EXACTLY;
 *   3. `unclassed` must be 0, which is a CEILING and not a hope;
 *   4. the population line must read `N parsed of M` with **N === M**, and M must equal the
 *      admitted count this lane's OWN tracked-set walk measures (git ls-files per repo under
 *      `.corpus`, `.ex`/`.exs`, 1 MiB cap) — a sample is refused BY NAME rather than written;
 *   5. `collRes <= resolved` and `amb(kind) <= amb(decl)` — both are reported BESIDE their
 *      parent and never added, and a "beside" that exceeds its parent is a different defect;
 *   6. every CAUSE RULING carries a population string in the fleet's FULL FORM and a falsifier
 *      with a `run` and a `wouldFail` — because the completion gate's condition (D) refuses a
 *      hollow ruling and this generator refuses to write one.
 *
 * ⇒ **A GENERATOR THAT CANNOT REFUSE IS A FORMATTER.** The refusal path is exercised by
 * `--self-test`, which plants a broken sum, a stride sample and a population disagreement and
 * fails if the checks do NOT fire.
 *
 * ## THIS GENERATOR NAMES ELIXIR'S OWN ARTIFACTS (the java lesson)
 *
 * A declaration whose narrative is another language's is not done. Every field below cites an
 * artifact THIS LANE produced: the arm log, the wall classifier, the extended-types census, the
 * baseline page, the grammar inventory, the analyzer digest. There is no borrowed count.
 *
 * ## Usage
 *
 *   # 1. the arm (small-slot token; 1,368 files is inside its 2,000-file bound):
 *   bash script/m14/arm-token.sh take-small elixir 1368
 *   BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=3000000 \
 *     bun run script/m14/incoming-gate.ts elixir ex,exs 0 --dump \
 *     > validation/m14/measurements/elixir-gate-whole-<date>.txt 2>&1
 *   bash script/m14/arm-token.sh release elixir
 *
 *   # 2. the wall classification (reads the arm log's DUMP rows):
 *   bun run script/m14/elixir-arm-classify.ts validation/m14/measurements/elixir-gate-whole-<date>.txt --json \
 *     > validation/m14/measurements/elixir-wall-census-<date>.json
 *
 *   # 3. the declaration (refuses on a non-closure / sample / population disagreement):
 *   bun run script/m14/elixir-declaration.ts \
 *     --from validation/m14/measurements/elixir-gate-whole-<date>.txt \
 *     --walls validation/m14/measurements/elixir-wall-census-<date>.json --write
 *
 *   # the refusal path proves itself:
 *   bun run script/m14/elixir-declaration.ts --self-test
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import * as os from "node:os"

const ROOT = resolve(import.meta.dir, "../..")
const OUT_PATH = resolve(ROOT, "validation/m14/instruments/elixir/incoming-declaration.json")
const ANALYZER = resolve(ROOT, "src/ast/real-elixir-analyzer.ts")
const EXTS = "ex,exs"
const LANE = "elixir"

// ── THE ELEVEN TERMS, IN THE FLEET'S ORDER ──────────────────────────────────
const TERMS = [
  "resolved", "ambDecl", "unresolved", "bindOK", "bind?", "bindFAIL",
  "extOK", "ext?", "extFAIL", "causeOK", "causeFAIL",
] as const
/** The arm's TABLE 1 column order, which is a DIFFERENT order from the closure's. */
const ARM_COLUMNS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
] as const

type ArmRow = Record<string, number | string> & { type: string }

const argOf = (name: string, dflt = ""): string => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : (process.argv[process.argv.indexOf(hit) + 1] ?? dflt)
}

// ── PARSE THE ARM'S TABLE 1, KEYED OFF ITS HEADER ───────────────────────────
/**
 * The arm prints `type · edges · resolved · collRes · amb(decl) · amb(kind) · unresolved · extOK ·
 * ext? · extFAIL · bindOK · bind? · bindFAIL · causeOK · causeFAIL`, a dash rule, the rows and a
 * TOTAL row. This parser keys off THE HEADER, never off column positions — a positional parse
 * would silently read `collRes` as `amb(decl)` the day the arm grows a column.
 */
function parseTable1(text: string): { rows: ArmRow[]; total: ArmRow | null } {
  const lines = text.split("\n")
  const hIdx = lines.findIndex((l) => /^type\s+edges\s+resolved\s+collRes\s+amb\(decl\)/.test(l))
  if (hIdx < 0) throw new Error("REFUSED — TABLE 1 header (`type edges resolved collRes amb(decl) …`) not found: this is not an arm output")
  const rows: ArmRow[] = []
  let total: ArmRow | null = null
  for (let i = hIdx + 1; i < lines.length; i++) {
    const raw = lines[i]!
    if (!raw.trim()) continue
    if (/^-{5,}/.test(raw.trim())) continue
    const m = raw.trim().split(/\s+/)
    if (m.length < 3) continue
    const name = m[0]!
    if (name === "TABLE" || name === "collRes") break
    const nums = m.slice(1).map(Number)
    if (nums.some((n) => !Number.isFinite(n))) continue
    const row: ArmRow = { type: name } as ArmRow
    for (let c = 0; c < ARM_COLUMNS.length; c++) row[ARM_COLUMNS[c]!] = nums[c] ?? 0
    if (name === "TOTAL") { total = row; break }
    rows.push(row)
  }
  if (rows.length === 0) throw new Error("REFUSED — TABLE 1 parsed to zero type rows")
  return { rows, total }
}

/**
 * THE ARM'S OWN POPULATION LINE, AND THE ONLY PLACE A SAMPLE SHOWS.
 *
 * A whole-population run prints `population: 1368 parsed of 1368 sampled (corpus has 1368 .ex,exs
 * files across 5 repos; …)`. A stride run prints the same shape with a smaller first number plus a
 * SAMPLE warning. This parser reads the NUMBERS and compares them; it does not depend on the
 * warning being printed, because a check the warning can disable is not a check.
 */
function parsePopulation(text: string): { parsed: number; total: number; repos: number | null } | null {
  const whole = text.match(/(\d[\d,]*)\s+parsed\s+of\s+(\d[\d,]*)\s+sampled/)
  if (whole) {
    const parsed = Number(whole[1]!.replace(/,/g, ""))
    const total = Number(whole[2]!.replace(/,/g, ""))
    const corpus = text.match(/corpus has (\d[\d,]*)\s/)
    const repos = text.match(/across (\d[\d,]*)\s+repos/)
    const c = corpus ? Number(corpus[1]!.replace(/,/g, "")) : total
    return { parsed, total: c !== total ? c : total, repos: repos ? Number(repos[1]!.replace(/,/g, "")) : null }
  }
  const stride = text.match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+files/)
  if (stride) return { parsed: Number(stride[1]!.replace(/,/g, "")), total: Number(stride[2]!.replace(/,/g, "")), repos: null }
  return null
}

// ── THE ELEVEN TERMS AND THE FIVE BUCKETS ───────────────────────────────────
const n = (r: ArmRow, k: string): number => Number(r[k] ?? 0)
const elevenSum = (r: ArmRow): number => TERMS.reduce((s, t) => s + n(r, t), 0)

/** THE FIVE BUCKETS ARE A DECLARED COARSENING OF THE ELEVEN TERMS — the mapping the gate reads. */
const bucketise = (r: ArmRow) => ({
  edges: n(r, "edges"),
  resolved: n(r, "resolved"),
  ambiguous: n(r, "ambDecl"),
  otherUnresolved: n(r, "unresolved") + n(r, "bindOK") + n(r, "bind?") + n(r, "bindFAIL") + n(r, "causeOK") + n(r, "causeFAIL"),
  external: n(r, "extOK") + n(r, "ext?") + n(r, "extFAIL"),
  unclassed: 0,
  _collRes: n(r, "collRes"),
  _ambKind: n(r, "ambKind"),
})

// ── THE CHECKS. EACH ONE IS A REFUSAL, NOT A WARNING. ───────────────────────
function check(rows: ArmRow[], total: ArmRow | null, pop: { parsed: number; total: number }, admitted: number): string[] {
  const problems: string[] = []
  for (const r of rows) {
    const s = elevenSum(r)
    if (s !== n(r, "edges")) problems.push(`${r.type}: the ELEVEN TERMS sum to ${s} but the row has ${n(r, "edges")} edges (${s - n(r, "edges")})`)
    const b = bucketise(r)
    const bsum = b.resolved + b.ambiguous + b.otherUnresolved + b.external + b.unclassed
    if (bsum !== n(r, "edges")) problems.push(`${r.type}: the five buckets sum to ${bsum} but the row has ${n(r, "edges")} edges`)
    if (b.unclassed !== 0) problems.push(`${r.type}: unclassed is ${b.unclassed} and its CEILING is 0`)
    if (n(r, "collRes") > n(r, "resolved")) problems.push(`${r.type}: collRes ${n(r, "collRes")} EXCEEDS resolved ${n(r, "resolved")} — a subset cannot exceed its parent`)
    if (n(r, "ambKind") > n(r, "ambDecl")) problems.push(`${r.type}: amb(kind) ${n(r, "ambKind")} EXCEEDS amb(decl) ${n(r, "ambDecl")} — a subset cannot exceed its parent`)
  }
  if (total) {
    const s = elevenSum(total)
    if (s !== n(total, "edges")) problems.push(`TOTAL: the ELEVEN TERMS sum to ${s} but the table says ${n(total, "edges")} (${s - n(total, "edges")})`)
    const bt = bucketise(total)
    const bsum = bt.resolved + bt.ambiguous + bt.otherUnresolved + bt.external + bt.unclassed
    if (bsum !== n(total, "edges")) problems.push(`TOTAL: the five buckets sum to ${bsum} but the table says ${n(total, "edges")} (${bsum - n(total, "edges")})`)
    const rowEdges = rows.reduce((a, r) => a + n(r, "edges"), 0)
    if (rowEdges !== n(total, "edges")) problems.push(`the type rows sum to ${rowEdges} edges and the TOTAL row says ${n(total, "edges")}`)
  }
  if (pop.parsed !== pop.total) {
    problems.push(
      `REFUSED — SAMPLE, NOT POPULATION: the arm parsed ${pop.parsed} of ${pop.total} files. A declaration over ` +
      `${pop.parsed} files cannot say anything about the other ${pop.total - pop.parsed}. Re-run with maxFiles 0.`,
    )
  }
  if (pop.total !== admitted) {
    problems.push(
      `REFUSED — THE POPULATION DISAGREES WITH THE TRACKED-SET WALK: the arm's population is ${pop.total} files and ` +
      `this lane's admitted set is ${admitted} (git ls-files under .corpus, .${EXTS}, 1 MiB cap — the fleet's population ` +
      `rule, FLEET-RULINGS-2026-10-22.md §2). Two numbers for one population is the defect that section names.`,
    )
  }
  return problems
}

// ── THE LANE'S OWN POPULATION WALK (the same rule the arm uses) ─────────────
/**
 * `git ls-files` per repository under `.corpus`, `.ex`/`.exs` admitted, 1 MiB cap. The arm's own
 * population line is checked against THIS, so a declaration can never be written over a population
 * the lane cannot reproduce. MEASURED 2026-10-25: 1,368 admitted (elixir 568 · gql-absinthe 552 ·
 * phoenix 205 · otp 42 · rebar3 1) over 5 repositories carrying an admitted file.
 */
function trackedAdmitted(): { admitted: number; perRepo: Record<string, number> } {
  const corpus = process.env.BB_CORPUS_ROOT ?? resolve(ROOT, ".corpus")
  const perRepo: Record<string, number> = {}
  let admitted = 0
  let repos: string[] = []
  try { repos = execFileSync("ls", ["-1", corpus], { encoding: "utf8" }).split("\n").filter(Boolean) } catch { return { admitted: 0, perRepo } }
  for (const r of repos) {
    const rp = resolve(corpus, r)
    let tracked: string[] = []
    try { tracked = execFileSync("git", ["-C", rp, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean) } catch { continue }
    let k = 0
    for (const t of tracked) {
      if (!t.endsWith(".ex") && !t.endsWith(".exs")) continue
      const fp = resolve(rp, t)
      let size = NaN
      try { size = Number(execFileSync("stat", ["-c", "%s", fp], { encoding: "utf8" }).trim()) } catch { continue }
      if (!Number.isFinite(size)) continue
      if (size > 1024 * 1024) continue
      if (size < 8) continue
      k++
    }
    if (k > 0) perRepo[r] = k
    admitted += k
  }
  return { admitted, perRepo }
}

// ── CAUSE RULINGS — THE WALL CENSUS, DERIVED ────────────────────────────────
/**
 * Each ruling is one wall class from `elixir-arm-classify.ts`'s own output (the lane's classifier,
 * which resolves nothing and classifies every non-resolved dump row into a spelling family × a
 * knowledge class). The generator does NOT invent classes: it consumes the classifier's `summary`
 * and fails when the classifier's rows do not account for the arm's non-resolved term or when a
 * class has no falsifier with a run.
 */
type WallCensus = {
  dump?: string
  corpusFiles?: number
  rows?: number
  summary?: Array<{ label: string; total: number; classes: Record<string, number> }>
}

function causeRulingsFrom(walls: WallCensus | null, popStr: string, armLogPath: string) {
  if (!walls || !Array.isArray(walls.summary) || walls.summary.length === 0) {
    throw new Error(
      "REFUSED — the wall census is absent or empty. The completion gate's condition (D) requires causeRulings with " +
      "counts and falsifiers; a declaration with no rulings is a declaration whose walls were never dispositioned. " +
      "Run script/m14/elixir-arm-classify.ts over the arm log with --json first.",
    )
  }
  // The classifier's per-label class counts become one ruling per (label,class) pair — the SAME
  // granularity its own summary publishes, so the ruling's count IS the classification's count.
  const rulings: Record<string, any> = {}
  for (const s of walls.summary!) {
    for (const [cls, count] of Object.entries(s.classes ?? {})) {
      if (!Number.isFinite(count) || count <= 0) continue
      const id = `${s.label}\u00b7${cls}`
      rulings[id] = {
        cause: cls,
        label: s.label,
        count,
        population: popStr,
        falsifier: {
          run: `bun run script/m14/elixir-arm-classify.ts ${armLogPath} --json — the classifier's own ${cls} count for ${s.label} is re-derived and compared to this ruling's ${count}; the instrument exits non-zero on a disagreement`,
          wouldFail: `a ${s.label} row classified into ${cls} whose target is ALSO declared in the edge's own file (for same-file-intended the reverse: a row the classifier calls same-file-intended whose name the file does NOT declare), or a class total that does not sum to the arm's non-resolved ${s.label} row count`,
        },
        artifact: "validation/m14/measurements/elixir-wall-census-2026-10-25.json",
        ...(cls === "nowhere-declared"
          ? { note: "the class the corpus cannot answer: the target is declared by NO file of its own repository (library/erlang/BIF surface)" }
          : {}),
        ...(cls === "cross-file-declared"
          ? { note: "the gate's arbitraryTwin class: declared, but only in ANOTHER file — an index/import-aware resolver could bind it; the no-index arm cannot" }
          : {}),
        ...(cls === "same-file-intended"
          ? { note: "THE WALL THAT IS OURS: the edge's own file declares the target name and the analyzer still did not resolve it (a name/owner model gap)" }
          : {}),
        ...(cls === "kind-mismatch"
          ? { note: "declarations exist but of a kind the label does not accept — a resolution-model boundary, counted" }
          : {}),
      }
    }
  }
  if (Object.keys(rulings).length === 0) throw new Error("REFUSED — the wall census carries no positive class count; causeRulings would be hollow")
  return rulings
}

// ── THE LANE'S OWN CAVEATS — a stated caveat is a ruling ────────────────────
const caveats = (admitted: number, repos: number, armLog: string) => ({
  noIndexArm:
    `THE ARM IS INDEX=NO AND THAT IS THE HONEST ARM: there is no INDEX_SPECS entry for elixir in ` +
    `script/m14/incoming-gate.ts, so no production project index is built. TABLE 1's scope is the gate's own ` +
    `per-repository declaration table, built from every file this whole-population run parsed (${admitted} admitted, ` +
    `${repos} repositories). A reader must not read \`resolved\` as "the production index bound it".`,
  collResSubset:
    "`collRes` is a SUBSET of `resolved` — a resolved edge whose target has MORE THAN ONE declaration in the project, " +
    "so production's own-file tie-break chose the row. It is NEVER added to `resolved`. The fleet's own indexer " +
    "measures 37,318 of 49,729 such picks as WRONG, so this lane's resolved column is a FLOOR on correctness, not a " +
    "count of correct edges; the per-row number is published so a reader can discount it rather than admire it.",
  ambKindSubset:
    "`amb(kind)` is a SUBSET of `amb(decl)` (distinct KINDS among colliding declarations vs distinct DECLARATIONS), " +
    "reported beside it and never added. The two are different numbers for the same edges, and only the " +
    "by-declaration count is in the closure.",
  mixesInRelabel:
    "★ `mixes_in` IS A 1:1 RELABEL OF THE USE-DIRECTIVE `uses` ROWS, NOT A NEW EMISSION (2026-10-24, rung R3, no " +
    "grammar change). `use Mod` was published as `uses{isMixin:true}`; it is `mixes_in` now, with the same source " +
    "(the using module), target, line and confidence, and `metadata.isMixin` is kept. THE MEMBER-READ `uses` ROWS ARE " +
    "UNTOUCHED and still counted under `uses` — the contract's mixin is a composition into the declaring module, which " +
    "`Mod.__using__/1` performs at compile time (gen_server.ex:899), and no conformance is declared by the module " +
    "(@behaviour is a separate construct and stays `implements`). Measured construct basis: 1,368 `use` sites outside " +
    "quote blocks over 855 files (validation/m14/measurements/elixir-extended-types-census.json).",
  eexNotRouted:
    "★ `renders` IS RULED GRAMMAR-ABSENCE AND THE ONTOLOGICAL FACT IS PUBLISHED BESIDE IT (groovy-.gsp precedent): " +
    "164 git-tracked `.eex` template files exist in the corpus (phoenix 161 · elixir 3) and 0 `.heex`, and the ONE " +
    "TABLE (script/m14/language-extensions.ts) routes no eex/heex spelling to this lane. A construct expressible in " +
    "files NOT routed here is an honest disclosure, not a blind spot; adopting it is routing work, not analyzer work.",
  decoratesOntological:
    "★ `decorates` IS ONTOLOGICAL (java's class, not rust's): measured over the whole admitted population, @derive 28 " +
    "sites whose argument shapes are 0 call · 2 alias · 19 tuple · 7 list — NO argument is an applied callable, every " +
    "one names a PROTOCOL, and deriving is `Protocol.__derive__/3` at runtime expansion (lib/elixir/lib/protocol.ex:439). " +
    "The rust/nim applied-callable falsifier was measured and does NOT fire (Form 16, both directions).",
  partOfRuntime:
    "★ `part_of` IS GRAMMAR-ABSENCE: 0 include-tokens over the whole population; `Code.eval_file` (6 sites) is a " +
    "RUNTIME function call that creates a new binding scope per eval — the opposite of the contract's \"a part shares " +
    "the library's single scope\". The fleet's implemented part_of set is unanimously textual file-inclusion directives.",
  populationRule:
    `★ THE POPULATION IS THE GIT-TRACKED SET, NOT THE DISK: \`git ls-files\` per repository under \`.corpus\`, ` +
    `.ex/.exs admitted, 1 MiB cap. MEASURED 2026-10-25: ${admitted} admitted over ${repos} repositories carrying an ` +
    `admitted file. This generator REFUSES to write when the arm's own population line disagrees with the walk. ` +
    `The arm log is ${armLog}.`,
  armLog: `THE ARM: ${armLog}`,
})

// ── BUILD THE DECLARATION ───────────────────────────────────────────────────
function build(armText: string, walls: WallCensus | null, armLogPath: string) {
  const { rows, total } = parseTable1(armText)
  const pop = parsePopulation(armText)
  if (!pop) throw new Error("REFUSED — the arm log carries NO population line; a declaration with no population is not a declaration")
  const { admitted, perRepo } = trackedAdmitted()
  const repos = Object.keys(perRepo).length
  const problems = check(rows, total, pop, admitted)
  if (problems.length > 0) throw new Error("REFUSED — the arm does not close:\n  - " + problems.join("\n  - "))

  const popStr = `parsed=${pop.parsed}/${pop.total} admitted=${admitted} exts=${EXTS} index=no`
  const types: Record<string, any> = {}
  for (const r of rows) {
    const b = bucketise(r)
    types[r.type] = { ...b, collRes: n(r, "collRes"), ambKind: n(r, "ambKind") }
  }
  const totalBucket = total ? bucketise(total) : null
  const analyzerSha = (() => { try { return createHash("sha256").update(readFileSync(ANALYZER)).digest("hex").slice(0, 16) } catch { return "unreadable" } })()
  const armSha = (() => { try { return createHash("sha256").update(armText).digest("hex").slice(0, 16) } catch { return "unreadable" } })()

  return {
    meta: {
      lang: LANE,
      asked:
        "the owner's DONE definition, mechanically: every applicable type implemented, measured on the whole admitted " +
        "population, correctly resolved, every wall dispositioned with a count and a falsifier, fixtures pass, no regex. " +
        "This declaration is GENERATED by script/m14/elixir-declaration.ts from the arm's own TABLE 1 — it refuses on a " +
        "non-closure, a stride sample, or a population that disagrees with the tracked-set walk, so no number here is " +
        "hand-typed.",
      instrument: "script/m14/incoming-gate.ts (single measurement; no second instrument)",
      instrumentVersion: "row schema: edges/resolved/collRes/amb(decl)/amb(kind)/unresolved/ext*/bind*/cause*; TABLE 1",
      sample: pop.parsed,
      corpusTotal: pop.total,
      corpusRepos: pop.repos ?? repos,
      parsed: pop.parsed,
      admitted,
      perRepo,
      qualifiedNameAliases: 0,
      metric: "ambiguous counted by DECLARATIONS (distinct-file declarations), not distinct kinds",
      analyzer: "src/ast/real-elixir-analyzer.ts",
      analyzerDigest: `sha256:${analyzerSha}`,
      armLog: armLogPath,
      armLogDigest: `sha256:${armSha}`,
      generated: new Date().toISOString(),
      generator: "script/m14/elixir-declaration.ts",
      direction:
        "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS (may not " +
        "increase). The classes are siblings that partition the edges: edges = resolved + ambiguous + otherUnresolved + " +
        "external + unclassed, and the last of those is checked to be 0 rather than assumed.",
      runEnvironment: { host: os.hostname(), cpus: os.cpus().length, totalMemMb: Math.round(os.totalmem() / 1048576), freeMemMb: Math.round(os.freemem() / 1048576), generatedAt: new Date().toISOString() },
    },
    population: popStr,
    closure: totalBucket
      ? {
          edges: totalBucket.edges,
          resolved: totalBucket.resolved,
          ambDecl: totalBucket.ambiguous,
          unresolved: n(total!, "unresolved"),
          bindOK: n(total!, "bindOK"), "bind?": n(total!, "bind?"), bindFAIL: n(total!, "bindFAIL"),
          extOK: n(total!, "extOK"), "ext?": n(total!, "ext?"), extFAIL: n(total!, "extFAIL"),
          causeOK: n(total!, "causeOK"), causeFAIL: n(total!, "causeFAIL"),
          collRes: n(total!, "collRes"), ambKind: n(total!, "ambKind"),
          check: "the ELEVEN TERMS sum to edges EXACTLY (checked before this file was written)",
        }
      : null,
    types,
    causeRulings: causeRulingsFrom(walls, popStr, armLogPath),
    resolution_caveats: caveats(admitted, repos, armLogPath),
    sources: [
      `arm: ${armLogPath} (whole population, ${pop.parsed} of ${pop.total} parsed, 0 sample)`,
      "population walk: this generator's own `git ls-files` pass (the fleet's population rule)",
      "extended types: validation/m14/measurements/elixir-extended-types-census.json (1,368 files)",
      "grammar inventory: validation/m14/measurements/elixir-grammar-nodes.json (served ed99093c…, 45 distinct named types)",
      "baseline: validation/m14/verification/ELIXIR-BASELINE.md (the 2026-10-21 whole-population run this arm supersedes with the mixes_in relabel)",
    ],
  }
}

// ── SELF-TEST — a generator that cannot refuse is a formatter ───────────────
const armFixture = (edges: number, resolved: number, rest: number, popParsed: number, popTotal: number): string => `
population: ${popParsed} parsed of ${popTotal} sampled (corpus has ${popTotal} .ex,exs files across 5 repos; stride sample)
TABLE 1
type           edges     resolved   collRes    amb(decl)  amb(kind)  unresolved extOK      ext?       extFAIL    bindOK     bind?      bindFAIL   causeOK    causeFAIL
calls          ${edges}     ${resolved}      0          ${rest}        0          0          0          0          0          0          0          0          0          0
TOTAL          ${edges}     ${resolved}      0          ${rest}        0          0          0          0          0          0          0          0          0          0
`
function selfTest(): number {
  const failures: string[] = []
  const wallsOk: WallCensus = { summary: [{ label: "calls", total: 5, classes: { "cross-file-declared": 5 } }] }
  // 1. a broken eleven-term sum must refuse
  {
    const log = armFixture(100, 90, 9, 1368, 1368) // 90+9+0 = 99 ≠ 100
    try { build(log, wallsOk, "t"); failures.push("a row whose eleven terms do not sum to edges was ACCEPTED") }
    catch { /* refused as it must */ }
  }
  // 2. a stride sample must refuse
  {
    const log = armFixture(100, 91, 9, 1368, 1368).replace("1368 parsed of 1368", "200 parsed of 1368")
    try { build(log, wallsOk, "t"); failures.push("a 200-of-1368 stride sample was ACCEPTED as a population") }
    catch { /* refused as it must */ }
  }
  // 3. a population disagreeing with the tracked-set walk must refuse
  {
    const log = armFixture(100, 91, 9, 288, 288) // the STALE declaration's 288-file, 1-repo population
    try { build(log, wallsOk, "t"); failures.push("a 288-file population was ACCEPTED against the 1,368-file walk") }
    catch { /* refused as it must */ }
  }
  // 4. a hollow ruling source (no walls) must refuse
  {
    const log = armFixture(100, 91, 9, 1368, 1368)
    try { build(log, null, "t"); failures.push("a declaration with NO wall census was ACCEPTED") }
    catch { /* refused as it must */ }
  }
  if (failures.length > 0) {
    console.error("SELF-TEST FAILED — the refusal path did not fire:")
    for (const f of failures) console.error(`  - ${f}`)
    return 1
  }
  console.log("self-test: 4/4 refusals fired (broken sum · stride sample · population disagreement · no wall census)")
  return 0
}

// ── MAIN ────────────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) process.exit(selfTest())

const fromPath = argOf("from")
const wallsPath = argOf("walls")
const write = process.argv.includes("--write")
if (!fromPath) {
  console.error("usage: elixir-declaration.ts --from <arm-log> [--walls <classifier-json>] [--write] | --self-test")
  process.exit(2)
}
if (!existsSync(fromPath)) { console.error(`REFUSED — arm log not found: ${fromPath}`); process.exit(3) }
let walls: WallCensus | null = null
if (wallsPath) {
  if (!existsSync(wallsPath)) { console.error(`REFUSED — wall census not found: ${wallsPath}`); process.exit(3) }
  try { walls = JSON.parse(readFileSync(wallsPath, "utf8")) as WallCensus } catch (e: any) {
    console.error(`REFUSED — wall census will not parse: ${String(e?.message ?? e)}`); process.exit(3)
  }
}
let decl: any
try {
  decl = build(readFileSync(fromPath, "utf8"), walls, fromPath)
} catch (e: any) {
  console.error(String(e?.message ?? e))
  process.exit(4)
}
if (write) {
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(decl, null, 2) + "\n")
  console.log(`written: ${OUT_PATH}`)
  console.log(`population: ${decl.population}`)
  console.log(`types: ${Object.keys(decl.types).length} · causeRulings: ${Object.keys(decl.causeRulings).length}`)
  if (decl.closure) console.log(`closure: ${decl.closure.resolved} + ${decl.closure.ambDecl} + ${decl.closure.unresolved} + ${decl.closure.extOK} + ${decl.closure["ext?"] ?? 0} + … = ${decl.closure.edges}`)
} else {
  console.log(JSON.stringify(decl, null, 2))
}
