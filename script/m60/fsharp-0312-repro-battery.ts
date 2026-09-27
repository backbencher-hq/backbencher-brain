// script/m60/fsharp-0312-repro-battery.ts — does tree-sitter-fsharp 0.3.12 close the
// six gaps the triage named, without breaking any of their controls?
//
// WHY THIS EXISTS. validation/m60/grammar-survey.json puts `fsharp` in section A
// (a candidate grammar is ahead): our pin is 0.3.11 and npm published 0.3.12 on
// 2026-09-12 — TWELVE DAYS BEFORE this repo's own fsharp triage commit 344f176b,
// which reduced the lane's 26.8% parse rate to six named grammar gaps. So the
// question "patch the grammar, or take the release that shipped after we
// diagnosed it?" is answerable by measurement rather than by guess, and it decides
// whether the fsharp lane owes a patch at all.
//
// A co-agent A/B already exists (validation/m14/results/fsharp-grammar-ab.json)
// and it is NOT this comparison: it adjudicates our PATCHED 0.3.11 against
// UNPATCHED 0.3.11, which justifies the patch we already carry. Nobody has
// compared against 0.3.12.
//
// THE BATTERY, and why controls dominate it. fsharp-error-repro.json holds 24
// minimal reproducers: 8 that BREAK under the pinned grammar and 16 that parse.
// The 16 are not filler — they are what rules out the neighbouring hypotheses (the
// triage records that ordinary `and`-joined constraints parse, which is how the
// 18-file `type_arguments` clusters collapse to ONE `not null` gap rather than two).
// A candidate that fixes a breaking case while breaking a control has not improved
// anything; it has moved the boundary, and that is a different and much cheaper
// thing to detect here than through a full F11 A/B.
//
// Every case is a `source` string with no file I/O, so the whole battery is 24
// parses per grammar and runs in under a second. Read-only: it loads two wasms and
// writes nothing.
//
// Usage:
//   bun run script/m60/fsharp-0312-repro-battery.ts
//   bun run script/m60/fsharp-0312-repro-battery.ts --json
//   bun run script/m60/fsharp-0312-repro-battery.ts --candidate /path/other.wasm
//
// Writes: nothing.

import { readFileSync } from "node:fs"
import path from "node:path"
import * as WTS from "web-tree-sitter"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const argv = process.argv.slice(2)
const argValue = (a: string, d?: string) => (argv.includes(a) ? argv[argv.indexOf(a) + 1] : d)
const AS_JSON = argv.includes("--json")

const PINNED = path.join(ROOT, "wasm", "tree-sitter-fsharp.wasm")
const CANDIDATE = argValue("--candidate", "/tmp/opencode/grammars/fs312/package/tree-sitter-fsharp.wasm")!
const REPRO = path.join(ROOT, "validation", "m14", "results", "fsharp-error-repro.json")

await WTS.Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })

type Case = { id: string; note: string; breaks: boolean; source: string; reducedFrom?: string }
const battery = JSON.parse(readFileSync(REPRO, "utf8")) as { cases: Case[]; totals: { cases: number; breaking: number; parsing: number } }

/** Parse and report the first ERROR/MISSING, matching the triage's own definition. */
function probe(lang: any, source: string) {
  const p = new (WTS.Parser as any)()
  p.setLanguage(lang)
  const t = p.parse(source)
  let firstError: { line: number; text: string; parent: string } | null = null
  let firstMissing: { line: number; type: string } | null = null
  const st: any[] = [t.rootNode]
  while (st.length) {
    const n = st.pop()
    if (!firstError && n.type === "ERROR") {
      firstError = { line: n.startPosition.row + 1, text: source.split("\n")[n.startPosition.row]?.trim().slice(0, 60) ?? "", parent: n.parent?.type ?? "?" }
    }
    if (!firstMissing && n.isMissing) firstMissing = { line: n.startPosition.row + 1, type: n.type }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) st.push(c)
    }
  }
  p.delete?.()
  const errors = count(t.rootNode, "ERROR")
  const missing = count(t.rootNode, null)
  return { breaks: errors > 0 || missing > 0, errors, missing, firstError, firstMissing }
}
function count(root: any, type: string | null): number {
  let n = 0
  const st: any[] = [root]
  while (st.length) {
    const x = st.pop()
    if (type ? x.type === type : x.isMissing) n++
    for (let i = 0; i < x.namedChildCount; i++) {
      const c = x.namedChild(i)
      if (c) st.push(c)
    }
  }
  return n
}

