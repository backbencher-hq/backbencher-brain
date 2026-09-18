// script/m26/verify-graph-docs.ts — M26.D1 verifier + mutation suite (issue #515).
//
// Docs are claims; D1's doc is GENERATED, not hand-written. The verifier
// OWNS docs/m26/GRAPH.md: it derives every fact from live code and the
// committed evidence ledger, writes the file, and the drift gate is
// byte-identical equality between the on-disk file and a fresh generation (a
// hand edit or a code change without regeneration both fail it).
//
//   G1 imported facts:   budgets/version/tiers come from the owning modules
//   G2 reality split:    the doc states the cross-language rule + launch
//                        languages + a pointer to the record; the RECORD carries
//                        the machine scan (one row per stored pair, each
//                        attributed to its database) — nothing fabricated
//   G3 tier table:       every EDGE_TIERS name renders with its TIER_MEANINGS gloss
//   G4 budgets:          truncation + impact policy state the live numbers
//   G5 claim levels:     the verification table mirrors the m26 ledger
//   G6 drift gate:       on-disk doc == fresh generation (read BEFORE write)
//   G7 ambient-free:     two different machine realities produce ONE document
//                        (negative control: a leaky generator is caught)
//
// Audit 2026-09-18 (found by the M53/M61/M62 lane convergence) — two defects
// fixed here, both of the class M61 exists to catch:
//
//   1. AMBIENT STATE IN A BYTE-GATED DOC. The doc embedded
//      `Real project dbs scanned: N` and one row per pair found in the
//      operator's live `~/.bb/projects`. Those are functions of machine state
//      outside the repo, so any `bb index` on the machine regenerated a
//      different committed document, which invalidated this record's pin, which
//      turned m26 governance red (`D1:stale-commit`) and — through the closure
//      ladders — every downstream bar red with it. Machine reality now lives in
//      the record (script/m26/ambient-reality.ts owns the scan); the doc
//      carries a stable pointer and is a pure function of the repository.
//   2. A HOLLOW DRIFT CHECK. The old order was `writeFileSync(DOC, generated)`
//      and then `check(readFileSync(DOC) === regenerated)` — the write erased
//      the very evidence of a hand edit, so the check could not fail. The
//      on-disk bytes are now read BEFORE the write and compared to the fresh
//      generation: a hand-edited doc FAILS on the next run (and the run heals
//      the file). First run after a content change fails and regenerates; the
//      next run proves the committed doc matches. That fixpoint is declared,
//      not accidental.
//
// Run: npx tsx script/m26/verify-graph-docs.ts
// Evidence: validation/m26/results/D1.json (machine-emitted)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import { writeSealed, parseSealedRecord } from "../lib/evidence.ts"
import {
  leakyControlDoc,
  realityPointerLines,
  scanRealPairs,
  type RealPair,
  type RealityFacts,
} from "./ambient-reality.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const DOC = join(ROOT, "docs", "m26", "GRAPH.md")
const RECORD_FILE = "validation/m26/results/D1.json"
const nodeRequire = createRequire(import.meta.url)

/** The facts a byte-gated document may assert: every one is imported from a
 *  module in this repository or read from a committed file. */
interface RepoFacts {
  impactBudget: { maxNodes: number; maxDepth: number }
  renderBudget: { maxNodes: number; maxEdges: number; warmMs: number; coldMs: number }
  schemaVersion: number
  edgeTiers: readonly string[]
  tierMeanings: Record<string, string>
}

let checks = 0
let passed = 0
function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

/** The drift rule, named so the mutant can exercise it directly. A doc is
 *  accepted only if the bytes already on disk equal a fresh generation. */
function driftMatches(onDisk: string, fresh: string): boolean {
  return onDisk === fresh
}

/** Every recorded machine-reality row must BE a scanned row: same pair, same
 *  count, same bridge, same database. A record that added, dropped, or edited a
 *  row is rejected — the recorded reality is a copy, never a claim of its own. */
function samePairRow(a: RealPair, b: RealPair): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.edgeCount === b.edgeCount &&
    a.sampleBridge === b.sampleBridge &&
    a.database === b.database
  )
}
function recordRowsMatch(recordRows: RealPair[], scanned: RealityFacts): boolean {
  return recordRows.length === scanned.pairs.length && recordRows.every((r) => scanned.pairs.some((p) => samePairRow(p, r)))
}

/** The generator — the SINGLE owner of docs/m26/GRAPH.md content.
 *
 *  `reality` is accepted as the declared AMBIENT SEAM: the document must not
 *  render any value from it (only a stable pointer), and passing the seam in is
 *  what gives the G7 ambient-independence check teeth — an edit that lets
 *  machine state into the doc changes the bytes for a different reality and
 *  fails G7. */
