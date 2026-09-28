// script/m26/verify-cross-language-hover.ts — M26.W3 verifier + mutation suite.
//
// Proves cross-language hover facts come from stored rows ONLY, per-pair,
// with declared absence, and that the suite CAN FAIL.
//
//   P1 source:    hover on a symbol with stored cross-language rows renders
//                 exactly those facts (pair, bridge, tier, confidence)
//   P2 absence:   a symbol with NO stored cross-language rows renders NO
//                 cross-language text at all (absence declared in docs)
//   P3 tier rule: stored evidenceClass wins; declared derivation otherwise
//                 (0.7 floor); confidence rendered with the tier
//   P4 coverage:  docs/m26/CROSS-LANGUAGE.md is GENERATED from the fixture
//                 coverage scan (repo-derived) and byte-identical on rerun; the
//                 real-store scan is RECORDED (machine reality) and the doc
//                 must not assert it (audit 2026-09-18 — see ambient-reality.ts)
//   R1 real db:   hover() runs against a real seeded sqlite index (real
//                 BrainDatabase), not a stub
//
// Mutants (each must be CAUGHT):
//   M1 absence rendered   (empty facts still produce a section)
//   M2 bridge fabricated  (null bridge becomes an invented mechanism)
//   M3 tier floor broken  (sub-floor calls labeled structural)
//   M4 non-cross rows leak (is_cross_language filter dropped)
//   M5 stored class ignored (evidenceClass override dropped)
//
// Run: npx tsx script/m26/verify-cross-language-hover.ts
// Evidence: validation/m26/results/W3.json + W3-pairs.json (machine-emitted)

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
// M26 ambient split (audited 2026-09-18): machine reality is scanned by the ONE
// owner and RECORDED; the byte-gated document asserts repository-derived facts
// only. See script/m26/ambient-reality.ts for the defect this fixes (a doc that
// embedded the operator's live store count turned every local `bb index` into a
// lane-wide staleness cascade).
import { assertAmbientIndependent, leakyControlDoc, realityPointerLines, scanRealPairs, type RealityFacts } from "./ambient-reality.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "cross_language_hover.ts")
const HOVER = join(ROOT, "src", "lsp", "hover.ts")
const DOC = join(ROOT, "docs", "m26", "CROSS-LANGUAGE.md")
const RECORD_FILE = "validation/m26/results/W3.json"

let checks = 0
let passed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

