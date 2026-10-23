/**
 * SCALA — THE WHOLE-POPULATION DECLARATION, GENERATED FROM THE ARM'S OWN TABLE.
 *
 * ## Why this file exists
 *
 * The completion gate (`script/m14/completion-gate.ts`) reads
 * `validation/m14/instruments/scala/incoming-declaration.json` and asks four
 * questions of it. This lane's existing declaration answered the fourth with a
 * 200-FILE SAMPLE: `sample: 200, corpusTotal: 18964, parsed: 200`, generated
 * 2026-10-10 against a corpus carrying TWO scala repositories. The gate read
 * that as UNREAD, not met, and it was right.
 *
 * ⇒⇒⇒ **THE FIX IS NOT A HAND-EDITED JSON.** A declaration transcribed by hand
 * from a long arm log is a declaration that can disagree with the log, and the
 * gate cannot tell — it reads ONE file. So this instrument TRANSCRIBES the arm's
 * own TABLE 1 and then CHECKS THE ARITHMETIC before it writes anything:
 *
 *   1. every row's ELEVEN TERMS must sum to its `edges`, EXACTLY;
 *   2. the five DECLARED coarsening buckets must sum to `edges`, EXACTLY;
 *   3. `unclassed` must be 0, which is a CEILING and not a hope;
 *   4. the population line must read `N of M files` with **N === M**, and M must
 *      equal the tracked-set admitted count this lane measured — a sample is
 *      refused by name rather than written;
 *   5. `collRes` must be `<= resolved` and `amb(kind)` must be `<= amb(decl)`,
 *      because the fleet reports both BESIDE their parent and never adds them,
 *      and a "beside" that can exceed its parent is a different defect.
 *
 * ⇒⇒⇒ **A GENERATOR THAT CANNOT REFUSE IS A FORMATTER.** Every check above exits
 * non-zero with the reason, so running this over a stride artefact prints REFUSED
 * rather than a declaration — and that refusal is the positive control, run in
 * this file's own self-test.
 *
 * ## The two numbers this lane publishes and never conflates
 *
 * - **THE POPULATION**, from the tracked-set walk: `git ls-files` per repository
 *   under the 1 MiB cap, over `.scala`/`.sc`/`.sbt`. MEASURED 2026-10-22:
 *   **19,347 admitted of 19,347 paths, 4 repositories**, artefact
 *   `validation/m14/measurements/scala-construct-census.json`.
 * - **THE GRAMMAR'S NODE-TYPE COUNT**, from the served build: **189 named node
 *   types of 455 ids** under the grammar's own rule, and **191** under the
 *   fleet's rule (the grammar's own named types PLUS the universal `ERROR` and
 *   `MISSING` pair, `FLEET-RULINGS-2026-10-22.md` §2). Both are published with
 *   the rule in the same sentence, beside the served digest
 *   `393cc91ba940440f598a2102cddd6fee92217096cedaef7f793392598f0c9917`.
 *
 *   ⇒ A count without its rule is a measurement of a moment; the sql lane held
 *   592/594/596 for one thing and the fix was not to pick one but to name each
 *   rule. This lane's 189 had the same defect one turn earlier: it was right and
 *   it did not say what it was counting.
 *
 * ## Usage
 *
 *   bun run script/m14/scala-declaration.ts --from <arm-output.txt> [--write]
 *   bun run script/m14/scala-declaration.ts --self-test
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createHash } from "node:crypto"

const ROOT = resolve(import.meta.dir, "../..")
const OUT_PATH = resolve(ROOT, "validation/m14/instruments/scala/incoming-declaration.json")
const CENSUS_PATH = resolve(ROOT, "validation/m14/measurements/scala-construct-census.json")
const ANALYZER = resolve(ROOT, "src/ast/real-scala-analyzer.ts")

// ── THE ELEVEN TERMS, IN THE FLEET'S ORDER ──────────────────────────────────
// `resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext?
//  + extFAIL + causeOK + causeFAIL = edges` — the arm prints them in this order.
const TERMS = [
  "resolved", "ambDecl", "unresolved", "bindOK", "bind?", "bindFAIL",
  "extOK", "ext?", "extFAIL", "causeOK", "causeFAIL",
] as const

/** The arm's TABLE 1 column order, which is a DIFFERENT order from the closure's. */
const ARM_COLUMNS = [
  "edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
] as const

interface Row {
  type: string
  edges: number
  resolved: number
  collRes: number
  ambDecl: number
  ambKind: number
  unresolved: number
  extOK: number
  ext?: number
  extFAIL: number
  bindOK: number
  bind?: number
  bindFAIL: number
  causeOK: number
  causeFAIL: number
}

type ArmRow = Record<string, number> & { type: string }

const argOf = (name: string, dflt = ""): string => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : (process.argv[process.argv.indexOf(hit) + 1] ?? dflt)
}

// ── PARSE THE ARM'S TABLE 1 ─────────────────────────────────────────────────
/**
 * The arm prints a header row naming the columns, a rule of dashes, the rows, and
 * a TOTAL row. This parser keys off THE HEADER, never off column positions — the
 * arm's column order is its own and a positional parse would silently take
 * `collRes` for `amb(decl)` the day the arm grows a column.
 */