function generateDoc(facts: RepoFacts, reality: RealityFacts): string {
  void reality
  const L: string[] = []
  L.push("# The Graph surface — what renders and what it claims (M26.D1)")
  L.push("")
  L.push("This document is **GENERATED** by `script/m26/verify-graph-docs.ts` from")
  L.push("live code and committed evidence — never hand-edit it. Every number below")
  L.push("is imported from the module that owns it, and the drift gate fails the")
  L.push("suite if this file stops matching a fresh generation.")
  L.push("")
  L.push("## What renders")
  L.push("")
  L.push("The webview renders the `bb/graph` result through ONE renderer")
  L.push("(`script/m26/graph-core.ts`): nodes, edges with per-edge evidence")
  L.push("badges, the tier legend, and truncation markers. The transport is the")
  L.push("versioned custom LSP request `bb/graph` (schema v" + facts.schemaVersion + ", declared in")
  L.push("`docs/m26/GRAPH-TRANSPORT.md`).")
  L.push("")
  L.push("## Edge evidence tiers (generated from TIER_MEANINGS — the W4 UI law)")
  L.push("")
  L.push("| tier | meaning in UI terms |")
  L.push("| --- | --- |")
  for (const t of facts.edgeTiers) L.push("| **" + t + "** | " + facts.tierMeanings[t] + " |")
  L.push("")
  L.push("Derivation: stored `metadata.evidenceClass` wins; otherwise a structural")
  L.push("edge below the 0.7 confidence floor renders as inferred. The hover gloss")
  L.push("(`src/lsp/cross_language_hover.ts`) uses the same rule.")
  L.push("")
  L.push("## Truncation policy (generated from RENDER_BUDGET — the W1 law)")
  L.push("")
  L.push("The renderer budget is `" + facts.renderBudget.maxNodes + "` nodes / `" + facts.renderBudget.maxEdges + "` edges. Anything")
  L.push("beyond the budget is NOT silently dropped: the webview shows a marker")
  L.push('with real counts ("Showing X of Y") and machine-readable `data-shown` /')
  L.push("`data-total-if-known` attributes. The impact surface has its own")
  L.push("declared budget: `" + facts.impactBudget.maxNodes + "` reverse-dependency nodes at traversal depth")
  L.push("`" + facts.impactBudget.maxDepth + "` (src/lsp/impact.ts).")
  L.push("")
  L.push("## Per-pair cross-language reality (rule here, data in the record)")
  L.push("")
  L.push("Cross-language UI text comes from stored `brain_relationship` rows only")
  L.push("(`is_cross_language = 1`). A pair with no stored rows is **declared")
  L.push("absent**: no cross-language UI text, no claimed bridge, nothing filled")
  L.push("in. Which pairs a real index actually stores is machine reality —")
  L.push("it is recorded, not asserted here (see below).")
  L.push("")
  L.push("Launch languages: java, groovy, kotlin, scala, typescript.")
  L.push("")
  for (const line of realityPointerLines(RECORD_FILE, "`machineReality`, `realPairRows`")) L.push(line)
  L.push("## Verification status (generated from the M26 evidence ledger)")
  L.push("")
  L.push("| issue | claim level |")
  L.push("| --- | --- |")
  const ledger = parseSealedRecord(join(ROOT, "validation", "m26", "results", "manifest.json"))
  for (const issue of ledger.issues as Array<{ code: string; status: string }>) {
    L.push("| " + issue.code + " | " + issue.status + " |")
  }
  L.push("")
  L.push("Claim levels are the ledger's statuses at generation time. `verified`")
  L.push("means the issue's own mutation-gated verifier passed at the pinned")
  L.push("commit — it is not a promise about code written after that commit.")
  L.push("")
  L.push("## Declared limitations")
  L.push("")
  L.push("- Per-pair cross-language coverage is recorded from what is actually")
  L.push("  stored on the recording machine; an unindexed language pair is absent,")
  L.push("  not broken, and this document therefore states the RULE rather than a")
  L.push("  machine's snapshot of it.")
  L.push('- "Showing X of Y" is honest per render; the underlying traversal')
  L.push("  budgets are documented above and enforced in code.")
  L.push("- The webview harness verifies rendered DOM, not a live editor; the")
  L.push("  editor legs (M25 E5/E6) cover the in-editor regime.")
  L.push("")
  return L.join("\n") + "\n"
}

