// script/m24/doc-mutant-harness.mts — RED proofs for the hover-docs gate.
//
// A gate that has only ever run green is not evidence of anything: it might be
// asserting nothing. Each mutant here plants a REAL defect in the real
// src/lsp/doc_comment.ts, re-runs the probe against the REAL parser, and requires
// the probe to NOTICE it. A mutant that plants a defect the oracle fails to see
// is reported as a harness failure, not skipped.
//
// The four mutants map onto the four things the hover-docs gate claims:
//   adjacency  — the attachment rule ignores adjacency (the main trap)
//   truncate   — only the first line of a multi-line doc survives
//   invent     — an absent doc is filled in with a placeholder
//   markup     — comment delimiters/asterisks are not stripped

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = process.cwd()
const TARGET = path.join(ROOT, "src", "lsp", "doc_comment.ts")
const PROBE = path.join(ROOT, "script", "m24", "doc-mutant-probe.mts")

type Mutant = { id: string; name: string; from: string; to: string }

// Anchored edits. `from` must be present in TARGET or the mutant never runs and
// the harness reports anchor-drift (it does not silently pass).
const MUTANTS: Mutant[] = [
  {
    id: "adjacency",
    name: "attachment ignores adjacency: takes the nearest comment above",
    from: "  const target = declarationLine - 1 // the line the comment must END on",
    to: "  const target = declarationLine - 1 // MUTANT\n  const nearestAbove = sites.filter((s) => s.endLine < declarationLine).pop()\n  if (nearestAbove) return stripCommentMarkup(nearestAbove.text)",
  },
  {
    id: "truncate",
    name: "only the first line of a multi-line doc is kept",
    from: "  return out.join(\"\\n\").trim()",
    to: "  return out.join(\"\\n\").trim().split(\"\\n\")[0] ?? \"\" // MUTANT",
  },
  {
    id: "invent",
    name: "an absent doc is filled in with a placeholder",
    from: "  const target = declarationLine - 1 // the line the comment must END on",
    to: "  const target = declarationLine - 1 // MUTANT\n  const hit = sites.find((s) => s.endLine === target)\n  if (!hit) return \"(no documentation)\" // MUTANT",
  },
  {
    id: "markup",
    name: "comment delimiters and asterisks are not stripped",
    from: "    l = l.replace(/^\\s*\\*\\s?/, \"\")",
    to: "    // MUTANT: markup left in place",
  },
]

let failures = 0
const log = (ok: boolean, name: string, detail: string) => {
  if (!ok) failures++
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

function runProbe(id: string): { noticed: boolean; why: string } {
  const out = execFileSync("npx", ["tsx", PROBE, id], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  const line = out.trim().split("\n").pop() ?? "{}"
  return JSON.parse(line) as { noticed: boolean; why: string }
}

const original = readFileSync(TARGET, "utf8")
try {
  console.log(`\nDOC MUTANTS — each plants a real defect and requires the probe to notice\n`)

  for (const m of MUTANTS) {
    if (!original.includes(m.from)) {
      log(false, `${m.id}: anchor present`, `the anchor is ABSENT from doc_comment.ts — this mutant would never run`)
      continue
    }
    writeFileSync(TARGET, original.replace(m.from, m.to))
    let result: { noticed: boolean; why: string }
    try {
      result = runProbe(m.id)
    } catch (e) {
      log(false, `${m.id}: probe ran`, `probe threw: ${String((e as Error).message).slice(0, 80)}`)
      continue
    } finally {
      writeFileSync(TARGET, original) // always restore, even on throw
    }
    log(result.noticed, `${m.id}: probe NOTICES the planted defect`, result.why)
  }

  // The control: with the file restored, the probe must NOT notice any of them —
  // otherwise "noticed" is just the probe saying yes, and the suite proves nothing.
  writeFileSync(TARGET, original)
  const controls = MUTANTS.map((m) => ({ m, r: runProbe(m.id) }))
  for (const { m, r } of controls) {
    log(!r.noticed, `${m.id}: probe does NOT fire on the clean file (control)`, r.why)
  }
} finally {
  writeFileSync(TARGET, original)
}

console.log(`\nDOC MUTANTS: ${failures === 0 ? "PASS" : `FAILED (${failures})`}`)
process.exit(failures === 0 ? 0 : 1)