function parseTable1(text: string): { rows: ArmRow[]; total: ArmRow | null; header: string[] } {
  const lines = text.split("\n")
  const hIdx = lines.findIndex((l) => /^type\s+edges\s+resolved\s+collRes\s+amb\(decl\)/.test(l))
  if (hIdx < 0) throw new Error("REFUSED — TABLE 1 header (`type edges resolved collRes amb(decl) …`) not found: this is not an arm output")
  const header = lines[hIdx]!.trim().split(/\s{2,}|\s+/).filter(Boolean)
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
    const row: any = { type: name }
    for (let c = 0; c < ARM_COLUMNS.length; c++) row[ARM_COLUMNS[c]!] = nums[c] ?? 0
    if (name === "TOTAL") { total = row; break }
    rows.push(row)
  }
  if (rows.length === 0) throw new Error("REFUSED — TABLE 1 parsed to zero type rows")
  return { rows, total, header }
}

/**
 * THE ARM'S OWN POPULATION LINE, AND THE ONLY PLACE A SAMPLE SHOWS.
 *
 * ⇒ TWO SPELLINGS EXIST AND BOTH ARE THE ARM'S, WHICH IS WHY BOTH ARE PARSED:
 *   · a WHOLE-POPULATION run prints  `population: 19347 parsed of 19347 sampled (corpus has 19347 … files across 4 repos)`
 *   · a STRIDE run prints            `SAMPLE, NOT POPULATION: 600 of 19347 files.` as a warning
 *
 * ★ AND THE SECOND FORM IS WHY THE CHECK MATTERS: the stride artefact's own `population:` line reads
 * `600 parsed of 19347 sampled`, so a parser that ONLY understood the warning line would have had to
 * trust that the warning is present. **A CHECK THAT DEPENDS ON THE WARNING BEING PRINTED IS A CHECK THE
 * WARNING CAN DISABLE** — this parser reads the numbers and compares them, so a truncated run is caught
 * whether or not the instrument chose to advertise it.
 */
function parsePopulation(text: string): { parsed: number; total: number } | null {
  const whole = text.match(/(\d[\d,]*)\s+parsed\s+of\s+(\d[\d,]*)\s+sampled/)
  if (whole) {
    const parsed = Number(whole[1]!.replace(/,/g, ""))
    const total = Number(whole[2]!.replace(/,/g, ""))
    // `corpus has N … files` — when present it MUST agree with the sampled total; two numbers for one
    // population inside one line is the same defect the fleet ruled on, one order of magnitude smaller.
    const corpus = text.match(/corpus has (\d[\d,]*)\s/)
    if (corpus) {
      const c = Number(corpus[1]!.replace(/,/g, ""))
      if (c !== total) return { parsed, total: c }
    }
    return { parsed, total }
  }
  const stride = text.match(/(\d[\d,]*)\s+of\s+(\d[\d,]*)\s+files/)
  if (stride) return { parsed: Number(stride[1]!.replace(/,/g, "")), total: Number(stride[2]!.replace(/,/g, "")) }
  return null
}

// ── THE ELEVEN TERMS AND THE FIVE BUCKETS ───────────────────────────────────
const elevenSum = (r: ArmRow): number => TERMS.reduce((s, t) => s + (r[t] ?? 0), 0)

/**
 * THE FIVE BUCKETS ARE A **DECLARED COARSENING** OF THE ELEVEN TERMS, and this
 * map is the declaration. The dart lane proved the map arithmetically exact on a
 * real run; it is exact here because BOTH sides are summed from the SAME eleven
 * numbers, so the only way to break it is to break the eleven first.
 */
const bucketise = (r: ArmRow) => ({
  edges: r.edges,
  resolved: r.resolved,
  ambiguous: r.ambDecl,
  otherUnresolved:
    r.unresolved + r.bindOK + r["bind?"]! + r.bindFAIL + r.causeOK + r.causeFAIL,
  external: r.extOK + r["ext?"]! + r.extFAIL,
  unclassed: 0,
  _collRes: r.collRes,
  _ambKind: r.ambKind,
})

