// script/m60/csharp-804-verification-pack.ts — M49.CS1 (#804), the verify-first pack.
//
// #804's protocol is not "the fixes were made" — it is: every claim
// PROBE-VERIFIED against the analyzer BEFORE fixing, and every fix closed with
// a fixture pin + a regression mutant + a spec ruling + green gates in the
// same session. This script re-derives that chain at HEAD, per claim, and it
// is written so that it can FAIL:
//
//   for each claim:
//     1. the claim's own words (quoted from reviews/csharp/master-review.md);
//     2. the fixture entries that pin it — and the mark that ties the pin to
//        the claim (a pin nobody can attribute is a pin nobody can audit);
//     3. an INDEPENDENT predicate derived from the claim's words, evaluated
//        against the analyzer's real output at HEAD (not read from the
//        expectation file, so a wrong expectation cannot vouch for itself);
//     4. the reverting mutant(s) — and the requirement that the mutant flips
//        THE CLAIM'S OWN PIN, not merely some other fixture entry, reported
//        with the failing problem text the canonical runner produced.
//
// Run: bun script/m60/csharp-804-verification-pack.ts
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { runLang, LANGS, getParser } from "../m14/run-fixtures"
import { MUTANTS } from "../m14/mutate-analyzer"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

/**
 * Import the oracle as it stood BEFORE the CS review wave, from git. The rev is
 * the OLDEST commit whose `is_pattern_expression` count changed in the oracle —
 * i.e. the commit that introduced the CS-B5 mirror (measured: it introduced both
 * mirrors and all five pins in one wave, 00c49c59). Imports are rewritten to
 * absolute paths because the module is written to live somewhere else.
 */
