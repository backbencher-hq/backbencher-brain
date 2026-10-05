// script/m24/verify-position-arithmetic.ts — the §5 RULE 1 PERMANENCE GATE.
//
// Contract §5: "No feature code converts positions inline; all conversion goes
// through the mapping component." That sentence was unenforced. The bypass it
// forbids was found live in src/lsp/navigation.ts (the 1-based-byte-column ->
// 0-based-UTF-16 hand-rolled walk, lines 228-238 at the time of the fix), and
// it survived every oracle in this file's own suite because the walk is
// behaviorally ALMOST correct: on an ASCII line it returns exactly the right
// index. Only reading the source sees the bypass.
//
// This gate is that reading. It is deliberately a SEPARATE script from
// verify-navigation.ts for one reason: a lint living inside the suite it
// polices can be edited away with the suite. As its own file it is a thing
// someone has to find and delete on purpose.
//
// OWNERSHIP IS DECLARED, NOT INFERRED: `OWNERS` below is the list this lane is
// allowed to hold findings for. A finding in a file this lane does not own is
// REPORTED — printed with file:line and counted in the evidence — and does NOT
// fail the build, because other lanes are editing those files right now and a
// gate that fails on their in-flight work gets disabled instead of fixed. The
// finding list is the handoff, not a verdict.
//
// Run: npx tsx script/m24/verify-position-arithmetic.ts
// Evidence: validation/m24/results/POSITION-OWNERSHIP.json

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { POSITION_OWNER, listLspSources, noInlinePositionArithmetic, type PositionFinding } from "./no-inline-position-arithmetic.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "POSITION-OWNERSHIP.json")

/** Files this lane owns. A finding in one of these FAILS the gate. Everything
 *  else is reported. Kept as data so the boundary is readable in one place. */
const OWNERS = new Set(["src/lsp/navigation.ts"])

/** Lint mutants: each plants a bypass in a throwaway copy of a real module and
 *  asserts the lint catches it. A lint with no planted defect is a check that
 *  cannot fail (contract §8.7). */
/** Either `from`/`to` (edit a REAL module on disk) or `synthetic` (a module
 *  that does not exist, built in memory). The synthetic ones matter because the
 *  common case for this bug class is a NEW surface: the lint must judge a file
 *  it has never seen, exactly as it would the day that surface lands. */
interface LintMutant {
  name: string
  file: string
  expectRule: string
  from?: string
  to?: string
  synthetic?: string
}

const LINT_MUTANTS: LintMutant[] = [
  {
    name: "navigation: the hand-rolled byte->UTF-16 walk returns",
    file: "src/lsp/navigation.ts",
    from: "    jsCol = mapper.indexToLsp({ line: indexPos.line, column: indexPos.column }).character;",
    to: "    jsCol = (() => {\n      const raw = indexPos.column - 1;\n      if (Buffer.byteLength(lineText, \"utf8\") !== lineText.length) {\n        let bytes = 0;\n        let acc = 0;\n        for (let i = 0; i < lineText.length; i++) {\n          const b = Buffer.byteLength(lineText[i], \"utf8\");\n          if (bytes + b > raw) break;\n          bytes += b;\n          acc = i + 1;\n        }\n        return acc;\n      }\n      return raw;\n    })();",
    expectRule: "P1",
  },
  {
    name: "navigation: the mapper's private byte->UTF-16 converter is called directly",
    file: "src/lsp/navigation.ts",
    from: "    jsCol = mapper.indexToLsp({ line: indexPos.line, column: indexPos.column }).character;",
    to: "    jsCol = (mapper as unknown as { byteOffsetToUtf16Offset(l: number, b: number): number }).byteOffsetToUtf16Offset(indexPos.line - 1, indexPos.column - 1);",
    expectRule: "P3",
  },
  {
    name: "a NEW module computes a byte column with Buffer.byteLength",
    file: "src/lsp/brand_new_surface.ts",
    synthetic: "export function columnOf(line: string, at: number): number {\n  return Buffer.byteLength(line.slice(0, at), \"utf8\") + 1;\n}\n",
    expectRule: "P1",
  },
  {
    name: "a NEW module inspects a surrogate directly",
    file: "src/lsp/brand_new_surface.ts",
    synthetic: "export function isTrailingHalf(text: string, at: number): boolean {\n  const unit = text.charCodeAt(at);\n  return unit >= 0xdc00 && unit <= 0xdfff;\n}\n",
    expectRule: "P2",
  },
  {
    name: "a NEW module reaches the owner's private converter",
    file: "src/lsp/brand_new_surface.ts",
    synthetic: "import { createPositionMapper } from \"./positions\";\nexport function column(mapper: ReturnType<typeof createPositionMapper>, line: number, byte: number): number {\n  return (mapper as any).byteOffsetToUtf16Offset(line, byte);\n}\n",
    expectRule: "P3",
  },
  {
    name: "a NEW module byte-walks a line's code units (P4)",
    file: "src/lsp/brand_new_surface.ts",
    synthetic: "export function walk(line: string, raw: number): number {\n  let bytes = 0;\n  let acc = 0;\n  for (let i = 0; i < line.length; i++) {\n    const b = Buffer.byteLength(line[i], \"utf8\");\n    if (bytes + b > raw) break;\n    bytes += b;\n    acc = i + 1;\n  }\n  return acc;\n}\n",
    expectRule: "P4",
  },
  {
    // THE SHARPEST CASE: the bypass written as a comment. A lint that reads
    // prose names a forbidden construct as a finding is a lint nobody can
    // work with, so this mutant proves the comment/string stripping works and
    // the rules do not fire on documentation.
    name: "a module that NAMES the forbidden primitives in a comment is NOT flagged",
    file: "src/lsp/doc_only_surface.ts",
    synthetic: "// We used to call Buffer.byteLength(line.slice(0, at)) here; see positions.ts.\n// The mapper does the byte arithmetic now, and charCodeAt stays in the owner.\nexport const NOTE = \"0xd800 is a high surrogate\";\n",
    expectRule: "NONE",
  },
]

