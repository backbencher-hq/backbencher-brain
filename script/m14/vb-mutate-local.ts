/**
 * LANE-OWNED MUTATION DRIVER for `src/ast/real-vb-analyzer.ts`.
 *
 * WHY THIS FILE EXISTS RATHER THAN FOUR ENTRIES IN `script/m14/mutate-analyzer.ts`.
 * `mutate-analyzer.ts` is MASTER-owned (`docs/analyzers/ONTOLOGY-WORKSTREAM.md`,
 * ownership table: "Shared harness (script/m14/**)"), and this lane may not edit
 * it. That file also mutates by TRANSFORM on an already-produced result — the
 * mutant's `analyze` is the real analyzer's output passed through a function — so
 * it can only simulate a defect that is expressible as a post-hoc edit of the
 * emitted edges.
 *
 * Four of this lane's defects are not expressible that way:
 *
 *   - `constructionIsFragment` answering true for a construction that carries its
 *     own arguments. The edge LOOKS fine in the output (a string target, a
 *     positive line, valid metadata); only the analyzer's own tree decision is
 *     wrong. A transform cannot see it.
 *   - `typeArgumentsStrippedText` returning the text unchanged. Same.
 *   - the `tuple_type` branch in `pushTypeReference`. Same.
 *   - the dedupe pass running. A transform CAN simulate that by dropping the
 *     `duplicateRows` rows' siblings, and this driver still mutates it at source
 *     level because that is the stronger claim.
 *
 * So this driver makes the mutation where the defect is: it edits the analyzer
 * SOURCE, runs the real fixture lane through the real production entry, and
 * requires the lane to go RED. A mutant that survives is recorded as a survivor,
 * never skipped — the honesty contract's §5.4 ("Silence is guilt").
 *
 * IT RESTORES THE FILE. The source is rewritten from a pre-run snapshot and the
 * restoration is verified byte-for-byte, because a driver that can leave a lane's
 * analyzer mutated is a worse thing than no driver.
 *
 * THE FIXTURE it runs against is `vb/edge-endpoint-integrity`, plus the whole vb
 * lane (`vb/declaration-shapes` and `vb/ontology-exports-instantiates-uses`) so
 * a mutation that breaks one fixture and silently satisfies another is visible.
 *
 * CLI: npx tsx script/m14/vb-mutate-local.ts [--out <path>]
 */
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"

const ANALYZER = "src/ast/real-vb-analyzer.ts"
const FIXTURE_LANE = ["--lang", "vb"]
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined

interface Mutant {
  id: string
  defectClass: string
  description: string
  /** The exact source text to find. Absent means the mutant is a deletion. */
  find?: string
  replace?: string
  /** Only run the mutant if this text is present, so a drifted file is a loud
   *  failure rather than a mutant that quietly matches nothing and "passes". */
  requires?: string
  killedBy?: string
}

