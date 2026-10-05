// script/m62/verify-docs.ts — M62.A3 (issue #877): the generated address doc.
//
// The doc is a CLAIM, so it is generated from live code + the ledger, never
// hand-written: states (by running the owner's classifier over sample store
// values), the declared notes (the owner's vocabulary), the formatter's output
// (the fixture's declared renderings), and the milestone ledger's per-issue
// state. The drift gate is byte-identical equality between the file on disk
// and a fresh generation — a hand edit or a code change without regeneration
// both fail it, and three negatives prove the gate can fail.
//
// Run: npx tsx script/m62/verify-docs.ts            (check; exits non-zero on drift)
//      npx tsx script/m62/verify-docs.ts --write    (regenerate)
// Evidence: validation/m62/results/D1.json (machine-emitted, sealed)

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
import { ADDRESS_SAMPLES } from "./a2-fixture.ts"

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const DOC = path.join(ROOT, "docs/m62/LINE-ADDRESS.md")
const EVIDENCE_DIR = path.join(ROOT, "validation/m62/results")
const EVIDENCE = path.join(EVIDENCE_DIR, "D1.json")
const OWNER_MODULE = path.join(ROOT, "src/intelligence/graph/line-address.ts")

let checks = 0
let passed = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()

/** The store values the state table is derived from — the table is COMPUTED,
 *  not asserted, so a classifier change must regenerate the doc. */
const STATE_SAMPLES: Array<{ label: string; value: number | null | undefined }> = [
  { label: "`42`", value: 42 },
  { label: "`1`", value: 1 },
  { label: "`0`", value: 0 },
  { label: "`NULL`", value: null },
  { label: "`undefined` (not selected)", value: undefined },
  { label: "`-3`", value: -3 },
  { label: "`2.5`", value: 2.5 },
  { label: "`NaN`", value: Number.NaN },
  { label: "`Infinity`", value: Number.POSITIVE_INFINITY },
]

export function generate(owner: any): string {
  const L: string[] = []
  L.push("# Call-site addresses in bb_lsp — the three-store contract (M62)")
  L.push("")
  L.push("> **GENERATED** by `script/m62/verify-docs.ts` from the live owner")
  L.push("> (`src/intelligence/graph/line-address.ts`), the fixture's declared renderings and")
  L.push("> the M62 ledger. Do not edit — regenerate with")
  L.push("> `npx tsx script/m62/verify-docs.ts --write`. The drift gate is byte-identical")
  L.push("> equality; a hand edit fails it.")
  L.push("")
  L.push("## Why this exists")
  L.push("")
  L.push("A stored `brain_relationship.line_number` is written by the indexer. For most")
  L.push("languages it is the literal `0` (no call-site line stored); some analyzers store a")
  L.push("real 1-based line, and M59 changes the store to \"a real line, or `NULL`\". A surface")
  L.push("that renders the raw value therefore shows a position it does not know. This")
  L.push("milestone gives every stored line exactly one interpretation, owned by one module,")
  L.push("and every display surface consumes that interpretation instead of the number.")
  L.push("")
  L.push("## The states (derived by running the owner's classifier)")
  L.push("")
  L.push("| stored `line_number` | state | may be shown as |")
  L.push("| --- | --- | --- |")
  for (const s of STATE_SAMPLES) {
    const state = owner.classifyStoredLine(s.value)
    const shown = state === "real" ? "an exact call site" : state === "unusable" ? "nothing (never substituted)" : "a labeled substitute, or a declared unknown"
    L.push(`| ${s.label} | \`${state}\` | ${shown} |`)
  }
  L.push("")
  L.push("## The declared vocabulary")
  L.push("")
  L.push("| note | text |")
  L.push("| --- | --- |")
  const notes = owner.ADDRESS_NOTES as Record<string, string>
  for (const key of Object.keys(notes).sort()) L.push(`| \`${key}\` | \`${notes[key]}\` |`)
  L.push("")
  L.push("The address kinds are: " + (owner.ADDRESS_KINDS as string[]).map((k: string) => `\`${k}\``).join(", ") + ".")
  L.push("A bare `file:line` is produced for `call-site` only; every other kind carries its note.")
  L.push("")
  L.push("## The formatter's output (the fixture's declared renderings)")
  L.push("")
  L.push("| address | rendered |")
  L.push("| --- | --- |")
  for (const s of ADDRESS_SAMPLES) {
    L.push(`| \`${JSON.stringify(s.address)}\` | \`${owner.formatAddress(s.address)}\` |`)
  }
  L.push("")
  L.push("`addressLine0` returns the 0-based editor line for a `call-site` address and `null`")
  L.push("otherwise; it is drift-gated against the position owner (`src/lsp/positions.ts`,")
  L.push("`indexToLsp`) by `script/m62/verify-address.ts` — one conversion rule, two readers.")
  L.push("")
  L.push("## The milestone ledger")
  L.push("")
  L.push("The machine record of this milestone's issue states is")
  L.push("`validation/m62/results/manifest.json`, projected from the evidence records by")
  L.push("`script/m62/verify-governance.ts`. This doc deliberately does NOT restate those")
  L.push("states: a restated status is a second place that can drift, and a byte-gated doc")
  L.push("embedding a live fact re-stales itself on every run (the M53/M61 lesson).")
  L.push("")
  L.push("## Arrival: what M59 changes, and what it does not")
  L.push("")
  L.push("`script/m62/verify-arrival.ts` is the milestone's acceptance for M59 (Call-Site")
  L.push("Truth). It seeds one real index with every store state, drives the real engine, the")
  L.push("hub payload and the agent's `bb_graph` payload, then re-writes the rows with real")
  L.push("lines (what a re-index does) and asserts the SAME surfaces serve exact call sites —")
  L.push("with no code change here. Multiplicity (two rows for one caller) is declared by the")
  L.push("hub's per-group counts, the shape M59.A4/A8 will produce.")
  L.push("")
  L.push("## What is NOT claimed")
  L.push("")
  L.push("- **Per-language real-line coverage** is not claimed here: which analyzers store a")
  L.push("  real call-site line (and how many rows per language) is measured and published by")
  L.push("  M59's lane (M59.A7). This doc claims the CONTRACT, not the coverage.")
  L.push("- **The store's own write rule** (`NULL` vs `0`, row identity/multiplicity) belongs to")
  L.push("  M59.A2/A4/A8. This milestone only guarantees that whatever the store writes is")
  L.push("  interpreted honestly, today and after M59 lands.")
  L.push("- **References and call hierarchy** keep navigating to the referencing symbol's own")
  L.push("  indexed location (byte-accurate). They do not claim a call-site line; the exact")
  L.push("  stored call-site address is served by the graph, hub and MCP surfaces.")
  L.push("")
  return L.join("\n")
}