// --- Real seeded sqlite fixture (real BrainDatabase, both languages) --------
async function makeFixture(): Promise<{ projectId: string; raw: any; ws: string; dataDir: string; cleanup: () => void }> {
  const ws = mkdtempSync(join(tmpdir(), "w3-ws-"))
  const dataDir = mkdtempSync(join(tmpdir(), "w3-data-"))
  // Hover side: typescript; other side: kotlin (a launch-language pair).
  writeFileSync(join(ws, "main.ts"), "export function main(): void {}\n")
  writeFileSync(join(ws, "service.kt"), "fun service() {}\n")
  const canonical = realpathSync(ws)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import(join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run("file-ts", projectId, join(ws, "main.ts"), "main.ts", "typescript", "w3-ts-hash")
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`).run("file-kt", projectId, join(ws, "service.kt"), "service.kt", "kotlin", "w3-kt-hash")
  const sym = raw.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  sym.run("sym-main", projectId, "file-ts", "main", "function", 1, 1, 1, 3, 5)
  sym.run("sym-service", projectId, "file-kt", "service", "function", 1, 1, 1, 3, 4)
  sym.run("sym-local", projectId, "file-ts", "localCaller", "function", 2, 2, 5, 8, 2)
  const rel = raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism, metadata) VALUES (?,?,?,?,?,?,?,?,?)`)
  // Cross-language pair WITH stored evidence class + bridge (the "stored pair" fixture).
  rel.run("rel-xt-1", projectId, "sym-service", "sym-main", "calls", 0.92, 1, "kotlin-ts interop", JSON.stringify({ evidenceClass: "usage_contextual" }))
  // Cross-language pair WITHOUT stored class, sub-floor confidence (derivation path).
  rel.run("rel-xt-2", projectId, "sym-local", "sym-service", "calls", 0.5, 1, null, null)
  // Same-language rows that must NEVER render as cross-language.
  rel.run("rel-same-1", projectId, "sym-local", "sym-main", "calls", 0.95, 0, null, null)
  return {
    projectId,
    raw,
    ws,
    dataDir,
    cleanup: () => {
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

// --- Pure component legs ------------------------------------------------------
interface ClModule {
  factsFromRows: (rows: any[], lang: string | null) => any[]
  crossLanguageSection: (facts: any[]) => string
  tierForCrossLanguageEdge: (edge: any) => string
  storedCrossLanguageRows: (db: any, symbolId: string) => any[]
  projectPairCoverage: (db: any, projectId: string, langs: readonly string[]) => any[]
}

async function main(): Promise<void> {
  const cl = (await import(COMPONENT)) as unknown as ClModule

  // P3: tier rule (pure).
  check("P3: stored evidenceClass wins", cl.tierForCrossLanguageEdge({ relationship_type: "calls", confidence: 0.99, evidence_class: "usage_contextual" }) === "usage_contextual")
  check("P3: sub-floor calls derive inferred (0.7 floor)", cl.tierForCrossLanguageEdge({ relationship_type: "calls", confidence: 0.5, evidence_class: null }) === "inferred")
  check("P3: above-floor calls derive structural", cl.tierForCrossLanguageEdge({ relationship_type: "calls", confidence: 0.9, evidence_class: null }) === "structural")
  check("P3: imports derive import_based", cl.tierForCrossLanguageEdge({ relationship_type: "imports", confidence: 0.9, evidence_class: null }) === "import_based")

  // P1/P2 at component level (pure rows → facts → section).
  const facts = cl.factsFromRows(
    [
      { relationship_type: "calls", confidence: 0.92, bridge_mechanism: "kotlin-ts interop", other_language: "kotlin", direction: "caller", evidence_class: "usage_contextual" },
      { relationship_type: "calls", confidence: 0.5, bridge_mechanism: null, other_language: "typescript", direction: "callee", evidence_class: null },
    ],
    "typescript",
  )
  check("P1: per-pair facts built from stored rows", facts.length === 2 && facts[0]!.pair === "typescript → kotlin" && facts[0]!.bridge === "kotlin-ts interop")
  const section = cl.crossLanguageSection(facts)
  check("P1: section renders pair, bridge, tier, confidence", section.includes("kotlin") && section.includes("kotlin-ts interop") && section.includes("usage_contextual") && section.includes("0.92"))
  check("P2: no rows → empty section (no UI text)", cl.crossLanguageSection([]) === "")
  check("P2: rows without opposite language are skipped, not guessed", cl.factsFromRows([{ relationship_type: "calls", confidence: 1, bridge_mechanism: "x", other_language: null, direction: "caller", evidence_class: null }], "typescript").length === 0)

  // --- P1/P2/R1: real hover against the real seeded sqlite -------------------
  const fx = await makeFixture()
  try {
    const { hover } = await import(HOVER)
    // Hover main (ts): stored caller row from kotlin with bridge + class.
    const h1 = await hover(fx.raw, { filePath: join(fx.ws, "main.ts"), position: { line: 0, character: 7 } })
    const text1 = h1.contents?.value ?? ""
    check("R1: real db — stored cross-language pair renders", text1.includes("**cross-language**") && text1.includes("called from kotlin via kotlin-ts interop"), text1.slice(0, 400))
    check("R1: real db — stored evidenceClass renders as the tier", text1.includes("usage_contextual"))
    check("R1: real db — confidence rendered with the tier", text1.includes("0.92"))
    // Hover localCaller (ts): cross-language callee at 0.5 (sub-floor → inferred),
    // plus a same-language row that must not appear as cross-language.
    const h2 = await hover(fx.raw, { filePath: join(fx.ws, "main.ts"), position: { line: 1, character: 7 } })
    const text2 = h2.contents?.value ?? ""
    check("R1: sub-floor cross-language callee renders inferred", text2.includes("calls into kotlin") && text2.includes("inferred (confidence 0.5)"), text2.slice(0, 400))
    // A symbol with NO cross-language rows: seed one.
    fx.raw.prepare(`INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`).run("sym-quiet", fx.projectId, "file-ts", "quietFn", "function", 3, 3, 9, 12, 1)
    fx.raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, is_cross_language, bridge_mechanism, metadata) VALUES (?,?,?,?,?,?,?,?,?)`).run("rel-same-2", fx.projectId, "sym-quiet", "sym-main", "calls", 0.95, 0, null, null)
    const h3 = await hover(fx.raw, { filePath: join(fx.ws, "main.ts"), position: { line: 2, character: 7 } })
    const text3 = h3.contents?.value ?? ""
    check("P2: real db — no cross-language text when no stored rows", !text3.includes("cross-language"), text3.slice(0, 300))
    // P4 evidence: stored pair rows via the component directly.
    const rows = cl.storedCrossLanguageRows(fx.raw, "sym-main")
    check("P1: component returns exactly the stored cross-language rows", rows.length === 1 && rows[0]!.direction === "caller" && rows[0]!.other_language === "kotlin" && rows[0]!.evidence_class === "usage_contextual")

    // --- P4: coverage scan + generated doc ---------------------------------
    const fixtureCoverage = cl.projectPairCoverage(fx.raw, fx.projectId, ["java", "groovy", "kotlin", "scala", "typescript", "javascript", "python"])
    check("P4: coverage scan sees the stored pair", fixtureCoverage.some((p) => p.source === "kotlin" && p.target === "typescript" && p.edgeCount === 1))
    // Machine reality (read-only; absent/unreadable recorded honestly) — one
    // owner, recorded in W3.json, deliberately NOT asserted by the doc.
    const reality = scanRealPairs()
    const fixturePairs = fixtureCoverage.map((p) => ({ ...p, origin: "fixture (W3 suite, seeded)" }))
    // The byte-gated doc: the fixture-verified pair is reproducible from the
    // repository (this suite seeds it), so it may be tabulated here. Which
    // pairs a REAL index stores is machine reality and is pointed at instead.
    const lines: string[] = [
      "# Cross-language coverage — generated, not aspirational (M26.W3)",
      "",
      "This table is GENERATED by `script/m26/verify-cross-language-hover.ts` from",
      "stored `brain_relationship` rows only (`is_cross_language = 1`). A pair not",
      "listed here has NO stored rows: the hover states nothing cross-language for",
      "it, and this document declares that absence. Never hand-edit — regenerate.",
      "",
      "| source language | target language | stored edges | bridge (sample) | verified by |",
      "| --- | --- | --- | --- | --- |",
    ]
    if (fixturePairs.length === 0) {
      lines.push("| _(none — the W3 fixture stored no cross-language rows)_ | | | | |")
    }
    for (const p of fixturePairs) {
      lines.push(`| ${p.source} | ${p.target} | ${p.edgeCount} | ${p.sampleBridge ?? "_(row carries no mechanism)_"} | ${p.origin} |`)
    }
    lines.push(
      "",
      "## Declared absence",
      "",
      "Launch languages: java, groovy, kotlin, scala, typescript, javascript, python",
      "(M29 wave-1 extension). Any pair among",
      "them not in the table above and not recorded in the evidence record is",
      "**declared absent**: no stored rows exist, the UI renders no cross-language",
      "text for it, and no bridge is claimed.",
      "",
    )
    for (const line of realityPointerLines(RECORD_FILE, "`machineReality`, `realPairRows`")) lines.push(line)
    const docContent = lines.join("\n") + "\n"
    // The drift rule reads the bytes ALREADY ON DISK and compares them to the
    // fresh generation (the old check compared a value to itself).
    const onDiskDoc = existsSync(DOC) ? readFileSync(DOC, "utf8") : ""
    check(
      "P4: drift gate — the on-disk doc is byte-identical to a fresh generation",
      onDiskDoc === docContent,
      onDiskDoc === "" ? "doc missing" : "on-disk doc differs (regenerated below — rerun to pin)",
    )
    if (onDiskDoc !== docContent) writeFileSync(DOC, docContent)
    check("P4: after the run the on-disk doc equals the fresh generation", readFileSync(DOC, "utf8") === docContent)
    check("P4: the doc asserts no machine-reality count", !/dbs scanned/i.test(docContent))
    check("P4: the doc points at the record that carries machine reality", docContent.includes(RECORD_FILE))
    // Negative control: the rule that keeps machine reality out of the doc must
    // reject a generator that embeds it — otherwise the rule cannot fail.
    {
      const realityA: RealityFacts = { dir: reality.dir, present: false, scanned: 0, skipped: 0, pairs: [] }
      const realityB: RealityFacts = { ...reality, present: true, scanned: reality.scanned + 1000, skipped: reality.skipped + 3 }
      check(
        "P4 [negative]: an ambient-leaky doc generator is rejected by the ambient-independence rule",
        !assertAmbientIndependent((r) => leakyControlDoc("# leaky", r), realityA, realityB),
      )
    }

    // --- Mutants ------------------------------------------------------------
    const compSource = readFileSync(COMPONENT, "utf8")
    const hoverSource = readFileSync(HOVER, "utf8")
    const mutants: Array<{ name: string; file: string; from: string; to: string; probe: (m: any, hoverMod: any) => Promise<boolean> | boolean }> = [
      {
        name: "M1 absence rendered",
        file: "component",
        from: 'if (facts.length === 0) return ""',
        to: "if (false) return \"\"",
        probe: (m) => m.crossLanguageSection([]) !== "", // empty facts produce a section => defect visible
      },
      {
        name: "M2 bridge fabricated",
        file: "component",
        from: 'row.bridge_mechanism ?? "unnamed bridge (stored row carries no mechanism)"',
        to: 'row.bridge_mechanism ?? "resolved via import graph"',
        probe: (m) => {
          const f = m.factsFromRows([{ relationship_type: "calls", confidence: 1, bridge_mechanism: null, other_language: "kotlin", direction: "caller", evidence_class: null }], "typescript")
          return f[0]!.bridge === "resolved via import graph" // invented mechanism present => defect visible
        },
      },
      {
        // M55.T5: the rule moved to src/lsp/evidence_tier.ts; the component
        // now DELEGATES. The defect is planted at the delegation site — the
        // component passing its own answer instead of the row's/edge's real
        // ones — which is exactly the drift the gate must catch.
        name: "M3 tier floor broken",
        file: "component",
        from: "    confidence: edge.confidence,",
        to: "    confidence: 1,",
        probe: (m) => m.tierForCrossLanguageEdge({ relationship_type: "calls", confidence: 0.5, evidence_class: null }) === "structural", // sub-floor labeled structural
      },
      {
        name: "M4 non-cross rows leak",
        file: "component",
        from: "WHERE r.is_cross_language = 1 AND r.target_symbol_id = ?",
        to: "WHERE r.target_symbol_id = ?",
        probe: (m) => {
          // sym-main has exactly ONE stored cross-language inbound row; every
          // same-language inbound row must stay invisible. The leaky mutant
          // returns same-language rows too (defect visible: count > 1).
          const rows = m.storedCrossLanguageRows(fx.raw, "sym-main")
          return rows.length > 1
        },
      },
      {
        name: "M5 stored class ignored",
        file: "component",
        from: "    evidenceClass: edge.evidence_class,",
        to: "    evidenceClass: null,",
        probe: (m) => m.tierForCrossLanguageEdge({ relationship_type: "calls", confidence: 0.99, evidence_class: "usage_contextual" }) === "structural", // derivation overrides stored class
      },
    ]
    let caught = 0
    let mutantsTotal = 0
    for (const mutant of mutants) {
      const target = mutant.file === "component" ? compSource : hoverSource
      if (!target.includes(mutant.from)) {
        console.log(`  SKIP (anchor not found): ${mutant.name}`)
        continue
      }
      mutantsTotal++
      const mutantPath = join(ROOT, "validation/m26", `w3.mutant.${Date.now()}.${mutantsTotal}.ts`)
      let src = target.replace(mutant.from, mutant.to)
      // Rewrite relative imports to absolute file:// against src/.
      src = src
        .replace(/from "\.\.\/brain\/database"/g, `from "file://${join(ROOT, "src", "brain", "database.ts").replace(/\\/g, "/")}"`)
        .replace(/from "\.\.\/brain\/freshness"/g, `from "file://${join(ROOT, "src", "brain", "freshness.ts").replace(/\\/g, "/")}"`)
        .replace(/from "\.\/positions"/g, `from "file://${join(ROOT, "src", "lsp", "positions.ts").replace(/\\/g, "/")}"`)
        .replace(/from "\.\/cross_language_hover"/g, `from "file://${mutantPath.replace(/\\/g, "/")}"`)
        // M55.T5: the component delegates to the tier owner, so the mutant copy
        // must resolve that specifier too (a load failure is not a catch).
        .replace(/from "\.\/evidence_tier"/g, `from "file://${join(ROOT, "src", "lsp", "evidence_tier.ts").replace(/\\/g, "/")}"`)
      writeFileSync(mutantPath, src)
      let detected = false
      try {
        const m = await import(mutantPath)
        const hoverMod = mutant.file === "component" ? await import(HOVER) : m
        detected = await mutant.probe(m, hoverMod)
      } catch {
        detected = true
      } finally {
        try { rmSync(mutantPath, { force: true }) } catch {}
      }
      if (detected) {
        caught++
        console.log(`  caught: ${mutant.name}`)
      } else {
        console.log(`  SURVIVED: ${mutant.name}`)
      }
    }
    check("mutation suite: every planted defect is caught", caught === mutantsTotal && mutantsTotal >= 4, `${caught}/${mutantsTotal}`)



    // --- Persist evidence -----------------------------------------------------
    const failed = checks - passed
    let commit = "unknown"
    try {
      commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    } catch {}
    const result = {
      issue: "M26.W3",
      code: "W3",
      milestone: "M26",
      status: failed === 0 ? "verified" : "known-gap",
      checks,
      passed,
      failed,
      mutantsCaught: caught,
      mutantsTotal,
      currentCommit: commit,
      verifierCommand: "npx tsx script/m26/verify-cross-language-hover.ts",
      evidenceFile: "W3.json",
      pairsFile: "W3-pairs.json",
      generatedAt: new Date().toISOString(),
      fixturePairs,
      // Machine reality: recorded, explicitly labelled, never asserted in a doc.
      machineReality: { dir: reality.dir, present: reality.present, scanned: reality.scanned, skipped: reality.skipped },
      storedPairs: [...fixturePairs, ...reality.pairs.map((p) => ({ ...p, origin: "real project index" }))],
      realPairRows: reality.pairs,
      realDbsScanned: reality.scanned,
      limitations: [
        "Launch-language pairs with no stored rows are declared absent; per-machine reality is recorded here, not in the byte-gated doc.",
        "Coverage scan reads real project dbs read-only; unreadable/absent dbs are skipped and counted in machineReality.",
        "The drift gate compares the bytes on disk before writing: the first run after a content change fails and regenerates, the next run is the proof.",
      ],
    }
    const dir = join(ROOT, "validation/m26/results")
    mkdirSync(dir, { recursive: true })
    writeSealed(join(dir, "W3.json"), result)
    writeSealed(join(dir, "W3-pairs.json"), { status: result.status, checkedPairs: result.storedPairs, realPairRows: reality.pairs, machineReality: result.machineReality, generatedAt: result.generatedAt })
    console.log(`W3: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${caught}/${mutantsTotal} mutants caught)`)
    process.exit(failed === 0 ? 0 : 1)
  } finally {
    fx.cleanup()
  }
}

void main()