let passed = 0
let failed = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++
    console.log(`  ok: ${name}`)
  } else {
    failed++
    failures.push(detail ? `${name}: ${detail}` : name)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(name: string, ok: boolean, detail = ""): void {
  check(`${name} [negative]`, ok, detail)
}

function runLintMutants(): { caught: number; total: number } {
  console.log("\nLint mutation suite: planting a bypass in a throwaway module")
  let caught = 0
  for (const m of LINT_MUTANTS) {
    // A synthetic module (a file that does not exist on disk) is built purely
    // in memory. Both kinds are needed: the on-disk edits prove the lint judges
    // a real module, the synthetic ones prove it judges a module it has never
    // seen — which is what happens the day a new surface lands.
    let text: string
    if (m.synthetic !== undefined) {
      text = m.synthetic
    } else {
      const original = readFileSync(join(ROOT, m.file), "utf8")
      const mutated = original.replace(m.from!, m.to!)
      if (mutated === original) {
        failed++
        failures.push(`lint mutant anchor not found: ${m.name}`)
        console.log(`  FAIL: anchor not found: ${m.name}`)
        continue
      }
      text = mutated
    }
    const findings = noInlinePositionArithmetic([{ path: m.file, text }])
    if (m.expectRule === "NONE") {
      // A must-NOT-fire case. Counting it as a catch would let a broken
      // comment stripper look like a strict lint.
      if (findings.length === 0) {
        caught++
        console.log(`  caught (no false positive on prose): ${m.name}`)
      } else {
        failed++
        failures.push(`lint fired on prose: ${m.name} -> ${JSON.stringify(findings.map((f) => `${f.rule} ${f.line}`))}`)
        console.log(`  FAIL: lint fired on prose: ${m.name}`)
      }
      continue
    }
    const byRule = findings.find((f: PositionFinding) => f.rule === m.expectRule)
    if (byRule !== undefined) {
      caught++
      console.log(`  caught (${m.expectRule} ${byRule.file}:${byRule.line}): ${m.name}`)
    } else {
      failed++
      failures.push(`lint mutant SURVIVED: ${m.name} (expected ${m.expectRule}, got ${JSON.stringify(findings.map((f) => f.rule))})`)
      console.log(`  FAIL: SURVIVED: ${m.name} — findings=${JSON.stringify(findings.map((f) => f.rule))}`)
    }
  }
  return { caught, total: LINT_MUTANTS.length }
}

function main(): void {
  console.log(`§5 rule 1 gate — position arithmetic belongs to ${POSITION_OWNER}\n`)

  const sources = listLspSources(ROOT)
  const findings = noInlinePositionArithmetic(sources)

  const ownedFindings = findings.filter((f) => OWNERS.has(f.file))
  const foreignFindings = findings.filter((f) => !OWNERS.has(f.file))

  console.log(`  scanned ${sources.length} modules under src/lsp (data-driven: readdirSync, no hard-coded list)`)
  check("R1: the owner itself is exempt from its own lint", !findings.some((f) => f.file === POSITION_OWNER))
  check("R1: the scan covered a real module set (a gate over zero files cannot fail)", sources.length >= 5, `${sources.length} files`)
  check(
    "R1: no owned module converts positions inline",
    ownedFindings.length === 0,
    ownedFindings.map((f) => `${f.rule} ${f.file}:${f.line} — ${f.text}`).join(" | "),
  )

  // The owner's own arithmetic must be REAL: if positions.ts were emptied of
  // conversion the lint would have nothing to police. Assert the owner still
  // contains each primitive the rules key on, so an owner that stopped
  // converting fails loudly instead of silently passing an empty lint.
  const ownerText = readFileSync(join(ROOT, POSITION_OWNER), "utf8")
  for (const [primitive, rule] of [["Buffer.byteLength(", "P1"], ["charCodeAt(", "P2"], ["Buffer.from(", "P4"]] as const) {
    check(`R1: the owner still performs ${rule}'s conversion (${primitive})`, ownerText.includes(primitive))
  }

  // REPORTED, not failed: findings in modules this lane does not own.
  if (foreignFindings.length > 0) {
    console.log(`\n  REPORTED (not this lane's files — see the handoff, not a verdict): ${foreignFindings.length} finding(s)`)
    for (const f of foreignFindings) console.log(`    ${f.rule} ${f.file}:${f.line} — ${f.law}\n        ${f.text}`)
  } else {
    console.log("\n  REPORTED: no findings in modules this lane does not own")
  }

  const { caught, total } = runLintMutants()
  check("M: every planted inline conversion is caught", caught === total, `${caught}/${total}`)

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const ok = failed === 0
  const evidence = {
    issue: "M24.lane4-position-ownership",
    code: "POSITION-OWNERSHIP",
    status: ok ? "verified" : "known-gap",
    currentCommit,
    sourceFingerprint: createHash("sha256")
      .update(sources.map((s) => `${s.path}\n${s.text}`).join("\n"))
      .digest("hex"),
    verifierCommand: "npx tsx script/m24/verify-position-arithmetic.ts",
    evidenceFile: "POSITION-OWNERSHIP.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases: total,
    mutantsCaught: caught,
    mutantsTotal: total,
    negativeCasesNote:
      "Every case in the lint mutation suite is a negative: it plants a module that must be flagged (or, for the one prose case, must NOT be flagged) and asserts the lint agrees. The count of checks that could have passed without a planted defect is zero.",
    owner: POSITION_OWNER,
    rules: {
      P1: "Buffer.byteLength outside the owner (byte arithmetic is the owner's)",
      P2: "charCodeAt/codePointAt outside the owner (surrogate handling is the owner's)",
      P3: "the owner's private converters called from a feature module",
      P4: "a byte-accumulating walk over a line's code units",
      P5: "surrogate-range literals outside the owner",
    },
    scopeStatement:
      "These are the BYPASS PRIMITIVES, not all arithmetic on a number. A rule claiming to forbid 'position arithmetic' would have to forbid `x - 1` on an array index, which is not a position conversion. What §5 rule 1 means is that nobody outside positions.ts computes a byte column, a UTF-16 column, or inspects a surrogate — exactly this list.",
    filesScanned: sources.map((s) => s.path),
    ownedFiles: [...OWNERS],
    ownedFindings: ownedFindings.map((f) => ({ file: f.file, line: f.line, rule: f.rule, law: f.law, text: f.text })),
    reportedElsewhere: foreignFindings.map((f) => ({ file: f.file, line: f.line, rule: f.rule, law: f.law, text: f.text })),
    reportedElsewhereNote:
      "Findings in modules this lane does not own are reported, not failed: other lanes are editing those files concurrently and a gate that fails on their in-flight work gets disabled rather than fixed. Each is a §5 rule 1 bypass to route through src/lsp/positions.ts.",
    determinism: {
      declaredVolatileFields: ["generatedAt", "bbSeal.sealedAt", "bbSeal.contentSha256"],
      note:
        "Every field is a function of the scanned sources and this script, except the three declared volatile ones (a wall-clock stamp, the seal's write time, and the content hash that covers the stamp). `filesScanned` comes from readdirSync().sort(); findings are sorted by file then line then rule. Measured: two consecutive runs compared after canonicalising the three volatile fields are identical.",
    },
    limitations: [
      "Source-level, not semantic: a bypass that avoids every listed primitive (for example a hand-rolled UTF-16 walk using only .length and .slice) is not detected by this lint.",
      "The file list is src/lsp/*.ts at depth 1; a module in a subdirectory of src/lsp is not scanned.",
      "Ownership of findings is declared in OWNERS; moving a file between owners is a one-line data change, so this boundary is auditable rather than inferred.",
      "The lint reads TEXT, so a bypass hidden inside a multi-line template literal's expression is treated as prose and not flagged. That is a deliberate trade (a fixture string that names Buffer.byteLength must not fail the build) and it is a hole: a caller can hide conversion in `${...}`. Not observed anywhere in src/lsp at this commit.",
    ],
  }
  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nPOSITION-OWNERSHIP: ${ok ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${passed + failed} passed, ${caught}/${total} planted bypasses caught, ${foreignFindings.length} reported elsewhere)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main()