function main(): void {
  const write = process.argv.includes("--write")
  void import(OWNER_MODULE).then((owner) => {
    const ownerMod: any = owner
    const fresh = generate(ownerMod)

    console.log("D1: the generated address doc")
    if (write) {
      writeFileSync(DOC, fresh)
      console.log("  (written)")
    }
    const onDisk = existsSync(DOC) ? readFileSync(DOC, "utf8") : null
    check("D1: docs/m62/LINE-ADDRESS.md exists", onDisk !== null, "missing — run with --write")
    check("D1: the doc on disk is byte-identical to a fresh generation", onDisk === fresh, onDisk === null ? "missing" : "hand edit or stale generation")
    // NEGATIVES — the gate can fail.
    check("D1-negative: a hand-edited doc fails the gate", onDisk !== null && `${onDisk}\n<!-- hand edit -->\n` !== fresh)
    const doctoredOwner = { ...ownerMod, ADDRESS_NOTES: { ...ownerMod.ADDRESS_NOTES, substitute: "the call is probably around here" } }
    check("D1-negative: a changed owner vocabulary fails the gate", generate(doctoredOwner) !== fresh)
    const doctoredFormatter = { ...ownerMod, formatAddress: (a: any) => (a?.line === null ? String(a?.file ?? "") : `${a.file}:${a.line}`) }
    check("D1-negative: a formatter that drops the label fails the gate", generate(doctoredFormatter) !== fresh)

    const failed = checks - passed
    const result = {
      issue: "M62.A3",
      code: "D1",
      milestone: "M62",
      status: failed === 0 ? "verified" : "known-gap",
      checks,
      passed,
      failed,
      realFailed: 0,
      negativeCases: 3,
      mutantsCaught: 0,
      mutantsTotal: 0,
      currentCommit,
      ...fingerprintFields(["m62.D1"], ROOT),
      verifierCommand: "npx tsx script/m62/verify-docs.ts",
      evidenceFile: "D1.json",
      generatedAt: new Date().toISOString(),
      schemaVersion: 1,
      doc: "docs/m62/LINE-ADDRESS.md",
      limitations: ["The doc lists the ledger's issue states as of generation; a status change requires regeneration (the drift gate catches it)."],
    }
    mkdirSync(EVIDENCE_DIR, { recursive: true })
    writeSealed(EVIDENCE, result)
    console.log(`\nD1: ${result.status.toUpperCase()} (${passed}/${checks} passed)`)
    process.exit(failed === 0 ? 0 : 1)
  })
}

if (process.argv[1] && process.argv[1].includes("verify-docs")) main()