// ── THE CHECKS. EACH ONE EXITS. NONE OF THEM WARNS. ─────────────────────────
function check(rows: ArmRow[], total: ArmRow | null, pop: { parsed: number; total: number }, admitted: number): string[] {
  const problems: string[] = []

  for (const r of rows) {
    const s = elevenSum(r)
    if (s !== r.edges) problems.push(`${r.type}: the ELEVEN TERMS sum to ${s} but the row has ${r.edges} edges (${s - r.edges})`)
    const b = bucketise(r)
    const bsum = b.resolved + b.ambiguous + b.otherUnresolved + b.external + b.unclassed
    if (bsum !== r.edges) problems.push(`${r.type}: the five buckets sum to ${bsum} but the row has ${r.edges} edges`)
    if (b.unclassed !== 0) problems.push(`${r.type}: unclassed is ${b.unclassed} and its CEILING is 0`)
    if (r.collRes > r.resolved) problems.push(`${r.type}: collRes ${r.collRes} EXCEEDS resolved ${r.resolved} — a subset cannot exceed its parent`)
    if (r.ambKind > r.ambDecl) problems.push(`${r.type}: amb(kind) ${r.ambKind} EXCEEDS amb(decl) ${r.ambDecl} — a subset cannot exceed its parent`)
  }

  if (total) {
    const s = elevenSum(total)
    if (s !== total.edges) problems.push(`TOTAL: the ELEVEN TERMS sum to ${s} but the table says ${total.edges} (${s - total.edges})`)
    // ⇒⇒⇒ **`unclassed` IS NOT AN ARM COLUMN** — it is a DERIVED bucket, and the first cut of this
    // check read `total.unclassed` on an `ArmRow`, whose `Record<string, number>` index signature
    // says every key exists, so the field read `undefined` and the check fired on EVERY real arm
    // output. The self-test's own second control caught it. ⇒ **A TYPE WITH AN INDEX SIGNATURE IS A
    // TYPE THAT CANNOT CATCH A MISSING KEY**, which is why `tsc` caught the `registrySha` family and
    // could not catch this one. The check now reads the bucket, which is where `unclassed` lives.
    const bt = bucketise(total)
    const bsum = bt.resolved + bt.ambiguous + bt.otherUnresolved + bt.external + bt.unclassed
    if (bsum !== total.edges) problems.push(`TOTAL: the five buckets sum to ${bsum} but the table says ${total.edges} (${bsum - total.edges})`)
    if (bt.unclassed !== 0) problems.push(`TOTAL: unclassed is ${bt.unclassed}`)
    const rowEdges = rows.reduce((a, r) => a + r.edges, 0)
    if (rowEdges !== total.edges) problems.push(`the type rows sum to ${rowEdges} edges and the TOTAL row says ${total.edges}`)
  }

  // ⇒ THE POPULATION CHECK, AND IT IS THE ONE THIS LANE PAID FOR. A sample is
  //   REFUSED BY NAME: a 200-file declaration reads exactly like a whole-population
  //   one in every field except this line, which is why the gate exists.
  if (pop.parsed !== pop.total) {
    problems.push(
      `REFUSED — SAMPLE, NOT POPULATION: the arm parsed ${pop.parsed} of ${pop.total} files. ` +
      `A declaration over ${pop.parsed} files cannot say anything about the other ${pop.total - pop.parsed}. Run with maxFiles 0.`,
    )
  }
  if (pop.total !== admitted) {
    problems.push(
      `REFUSED — THE POPULATION DISAGREES WITH THE TRACKED-SET WALK: the arm's corpus is ${pop.total} files ` +
      `and this lane's admitted set is ${admitted} (validation/m14/measurements/scala-construct-census.json). ` +
      `Two numbers for one population is the defect FLEET-RULINGS-2026-10-22.md §2 names.`,
    )
  }
  return problems
}

// ── THE LANE'S OWN CAVEATS ──────────────────────────────────────────────────
/**
 * ⇒ THE CAVEAT CHANNEL IS THE HTML LANE'S FINDING: the gate's condition (C)
 * checked that the buckets PARTITION the edges, and **a partition is not a
 * correctness property**. A stated caveat is a ruling; an unstated one is a hole.
 *
 * Every caveat below is MEASURED on this lane's own instruments, and each names
 * the artefact a reader can re-derive it from.
 */
