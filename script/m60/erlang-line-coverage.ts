// M60.P1 for erlang: is `line_number` actually ALIVE on the erlang lane, or does
// the cell pass on a source-regex?
//
// The M60 completion matrix derives its `lines` cell from
// `script/m60/payload-matrix.ts`, whose `line_number` emit check is
//
//     emit: /\bline_number\s*:/
//
// run over the analyzer's SOURCE. One occurrence satisfies it. The matrix says so
// itself: "the gate asks `is line_number written anywhere` so ONE emit site
// satisfies it". That is enough to prove the field is not dead and not enough to
// prove it is right: a line that is off by one, that names the construct instead
// of the name-bearing node, or that points at a line the file does not have all
// read as `alive: true`.
//
// This gate measures the thing the cell stands in for, over the whole corpus and
// through the PRODUCTION entry (pool-worker `parseFile`, not a direct `analyze`
// call, so the engine's own handoff runs):
//
//   1. COVERAGE  — every relationship carries a numeric line. A relationship with no
//      line is stored NULL and reads as "unknown location" forever.
//   2. BOUNDS    — every line is within [1, the file's own line count]. A line past
//      EOF is a construct that ran off the end, and an off-by-one is invisible in
//      any count that starts at zero.
//   3. NON-ZERO  — no 0-based line leaked through. This is the failure M59 #825 was
//      written about, and a bounds check that starts at 0 cannot see it.
//   4. RESIDENCE — the line is a line the file has content on. A relationship whose
//      line is blank is pointing at a construct boundary rather than a
//      name-bearing node, which is the ER-D33 class: a multi-line `-define(` puts
//      the keyword a line above the macro name, and reporting the keyword's line is
//      wrong even though it is in bounds.
//   5. SYMBOLS   — every symbol carries both a start and an end line, in bounds.
//
// The result is broken down by relationship type, because one number over ~900k
// edges hides the case where a single edge type is entirely unlined.
//
// It FAILS on any violation, and it FAILS when it examined nothing: the first run
// of this gate reported all four dimensions PASS over 0 files because the corpus
// path was wrong. Four green rows from no data is worse than no gate.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

// Overridable because the corpora live under whichever home the run has; the lua
// gate takes its repo as argv[2] for the same reason.
const ROOT = process.env.BB_ERLANG_REPOS ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = [
  { name: "otp", dir: path.join(ROOT, "otp") },
  { name: "rebar3", dir: path.join(ROOT, "rebar3") },
  { name: "cowboy", dir: path.join(ROOT, "cowboy") },
]

const LIMIT = Number(process.env.BB_ERLANG_LINE_LIMIT ?? "0") // 0 = every file
const OUT = process.env.BB_ERLANG_LINE_OUT ?? ""

interface Bucket {
  total: number
  withLine: number
}
const byType = new Map<string, Bucket>()
const bucket = (t: string): Bucket => {
  let b = byType.get(t)
  if (!b) byType.set(t, (b = { total: 0, withLine: 0 }))
  return b
}