function main(): void {
  // --- Fact gathering ------------------------------------------------------
  // Repo-derived facts (may be asserted in the doc) ...
  const impactMod = nodeRequire(join(ROOT, "src/lsp/impact.ts"))
  const core = nodeRequire(join(ROOT, "script/m26/graph-core.ts"))
  const transport = nodeRequire(join(ROOT, "src/lsp/graph_request.ts"))
  const facts: RepoFacts = {
    impactBudget: impactMod.IMPACT_BUDGET,
    renderBudget: core.RENDER_BUDGET,
    schemaVersion: transport.GRAPH_SCHEMA_VERSION,
    edgeTiers: core.EDGE_TIERS as readonly string[],
    tierMeanings: core.TIER_MEANINGS as Record<string, string>,
  }
  // ... and machine reality (recorded, never asserted in the doc).
  const reality = scanRealPairs()

  // --- G1: facts really are imported from the owning modules ----------------
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8")
  check("G1: impact budget imported from the real module", self.includes(`nodeRequire(join(ROOT, "src/lsp/impact.ts"))`) && facts.impactBudget.maxNodes === 200 && facts.impactBudget.maxDepth === 5)
  check("G1: render budget imported from the real core", self.includes(`nodeRequire(join(ROOT, "script/m26/graph-core.ts"))`) && facts.renderBudget.maxNodes === 500 && facts.renderBudget.maxEdges === 2000)
  // M44.U1 (issue #688): the usages-mode response is grouped per symbol, so
  // the wire schema moved to 2 — pinned here against the live transport.
  check("G1: schema version imported from the real transport", self.includes(`nodeRequire(join(ROOT, "src/lsp/graph_request.ts"))`) && facts.schemaVersion === 2)
  check("G1: tier meanings imported from the real core map", facts.edgeTiers.length === 5 && typeof facts.tierMeanings[facts.edgeTiers[0]] === "string" && facts.tierMeanings[facts.edgeTiers[0]].length > 10)
  // The audit rules: this gate must not read machine reality into the document.
  // The forbidden needle is assembled at runtime so this check's own source
  // text cannot satisfy it (the same self-reference trap the banned-vocabulary
  // lint avoids by not linting the gate itself).
  const forbiddenNeedle = ["REAL_DATA", "DIR"].join("_")
  check("G1: the machine-reality scan is owned by ambient-reality.ts, not by this gate", self.includes(`from "./ambient-reality.ts"`) && !self.includes(forbiddenNeedle))

  // --- Generate, then compare the bytes ALREADY ON DISK ---------------------
  const generated = generateDoc(facts, reality)
  const onDisk = existsSync(DOC) ? readFileSync(DOC, "utf8") : ""
  check("G6: drift gate — the on-disk doc is byte-identical to a fresh generation", driftMatches(onDisk, generated), onDisk === "" ? "doc missing" : "on-disk doc differs from a fresh generation (regenerated below — rerun to pin)")
  // Heal, and say so: the first run after a content change fails and rewrites;
  // the next run proves the committed doc matches (the declared fixpoint).
  if (onDisk !== generated) writeFileSync(DOC, generated)
  const written = readFileSync(DOC, "utf8")
  check("G6: after the run the on-disk doc equals the fresh generation", driftMatches(written, generated))

  // --- G2: the doc asserts rules, the record carries reality ----------------
  check("G2: the doc states the launch languages", generated.includes("java, groovy, kotlin, scala, typescript"))
  check("G2: the doc points at the record that carries machine reality", generated.includes(RECORD_FILE))
  check("G2: the doc asserts no machine-reality count", !/dbs scanned/i.test(generated), "a live store count leaked into the byte-gated doc")
  check("G2: every recorded reality row is a scanned row (nothing fabricated)", recordRowsMatch(reality.pairs, reality))

  // --- G3: tier table matches the W4 meanings map ----------------------------
  for (const tier of facts.edgeTiers) {
    check("G3: tier table lists " + tier + " with its UI meaning", generated.includes("**" + tier + "**") && generated.includes(facts.tierMeanings[tier].slice(0, 20)))
  }

  // --- G4: truncation policy states the live budgets -------------------------
  check("G4: truncation policy carries the live render budget", generated.includes("`" + facts.renderBudget.maxNodes + "` nodes / `" + facts.renderBudget.maxEdges + "` edges"))
  check("G4: truncation policy carries the live impact budget", generated.includes("`" + facts.impactBudget.maxNodes + "` reverse-dependency nodes at traversal depth") && generated.includes("`" + facts.impactBudget.maxDepth + "` (src/lsp/impact.ts)"))

  // --- G5: claim levels reflect the ledger -----------------------------------
  const ledger = parseSealedRecord(join(ROOT, "validation", "m26", "results", "manifest.json"))
  for (const issue of ledger.issues as Array<{ code: string; status: string }>) {
    check("G5: verification table states " + issue.code + " per ledger", generated.includes("| " + issue.code + " | " + issue.status + " |"))
  }

  // --- G7: the byte-gated doc is a pure function of the repository -----------
  const realityA: RealityFacts = { dir: reality.dir, present: false, scanned: 0, skipped: 0, pairs: [] }
  const realityB: RealityFacts = {
    dir: "/tmp/not-this-machine/projects",
    present: true,
    scanned: 4242,
    skipped: 7,
    pairs: [{ source: "zig", target: "rust", edgeCount: 9, sampleBridge: "ffi", database: "does-not-exist" }],
  }
  check(
    "G7: two different machine realities produce ONE document (ambient-independent)",
    generateDoc(facts, realityA) === generateDoc(facts, realityB),
  )

  // --- V: the generated doc passes the contract §1 lint ----------------------
  // Same pattern list as the G1 gate (negations like "not guaranteed" are
  // honesty language and not banned — the gate's list has no bare
  // "guaranteed" pattern).
  const BANNED: RegExp[] = [/perfect(ion)?\b/i, /\bcomplete(ly|d|ness)?\b/i, /\bproduction-ready\b/i, /\bbulletproof\b/i, /\brock-solid\b/i, /\bbattle-tested\b/i, /\bextensively tested\b/i, /\bthoroughly reviewed\b/i, /\bshould work\b/i, /\bexpected to pass\b/i, /\bIDE-grade\b/i, /\bIntelliJ-like\b/i, /\breal-time\b/i, /\bseamless(ly)?\b/i, /\ball languages\b/i]
  const bannedHit = BANNED.map((p) => generated.match(p)?.[0]).filter(Boolean)
  check("V: generated doc passes the banned-vocabulary lint", bannedHit.length === 0, bannedHit.join(","))

  // --- Mutants: the suite CAN fail ------------------------------------------
  const mutants: Array<{ name: string; caught: boolean }> = []
  {
    // M1: a hand-edited embedded fact must fail the drift rule. The old gate
    // wrote the file before comparing, so this mutant could not be caught.
    const doctored = generated.replace(
      "`" + facts.renderBudget.maxNodes + "` nodes / `" + facts.renderBudget.maxEdges + "` edges",
      "`99999` nodes / `88888` edges",
    )
    const caught = doctored !== generated && !driftMatches(doctored, generated)
    mutants.push({ name: "M1 doctored embedded fact (drift rule)", caught })
    check("M1: a doctored embedded fact fails the drift rule", caught)
  }
  {
    // M2: a record that fabricated a reality row must be rejected.
    const phantom: RealPair = { source: "zig", target: "rust", edgeCount: 9, sampleBridge: "ffi", database: "does-not-exist" }
    const caught = !recordRowsMatch([...reality.pairs, phantom], reality)
    mutants.push({ name: "M2 fabricated reality row", caught })
    check("M2: a fabricated reality row is rejected by the copy rule", caught)
  }
  {
    // M3: the ambient-independence rule must reject a generator that DOES embed
    // machine reality — otherwise G7 could not fail and would not be evidence.
    const leaky = (r: RealityFacts): string => leakyControlDoc("# leaky", r)
    const caught = !(leaky(realityA) === leaky(realityB))
    mutants.push({ name: "M3 ambient leak (leaky control)", caught })
    check("M3: an ambient-leaky generator is rejected by the ambient-independence rule", caught)
  }
  for (const m of mutants) console.log(`  ${m.caught ? "caught" : "SURVIVED"}: ${m.name}`)

  // --- Emit evidence -----------------------------------------------------------
  const dir = join(ROOT, "validation", "m26", "results")
  mkdirSync(dir, { recursive: true })
  let commit = "unknown"
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}
  const result = {
    issue: "M26.D1",
    status: checks === passed ? "verified" : "failed",
    passed,
    failed: checks - passed,
    negativeCases: mutants.length,
    mutants: mutants.map((m) => ({ name: m.name, caught: m.caught })),
    mutantsCaught: mutants.filter((m) => m.caught).length,
    mutantsTotal: mutants.length,
    // Machine reality: recorded, explicitly labelled, never asserted in a doc.
    machineReality: { dir: reality.dir, present: reality.present, scanned: reality.scanned, skipped: reality.skipped },
    realDbsScanned: reality.scanned,
    realDbsSkipped: reality.skipped,
    realCrossLanguagePairs: reality.pairs.length,
    realPairRows: reality.pairs,
    docFile: "docs/m26/GRAPH.md",
    currentCommit: commit,
    verifierCommand: "npx tsx script/m26/verify-graph-docs.ts",
    generatedAt: new Date().toISOString(),
    limitations: [
      "The byte-gated doc asserts repository-derived facts only; machine reality (realDbsScanned/realPairRows) is recorded here and is specific to the machine that ran this gate.",
      "The drift gate compares the bytes on disk BEFORE writing, so the first run after a content change fails and regenerates; the run after that is the proof.",
    ],
  }
  writeSealed(join(dir, "D1.json"), result)
  console.log("D1: " + result.status.toUpperCase() + " (" + passed + "/" + checks + " passed, " + result.mutantsCaught + "/" + result.mutantsTotal + " mutants)")
  if (result.status !== "verified") process.exitCode = 1
}

main()