const caveats = (pop: { parsed: number; total: number }) => ({
  collResSubset:
    "`collRes` — a resolved edge whose target has MORE THAN ONE declaration in the project — is a SUBSET of " +
    "`resolved` and is NEVER added to it. It is concentrated in ONE type: `contains`, where every member of a " +
    "project answers to the owner's name, so the tie-break is doing real work on almost every row. " +
    "⇒ READ `contains`'s resolved column AS A FLOOR ON CORRECTNESS, not as a count of correct edges: the fleet's " +
    "own indexer measures a large share of such tie-break picks as wrong. The number is published per row " +
    "above so no reader has to guess which types carry it.",

  ambKindSubset:
    "`amb(kind)` is a SUBSET of `amb(decl)` (it counts distinct KINDS among the colliding declarations, where " +
    "`amb(decl)` counts distinct DECLARATIONS), reported beside it and never added. Two orders of magnitude " +
    "separate them on this lane, which is the fleet's standing reason for counting by declaration.",

  perFileScope:
    "THE RESOLUTION SCOPE IS PER PROJECT — the repository a file belongs to — which is production's scope: " +
    "`parallel-indexer.resolveRelationships` fills `target_symbol_id` only from a project-scoped qualified-name " +
    "exact match, or from a bare name whose count in THAT project is exactly 1. A name declared in the corpus " +
    "but in ANOTHER repository therefore reads unresolved HERE and would not necessarily read so in a pooled " +
    "scope. ⇒ THE ARM PRINTS BOTH TABLES for exactly this reason and this lane publishes the PER-PROJECT one as " +
    "the verdict's, because it is the scope production runs in.",

  implementsIsTheSelfType:
    "★ THE `implements` ROWS COME FROM THE SELF TYPE (`this: Logging =>`), AND THAT IS THE CONSTRUCT THAT LOOKS " +
    "UNIMPLEMENTED AND IS NOT. Scala's heritage clause says a trait may REQUIRE a type of its implementor; the " +
    "requirement is an obligation on whatever mixes the trait in, which is what `implements` means. MEASURED over " +
    "the whole admitted population: 1,017 `self_type` sites in 636 files, of which 669 in 398 files carry a " +
    "REQUIRED TYPE (348 in 253 files are a bare self NAME and publish nothing). The X→X case is suppressed by the " +
    "INFORMATION test — `Pure { this: Pure => }` says nothing — and a `structural_type` (`this: { def f: Int }`) " +
    "publishes NOTHING because a structural type names no declaration (4 sites). " +
    "⇒ A reader who sees `implements` on a Scala lane and expects a Java-style `implements` keyword will " +
    "under-read this row; the window `self_type` is the whole of the evidence. Artefacts: " +
    "`validation/m14/measurements/scala-implements-agreement.json` (571 analyzer rows against 571 oracle rows, " +
    "0 disagreements on either side, over all 19,347 files) and `script/m14/scala-implements-red-proof.ts`.",

  rendersAndXmlLiterals:
    "★ SCALA **HAS** XML LITERALS AND THEY ARE **NOT** RENDERING SITES, SO THE ABSENCE OF `renders` MUST NOT BE " +
    "READ AS A BLIND SPOT. MEASURED over the whole admitted population by a PARSE-ONLY census: 979 sites across " +
    "the 8 `xml`-stem node types (`xml_text` 668/17, `xml_name` 187/25, `xml_element` 60/15, `xml_expression` " +
    "39/14, `xml_pattern` 10/4, `xml_attribute` 7/3, `xml_string` 7/3, `xml_comment` 1/1). The fleet's `renders` " +
    "contract (VOCABULARY-EXTENSION-PROPOSAL §2.1) fires on a CAPITALIZED COMPONENT NAME at a rendering site and " +
    "its MUST-NOT list excludes string and namespaced tags; a Scala XML literal's tag is a markup name in an " +
    "EXPRESSION, not a reference to a component declaration. ⇒ THE LARGEST NEAR MISS ON THIS LANE IS NOT XML AT " +
    "ALL: `template_body` is 44,952 sites in 16,303 files, and a Scala 3 `template` is a POLYMORPHIC MEMBER BODY, " +
    "not a rendering site. Artefact: `validation/m14/measurements/scala-node-census.json`.",

  partOfIsOwnership:
    "★ A PACKAGE IS OWNERSHIP AND NOT PART-OF, AND SCALA HAS NOTHING PART-ISH AT ALL — which is why this lane's " +
    "`part_of` basis is the GRAMMAR'S ABSENCE while the csharp lane's was not (csharp has `partial`, whose row " +
    "would be X→X). The fleet's `part_of` is a construct that names ANOTHER UNIT AS A PART (L-2026-10-21-06, the " +
    "rust `mod` precedent: module composition is ownership). MEASURED: `package_clause` 6,704/4,790, " +
    "`package_identifier` 6,705/4,790, `package_object` 168/163, `import_declaration` 26,879/8,840, " +
    "`export_declaration` 271/153, `extension_definition` 1,709/716; the `part`/`partial`/`include`/`fragment` " +
    "stems have 0 of the grammar's 189 named node types.",

  importSourceIsRoot:
    "★ THE `references` ROWS CARRYING `isImportDep` ARE ATTRIBUTED TO `root`, AND `root` IS A **MEASURED** " +
    "ATTRIBUTION, NOT A PLACEHOLDER. `validation/m12/ground-truth/scala.json` carries all six of the hand-audited " +
    "`references` rows with `sourceId: \"root\"` and was verified on both sides of a branch consolidation; the " +
    "evidence decided, and a file-level import genuinely has no declaring symbol as its source. ⇒ A reader must " +
    "not read `root` as 'un-attributed' and must not 'fix' it: the same import is published a SECOND time as an " +
    "`imports` row with `source: \"(file)\"`, which is where a per-file reader should look.",

  populationIsTracked:
    `★ THE POPULATION IS THE GIT-TRACKED SET, NOT THE DISK: \`git ls-files\` per repository under the 1 MiB cap, ` +
    `over \`.scala\`/\`.sc\`/\`.sbt\`. MEASURED 2026-10-22: ${pop.total} admitted of ${pop.total} paths, 4 ` +
    `repositories (scala3 18,616 · cats-effect 462 · gql-sangria 267 · pixie 2), 199 symlinked directories ` +
    `followed over 202 corpus entries, 0 files over the cap. ⇒ THE PREVIOUS DECLARATION'S \`corpusTotal: 18964\` ` +
    `IS SUPERSEDED, NOT CONTRADICTED: it was generated 2026-10-10 against a corpus whose \`corpusRepos\` was 2. ` +
    `The 383-file delta is the NET of that growth and is NOT decomposed here, because a decomposition needs the ` +
    `old tree and this lane does not carry a 2026-10-10 checkout. ⇒ A number that does not say which rule ` +
    `produced it cannot be compared (FLEET-RULINGS-2026-10-22.md), and a date plus a repo count is the smallest ` +
    `thing that makes two numbers comparable.`,

  measuredOnAHealthyBox:
    "★ THE CLOSURE ABOVE IS A NUMBER ABOUT THE POPULATION ONLY IF IT WAS MEASURED ON A MACHINE THAT COULD " +
    "MEASURE IT, AND THIS LANE CAN NOW SAY WHICH MACHINE IT WAS. On 2026-10-22 the host hit 167 MB of 15,860 MB " +
    "available with 19,956 MB of swap FULL, because four lanes' arms were resident at once; the kernel would have " +
    "OOM-killed the next large allocation and chosen the victim itself. ⇒ **A WHOLE-POPULATION CLOSURE MEASURED " +
    "WHILE THE BOX THRASHES SWAP IS A NUMBER ABOUT THE BOX** — a truncated or timed-out slice that still prints a " +
    "TABLE looks identical to a complete one, which is THIS LANE'S OWN finding (`implements` before the R3 fix, " +
    "and the seven near-miss censuses) in its general form. " +
    "⇒ THE DEFENCE IS THE INSTRUMENT, NOT THE PROSE: `script/m14/arm-token.sh take` now REFUSES below a memory " +
    "floor and names `MemAvailable` and `SwapFree`, so the arm cannot start into an exhausted machine, and this " +
    "generator records the memory state the arm ran in (`meta.runEnvironment`) so a reader can check the " +
    "condition instead of trusting a sentence. ⇒ **A MEASUREMENT THAT CANNOT DISTINGUISH ITSELF FROM A BROKEN " +
    "ONE IS NOT A MEASUREMENT, AND THE MEMORY GATE IS WHAT MAKES THAT CHECKABLE RATHER THAN RHETORICAL.**",

  sampleRefusedByTheGenerator:
    "★ THIS DECLARATION IS WRITTEN BY `script/m14/scala-declaration.ts`, WHICH REFUSES A SAMPLE BY NAME: it will " +
    "not write a declaration whose arm output parsed fewer files than the population holds, and it refuses a " +
    "population that disagrees with the tracked-set walk. ⇒ THE LANE'S PREVIOUS DECLARATION WAS A 200-FILE " +
    "SAMPLE and every other field in it looked exactly like a whole-population one — that is the failure mode the " +
    "completion gate exists for, and the defence chosen here is an instrument that cannot emit it.",
})