async function main(): Promise<void> {
  let files = 0
  let parsed = 0
  let relationships = 0
  let withLine = 0
  let symbolLines = 0
  let symbolWithLine = 0
  const missing: string[] = []
  const zero: string[] = []
  const outOfBounds: string[] = []
  const blankLine: string[] = []
  const symbolIncomplete: string[] = []
  const symbolOutOfBounds: string[] = []
  const t0 = Date.now()

  for (const repo of REPOS) {
    if (!fs.existsSync(repo.dir)) {
      console.log(`  MISSING repo ${repo.dir} — skipped`)
      continue
    }
    const listed = execFileSync("git", ["-C", repo.dir, "ls-files", "*.erl", "*.hrl"], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
      .trim()
      .split("\n")
      .filter(Boolean)
    for (const rel of LIMIT > 0 ? listed.slice(0, LIMIT) : listed) {
      files++
      const abs = path.join(repo.dir, rel)
      let content: string
      try {
        content = fs.readFileSync(abs, "utf8")
      } catch {
        continue
      }
      const lines = content.length === 0 ? [] : content.split("\n")
      const lineCount = lines.length
      let r: any
      try {
        r = await parseFile(abs, repo.dir)
      } catch {
        continue
      }
      if (!r || r.success === false) continue
      parsed++

      // The production entry NORMALISES `range` to flat `startLine`/`endLine`
      // (pool-worker.ts:651), so a gate that reads `s.range.startLine` measures
      // nothing and reports 0% — which is exactly what the first run of this gate
      // did. Both spellings are read, and the end line is measured too: a symbol
      // with a start and no end cannot be ranged over in a query.
      for (const s of r.symbols ?? []) {
        symbolLines++
        const sl = typeof s.startLine === "number" ? s.startLine : s.range?.startLine
        const el = typeof s.endLine === "number" ? s.endLine : s.range?.endLine
        if (typeof sl === "number" && sl >= 1) symbolWithLine++
        if (typeof sl !== "number" || typeof el !== "number") {
          symbolIncomplete.push(`${repo.name}/${rel}: ${s.name} (start=${sl} end=${el})`)
        } else if (sl < 1 || el > lineCount) {
          symbolOutOfBounds.push(`${repo.name}/${rel}: ${s.name} @${sl}-${el} (file has ${lineCount} lines)`)
        }
      }

      for (const e of r.relationships ?? []) {
        relationships++
        const t = String(e.type ?? e.relationshipType ?? "?")
        const b = bucket(t)
        b.total++
        const ln = e.line_number
        const where = `${repo.name}/${rel}: ${t} ${e.source ?? e.from}->${e.target ?? e.to}`
        if (typeof ln !== "number" || !Number.isFinite(ln)) {
          missing.push(`${where} (no line)`)
          continue
        }
        b.withLine++
        withLine++
        if (ln === 0) zero.push(`${where} @0`)
        else if (ln < 1 || ln > lineCount) outOfBounds.push(`${where} @${ln} (file has ${lineCount} lines)`)
        else if ((lines[ln - 1] ?? "").trim() === "") blankLine.push(`${where} @${ln}`)
      }
    }
  }

  // A gate that examined NOTHING is not a pass. The first run of this gate
  // reported all four dimensions PASS over 0 files because the corpus path was
  // wrong — four green rows and a green verdict, from no data. That is the same
  // failure the erlang dual lens had when a reused WASM parser silently skipped
  // 422 of 4,326 files while the header said "4,326 files". An empty run is a
  // failure to run, reported as one.
  if (files === 0) {
    console.error(
      `\nM60.P1 erlang line coverage: examined 0 files under ${ROOT} — this is a RUN failure, not a pass.\n` +
        `Set BB_ERLANG_REPOS to the directory holding the otp/rebar3/cowboy checkouts.`,
    )
    process.exitCode = 1
    return
  }
  if (parsed === 0) {
    console.error(
      `\nM60.P1 erlang line coverage: read ${files} files and parsed 0 — the production entry rejected every one.`,
    )
    process.exitCode = 1
    return
  }

  const pct = relationships ? ((withLine / relationships) * 100).toFixed(3) : "n/a"
  const symPct = symbolLines ? ((symbolWithLine / symbolLines) * 100).toFixed(3) : "n/a"
  const violations =
    missing.length + zero.length + outOfBounds.length + blankLine.length +
    symbolIncomplete.length + symbolOutOfBounds.length

  console.log("")
  console.log("M60.P1 line coverage — erlang, through the production entry (pool-worker parseFile)")
  console.log(`  corpora=${REPOS.map((r) => r.name).join(",")} files=${files} parsed=${parsed} wall=${Date.now() - t0} ms`)
  console.log(
    `  relationships=${relationships} withLine=${withLine} (${pct}%) | symbols=${symbolLines} withStartLine=${symbolWithLine} (${symPct}%)`,
  )
  console.log("")
  console.log("| dimension | count | verdict |")
  console.log("|---|---|---|")
  const row = (label: string, arr: string[]) =>
    console.log(`| ${label} | ${arr.length} | ${arr.length === 0 ? "PASS" : "FAIL"} |`)
  row("relationship with no line (stored NULL)", missing)
  row("line 0 (0-based leak)", zero)
  row("line outside [1, file lines]", outOfBounds)
  row("line points at a blank line", blankLine)
  row("symbol missing start or end line", symbolIncomplete)
  row("symbol line outside [1, file lines]", symbolOutOfBounds)
  console.log("")
  console.log("| relationship type | total | withLine | % |")
  console.log("|---|---|---|---|")
  for (const [t, b] of [...byType.entries()].sort((a, b2) => b2[1].total - a[1].total)) {
    const p = b.total ? ((b.withLine / b.total) * 100).toFixed(2) : "n/a"
    console.log(`| ${t} | ${b.total} | ${b.withLine} | ${p} |`)
  }
  for (const [t, b] of byType) {
    if (b.total > 0 && b.withLine === 0) console.log(`  NOTE: \`${t}\` carries NO line anywhere in the corpus`)
  }

  for (const [label, arr] of [
    ["MISSING LINE", missing],
    ["ZERO LINE", zero],
    ["OUT OF BOUNDS", outOfBounds],
    ["BLANK LINE", blankLine],
    ["SYMBOL LINE INCOMPLETE", symbolIncomplete],
    ["SYMBOL LINE OUT OF BOUNDS", symbolOutOfBounds],
  ] as const) {
    if (arr.length === 0) continue
    console.log("")
    console.log(`## ${label} (${arr.length}, first 15)`)
    for (const s of arr.slice(0, 15)) console.log(`  ${s}`)
  }

  if (OUT) {
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          gate: "M60.P1 line coverage (erlang)",
          at: new Date().toISOString(),
          corpora: REPOS.map((r) => r.name),
          files,
          parsed,
          relationships,
          withLine,
          coveragePct: Number(pct),
          symbols: symbolLines,
          symbolsWithStartLine: symbolWithLine,
          missingLine: missing.length,
          zeroLine: zero.length,
          outOfBounds: outOfBounds.length,
          blankLine: blankLine.length,
          symbolLineIncomplete: symbolIncomplete.length,
          symbolLineOutOfBounds: symbolOutOfBounds.length,
          byType: Object.fromEntries(byType.entries()),
          verdict: violations === 0 ? "PASS" : "FAIL",
        },
        null,
        2,
      ) + "\n",
    )
    console.log(`\nevidence written: ${OUT}`)
  }

  if (violations > 0) {
    console.error(
      `\nM60.P1 erlang line coverage: ${violations} violation(s) — the \`lines\` cell is NOT satisfied by measurement`,
    )
    process.exitCode = 1
  } else {
    console.log(
      "\nM60.P1 erlang line coverage: PASS — every relationship carries an in-bounds, non-blank, 1-based line, and every symbol a start+end line",
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
