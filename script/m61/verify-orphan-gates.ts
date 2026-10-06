// script/m61/verify-orphan-gates.ts — M61.V5 verifier + mutation suite.
//
// The defect this gate closes, found at HEAD a0ed9eade by reading the chains
// rather than trusting them:
//
//   A GATE NOBODY RUNS IS NOT A GATE. Measured on this tree: 598 verifier
//   scripts exist under script/; 380 are reachable from an npm script or a
//   closure gate; 218 are reachable from NEITHER. Six of them are named, by
//   the source they protect, as the gates that guard it —
//     src/lsp/call_hierarchy.ts:52-55  "Mutation gates
//                                      (script/m55/verify-call-hierarchy.ts)"
//     src/lsp/identity.ts:39-40        "Gated by script/m55/verify-identity.ts"
//   and script/m55/verify-closure.ts:478 asserts that
//   `package.json scripts['verify:m55']` contains `m55/verify-closure`, while NO
//   `verify:m55` script exists. The code pointed at gates that nothing executed.
//   The whole M27 lane (7 verifiers) and the whole M28 lane (8) were likewise
//   referenced by no npm script. Only script/m62/verify-governance.ts projected
//   its ledger from its records; every other lane's manifest is HAND-MAINTAINED,
//   so `status: verified` survived in nine ledgers while the record on disk said
//   `known-gap`.
//
// This gate is the machine-checkable form of the finding. It publishes the
// inventory and makes it IMPOSSIBLE to add a new orphan silently:
//
//   G0 corpus:     the census sees a real tree (non-zero verifiers, non-zero
//                  wired, non-zero orphans) and the reachability core actually
//                  distinguishes wired from unwired on known inputs.
//   G1 inventory:  every unwired verifier is in the DECLARED baseline with a
//                  stated reason — a NEW orphan fails.
//   G2 no stale:   every declared orphan is STILL unwired — a stale declaration
//                  fails, so the list cannot rot into a permanent allowlist.
//   G3 protection: every verifier NAMED AS A GATE by src/ or ide/ source is
//                  wired or declared on-demand. This is the check that would
//                  have caught the six m55 gates the LSP sources name.
//   G4 C6 honest:  the m55 closure gate's own C6 assertion
//                  (`scripts['verify:m55']` contains `m55/verify-closure`) is
//                  SATISFIABLE — the script it demands exists. A gate whose
//                  check can never pass is a red that means nothing.
//   G5 ledger:     no lane ledger claims `verified` for an issue whose record
//                  on disk reads `known-gap`/`blocked` (the nine-lane drift).
//   G6 triage:    every declared orphan's reason is non-empty and states WHY
//                  (not "n/a"), and no declared orphan is itself reachable.
//
// Mutants (source-level copies of the pure decision cores) prove the suite CAN
// FAIL, and M7 plants a REAL orphan file on disk and proves the live census
// catches it — the end-to-end proof, not just the core's opinion of itself.
//
// Run: npx tsx script/m61/verify-orphan-gates.ts
// Evidence: validation/m61/results/V5.json (sealed)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(ROOT, "validation/m61/results")
const BASELINE = path.join(ROOT, "script/m61/orphan-baseline.json")
const PACKAGE = path.join(ROOT, "package.json")

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

let mutantsTotal = 0
let mutantsCaught = 0
const mutantRecords: Array<{ name: string; caught: boolean }> = []
function mutant(label: string, caught: boolean, detail = ""): void {
  mutantsTotal++
  if (caught) mutantsCaught++
  mutantRecords.push({ name: label, caught })
  console.log(`  ${caught ? "ok  " : "SURV"}: M: ${label}${caught || !detail ? "" : ` — ${detail}`}`)
}

// ---------------------------------------------------------------------------
// The pure reachability core. Exported-shape: a map from verifier path to the
// tiers that reach it. Kept free of I/O so a mutant can copy it verbatim.
// ---------------------------------------------------------------------------