const MUTANTS: Mutant[] = [
  {
    id: "vb/construction-climbs-any-access-chain",
    defectClass: "fabricated-target",
    description:
      "PRE-FIX SHAPE, restored exactly: `constructionIsFragment` answered 'is my parent a member_access_expression whose object I am?', which is true for BOTH `New System.Text.StringBuilder` (a namespace prefix, where the type continues in the chain) and `New StackFrame(1).GetMethod()` (a whole construction whose receiver is then read). Climbing the second published `instantiates -> GetMethod` -- a method, not a type. Measured on the lane corpus before the fix: 322 of the 15,543 construction nodes in an access chain were complete constructions named off the wrong node, and an independent source-text oracle put the error at 1.07% of all `instantiates` edges with targets `ToList` 59, `Message` 6, `Length` 4, `GetMethod` 4, `Contains` 4, `Clone` 2.",
    find: `    if (n.namedChildCount !== 1) return false
    const ty = n.childForFieldName("type")
    if (!ty) return false
    return ty.type === "simple_name" || ty.type === "identifier"`,
    replace: `    return true`,
    requires: "if (n.namedChildCount !== 1) return false",
  },
  {
    id: "vb/namespace-prefix-climb-removed",
    defectClass: "wrong-target",
    description:
      "THE OTHER DIRECTION, and the reason the fix is not simply 'never climb'. Removing the climb entirely satisfies every `forbid` row above -- no `GetMethod`, no `ToList`, no `Add` -- while breaking 15,221 genuine namespace fragments into `instantiates -> System`, `-> GameJolt`, `-> Servers`: a NAMESPACE, which nothing constructs. A mutant that only tests the forbidden shape cannot see this, so the fixture pins `instantiates Trace -> StringBuilder` with `meta.qualifiedConstruction: true` as a control and this mutant is what kills it.",
    find: `    if (this.constructionIsFragment(n)) {
      let outer: Node = n`,
    replace: `    if (false && this.constructionIsFragment(n)) {
      let outer: Node = n`,
    requires: "if (this.constructionIsFragment(n)) {",
  },
  {
    id: "vb/type-arguments-kept-in-heritage-target",
    defectClass: "unusable-target",
    description:
      "PRE-FIX SHAPE: a member-level heritage target kept its type arguments, so `Public Function GetEnumerator() Implements IEnumerable(Of String).GetEnumerator` published the target `IEnumerable(Of String).GetEnumerator`. That string is in no symbol table, is not navigable, and matches no oracle. Measured on the lane corpus before the fix: 94 of the 286 `implements` edges (32.9%).",
    find: "const target = this.typeArgumentsStrippedText(nameNode)",
    replace: "const target = this.nameText(nameNode).trim()",
    requires: "typeArgumentsStrippedText(nameNode)",
  },
  {
    id: "vb/tuple-type-published-as-its-own-text",
    defectClass: "fabricated-target",
    description:
      "PRE-FIX SHAPE: `namingToken` had no case for `tuple_type`, so `Function F() As (Range As ValueRange, Name As String)` published the `references` target `(Range As ValueRange, Name As String)` -- a PARAMETER LIST. Simulated by deleting the `tuple_type` branch, which is the same resulting behaviour: `namingToken` returns the node and `nameText` returns its whole text.",
    find: `    if (typeNode.type === "tuple_type") {
      for (const el of this.namedChildrenOfType(typeNode, "tuple_element")) {
        const ty = el.childForFieldName("type")
        if (ty) this.pushTypeReference(from, ty, role)
      }
      return
    }
`,
    replace: ``,
    requires: 'if (typeNode.type === "tuple_type") {',
  },
  {
    id: "vb/duplicate-relationship-rows-restored",
    defectClass: "duplicate-edge",
    description:
      "The dedupe pass not running. 6,590 rows over the lane corpus were the same row as a row already present (references 3,813, instantiates 1,840, calls 935, imports 2), and `bb_impact` counts degrees, so three `As String` in one signature made `String` look three times as depended-upon. This is the one defect a `mutate-analyzer.ts` transform COULD have simulated; it is mutated at source level anyway because that is the stronger claim, and because the `duplicateRows` metadata the survivor would drop is itself an assertion.",
    find: "    this.dedupeRelationships()\n",
    replace: ``,
    requires: "this.dedupeRelationships()",
  },
  {
    id: "vb/dedupe-keyed-without-the-line",
    defectClass: "lost-fact",
    description:
      "THE OVER-CORRECTION, and the reason the dedupe key includes the line. Keying on (source, target, type) alone would collapse two constructions of one type on two lines into one row, discarding a fact the M59.A7 per-site line contract requires: navigation is the product, and an edge whose site was silently dropped is an edge that cannot be followed to. Two fixture rows differ ONLY by `line_number` and one `expectRelationshipCount` pins 2, so this mutant is killed by both.",
    find: "const key = `${rel.source}\\u0000${rel.target}\\u0000${rel.type}\\u0000${rel.line_number ?? 0}`",
    replace: "const key = `${rel.source}\\u0000${rel.target}\\u0000${rel.type}`",
    requires: "rel.line_number ?? 0}",
  },
  {
    id: "vb/unnamed-construction-dropped-silently",
    defectClass: "undisclosed-gap",
    description:
      "The DISCLOSURE removed, not the behaviour: `New String() {\"x\", \"y\"}` puts an `array_type` wrapping a `predefined_type` in the construction's `type` field, a keyword token with no identifier leaf under it, so there is no name and no edge is published. That is the right behaviour; publishing one from an invented name would be a fabrication. What must not change is that the boundary is COUNTED in `metadata.vbGaps` -- a silent drop and an invented edge are the same boundary stated quietly, and only one of them can be seen by a consumer.",
    find: `      this.note("construction-without-readable-name")
      return`,
    replace: `      return`,
    requires: 'this.note("construction-without-readable-name")',
  },
]