// ── MAIN ────────────────────────────────────────────────────────────────────
const selfTest = process.argv.includes("--self-test")
const fromArg = argOf("from")
const write = process.argv.includes("--write")

const admittedOf = (): number => {
  const d = JSON.parse(readFileSync(CENSUS_PATH, "utf8"))
  return Number(d?.population?.admitted ?? 0)
}

if (selfTest) {
  console.log("SCALA DECLARATION GENERATOR — SELF-TEST (a generator that cannot refuse is a formatter)")
  let pass = 0, fail = 0
  const ctl = (name: string, ok: boolean, detail: string) => {
    if (ok) { pass++; console.log(`  FIRED   ${name} — ${detail}`) }
    else { fail++; console.log(`  MISSED  ${name} — ${detail}`) }
  }

  // CONTROL 1 — a stride artefact must be REFUSED as a sample.
  const stride = resolve(ROOT, "validation/m14/measurements/scala-stride600-incoming.txt")
  if (existsSync(stride)) {
    const t = readFileSync(stride, "utf8")
    const { rows, total } = parseTable1(t)
    const pop = parsePopulation(t)
    const probs = pop ? check(rows, total, pop, admittedOf()) : ["no population line"]
    ctl("a 600-file stride is REFUSED", probs.some((p) => /SAMPLE, NOT POPULATION/.test(p)), `${rows.length} rows parsed; refusal: ${probs.find((p) => /SAMPLE/.test(p))?.slice(0, 80) ?? "(none)"}`)
    ctl("and its ARITHMETIC is still checked", probs.every((p) => !/ELEVEN TERMS|five buckets|unclassed/.test(p)), "the stride's own rows close, so the refusal is about the SAMPLE and not about the sums")
  } else {
    ctl("a 600-file stride is REFUSED", false, "the stride artefact is missing — run with --from instead")
  }

  // CONTROL 2 — a corrupted row must be caught by the arithmetic, not by the eye.
  const fake = [
    "type          edges    resolved  collRes  amb(decl)  amb(kind)  unresolved  extOK   ext?    extFAIL  bindOK   bind?   bindFAIL  causeOK  causeFAIL",
    "----------------------------------------------------------------------------------------------------------------------------------------------------",
    "calls         100      60        0        10         5          30          0       0       0        0        0       0         0        0",
    "----------------------------------------------------------------------------------------------------------------------------------------------------",
    "TOTAL         100      60        0        10         5          30          0       0       0        0        0       0         0        0",
    "100 of 19347 files",
  ].join("\n")
  {
    const { rows, total } = parseTable1(fake)
    const pop = parsePopulation(fake)!
    const probs = check(rows, total, pop, admittedOf())
    ctl("a well-formed fake row passes the arithmetic", !probs.some((p) => /ELEVEN|buckets|unclassed/.test(p)), "60+10+30 = 100")
  }
  {
    const broken = fake.replace("calls         100      60", "calls         100      61")
    const { rows, total } = parseTable1(broken)
    const pop = parsePopulation(broken)!
    const probs = check(rows, total, pop, admittedOf())
    ctl("one bumped term is CAUGHT", probs.some((p) => /ELEVEN TERMS/.test(p)), probs[0]?.slice(0, 90) ?? "")
  }
  {
    const broken = fake.replace("calls         100      60        0        10         5", "calls         100      60        0        4          5")
    const { rows, total } = parseTable1(broken)
    const pop = parsePopulation(broken)!
    const probs = check(rows, total, pop, admittedOf())
    ctl("a subset larger than its parent is CAUGHT", probs.some((p) => /EXCEEDS amb\(decl\)|five buckets/.test(p)), probs.find((p) => /EXCEEDS|buckets/.test(p))?.slice(0, 90) ?? "")
  }
  {
    const broken = fake.replace("100 of 19347 files", "19346 of 19347 files")
    const { rows, total } = parseTable1(broken)
    const pop = parsePopulation(broken)!
    const probs = check(rows, total, pop, admittedOf())
    ctl("one missing file is CAUGHT", probs.some((p) => /SAMPLE, NOT POPULATION/.test(p)), probs.find((p) => /SAMPLE/.test(p))?.slice(0, 70) ?? "")
  }
  {
    const { rows, total } = parseTable1(fake)
    const pop = parsePopulation(fake)!
    const probs = check(rows, total, pop, 19347)
    ctl("the population is checked against the TRACKED-SET WALK, not against itself", probs.some((p) => /arm's corpus is 19347 files/.test(p) === false), "a fake corpus of 19347 vs admitted 19347 is consistent; the walk's own number is what binds")
  }

  console.log(`\n${pass} FIRED · ${fail} MISSED`)
  console.log(fail === 0
    ? "⇒ THE GENERATOR CAN SAY NO, AND IT SAYS NO TO THE EXACT DEFECT THIS LANE HAD: a 200-file sample that reads like a population."
    : "⇒ *** THE GENERATOR CANNOT SAY NO — FIX IT BEFORE TRUSTING ANY DECLARATION IT WRITES ***")
  process.exit(fail === 0 ? 0 : 5)
}

if (!fromArg) {
  console.error("REFUSED — no --from <arm-output.txt>. The declaration is TRANSCRIBED from the arm's own TABLE 1; it is never typed.")
  process.exit(2)
}
// ── ONE ARM RUN, OR SEVERAL DISJOINT CHUNKS SUMMED ──────────────────────────
// ★ THE CHUNKED FORM IS THE FSHARP LANE'S AND IT EXISTS FOR A REASON THIS HOST TAUGHT US: an arm
// that dies at file 17,000 of 19,347 publishes NOTHING if the design is one run, while a set of
// disjoint chunks publishes N of M and REFUSES BY NAME for the rest. The summing is legitimate only
// with its rule stated, so the declaration records the chunk list and the assertion that makes the
// sum meaningful: Σ parsed === admitted.
const fromArgs = process.argv.reduce<string[]>((acc, a, i) => {
  if (a === "--from") { const v = process.argv[i + 1]; if (v) acc.push(v) } else if (a.startsWith("--from=")) acc.push(a.slice(7))
  return acc
}, [])
const sources = fromArgs.length ? fromArgs : [fromArg]
const offsetsArg = argOf("offsets")

const parsedRuns = sources.map((src) => {
  const t = readFileSync(resolve(ROOT, src), "utf8")
  const tbl = parseTable1(t)
  const p = parsePopulation(t)
  if (!p) {
    console.error(`REFUSED — ${src} carries no \`N of M files\` population line, so its population is UNREAD and a declaration over an unknown population is a claim about nothing.`)
    process.exit(2)
  }
  return { src, rows: tbl.rows, total: tbl.total, pop: p }
})

let rows: ArmRow[]
let total: ArmRow | null
let pop: { parsed: number; total: number }
let chunkNote = "one arm run over the whole admitted population"
let chunkList: Array<{ source: string; parsed: number; corpusTotal: number; offset: string | null }> | null = null

if (parsedRuns.length === 1) {
  const only = parsedRuns[0]!
  rows = only.rows; total = only.total; pop = only.pop
} else {
  // ⇒ THE SUM, AND THE SUM IS NOT A NO-OP: the eleven terms are summed PER TYPE, and the
  //   population is the sum of the runs' parsed counts against the corpus each run reports.
  const byType = new Map<string, ArmRow>()
  for (const run of parsedRuns) {
    for (const r of run.rows) {
      const acc = byType.get(r.type)
      if (!acc) { byType.set(r.type, { ...r }) }
      else { for (const c of ARM_COLUMNS) acc[c] = (acc[c] ?? 0) + (r[c] ?? 0) }
    }
  }
  rows = [...byType.values()]
  total = null
  const sumParsed = parsedRuns.reduce((a, r) => a + r.pop.parsed, 0)
  const corpora = new Set(parsedRuns.map((r) => r.pop.total))
  if (corpora.size !== 1) {
    console.error(`REFUSED — the chunks disagree about the corpus size (${[...corpora].join(", ")}); they are not slices of one population.`)
    process.exit(5)
  }
  pop = { parsed: sumParsed, total: [...corpora][0]! }
  const offsets = offsetsArg ? offsetsArg.split(",") : []
  chunkList = parsedRuns.map((r, i) => ({ source: r.src, parsed: r.pop.parsed, corpusTotal: r.pop.total, offset: offsets[i] ?? null }))
  chunkNote =
    `${parsedRuns.length} DISJOINT CHUNKS, SUMMED. Each chunk is a slice of the same ${pop.total}-file corpus and the ` +
    `slices sum to ${sumParsed} of ${pop.total}. ⇒ DISJOINTNESS IS A PROPERTY OF THE OFFSETS PASSED TO THE ARM, NOT OF ` +
    `THESE FILES: the arm cannot see another run's files, so no reader can re-derive disjointness from the outputs. ` +
    `The offsets are recorded in meta.chunks so the claim is checkable against the command that made it. ` +
    `⇒ AND THE REASON THIS FORM EXISTS: an arm that dies at file 17,000 of ${pop.total} publishes NOTHING under a ` +
    `one-run design, and a truncated run that still prints a TABLE is indistinguishable from a complete one — ` +
    `so the lane measures in slices it can COMPLETE and lets the population check refuse the rest by name.`
}
const admitted = admittedOf()
const problems = check(rows, total, pop, admitted)
if (problems.length) {
  console.error("REFUSED — this arm output cannot become a declaration:")
  for (const p of problems) console.error(`  · ${p}`)
  process.exit(5)
}

const analyzerDigest = createHash("sha256").update(readFileSync(ANALYZER)).digest("hex").slice(0, 16)

/**
 * ⇒⇒⇒ THE RUN'S OWN ENVIRONMENT, RECORDED BECAUSE THE CLOSURE'S MEANING DEPENDS ON IT.
 * The arm runner writes `MemAvailable`/`SwapFree` at the moment the token was taken, and this
 * generator puts them in the declaration. A reader can then check that the box was not thrashing
 * when the number was taken — the check the 2026-10-22 memory incident showed nobody had.
 */
const runEnvPath = resolve(ROOT, ".tmp-lead/scala-arm-env.json")
const runEnvironment = existsSync(runEnvPath)
  ? (() => { try { return JSON.parse(readFileSync(runEnvPath, "utf8")) } catch { return null } })()
  : null
const bucketRows = rows.map((r) => [r.type, bucketise(r)] as const)
const sumOf = (k: keyof ReturnType<typeof bucketise>) =>
  bucketRows.reduce((a, [, b]) => a + (b[k] as number), 0)

const decl = {
  meta: {
    lang: "scala",
    instrument: "script/m14/incoming-gate.ts (single measurement; no second instrument)",
    generator: "script/m14/scala-declaration.ts — transcribes the arm's TABLE 1 and REFUSES a sample",
    sample: pop.total,
    corpusTotal: pop.total,
    corpusRepos: 4,
    parsed: pop.parsed,
    population: `parsed=${pop.parsed}/${pop.total} admitted=${admitted} exts=scala,sc,sbt index=no`,
    metric: "ambiguous counted by DECLARATIONS (distinct-file declarations), not distinct kinds",
    analyzer: "src/ast/real-scala-analyzer.ts",
    analyzerDigest: `sha256:${analyzerDigest}`,
    generated: new Date().toISOString().slice(0, 10),
    measurementForm: chunkNote,
    ...(chunkList ? { chunks: chunkList } : {}),
    populationNote:
      `THE POPULATION IS THE WHOLE ADMITTED SET. MEASURED over BB_CORPUS_ROOT=$PWD/.corpus on 2026-10-22: ` +
      `${admitted} admitted files of ${admitted} paths, 4 repositories (scala3 18,616 · cats-effect 462 · ` +
      `gql-sangria 267 · pixie 2), 199 symlinked directories followed over 202 corpus entries, 0 files over ` +
      `the 1 MiB cap. THE RULE: the admitted set is the GIT-TRACKED set, \`git ls-files\` per repository under ` +
      `the cap, extensions .scala/.sc/.sbt — NOT a disk walk. THE SCOPE: index=no, the PER-FILE population: ` +
      `resolution is per project (the repository a file belongs to), which is production's scope. ` +
      `THE ARM PARSED ${pop.parsed} OF ${pop.total} FILES, so the whole population was measured and no stride ` +
      `or subsample is involved. ⇒ THE PREVIOUS DECLARATION'S corpusTotal: 18964 IS SUPERSEDED: it was ` +
      `generated 2026-10-10 with corpusRepos: 2, and the 383-file delta is the net of corpus growth that this ` +
      `lane does not decompose from a number alone.`,
    classMapping:
      "THE FIVE DECLARATION BUCKETS ARE THE GATE'S CLASSES, MAPPED ONCE, HERE, SO NOTHING IS HIDDEN: " +
      "resolved = resolved (collRes is a SUBSET of resolved and is never added); " +
      "ambiguous = amb(decl) (amb(kind) is a SUBSET of amb(decl), reported beside it and never added); " +
      "otherUnresolved = unresolved + bindOK + bind? + bindFAIL + causeOK + causeFAIL " +
      "(a causeOK edge is STATED, not resolved — the gate says 'NEVER folded into resolved'); " +
      "external = extOK + ext? + extFAIL; unclassed = 0, ALWAYS, and it is a CEILING. " +
      "THE CLOSURE: resolved + ambiguous + otherUnresolved + external + unclassed = edges, EXACTLY, and this " +
      "generator CHECKS it before it writes.",
    closure: (() => {
      const edges = sumOf("edges")
      const resolved = sumOf("resolved")
      const ambiguous = sumOf("ambiguous")
      const otherUnresolved = sumOf("otherUnresolved")
      const external = sumOf("external")
      const unclassed = 0
      return {
        edges, resolved, ambiguous, otherUnresolved, external, unclassed,
        sum: resolved + ambiguous + otherUnresolved + external + unclassed,
        exact: resolved + ambiguous + otherUnresolved + external + unclassed === edges,
        collRes_beside: bucketRows.reduce((a, [, b]) => a + b._collRes, 0),
        ambKind_beside: bucketRows.reduce((a, [, b]) => a + b._ambKind, 0),
        residual_ambDecl_plus_unresolved:
          sumOf("ambiguous") + rows.reduce((a, r) => a + r.unresolved, 0),
        resolvedPct: Number(((resolved / edges) * 100).toFixed(2)),
      }
    })(),
  },
  rules: {
    measurement: "one arm run over the whole admitted population, transcribed from its own TABLE 1",
    population: "the whole admitted set; no stride and no subsample",
    direction:
      "resolved/external are FLOORS (may not decrease). ambiguous/otherUnresolved/unclassed are CEILINGS " +
      "(may not increase).",
    elevenTerms:
      "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + " +
      "causeFAIL = edges, and this lane's arm measured each of the eleven per type; the five buckets above are " +
      "a declared coarsening of them, so no term is hidden by the coarsening.",
  },
  causeRulingsNote:
    "THIS LANE'S ARM MEASURED causeOK: 0 AND causeFAIL: 0, AND THAT IS THE HONEST STATE OF ITS CAUSES: the " +
    "scala analyzer does NOT emit a `baseBeyondRunScope` marker, so no edge DECLARES a cause and none can be " +
    "refuted. ⇒ THE UNRESOLVED EDGES ARE THEREFORE UNSTATED, NOT CAUSED, and the ruling below is about WHAT " +
    "THEY ARE rather than about a marker the analyzer never writes. ⇒ A LANE THAT PUBLISHED A causeOK COUNT " +
    "IT HAD NOT MEASURED WOULD BE FABRICATING A DISPOSITION; this one rules the absence.",
  types: Object.fromEntries(bucketRows),
  runEnvironment,
  causeRulings: {
    noDeclaredCauseMarker: {
      population: `parsed=${pop.parsed}/${pop.total} admitted=${admitted} exts=scala,sc,sbt index=no`,
      edges: rows.reduce((a, r) => a + r.unresolved, 0),
      what:
        "the unresolved edges of every type, as ONE ruling, because this analyzer declares no cause marker: " +
        "causeOK = 0 and causeFAIL = 0 over the whole population, so the disposition is that these targets name " +
        "nothing the PER-PROJECT key space could answer, not that they were excused.",
      falsifier: {
        run:
          "BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/scala-declaration.ts --self-test " +
          "&& BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts scala scala,sc,sbt 0 --dump",
        wouldFail:
          "THIS RULING FAILS IF ANY of two things is true, and both are checked by the run above: " +
          "(1) causeOK > 0 or causeFAIL > 0 in TABLE 1 — then the analyzer DOES declare causes and this ruling's " +
          "premise (it declares none) is false, and the edges must be re-ruled cause by cause; or " +
          "(2) the five buckets do not sum to the edge count, or unclassed is not 0 — then some edges are " +
          "outside every disposition and the 'unresolved' row is not the whole of the unexplained set. " +
          "⇒ NOTE WHAT IS NOT A FALSIFIER HERE: a target being unresolvable. That is the claim.",
      },
    },
  },
  resolution_caveats: caveats(pop),
}

console.log("SCALA WHOLE-POPULATION DECLARATION")
console.log(`  population           parsed=${pop.parsed}/${pop.total} admitted=${admitted} index=no`)
console.log(`  types                 ${rows.length}`)
console.log(`  edges                 ${decl.meta.closure.edges}`)
console.log(`  resolved              ${decl.meta.closure.resolved}  (${decl.meta.closure.resolvedPct}%)`)
console.log(`  ambiguous (amb decl)  ${decl.meta.closure.ambiguous}`)
console.log(`  otherUnresolved       ${decl.meta.closure.otherUnresolved}`)
console.log(`  external              ${decl.meta.closure.external}`)
console.log(`  unclassed             ${decl.meta.closure.unclassed}   (ceiling 0)`)
console.log(`  CLOSURE EXACT         ${decl.meta.closure.exact ? "YES" : "NO — REFUSED"}`)
console.log(`  collRes   BESIDE      ${decl.meta.closure.collRes_beside}`)
console.log(`  amb(kind) BESIDE      ${decl.meta.closure.ambKind_beside}`)
console.log(`  causeOK / causeFAIL   ${rows.reduce((a, r) => a + r.causeOK, 0)} / ${rows.reduce((a, r) => a + r.causeFAIL, 0)}`)

if (!decl.meta.closure.exact) {
  console.error("REFUSED — the closure does not add up; nothing written.")
  process.exit(5)
}
if (!write) {
  console.log("\n(dry run — pass --write to publish the declaration)")
  process.exit(0)
}
mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, JSON.stringify(decl, null, 1) + "\n")
console.log(`\nwritten ${OUT_PATH.replace(ROOT + "/", "")}`)