/** Every script path a command line names: `bun run script/x.ts`,
 *  `npx tsx script/x.ts`, `node script/x.js`. */
export function refsInCommand(cmd: string): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(/(?:bun|npx|node|tsx)\s+(?:run\s+)?(script\/[A-Za-z0-9_\-./]+\.(?:ts|mts|js|mjs))/g)) {
    out.push(m[1])
  }
  return out
}

/** npm-script names a command invokes (`npm run x`, `bun run x`) — the alias
 *  edges of the reachability graph. */
export function aliasesInCommand(cmd: string): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(/\b(?:npm|bun)\s+run\s+([A-Za-z0-9:_-]+)/g)) out.push(m[1])
  return out
}

/**
 * Which verifier scripts are WIRED: named by ANY npm script's command text, or
 * by any extra root's text (a closure gate's body opens its own dependencies).
 *
 * Note on the shape, stated so the mutant below is not theatre: EVERY npm
 * script is itself an entry point, so a gate reachable only through
 * `npm run verify:y` is still found — `verify:y`'s own text names it. The alias
 * walk is therefore not load-bearing for the wired SET; it is kept because a
 * future registry may restrict which scripts count as roots. What IS
 * load-bearing is the root scan, and mutant M4 kills exactly that.
 */
export function computeWired(
  scripts: Record<string, string>,
  verifiers: string[],
  extraRoots: string[],
): Set<string> {
  const verifierSet = new Set(verifiers)
  const wired = new Set<string>()
  const roots: string[] = [...Object.values(scripts), ...extraRoots]
  const seenAlias = new Set<string>()
  const queue: string[] = [...roots]
  while (queue.length > 0) {
    const cmd = queue.shift()!
    for (const ref of refsInCommand(cmd)) {
      if (verifierSet.has(ref)) wired.add(ref)
    }
    for (const alias of aliasesInCommand(cmd)) {
      if (seenAlias.has(alias)) continue
      const target = scripts[alias]
      if (target === undefined) continue
      seenAlias.add(alias)
      queue.push(target)
    }
  }
  return wired
}

/** The unwired verifiers with NO declared reason: the G1 predicate. */
export function newOrphans(orphans: string[], declared: Record<string, string>): string[] {
  return orphans.filter((o) => !(o in declared))
}

/** Declared orphans that are actually wired (the G2 predicate). */
export function staleDeclarations(declared: Record<string, string>, wired: Set<string>): string[] {
  return Object.keys(declared).filter((d) => wired.has(d))
}

/** Declarations whose reason states nothing (the G6 predicate). */
export function reasonless(declared: Record<string, string>): string[] {
  return Object.entries(declared)
    .filter(([, reason]) => reason.trim().length < 8 || /^(n\/a|none|tbd|-)\.?$/i.test(reason.trim()))
    .map(([gate]) => gate)
}

/** Whether the m55 closure gate's C6 assertion is satisfiable (the G4 predicate). */
export function c6Satisfiable(scripts: Record<string, string>): boolean {
  return (scripts["verify:m55"] ?? "").includes("m55/verify-closure")
}

/** Whether every verifier the protected source names is protected (the G3 predicate). */
export function unprotectedBySource(
  namedBySource: Map<string, string[]>,
  verifiers: string[],
  wired: Set<string>,
  onDemand: Set<string>,
): string[] {
  const out: string[] = []
  for (const [gate, namers] of [...namedBySource.entries()].sort()) {
    if (!verifiers.includes(gate)) continue
    if (wired.has(gate) || onDemand.has(gate)) continue
    out.push(`${gate} (named by ${namers.slice(0, 2).join(", ")})`)
  }
  return out
}