const snapshot = readFileSync(ANALYZER, "utf8")
const restore = (): void => { writeFileSync(ANALYZER, snapshot) }

type Row = { id: string; defectClass: string; outcome: "KILLED" | "SURVIVED" | "NOT-APPLIED"; detail: string }
const rows: Row[] = []

/**
 * The fixture lane, with BOTH streams and the real exit status.
 *
 * `execFileSync` was used first and it reported seven survivors against a lane
 * that demonstrably goes red — because it throws on a non-zero exit and the
 * handler it fell into is not the only path that yields 0. `spawnSync` is used
 * because it cannot fail in that way: `status` is the child's own code, and
 * `stderr` is captured on SUCCESS as well as on failure. A harness that cannot
 * tell a crashed child from a passing one reports survivors that never ran, and
 * seven of those would have been written into a mutation log as evidence.
 */
const runFixtureLane = (): { code: number; out: string; failedFixtures: string[] } => {
  const r = spawnSync("npx", ["tsx", "script/m14/run-fixtures.ts", ...FIXTURE_LANE], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  })
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`
  if (r.error) return { code: -1, out: `${out}\nDRIVER ERROR: ${r.error.message}`, failedFixtures: ["<driver error>"] }
  // THE EXIT CODE IS NOT THE VERDICT, and getting that wrong is how this driver
  // first reported seven survivors against a lane that goes red on every one of
  // them. `script/m14/run-fixtures.ts:1592` ends with an UNCONDITIONAL
  // `process.exit(0)` and the comment above it says why: "F3 gate: fixtures RUN
  // successfully; failures are wave work items". So the process exit status
  // answers "did the run happen", not "did the fixtures pass".
  //
  // The verdict is therefore read from the lane's own OUTPUT, which is where the
  // runner puts it:
  //   `FAIL  <fixtureId>`  one per failing fixture
  //   `N fixture(s) FAIL` the summary
  //   `FIXTURE REGRESSION` the baseline gate, which is the only path that exits 4
  // and a non-zero exit is treated as a failure too, so a harness error can never
  // be read as a pass.
  const failedFixtures = [...out.matchAll(/^FAIL\s+(\S+)/gm)].map((m) => m[1])
  const summaryFail = /\d+ fixture\(s\) FAIL/.test(out)
  const regression = /FIXTURE REGRESSION/.test(out)
  const failed = failedFixtures.length > 0 || summaryFail || regression || (typeof r.status === "number" && r.status !== 0)
  return { code: failed ? 1 : 0, out, failedFixtures: failed ? (failedFixtures.length ? failedFixtures : ["(summary reported failures)"]) : [] }
}

// The lane must be GREEN before any mutant means anything. A survivor recorded
// against a red baseline is not a survivor, it is a baseline that was already
// broken, and the two must never be reported as one.
const baseline = runFixtureLane()
const baselineGreen = baseline.code === 0 && baseline.failedFixtures.length === 0
console.log(`vb local mutation driver — analyzer ${ANALYZER}`)
console.log(`baseline fixture lane (${FIXTURE_LANE.join(" ")}): ${baselineGreen ? "PASS" : `FAIL (exit ${baseline.code})`}`)
if (!baselineGreen) {
  console.log(baseline.out.split("\n").slice(-25).join("\n"))
  restore()
  console.log("\nREFUSING TO RUN MUTANTS against a red baseline: a 'survivor' measured against a broken lane is not a survivor, and recording it as one would be a lie about the suite.")
  process.exit(2)
}

for (const m of MUTANTS) {
  const src = readFileSync(ANALYZER, "utf8")
  if (m.requires && !src.includes(m.requires)) {
    rows.push({ id: m.id, defectClass: m.defectClass, outcome: "NOT-APPLIED", detail: `the file no longer contains the text this mutant edits (${JSON.stringify(m.requires.slice(0, 60))}) — the analyzer was restructured and this mutant needs rewriting, not re-running` })
    continue
  }
  if (m.find !== undefined && !src.includes(m.find)) {
    rows.push({ id: m.id, defectClass: m.defectClass, outcome: "NOT-APPLIED", detail: `find text absent (${JSON.stringify(m.find.slice(0, 60))}) — same as above` })
    continue
  }
  const mutated = m.find === undefined ? src : src.replace(m.find, m.replace ?? "")
  if (mutated === src) {
    rows.push({ id: m.id, defectClass: m.defectClass, outcome: "NOT-APPLIED", detail: "the replacement produced no change" })
    continue
  }
  writeFileSync(ANALYZER, mutated)
  const r = runFixtureLane()
  console.log(`  ${m.id}: verdict ${r.code === 0 ? "GREEN" : "RED"}, failing fixtures: ${r.failedFixtures.join(", ") || "(none)"}`)
  const detailLines = r.out.split("\n").filter((l) => /FAIL|forbidden|expected|mutant|fixture\(s\)/i.test(l)).slice(-6)
  if (r.code !== 0) {
    rows.push({ id: m.id, defectClass: m.defectClass, outcome: "KILLED", detail: detailLines.join(" | ").slice(0, 400) })
  } else {
    rows.push({ id: m.id, defectClass: m.defectClass, outcome: "SURVIVED", detail: "the fixture lane stayed green — the assertion this mutant breaks does not exist, or exists in a form it does not reach" })
  }
  restore()
}

const restored = readFileSync(ANALYZER, "utf8") === snapshot
console.log(`\nanalyzer restored byte-for-byte: ${restored ? "yes" : "NO — THE WORKING TREE IS MUTATED"}`)
console.log(`\n${"outcome".padEnd(12)}${"id".padEnd(46)}detail`)
console.log("-".repeat(140))
for (const r of rows) console.log(`${r.outcome.padEnd(12)}${r.id.padEnd(46)}${r.detail.slice(0, 90)}`)
const survivors = rows.filter((r) => r.outcome === "SURVIVED")
const notApplied = rows.filter((r) => r.outcome === "NOT-APPLIED")
console.log("-".repeat(140))
console.log(`${rows.length} mutants: ${rows.filter((r) => r.outcome === "KILLED").length} killed, ${survivors.length} SURVIVING, ${notApplied.length} not applied`)

if (OUT) {
  const md = [
    `# M60/VISUAL_BASIC local mutation log — \`${ANALYZER}\``,
    ``,
    `Source-level mutants driven by \`script/m14/vb-mutate-local.ts\`, each a single`,
    `edit to the analyzer, each run through \`npx tsx script/m14/run-fixtures.ts --lang vb\``,
    `with the file restored afterwards and the restoration verified byte-for-byte. The lane is`,
    `required to be GREEN before any mutant runs: a "survivor" measured against a red`,
    `baseline is not a survivor.`,
    ``,
    `These are lane-owned because \`script/m14/mutate-analyzer.ts\` is MASTER-owned and`,
    `because four of these defects are not expressible as a post-hoc transform of an`,
    `emitted result — the edge looks well-formed in the output and only the analyzer's own`,
    `tree decision is wrong.`,
    ``,
    `| mutant | defect class | outcome |`,
    `|---|---|---|`,
    ...rows.map((r) => `| \`${r.id}\` | ${r.defectClass} | **${r.outcome}** — ${r.detail.replace(/\|/g, "/").slice(0, 300)} |`),
    ``,
    `Baseline before the run: ${baselineGreen ? "green" : "red"}. Analyzer restored: ${restored ? "yes" : "NO"}.`,
    ``,
  ].join("\n")
  writeFileSync(OUT, md)
  console.log(`\nwrote ${OUT}`)
}

if (!restored || survivors.length > 0 || notApplied.length > 0) process.exitCode = 1