const pinned = await WTS.Language.load(readFileSync(PINNED))
const cand = await WTS.Language.load(readFileSync(CANDIDATE))

const rows = battery.cases.map((c) => {
  const p = probe(pinned, c.source)
  const k = probe(cand, c.source)
  return {
    id: c.id,
    role: c.breaks ? "BREAKING under pinned" : "CONTROL (parses under pinned)",
    reducedFrom: c.reducedFrom ?? null,
    note: c.note,
    pinned: { breaks: p.breaks, errors: p.errors, missing: p.missing },
    candidate: { breaks: k.breaks, errors: k.errors, missing: k.missing },
    // The three outcomes that matter, and they are not equally good.
    outcome: p.breaks && !k.breaks ? "FIXED by candidate" : !p.breaks && k.breaks ? "REGRESSION — control now breaks" : p.breaks && k.breaks ? "still breaks" : "unchanged (parses both)",
  }
})

const fixed = rows.filter((r) => r.outcome === "FIXED by candidate")
const regressed = rows.filter((r) => r.outcome === "REGRESSION — control now breaks")
const stillBroken = rows.filter((r) => r.outcome === "still breaks")

const report = {
  schemaVersion: 1,
  instrument: "m60-fsharp-0312-repro-battery",
  question: "does tree-sitter-fsharp 0.3.12 close the six gaps the triage named, without breaking a control?",
  pinned: { file: path.basename(PINNED), nodeTypes: pinned.nodeTypeCount },
  candidate: { file: path.basename(CANDIDATE), nodeTypes: cand.nodeTypeCount },
  battery: { source: path.relative(ROOT, REPRO), cases: battery.totals.cases, breaking: battery.totals.breaking, controls: battery.totals.parsing },
  result: {
    fixed: fixed.length,
    regressed: regressed.length,
    stillBroken: stillBroken.length,
    controlsHeld: rows.filter((r) => r.role.startsWith("CONTROL") && !r.candidate.breaks).length,
    controlsTotal: rows.filter((r) => r.role.startsWith("CONTROL")).length,
  },
  rows,
  policy:
    "A screening battery, not a gate: 24 minimal sources with no file I/O, replayed under both grammars. A candidate that fixes a breaking case while breaking a control has moved the boundary rather than improved anything, and that is caught here in under a second instead of through a full F11 A/B. Acceptance remains M14.0.F11. The battery is the triage's own, unmodified — this file adds no cases and removes none, so a gap it does not cover is still a gap.",
}

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`fsharp 0.3.12 repro battery — ${report.battery.cases} cases (${report.battery.breaking} breaking, ${report.battery.controls} controls)`)
  console.log(`pinned ${report.pinned.nodeTypes} types vs candidate ${report.candidate.nodeTypes} types\n`)
  for (const r of rows) {
    const mark = r.outcome === "FIXED by candidate" ? "FIXED  " : r.outcome === "REGRESSION — control now breaks" ? "REGRESS " : r.outcome === "still breaks" ? "STILL  " : "  ok   "
    console.log(`  ${mark} ${r.id.padEnd(34)} pinned=${r.pinned.errors}e/${r.pinned.missing}m  cand=${r.candidate.errors}e/${r.candidate.missing}m   ${r.role.startsWith("CONTROL") ? "(control)" : ""}`)
  }
  console.log(`\n  FIXED ${report.result.fixed}/${report.battery.breaking} breaking   REGRESSIONS ${report.result.regressed}   still broken ${report.result.stillBroken}   controls held ${report.result.controlsHeld}/${report.result.controlsTotal}`)
  console.log(`  ${report.result.fixed === report.battery.breaking && report.result.regressed === 0 ? "0.3.12 closes EVERY named gap and holds every control — the fsharp lane owes an UPGRADE, not a patch." : report.result.fixed > 0 ? `0.3.12 closes ${report.result.fixed} of ${report.battery.breaking} named gaps. The remainder still owe a patch.` : "0.3.12 closes none of the named gaps — the lane owes a patch regardless."}`)
}