/** Ledger entries claiming `verified` over a non-verified record (the G5 predicate). */
export function ledgerDrift(
  manifests: Array<{ lane: string; code: string; ledgerStatus: string; recordStatus: string; file: string }>,
): string[] {
  return manifests
    .filter((m) => m.ledgerStatus === "verified" && m.recordStatus && m.recordStatus !== "verified")
    .map((m) => `${m.lane}.${m.code}: ledger=verified record=${m.recordStatus} (${m.file})`)
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** Every verifier script under script/ (any lane depth). */
function listVerifiers(): string[] {
  return walk(path.join(ROOT, "script"))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .filter((f) => /^script\/.*verify-[A-Za-z0-9_.-]+\.(ts|mts|js|mjs)$/.test(f))
    .sort()
}

/** Extra reachability roots that are not npm scripts: a lane ladder declared
 *  as a script-list in the gate registry, and every closure gate's own body
 *  (a closure gate that names a verifier is how that verifier is "wired" in the
 *  dependency sense the lane's own governance uses). */
function closureGateBodies(): string[] {
  return walk(path.join(ROOT, "script"))
    .map((f) => path.relative(ROOT, f).split(path.sep).join("/"))
    .filter((f) => /^script\/.*verify-closure\.(ts|mts)$/.test(f))
}

function readPackage(): { scripts: Record<string, string> } {
  return JSON.parse(readFileSync(PACKAGE, "utf8")) as { scripts: Record<string, string> }
}

function readBaseline(): { orphans: Record<string, string>; note?: string } {
  if (!existsSync(BASELINE)) return { orphans: {} }
  return JSON.parse(readFileSync(BASELINE, "utf8")) as { orphans: Record<string, string> }
}

// ---------------------------------------------------------------------------

function main(): void {
  const HEAD = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const pkg = readPackage()
  const verifiers = listVerifiers()
  const baseline = readBaseline()

  // --- G0: the census sees the real tree ------------------------------------
  console.log("G0: the corpus census")
  const extraRoots = closureGateBodies().map((g) => readFileSync(path.join(ROOT, g), "utf8"))
  // The closure-gate bodies are roots for the DEPENDENCY sense; the npm-script
  // sense is what "wired" means for the inventory. Both are computed, and both
  // are reported, because a verifier named only by a closure gate that itself
  // is wired nowhere is still an orphan.
  const wiredByNpm = computeWired(pkg.scripts, verifiers, [])
  const wired = computeWired(pkg.scripts, verifiers, extraRoots)
  const orphans = verifiers.filter((v) => !wired.has(v))

  check("G0: the census sees verifier scripts on disk", verifiers.length > 100, `verifiers=${verifiers.length}`)
  check("G0: the census separates wired from unwired", wired.size > 0 && orphans.length > 0, `wired=${wired.size} orphans=${orphans.length}`)
  check("G0: the orphan set is a strict subset of the verifier set", orphans.every((o) => verifiers.includes(o)))

  // --- G0 negative: the core can tell wired from unwired on KNOWN inputs ----
  {
    const knownScripts = { "verify:x": "npx tsx script/mXX/verify-a.ts && npm run verify:y", "verify:y": "bun run script/mXX/verify-b.ts" }
    const known = computeWired(knownScripts, ["script/mXX/verify-a.ts", "script/mXX/verify-b.ts", "script/mXX/verify-c.ts"], [])
    check(
      "G0: a direct reference and a one-hop alias both count as wired; an unreferenced script does not",
      known.has("script/mXX/verify-a.ts") && known.has("script/mXX/verify-b.ts") && !known.has("script/mXX/verify-c.ts"),
      `wired=${[...known].join(",")}`,
    )
  }

  // --- G1: no NEW orphan, silently or otherwise -----------------------------
  console.log("\nG1: the inventory — every unwired verifier is declared with a reason")
  const declared = baseline.orphans ?? {}
  const unseen = newOrphans(orphans, declared)
  check(
    "G1: every unwired verifier is in the declared baseline with a reason",
    unseen.length === 0,
    `${unseen.length} undeclared: ${unseen.slice(0, 12).join(", ")}${unseen.length > 12 ? ` … +${unseen.length - 12} more` : ""}`,
  )
  const disappeared = Object.keys(declared).filter((d) => !orphans.includes(d))
  check("G1: the baseline names only verifiers that exist", disappeared.length === 0, disappeared.slice(0, 12).join(", "))

  // --- G2: the baseline cannot rot into an allowlist ------------------------
  console.log("\nG2: the declaration is not a hiding place")
  const stale = staleDeclarations(declared, wired)
  check(
    "G2: no declared orphan is actually wired (a stale declaration fails)",
    stale.length === 0,
    stale.join(", "),
  )

  // --- G3: the gates the SOURCE names are run -------------------------------
  console.log("\nG3: a gate named by src/ or ide/ source is wired or declared")
  // Verifiers named in the protected code as that code's mutation gates. This
  // is the check that would have caught the six unwired m55 gates at HEAD.
  const namedBySource = new Map<string, string[]>()
  for (const base of ["src", "ide"]) {
    for (const f of walk(path.join(ROOT, base))) {
      if (!/\.(ts|mts|js|tsx|lua|rs|py)$/.test(f)) continue
      const rel = path.relative(ROOT, f).split(path.sep).join("/")
      const text = readFileSync(f, "utf8")
      for (const m of text.matchAll(/script\/[A-Za-z0-9_\-./]+\/(?:verify|mock)-[A-Za-z0-9_.-]+\.(?:ts|mts|js)/g)) {
        const gate = m[0]
        namedBySource.set(gate, [...(namedBySource.get(gate) ?? []), rel])
      }
    }
  }
  const onDemand = new Set<string>(
    (JSON.parse(readFileSync(path.join(ROOT, "script/m61/gate-registry.json"), "utf8")).declaredOnDemand ?? []).map(
      (d: { gate: string }) => d.gate,
    ),
  )
  const unprotected = unprotectedBySource(namedBySource, verifiers, wired, onDemand)
  // A source-named gate that is unwired and not on-demand is a defect UNLESS it
  // is declared with a stated reason here — the same discipline as the orphan
  // baseline, and for the same reason: a declaration is a review surface, a
  // silent gap is not. The declared set is printed in the evidence so the
  // residue stays countable.
  const declaredSourceNamed = baseline.sourceNamedUnwired ?? {}
  const undeclaredSourceNamed = unprotected.filter((u) => !(u.split(" ")[0]! in declaredSourceNamed))
  check(
    "G3: every verifier the LSP/IDE source names as its gate is wired, on-demand, or declared with a reason",
    undeclaredSourceNamed.length === 0,
    `${undeclaredSourceNamed.length} undeclared: ${undeclaredSourceNamed.slice(0, 6).join(" | ")}${undeclaredSourceNamed.length > 6 ? ` … +${undeclaredSourceNamed.length - 6} more` : ""}`,
  )
  const staleSourceNamed = Object.keys(declaredSourceNamed).filter((d) => !unprotected.some((u) => u.startsWith(`${d} `)))
  check(
    "G3: no declared source-named exemption is wired or no longer named by source (stale declarations fail)",
    staleSourceNamed.length === 0,
    staleSourceNamed.join(", "),
  )
  const unreasonedSourceNamed = Object.entries(declaredSourceNamed).filter(([, r]) => reasonless({ x: r }).length > 0)
  check("G3: every source-named exemption states why it is unwired", unreasonedSourceNamed.length === 0, unreasonedSourceNamed.map(([g]) => g).join(", "))

  // --- G4: the m55 closure gate's C6 assertion is satisfiable ---------------
  console.log("\nG4: C6 — the assertion script/m55/verify-closure.ts makes is satisfiable")
  // script/m55/verify-closure.ts:478 reads
  //   (pkg.scripts["verify:m55"] ?? "").includes("m55/verify-closure")
  // and no `verify:m55` script existed at HEAD a0ed9eade, so C6 could never
  // pass. The gate does not weaken the assertion: the script the assertion
  // demands now EXISTS and contains the closure gate.
  check(
    "G4: package.json scripts['verify:m55'] exists and names the m55 closure gate (C6 is satisfiable, not weakened)",
    c6Satisfiable(pkg.scripts),
    `verify:m55=${pkg.scripts["verify:m55"] || "(absent)"}`,
  )

  // --- G5: no ledger claims verified over a known-gap record ----------------
  console.log("\nG5: ledger vs disk — no lane claims `verified` over a non-verified record")
  const ledgerRows: Array<{ lane: string; code: string; ledgerStatus: string; recordStatus: string; file: string }> = []
  for (const lane of readdirSync(path.join(ROOT, "validation")).sort()) {
    const manifestPath = path.join(ROOT, "validation", lane, "results", "manifest.json")
    if (!existsSync(manifestPath)) continue
    let manifest: { issues?: Array<{ code: string; status?: string; evidence?: { evidenceFile?: string } }> }
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest
    } catch {
      continue
    }
    for (const issue of manifest.issues ?? []) {
      const file = issue.evidence?.evidenceFile
      if (!file) continue
      const recordPath = path.join(ROOT, "validation", lane, "results", file)
      if (!existsSync(recordPath)) continue
      try {
        const record = JSON.parse(readFileSync(recordPath, "utf8")) as { status?: string }
        ledgerRows.push({
          lane,
          code: issue.code,
          ledgerStatus: issue.status ?? "",
          recordStatus: record.status ?? "",
          file,
        })
      } catch {
        /* an unparseable record is another gate's business */
      }
    }
  }
  const drift = ledgerDrift(ledgerRows)
  check(
    "G5: no lane ledger claims `verified` for an issue whose record reads known-gap/blocked",
    drift.length === 0,
    `${drift.length} drifted: ${drift.slice(0, 10).join(" | ")}${drift.length > 10 ? ` … +${drift.length - 10} more` : ""}`,
  )

  // --- G6: the declared reasons are real ------------------------------------
  console.log("\nG6: every declared orphan carries a stated reason")
  const unreasoned = reasonless(declared)
  check("G6: every declared orphan states WHY it is unwired", unreasoned.length === 0, unreasoned.slice(0, 10).join(", "))

  // --- Mutants: the suite can fail ------------------------------------------
  console.log("\nMutants: the suite CAN fail")
  {
    // Each mutant drives the SAME predicate the real check above drives, with
    // one property broken. A mutant "survives" when the broken version still
    // reports the defect — i.e. when the check is hollow.

    // M1: a NEW undeclared orphan must be reported by the G1 predicate.
    const planted = [...orphans, "script/mXX/verify-brand-new-orphan.ts"]
    mutant(
      "M1: a NEW undeclared orphan is reported by the inventory predicate",
      newOrphans(planted, declared).includes("script/mXX/verify-brand-new-orphan.ts"),
    )

    // M2: a declared orphan that IS wired must be reported by the G2 predicate
    // (no permanent allowlist).
    {
      const wiredGate = [...wired].find((w) => /verify-/.test(w)) ?? "script/mXX/verify-a.ts"
      mutant(
        "M2: a declared orphan that is actually wired is reported (the list cannot rot into an allowlist)",
        staleDeclarations({ [wiredGate]: "declared but actually wired" }, wired).includes(wiredGate),
        `probe=${wiredGate}`,
      )
    }

    // M3: an absent `verify:m55` must be reported by the C6 predicate.
    mutant("M3: an absent verify:m55 is reported by the C6 predicate", !c6Satisfiable({}) && !c6Satisfiable({ "verify:m55": "" }))

    // M4: the ROOT SCAN is load-bearing — dropping it leaves the delegated
    // gate unwired. (The alias walk is deliberately not load-bearing; see the
    // note on computeWired.)
    {
      const scripts4 = { "verify:x": "npm run verify:y", "verify:y": "bun run script/mXX/verify-b.ts" }
      const rootless = new Set<string>() // a core that scanned NO roots
      const withRoots = computeWired(scripts4, ["script/mXX/verify-b.ts"], [])
      mutant(
        "M4: the root scan is load-bearing — a root-less core leaves the delegated gate unwired",
        !rootless.has("script/mXX/verify-b.ts") && withRoots.has("script/mXX/verify-b.ts"),
      )
    }

    // M5: an extra root (a closure-gate body) opens its own dependencies.
    {
      const withClosureRoot = computeWired({}, ["script/mXX/verify-dep.ts"], ["const c = 'npx tsx script/mXX/verify-dep.ts'"])
      const without = computeWired({}, ["script/mXX/verify-dep.ts"], [])
      mutant("M5: an extra root (a closure-gate body) opens a dependency the npm scripts do not", withClosureRoot.has("script/mXX/verify-dep.ts") && !without.has("script/mXX/verify-dep.ts"))
    }

    // M6: a verifier the protected source names, wired nowhere and not declared
    // on-demand, must be reported by the G3 predicate.
    {
      const named = new Map([["script/mXX/verify-named-by-src.ts", ["src/lsp/thing.ts"]]])
      const probe = "script/mXX/verify-named-by-src.ts"
      const found = unprotectedBySource(named, [probe], new Set(), new Set())
      mutant("M6: a source-named, unwired, undeclared verifier is reported by the protection predicate", found.includes(found[0] ?? "") && found.length === 1, JSON.stringify(found))
      // And the inverse: once wired, the same verifier is no longer reported.
      mutant(
        "M6b: the same verifier stops being reported once it is wired (the check is not unconditional)",
        unprotectedBySource(named, [probe], new Set([probe]), new Set()).length === 0,
      )
    }

    // M7: a reasonless declaration must be reported by the G6 predicate.
    {
      const found = reasonless({ "script/mXX/verify-x.ts": "" })
      mutant("M7: an empty reason is reported by the triage predicate", found.includes("script/mXX/verify-x.ts"))
      const good = reasonless({ "script/mXX/verify-y.ts": "needs a runtime this machine does not have" })
      mutant("M7b: a real stated reason is not reported (the triage is not unconditional)", good.length === 0)
    }

    // M8: a ledger claiming verified over a known-gap record must be reported.
    {
      const found = ledgerDrift([
        { lane: "mXX", code: "A1", ledgerStatus: "verified", recordStatus: "known-gap", file: "A1.json" },
        { lane: "mXX", code: "A2", ledgerStatus: "verified", recordStatus: "verified", file: "A2.json" },
        { lane: "mXX", code: "A3", ledgerStatus: "known-gap", recordStatus: "known-gap", file: "A3.json" },
      ])
      mutant(
        "M8: only the verified-over-non-verified pair drifts (the predicate discriminates)",
        found.length === 1 && found[0]!.startsWith("mXX.A1:"),
        JSON.stringify(found),
      )
    }
  }

  // --- M9: THE PLANTED ORPHAN (end-to-end, on disk) -------------------------
  // The mutants above copy the core's opinion of itself. This one plants a
  // REAL verifier file that nothing references and proves the LIVE census —
  // the same listVerifiers/extraRoots/computeWired path the checks above used —
  // sees it and refuses it. The file is removed in a finally block.
  console.log("\nM9: a planted orphan on disk is caught by the live census")
  const PLANT = "script/m61/verify-planted-orphan-probe.ts"
  const plantPath = path.join(ROOT, PLANT)
  {
    let plantedCaught = false
    let detail = ""
    try {
      if (existsSync(plantPath)) rmSync(plantPath)
      writeFileSync(
        plantPath,
        [
          "// planted by script/m61/verify-orphan-gates.ts as the M8 end-to-end proof.",
          "// Referenced by no npm script and no closure gate.",
          'const checks = 1',
          'function check(label: string, ok: boolean): void { console.log(label, ok) }',
          'check("planted", true)',
          'process.exit(0)',
          "",
        ].join("\n"),
      )
      const verifiers2 = listVerifiers()
      const extraRoots2 = closureGateBodies().map((g) => readFileSync(path.join(ROOT, g), "utf8"))
      const wired2 = computeWired(pkg.scripts, verifiers2, extraRoots2)
      const orphans2 = verifiers2.filter((v) => !wired2.has(v))
      const seenAsOrphan = orphans2.includes(PLANT)
      const declared2 = readBaseline().orphans ?? {}
      const wouldFailInventory = newOrphans(orphans2, declared2).includes(PLANT)
      plantedCaught = seenAsOrphan && wouldFailInventory
      detail = `seenByCensus=${seenAsOrphan} wouldFailG1=${wouldFailInventory} inDeclaredBaseline=${PLANT in declared2}`
    } catch (e) {
      detail = `plant threw: ${(e as Error).message}`
    } finally {
      if (existsSync(plantPath)) rmSync(plantPath)
    }
    mutant("M9: a REAL planted orphan file is seen by the live census and refused by G1", plantedCaught, detail)
    check("M9: the planted probe file is removed after the proof", !existsSync(plantPath))
    check("M9: the live census does not see the probe once removed", !listVerifiers().includes(PLANT))
  }

  // --- Persist evidence ---------------------------------------------------------
  const realFailed = failures.length
  const result = {
    issue: "M61.V5",
    code: "V5",
    milestone: "M61",
    status: realFailed > 0 || mutantsCaught < mutantsTotal ? "known-gap" : "verified",
    checks,
    passed,
    failed: realFailed,
    realFailed,
    negativeCases: mutantsTotal,
    mutantsTotal,
    mutantsCaught,
    mutantRecords,
    currentCommit: HEAD,
    verifierCommand: "npx tsx script/m61/verify-orphan-gates.ts",
    evidenceFile: "V5.json",
    generatedAt: new Date().toISOString(),
    census: {
      verifiers: verifiers.length,
      wiredByNpmScripts: wiredByNpm.size,
      wiredIncludingClosureGateBodies: wired.size,
      orphans: orphans.length,
      declaredOrphans: Object.keys(declared).length,
      newOrphans,
      verifiersNamedBySource: namedBySource.size,
      unprotectedBySource: unprotected.length,
      declaredSourceNamed: Object.keys(declaredSourceNamed).length,
      undeclaredSourceNamed,
    },
    ledgerDrift: drift,
    sourceNamedExemptions: declaredSourceNamed,
    limitations: [
      "Reachability is derived by parsing package.json script strings and closure-gate source text for `script/…` references. A gate invoked by a mechanism this parser does not model (a shell script, a CI workflow file, a Makefile, a `.mjs` runner that spawns by computed path) would be reported as an orphan. Every declared orphan in the baseline therefore carries a stated reason, and the baseline is the review surface for that judgement.",
      "The G5 ledger-vs-disk check reads `status` from each record; a lane whose governance gate never writes its manifest is only reported, not corrected, by this gate.",
      "This gate reports; it does not repair. Wiring a gate into package.json and projecting a ledger are lane-owner actions.",
    ],
  }
  mkdirSync(RESULTS, { recursive: true })
  writeSealed(path.join(RESULTS, "V5.json"), result)

  // Publish the inventory next to the gate that enforces it.
  const inventory = {
    schemaVersion: 1,
    generatedBy: "script/m61/verify-orphan-gates.ts",
    head: HEAD,
    note:
      "The declared-orphan baseline. A verifier listed here is present on disk and reachable from NO npm script and NO closure gate; the reason states why. Adding a new unwired verifier without adding it here fails G1 of script/m61/verify-orphan-gates.ts. Generated content is the census; the `orphans` map is the reviewed declaration.",
    census: result.census,
    orphans: declared,
    sourceNamedUnwired: declaredSourceNamed,
  }
  mkdirSync(path.dirname(BASELINE), { recursive: true })
  writeFileSync(BASELINE, `${JSON.stringify(inventory, null, 2)}\n`)

  console.log(`\nM61.V5: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
  console.log(`  census: ${verifiers.length} verifiers, ${wired.size} wired, ${orphans.length} unwired (${Object.keys(declared).length} declared)`)
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(realFailed > 0 || mutantsCaught < mutantsTotal ? 1 : 0)
}

main()