async function oracleRevertProof(): Promise<{ lines: string[]; failures: number }> {
  const lines: string[] = []
  let failures = 0
  const revs = execFileSync("git", ["log", "-S", "is_pattern_expression", "--format=%H", "--", "script/m14/differential.ts"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
  if (!revs.length) {
    return { lines: ["  FAIL cannot materialise the pre-fix oracle: no revision in history introduced the CS-B5 mirror"], failures: 1 }
  }
  const preRev = `${revs[revs.length - 1]}^`
  const preSrc = execFileSync("git", ["show", `${preRev}:script/m14/differential.ts`], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
  const prePath = path.join("/tmp", "bb-804-prefix-differential.ts")
  fs.writeFileSync(prePath, preSrc.replace(/"\.\.\/\.\.\/src/g, `"${ROOT}/src`).replace(/"\.\//g, `"${ROOT}/script/m14/`))
  const pre: any = await import(prePath)
  const fixed: any = await import(ORACLE)
  if (typeof pre?.deriveCSharpEdges !== "function" || typeof fixed?.deriveCSharpEdges !== "function") {
    return { lines: [`  FAIL the pre-fix oracle at ${preRev} does not export deriveCSharpEdges — the revert cannot be measured`], failures: 1 }
  }
  const src = fs.readFileSync(FIXTURE_CS, "utf8")
  const root = (await getParser("csharp")).parse(src).rootNode
  const preEdges: any[] = pre.deriveCSharpEdges(root)
  const fixedEdges: any[] = fixed.deriveCSharpEdges(root)
  const has = (edges: any[], label: string, target: string) => edges.some((e) => e.label === label && e.target === target)
  lines.push(`  pre-fix oracle materialised from ${preRev} (the wave that introduced the CS-B2/CS-B5 mirrors)`)

  const cases: { claim: string; ok: boolean; what: string; detail: string }[] = [
    {
      claim: "CS-B2",
      ok: has(preEdges, "calls", "nameof") && !has(fixedEdges, "calls", "nameof"),
      what: "mirror: the pre-fix oracle derives a call to `nameof`, the fixed one does not",
      detail: `pre=${Number(has(preEdges, "calls", "nameof"))} fixed=${Number(has(fixedEdges, "calls", "nameof"))}`,
    },
    {
      claim: "CS-B5",
      ok: has(preEdges, "calls", "Point") && !has(fixedEdges, "calls", "Point"),
      what: "mirror: the pre-fix oracle derives `Point` as a pattern head's CALL, the fixed one does not",
      detail: `pre=${Number(has(preEdges, "calls", "Point"))} fixed=${Number(has(fixedEdges, "calls", "Point"))}`,
    },
    {
      claim: "CS-R1",
      ok: !preEdges.some((e) => e.label === "uses" && e.target === "Max") && !fixedEdges.some((e) => e.label === "uses" && e.target === "Max"),
      what: "premise: the oracle audits calls/instantiates only — a bare member read is derived by NEITHER revision (the blind spot the claim names)",
      detail: `bare uses: pre=${preEdges.filter((e) => e.label === "uses").length} fixed=${fixedEdges.filter((e) => e.label === "uses").length}`,
    },
    {
      claim: "CS-B1",
      ok: has(preEdges, "calls", "WriteLine") && has(fixedEdges, "calls", "WriteLine"),
      what: "premise: the oracle derives every invocation leaf, so a top-level call had to be fixed on the analyzer side (no oracle change was possible)",
      detail: `pre=${Number(has(preEdges, "calls", "WriteLine"))} fixed=${Number(has(fixedEdges, "calls", "WriteLine"))}`,
    },
  ]
  for (const c of cases) {
    if (!c.ok) failures++
    lines.push(`  ${c.ok ? "HOLDS " : "FAILS "} ${c.claim}: ${c.what} (${c.detail})`)
  }
  // Positive control: an oracle that derived nothing would satisfy every
  // "does not derive" above. The fixture really does derive calls.
  const control = fixedEdges.filter((e) => e.label === "calls").length
  lines.push(`  control: the fixed oracle derives ${control} call edge(s) on this fixture (a silent oracle cannot pass the checks above)`)
  if (control < 3) failures++

  // Edge-neutrality for the claims whose fix is analyzer-only (CS-B3's complexity
  // and CS-B4's visibility/export are payloads): the review wave changed the
  // oracle in EXACTLY the two mirrored shapes and nothing else. Measured as a set
  // difference with the two mirrored targets removed — so "payload claims are
  // unaffected" is a reading, not an assumption.
  const key = (e: any) => `${e.label}|${e.from}|${e.target}`
  const strip = (edges: any[]) => new Set(edges.filter((e) => e.target !== "nameof" && e.target !== "Point").map(key))
  const preRest = strip(preEdges)
  const fixedRest = strip(fixedEdges)
  const onlyPre = [...preRest].filter((k) => !fixedRest.has(k))
  const onlyFixed = [...fixedRest].filter((k) => !preRest.has(k))
  const neutral = onlyPre.length === 0 && onlyFixed.length === 0
  lines.push(
    `  ${neutral ? "HOLDS " : "FAILS "} CS-B3/CS-B4: outside the two mirrored shapes the oracle's derivation is IDENTICAL ` +
      `(${preRest.size} edge(s); only-pre=${JSON.stringify(onlyPre.slice(0, 3))} only-fixed=${JSON.stringify(onlyFixed.slice(0, 3))})`,
  )
  if (!neutral) failures++
  return { lines, failures }
}
const FIXTURE_ID = "csharp/bare-value-reads"
const FIXTURE_CS = path.join(ROOT, "validation/m14/fixtures/csharp/bare-value-reads.cs")
const FIXTURE_EXP = path.join(ROOT, "validation/m14/fixtures/csharp/bare-value-reads.expectation.json")
const ORACLE = path.join(ROOT, "script/m14/differential.ts")

type Rel = { type: string; from: string; target: string }
type Pin = Rel & { present: boolean; what: string }

interface Claim {
  id: string
  /** Verbatim from the review — the claim is a quotation, not a paraphrase. */
  quote: string
  /** A mark that ties an existing fixture entry to this claim. */
  attributedBy: string
  /** Where the tie lives (rationale for CS-R1, the pin's own comment otherwise). */
  attribution: "rationale" | "comment"
  pins: Pin[]
  mutants: string[]
}

const CLAIMS: Claim[] = [
  {
    id: "CS-R1",
    quote:
      "The analyzer emitted no bare-identifier edges at all (`return Max;` produced zero relationships) while the oracle audits only calls/instantiates — the CONV-CS-1 blind spot… Implemented `analyzeCSharpBareIdentifierUses`.",
    attributedBy: "CS-R1 (csharp review): bare-identifier value reads",
    attribution: "rationale",
    pins: [
      { type: "uses", from: "Get", target: "Max", present: true, what: "a static field read is an edge" },
      { type: "uses", from: "Get", target: "count", present: true, what: "an instance field read is an edge" },
      { type: "uses", from: "Get", target: "Step", present: true, what: "a const read is an edge" },
      { type: "uses", from: "Shadowed", target: "Max", present: false, what: "a param shadows the member (no edge)" },
      { type: "uses", from: "Make", target: "X", present: false, what: "a with-designator never reads" },
      { type: "uses", from: "Build", target: "X", present: false, what: "an object-initializer designator never reads" },
    ],
    mutants: ["csharp/drop-bare-uses", "csharp/reemit-shadowed-reads", "csharp/reemit-designator-reads"],
  },
  {
    id: "CS-B1",
    quote:
      "C# 9 top-level statements execute with no enclosing symbol, so their calls were skipped for lack of a source name while the oracle derives every invocation leaf (each a MISSING). Fixed by attributing to `global`; no oracle change needed.",
    attributedBy: "CS-B1: top-level statement calls attribute to global",
    attribution: "comment",
    pins: [
      { type: "calls", from: "global", target: "WriteLine", present: true, what: "a top-level call attributes to global" },
      { type: "uses", from: "global", target: "topmark", present: false, what: "a top-level local binds in the file frame" },
    ],
    mutants: ["csharp/top-level-call-loss"],
  },
  {
    id: "CS-B2",
    quote:
      "`nameof(x)` parses as an invocation with an identifier callee — the keyword set lacked it, so every site emitted `calls->nameof` on both sides. Fixed in the analyzer set and the oracle regex; the operand is gated as a name position.",
    attributedBy: "CS-B2: nameof is an operator, never a callee",
    attribution: "comment",
    pins: [
      { type: "calls", from: "*", target: "nameof", present: false, what: "nameof is never a callee" },
      { type: "uses", from: "NameOf", target: "Max", present: false, what: "the nameof operand never reads" },
    ],
    mutants: ["csharp/nameof-call-fabrication"],
  },
  {
    id: "CS-B3",
    quote:
      "Both catch forms parse as `catch_clause` containing an optional `catch_declaration` — counting the inner node counted typed catches but never bare ones… Fixed by counting the clause (exactly once either way).",
    attributedBy: "CS-B3: bare catch counts",
    attribution: "comment",
    pins: [],
    mutants: ["csharp/bare-catch-complexity-loss"],
  },
  {
    id: "CS-B4",
    quote:
      "`file class Hidden` reported undefined visibility and exported as public API. Fixed: `file` maps to private; file-scoped types never export.",
    attributedBy: "CS-B4: file-scoped types never export",
    attribution: "comment",
    pins: [],
    mutants: ["csharp/file-type-exported"],
  },
  {
    id: "CS-B5",
    quote:
      "`o is Point(1, y)` parses as an invocation — under `constant_pattern`, except trailing `&&` misparses INSIDE it… Fixed on both sides with a bounded climb.",
    attributedBy: "CS-B5: positional-pattern heads are patterns, never calls",
    attribution: "comment",
    pins: [
      { type: "calls", from: "Pos", target: "Point", present: false, what: "a positional-pattern head is not a call" },
      { type: "uses", from: "Pos", target: "y", present: false, what: "the pattern's declared var binds, never reads" },
    ],
    mutants: ["csharp/positional-pattern-call-fabrication"],
  },
]

// ---------------------------------------------------------------- the result shape

function rel(x: any): { type: string; from: string; target: string } {
  return {
    type: String(x.type ?? x.relationshipType ?? ""),
    from: String(x.source ?? x.from ?? x.fromSymbol ?? ""),
    target: String(x.target ?? x.to ?? x.toSymbol ?? ""),
  }
}

function pinStatus(result: any, pin: Pin): boolean {
  const hit = (result.relationships ?? [])
    .map(rel)
    .some((r) => r.type === pin.type && (pin.from === "*" || r.from === pin.from) && r.target === pin.target)
  return hit === pin.present
}

function complexityOf(result: any, name: string): number | undefined {
  const s = (result.symbols ?? []).find((x: any) => x.name === name)
  return s?.complexity
}

function visibilityOf(result: any, name: string): string | undefined {
  const s = (result.symbols ?? []).find((x: any) => x.name === name)
  return s?.visibility
}

/** The two claims whose pin lives in the payload rather than in the edges. */
function payloadPins(result: any, id: string): { ok: boolean; what: string }[] {
  if (id === "CS-B3") {
    return ["Errors", "ErrorsTyped"].map((n) => ({
      ok: complexityOf(result, n) === 2,
      what: `${n} complexity == 2 (got ${String(complexityOf(result, n))})`,
    }))
  }
  if (id === "CS-B4") {
    return [
      { ok: visibilityOf(result, "Hidden") === "private", what: `Hidden visibility == private (got ${String(visibilityOf(result, "Hidden"))})` },
      { ok: !(result.exports ?? []).some((e: any) => e.name === "Hidden"), what: "Hidden is not exported" },
    ]
  }
  return []
}

// ---------------------------------------------------------------- the run

/**
 * The canonical path: parse with the lane's pinned wasm, hand the ROOT to the
 * real analyzer exactly as `runLang` does, then apply the mutant's transform to
 * that result. Deliberately NOT `ASTEngine.parseFile` — the F4 harness wraps the
 * analyzer's own `analyze`, and a pack that measured a different path could pass
 * where the suite fails.
 */
async function analyzeFixture(mutantId?: string): Promise<any> {
  const src = fs.readFileSync(FIXTURE_CS, "utf8")
  const parser = await getParser("csharp")
  const tree = parser.parse(src)
  const mod: any = await import(`../../src/ast/${LANGS.csharp.analyzerFile}`)
  const real = new mod[LANGS.csharp.className]()
  const res = await real.analyze(tree.rootNode, src, FIXTURE_CS)
  if (!mutantId) return res
  const m = MUTANTS.find((x) => x.id === mutantId)
  if (!m) throw new Error(`no mutant ${mutantId}`)
  return m.transform(res, src)
}

/** `runLang`'s override surface, mirroring the harness's wrapper. */
async function harnessFor(mutantId: string) {
  const m = MUTANTS.find((x) => x.id === mutantId)!
  const mod: any = await import(`../../src/ast/${LANGS.csharp.analyzerFile}`)
  const real = new mod[LANGS.csharp.className]()
  return {
    analyze: async (...args: any[]) => m.transform(await real.analyze(...args), typeof args[1] === "string" ? args[1] : undefined),
    transform: m.transform,
  }
}

async function main() {
  const exp = JSON.parse(fs.readFileSync(FIXTURE_EXP, "utf8"))
  const raw = fs.readFileSync(FIXTURE_EXP, "utf8")
  const head = await analyzeFixture()
  const base = await runLang("csharp")

  let failures = 0
  const lines: string[] = []
  const claim = (s: string) => lines.push(s)

  claim(`#804 verification pack — fixture ${FIXTURE_ID}; HEAD run: ${base.pass} passed, ${base.fail} failed`)
  claim("")

  for (const c of CLAIMS) {
    claim(`## ${c.id}`)
    claim(`  claim: "${c.quote.slice(0, 96)}${c.quote.length > 96 ? "…" : ""}"`)

    // 1. the attribution must exist in the fixture, or the pin cannot be audited
    const attributionSource = c.attribution === "rationale" ? String(exp.rationale ?? "") : raw
    const attributed = attributionSource.includes(c.attributedBy)
    claim(`  pin attribution (${c.attribution}): ${attributed ? "FOUND" : "MISSING"} — ${JSON.stringify(c.attributedBy)}`)
    if (!attributed) failures++

    // 2. the pins, evaluated independently at HEAD
    const headStatus = c.pins.map((p) => ({ pin: p, ok: pinStatus(head, p) }))
    const headPayload = payloadPins(head, c.id)
    for (const { pin, ok } of headStatus) {
      claim(`  ${ok ? "HOLDS " : "FAILS "} ${pin.present ? "expect" : "forbid"} ${pin.type} ${pin.from}->${pin.target}  (${pin.what})`)
      if (!ok) failures++
    }
    for (const p of headPayload) {
      claim(`  ${p.ok ? "HOLDS " : "FAILS "} ${p.what}`)
      if (!p.ok) failures++
    }
    if (!c.pins.length && !headPayload.length) {
      claim("  (no executable pin — this claim is not verifiable and is reported as a finding)")
      failures++
    }

    // 3. the reverting mutant must flip THIS claim's pin, and the canonical
    //    fixture runner must go red on the fixture that carries it
    for (const mid of c.mutants) {
      const mutated = await analyzeFixture(mid)
      const flipped = [
        ...c.pins.map((p) => ({ what: `${p.present ? "expect" : "forbid"} ${p.type} ${p.from}->${p.target}`, flipped: !pinStatus(mutated, p) })),
        ...payloadPins(mutated, c.id).map((p, i) => ({ what: c.id === "CS-B3" ? `complexity of ${["Errors", "ErrorsTyped"][i]}` : `payload pin ${i}`, flipped: !p.ok })),
      ].filter((x) => x.flipped)
      const run = await runLang("csharp", await harnessFor(mid))
      const detail = (run.details ?? []).find((d: any) => d.fixture === FIXTURE_ID)
      const problems: string[] = detail?.problems ?? []
      const cascaded = run.fail > base.fail
      const ok = flipped.length > 0 && cascaded
      if (!ok) failures++
      claim(`  ${ok ? "CAUGHT" : "NOT-CAUGHT"} ${mid} — pin flipped: ${flipped.length ? flipped.map((f) => f.what).join("; ") : "(none)"}; fixture red: ${!detail?.ok ? "yes" : "no"}; suite ${base.fail} -> ${run.fail} failures`)
      for (const p of problems.slice(0, 3)) claim(`      ${p.slice(0, 168)}`)
    }
    claim("")
  }

  // ------------------------------------------------------------ the oracle halves
  //
  // A fixture gates ONE side, so for the claims whose fix landed on BOTH sides
  // (CS-B2, CS-B5) the pack reverts the ORACLE for real: the pre-fix module is
  // materialised from git and its OWN derivation answers (the method
  // script/m14/tmp/oracle-revert-proof.ts established). The revision is found by
  // pickaxe, so a fixed SHA cannot go stale.
  //
  // The same two modules also let the pack test each claim's PREMISE, which is
  // the half a fixture can never reach:
  //   CS-R1  the oracle audits calls/instantiates only — so it derives no
  //          bare-identifier read, in EITHER revision (that is the blind spot);
  //   CS-B1  the oracle derives every invocation leaf — so a top-level call is
  //          required on the analyzer side and no oracle change was possible.
  const oracleHalves = await oracleRevertProof()
  claim("## the oracle halves — reverted, not grepped")
  for (const l of oracleHalves.lines) claim(l)
  failures += oracleHalves.failures

  const out = lines.join("\n")
  console.log(out)
  const report = path.join(ROOT, "validation/m60/results/csharp-804-pack.txt")
  fs.mkdirSync(path.dirname(report), { recursive: true })
  fs.writeFileSync(report, out + "\n")
  console.log(`\n${failures === 0 ? "PACK PASS" : `PACK FAIL (${failures})`} — wrote ${path.relative(ROOT, report)}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
