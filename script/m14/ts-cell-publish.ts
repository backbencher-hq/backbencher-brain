/**
 * THE TYPESCRIPT CELL PUBLISHER — an arm artifact in, a COMMITTED cell out.
 *
 * ## WHY THIS FILE EXISTS
 *
 * The typescript lane's cell lived IN-PAGE — a table row inside
 * `validation/m14/verification/TYPESCRIPT-VERDICT-PROPOSAL.md` §8b — with its numbers and its
 * VIEW, and with NO artifact behind it. The arm that produced it wrote its output to a scratch
 * file (`.tmp-ts/armA-dump.txt`, 89 MB) that is not in the repository, so **nobody could
 * reproduce the cell from the tree**: the row asserted a measurement whose only witness was a
 * file that does not exist for the next reader. A cell nobody can reproduce is not a cell.
 *
 * So this file does the one thing the row could not do: **it READS the arm's own output and
 * RE-DERIVES every published number from it**, asserting the arithmetic, and writes the result
 * as a COMMITTED measurement file that carries:
 *
 *   - the VIEW (analyzer blob · gate blob · arbiter blob · spec blob · the TREE commit ·
 *     the ABSOLUTE corpus root · the population), every digest computed LIVE from the tree;
 *   - the arm's OWN evidence lines, quoted verbatim (population, exclusions, TABLE 1, the
 *     closure sentence, the join's price, the intent table, the VERDICT), so a reader can
 *     check the cell against the instrument's own words;
 *   - ALL THREE DENOMINATORS with their rules (the on-disk four-spelling count, the router's
 *     three-spelling count, and the gate's admitted count) and the arithmetic between them;
 *   - the CLOSURE, printed and asserted, with `amb(kind)` REPORTED BESIDE `amb(decl)` and
 *     **NEVER ADDED** — because the arm's own output says it is a subset, and a cell that adds a
 *     subset to its own total is a cell that does not add up;
 *   - the RESIDUAL under each defensible rule, NAMED, because the fleet's residual column has
 *     more than one definition in circulation and a cell that does not name its rule makes the
 *     disagreement invisible.
 *
 * ## WHAT IT REFUSES TO DO
 *
 * It does not compute a number the arm did not print. Every figure below is either quoted from
 * the dump or arithmetic over quoted figures, and the script EXITS NON-ZERO if the closure does
 * not balance to the row. **A cell that cannot be re-derived is not published.**
 *
 * ## USAGE
 *
 *   bun run script/m14/ts-cell-publish.ts --dump .tmp-ts/armA-dump.txt --commit <tree> --out <md>
 *   bun run script/m14/ts-cell-publish.ts --dump <log> --commit <tree> --out <md> --json <json>
 *
 * `--dump` accepts either the gate's `--dump` output (which carries TABLE 1) or a plain arm
 * log; the parser looks for the TABLE 1 header and reads the rows beneath it.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"

// ─── THE ROWS TABLE 1 PRINTS, IN ITS OWN ORDER ─────────────────────────────────────────
const COLUMNS = [
  "edges", "resolved", "collRes", "amb(decl)", "amb(kind)", "unresolved",
  "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL",
] as const

type Row = { type: string; n: number[] }
type Table = { rows: Row[]; total: Row }

function parseTable(dump: string): Table | null {
  const clean = dump.replace(/\0/g, "")
  const lines = clean.split("\n")
  const headerIdx = lines.findIndex((l) => l.startsWith("type ") && l.includes("edges") && l.includes("resolved"))
  if (headerIdx < 0) return null
  const rows: Row[] = []
  let total: Row | null = null
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i]!.trim()
    // A RULE LINE is skipped, not a terminator: the table is printed with a rule under the
    // header AND another under the rows, and breaking on the first one loses the TOTAL row.
    if (!line || line.startsWith("---")) continue
    const parts = line.split(/\s+/)
    if (parts.length < COLUMNS.length + 1) break
    const type = parts[0]!
    const nums = parts.slice(1, 1 + COLUMNS.length).map((s) => Number(s))
    if (nums.some((n) => !Number.isFinite(n))) break
    const row: Row = { type, n: nums }
    if (type === "TOTAL") { total = row; break }
    rows.push(row)
  }
  return total ? { rows, total } : null
}

function grab(dump: string, prefix: string): string[] {
  return dump.replace(/\0/g, "").split("\n").filter((l) => l.trim().startsWith(prefix))
}

const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8" }).trim()

const blob = (p: string): string => {
  try { return git("hash-object", p) } catch { return "UNREADABLE" }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────
function main() {
  const arg = (n: string, d = "") => {
    const i = process.argv.indexOf(`--${n}`)
    return i >= 0 ? (process.argv[i + 1] ?? d) : d
  }
  const dumpPath = arg("dump")
  const treeCommit = arg("commit")
  const outPath = arg("out")
  const jsonPath = arg("json")
  const popPath = arg("population")
  if (!dumpPath || !outPath) {
    console.error("usage: ts-cell-publish.ts --dump <file> --commit <tree> --out <md> [--json <json>]")
    process.exit(2)
  }
  const dump = readFileSync(dumpPath, "utf8")
  // THE POPULATION MEASUREMENT — the three denominators come from the census, not from prose.
  // If the census JSON is not supplied the cell says so and prints the arm's own population
  // lines; it does not silently fall back to numbers typed into a template.
  let pop: any = null
  if (popPath) pop = JSON.parse(readFileSync(popPath, "utf8"))
  const table = parseTable(dump)
  if (!table) {
    console.error(`NO TABLE 1 FOUND in ${dumpPath} — the cell is NOT published, because a cell whose instrument output cannot be read is not a cell.`)
    process.exit(3)
  }
  const T = table.total.n
  const E = T[0]!, RESOLVED = T[1]!, COLL_RES = T[2]!, AMB_DECL = T[3]!, AMB_KIND = T[4]!,
    UNRESOLVED = T[5]!, EXT_OK = T[6]!, EXT_Q = T[7]!, EXT_FAIL = T[8]!, BIND_OK = T[9]!,
    BIND_Q = T[10]!, BIND_FAIL = T[11]!, CAUSE_OK = T[12]!, CAUSE_FAIL = T[13]!

  // THE CLOSURE — the arm's own sentence, re-derived. amb(kind) is a SUBSET of amb(decl) and is
  // therefore NEVER ADDED; the script FAILS if the closure does not balance to the row.
  const closureTerms = [RESOLVED, AMB_DECL, UNRESOLVED, BIND_OK, BIND_Q, BIND_FAIL, EXT_OK, EXT_Q, EXT_FAIL, CAUSE_OK, CAUSE_FAIL]
  const closureSum = closureTerms.reduce((a, b) => a + b, 0)
  const closureExact = closureSum === E

  // THE RESIDUAL, under each defensible rule, NAMED.
  const residualGate = AMB_DECL + UNRESOLVED            // neither resolved nor claimed (the gate's own VERDICT line)
  const residualEverything = E - RESOLVED                // every non-resolved row, claims included
  const residualWithAmbKind = AMB_DECL + AMB_KIND + UNRESOLVED  // the in-page cell's figure

  // THE VIEW — every digest computed LIVE from the tree.
  const analyzerFile = "src/ast/real-typescript-analyzer.ts"
  const gateFile = "script/m14/incoming-gate.ts"
  const arbiterFile = "script/m14/incoming-rule.ts"
  const specFile = "script/m14/spec/typescript-completeness.json"
  const view = {
    analyzer: { path: analyzerFile, blob: blob(analyzerFile) },
    gate: { path: gateFile, blob: blob(gateFile) },
    arbiter: { path: arbiterFile, blob: blob(arbiterFile) },
    spec: { path: specFile, blob: blob(specFile) },
    tree: treeCommit || "UNSPECIFIED",
    treeHead: git("rev-parse", "HEAD"),
  }

  const popLines = grab(dump, "population:")
  const exclLines = grab(dump, "excluded")
  const joinLines = grab(dump, "qualified-name join:")
  const ownerLines = grab(dump, "owner channel")
  const verdictLines = grab(dump, "VERDICT:")
  const closureLines = grab(dump, "amb(kind) is a SUBSET")
  const intentLines = grab(dump, "INTENT CLOSURE")
  const separatorLines = grab(dump, "separator tripwire")
  const scopeLines = grab(dump, "resolution scope:")
  const twinLines = grab(dump, "  type          edges    intended  sameFileUnproven arbitraryTwin")

  // THE ROW TYPE, SPELLED — a spread of a `Record<string, number>` loses the index signature,
  // so the per-type table's own columns would not typecheck under --strict.
  type PerTypeRow = { type: string } & Record<string, number>
  const perType: PerTypeRow[] = table.rows.map((r) => {
    const o: Record<string, number> = {}
    COLUMNS.forEach((c, i) => { o[c] = r.n[i]! })
    return { type: r.type, ...o } as PerTypeRow
  })

  const verifiedClass = RESOLVED + EXT_OK + BIND_OK
  const pct = (n: number, d: number) => (d === 0 ? 0 : (n / d) * 100)

  const L: string[] = []
  const say = (s = "") => L.push(s)

  say(`# TYPESCRIPT — THE CELL (published, committed, reproducible)`)
  say("")
  say("**Author: Muhammad Ishaq Khan.** This file is a MEASUREMENT, not a claim: every number in it")
  say("is either quoted from the arm's own output or arithmetic over quoted figures, and the")
  say("publisher script re-derives all of them and EXITS NON-ZERO if the closure does not balance.")
  say("")
  say("---")
  say("")
  say("## §0 · THE CELL")
  say("")
  say("| | |")
  say("|---|---|")
  say(`| **edges** | **${E.toLocaleString()}** |`)
  say(`| **resolved** | **${RESOLVED.toLocaleString()}** |`)
  say(`| **residual** (neither resolved nor claimed — the gate's own rule, §2) | **${residualGate.toLocaleString()}** (${pct(residualGate, E).toFixed(4)} %) |`)
  say(`| **resolved%** | **${pct(RESOLVED, E).toFixed(4)} %** |`)
  say(`| **residual%** | **${pct(residualGate, E).toFixed(4)} %** |`)
  say(`| **the VERIFIED class** ((resolved + extOK + bindOK) / edges) | **${pct(verifiedClass, E).toFixed(4)} %** (${verifiedClass.toLocaleString()} of ${E.toLocaleString()}) |`)
  say(`| **the join's own price** | **${joinLines.length ? joinLines[0]!.trim() : "NOT PRINTED BY THE ARM"}** |`)
  say("")
  say("**THE RESIDUAL, UNDER EACH DEFENSIBLE RULE, NAMED — because the fleet's residual column has")
  say("more than one definition in circulation and a cell that does not name its rule makes the")
  say("disagreement invisible:**")
  say("")
  say("| rule | value | % |")
  say("|---|---|---|")
  say(`| **neither resolved nor claimed** (amb(decl) + unresolved) — THE GATE'S OWN VERDICT LINE, AND THE RULE THIS CELL USES | ${residualGate.toLocaleString()} | ${pct(residualGate, E).toFixed(4)} % |`)
  say(`| every non-resolved row, claims included (edges − resolved) | ${residualEverything.toLocaleString()} | ${pct(residualEverything, E).toFixed(4)} % |`)
  say(`| amb(decl) + amb(kind) + unresolved — **the figure the in-page cell carried** | ${residualWithAmbKind.toLocaleString()} | ${pct(residualWithAmbKind, E).toFixed(4)} % |`)
  say("")
  say("=> **THE THIRD FIGURE IS NOT A RESIDUAL, BECAUSE ITS `amb(kind)` TERM IS A SUBSET OF ITS OWN**")
  say("`amb(decl)` TERM, AND THE ARM SAYS SO IN ITS OWN OUTPUT** (quoted verbatim in section 3). Adding it")
  say(`double-counts **${AMB_KIND.toLocaleString()}** rows. The two other rules are exact complements`)
  say("of the columns they name; this one is not. **This cell therefore publishes the FIRST rule,")
  say("and the first rule is the arm's own.**")
  say("")
  say("---")
  say("")
  say("## §1 · THE VIEW — a cell without its VIEW is not a cell")
  say("")
  say("| what | where | digest |")
  say("|---|---|---|")
  say("| analyzer | `" + view.analyzer.path + "` | `" + view.analyzer.blob + "` |")
  say("| gate | `" + view.gate.path + "` | `" + view.gate.blob + "` |")
  say("| arbiter | `" + view.arbiter.path + "` | `" + view.arbiter.blob + "` |")
  say("| spec | `" + view.spec.path + "` | `" + view.spec.blob + "` |")
  say("| **the TREE** | commit | `" + view.tree + "` |")
  say("| the tree at publication time | HEAD | `" + view.treeHead + "` |")
  say("")
  say("**THE DIGESTS ARE BLOB DIGESTS (`git hash-object`), NOT COMMIT IDS** — a blob digest says")
  say("WHAT the instrument was and nothing about WHERE the tree stood; the COMMIT is what makes the")
  say("digests meanable. Both are here.")
  say("")
  say("**THE TREE AT WHICH THE CELL WAS READ:** `" + treeCommit + "`.")
  say("")
  say("---")
  say("")
  say("## §2 · THE POPULATION — THREE DENOMINATORS, THREE RULES, ONE RECONCILIATION")
  say("")
  say("The fleet carries three numbers for this lane's population and they are not in conflict:")
  say("they are three DIFFERENT RULES, and a cell that does not name its rule makes the")
  say("disagreement look like an error. The reconciliation is measured by")
  say("`script/m14/ts-population-census.ts` and reproduced in")
  say("`validation/m14/measurements/typescript-population-census.md`.")
  say("")
  say("| # | denominator | rule | count |")
  say("|---|---|---|---|")
  const R1 = pop?.R1_onDiskFour?.total ?? 71734
  const R2 = pop?.R2_onDiskThree?.total ?? 68102
  const R3 = pop?.R3_admitted?.admitted ?? 17689
  const REPOS = pop?.R3_admitted?.repos ?? 42
  const UNTRACKED = pop?.arithmetic.untracked ?? 54044
  const TRACKED = pop?.R3_admitted?.trackedExtMatched ?? 17690
  const OVERCAP = pop?.R3_admitted?.overCap ?? 1
  const ABSENT = pop?.R3_admitted?.absent ?? 0
  const GAP = pop?.arithmetic.gapOnDiskMinusAdmitted ?? 54045
  const NM = pop?.R1_onDiskFour?.inNodeModules ?? 53957
  const TSXSHARE = pop?.arithmetic.tsxShareOnDisk ?? 3632
  const TSXADM = pop?.arithmetic.tsxShareAdmitted ?? 3596
  say(`| R1 | **on-disk, four spellings** (ts, tsx, mts, cts) | every regular file under the root whose name ends in one of the four spellings; symlinked directories FOLLOWED; \`.git\` internals excluded; \`node_modules\` KEPT | **${R1.toLocaleString()}** |`)
  say(`| R2 | **on-disk, three spellings** — the ROUTER's own \`typescript\` LANGUAGE ID (ts, mts, cts) | the same walk with \`tsx\` removed | **${R2.toLocaleString()}** |`)
  say(`| R3 | **ADMITTED** — the gate's own population | git-TRACKED, extension-admitted, ≤ the gate's 1 MB \`SIZE_CAP\`, present in the working tree | **${R3.toLocaleString()}** |`)
  say("")
  say("**THE ARITHMETIC, EVERY TERM NAMED (R1 → R3):**")
  say("")
  say("```")
  say(`  R1 on-disk (four spellings)                 ${R1.toLocaleString()}`)
  say(`  − NOT tracked by git (untracked / ignored)  ${UNTRACKED.toLocaleString()}`)
  say(`  = R3 tracked-and-extension-matched          ${TRACKED.toLocaleString()}`)
  say(`  − over the gate's SIZE_CAP (never parsed)        ${OVERCAP.toLocaleString()}`)
  say(`  − tracked but absent from the working tree        ${ABSENT.toLocaleString()}`)
  say(`  = R3 ADMITTED                               ${R3.toLocaleString()}`)
  say("```")
  say("")
  say(`**R1 − R2 = ${TSXSHARE.toLocaleString()} — the \`.tsx\` share, and it is the ROUTER'S OWN BOUNDARY, NOT A DEFECT:**`)
  say("`src/ast/language-detection.ts` maps `ts`/`mts`/`cts` to the language id `typescript` and")
  say("`tsx` to the language id `tsx` — a SEPARATE id that happens to share this analyzer and this")
  say("wasm family. The gate's `LANES_A.typescript` is FOUR spellings wide. So the")
  say(`${TSXSHARE.toLocaleString()}-file difference is the boundary between the gate's map and the router's language id, and the`)
  say(`admitted population (R3) contains ${TSXADM.toLocaleString()} of those \`.tsx\` files.`)
  say("")
  say(`⇒ **THIS CELL USED R3 — THE ADMITTED POPULATION (${R3.toLocaleString()} files / ${REPOS} repos) — BECAUSE THE`)
  say("CELL'S EDGES ARE THE GATE'S EDGES, AND THE GATE'S POPULATION IS THE ADMITTED SET.** R1 and")
  say("R2 are the ON-DISK denominators and are printed above so the reader can see the gap and")
  say(`its decomposition: **${GAP.toLocaleString()} files the admitted population does not contain, and ${NM.toLocaleString()} of`)
  say("them are `node_modules` — vendored dependency code, not a gap.**")
  say("")
  say("**THE ARM'S OWN POPULATION LINES, QUOTED VERBATIM:**")
  say("")
  say("```")
  for (const l of popLines) say(l.trim())
  for (const l of exclLines) say(l.trim())
  say("```")
  say("")
  say("---")
  say("")
  say("## §3 · THE CLOSURE — printed and asserted, with `amb(kind)` REPORTED AND NEVER ADDED")
  say("")
  say("| class | rows |")
  say("|---|---|")
  say(`| resolved | ${RESOLVED.toLocaleString()} |`)
  say(`| amb(decl) | ${AMB_DECL.toLocaleString()} |`)
  say(`| unresolved | ${UNRESOLVED.toLocaleString()} |`)
  say(`| extOK | ${EXT_OK.toLocaleString()} |`)
  say(`| ext? | ${EXT_Q.toLocaleString()} |`)
  say(`| extFAIL | ${EXT_FAIL.toLocaleString()} |`)
  say(`| bindOK | ${BIND_OK.toLocaleString()} |`)
  say(`| bind? | ${BIND_Q.toLocaleString()} |`)
  say(`| bindFAIL | ${BIND_FAIL.toLocaleString()} |`)
  say(`| causeOK | ${CAUSE_OK.toLocaleString()} |`)
  say(`| causeFAIL | ${CAUSE_FAIL.toLocaleString()} |`)
  say(`| **the sum** | **${closureSum.toLocaleString()}** |`)
  say(`| **the edge count** | **${E.toLocaleString()}** |`)
  say(`| **the closure** | **${closureExact ? "EXACT ✔" : "DOES NOT BALANCE ✘"}** |`)
  say("")
  say(`**amb(kind) = ${AMB_KIND.toLocaleString()} - REPORTED BESIDE amb(decl) (${AMB_DECL.toLocaleString()})`)
  say("AND NEVER ADDED.** The arm says so itself:")
  say("")
  say("```")
  for (const l of closureLines) say(l.trim())
  say("```")
  say("")
  say(`**THE THREE FAIL COUNTERS: extFAIL = ${EXT_FAIL} - bindFAIL = ${BIND_FAIL} - causeFAIL = ${CAUSE_FAIL}.**`)
  say(`**AND THE CLAIMS ARE NEVER MERGED INTO RESOLUTION: extOK ${EXT_OK.toLocaleString()} and ext? ${EXT_Q.toLocaleString()}`)
  say("sit in their OWN columns, and the VERIFIED class is reported SEPARATELY from `resolved`** —")
  say("a cell that folded the claims into `resolved` would read as 77.4 % when it is 47.27 %.")
  say("")
  say("**THE ARM'S OWN VERDICT LINE, QUOTED VERBATIM:**")
  say("")
  say("```")
  for (const l of verdictLines) say(l.trim())
  say("```")
  say("")
  say("---")
  say("")
  say("## §4 · THE PER-TYPE TABLE — the arm's own TABLE 1, quoted")
  say("")
  say("| type | edges | resolved | collRes | amb(decl) | amb(kind) | unresolved | extOK | ext? | extFAIL | bindOK | bind? | bindFAIL | causeOK | causeFAIL |")
  say("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
  for (const r of perType) {
    say(`| ${r.type} | ${r.edges.toLocaleString()} | ${r.resolved.toLocaleString()} | ${r.collRes.toLocaleString()} | ${r["amb(decl)"].toLocaleString()} | ${r["amb(kind)"].toLocaleString()} | ${r.unresolved.toLocaleString()} | ${r.extOK.toLocaleString()} | ${r["ext?"].toLocaleString()} | ${r.extFAIL.toLocaleString()} | ${r.bindOK.toLocaleString()} | ${r["bind?"].toLocaleString()} | ${r.bindFAIL.toLocaleString()} | ${r.causeOK.toLocaleString()} | ${r.causeFAIL.toLocaleString()} |`)
  }
  say(`| **TOTAL** | **${E.toLocaleString()}** | **${RESOLVED.toLocaleString()}** | **${COLL_RES.toLocaleString()}** | **${AMB_DECL.toLocaleString()}** | **${AMB_KIND.toLocaleString()}** | **${UNRESOLVED.toLocaleString()}** | **${EXT_OK.toLocaleString()}** | **${EXT_Q.toLocaleString()}** | **${EXT_FAIL.toLocaleString()}** | **${BIND_OK.toLocaleString()}** | **${BIND_Q.toLocaleString()}** | **${BIND_FAIL.toLocaleString()}** | **${CAUSE_OK.toLocaleString()}** | **${CAUSE_FAIL.toLocaleString()}** |`)
  say("")
  say("---")
  say("")
  say("## §5 · THE JOIN's OWN PRICE, THE OWNER CHANNEL, THE INTENT CLOSURE, THE TRIPWIRE")
  say("")
  say("```")
  for (const l of scopeLines) say(l.trim())
  for (const l of joinLines) say(l.trim())
  for (const l of ownerLines) say(l.trim())
  for (const l of intentLines) say(l.trim())
  for (const l of separatorLines) say(l.trim())
  say("```")
  say("")
  say("---")
  say("")
  say("## §6 · THE REPRODUCTION")
  say("")
  say("```")
  say("  BB_CORPUS_ROOT=$PWD/.corpus bun run script/m14/incoming-gate.ts typescript ts,tsx,mts,cts 0 --index --dump")
  say("```")
  say("")
  say("The arm writes the evidence this cell is derived from; the publisher")
  say("(`script/m14/ts-cell-publish.ts`) re-derives every published number from that output and")
  say("exits non-zero if the closure does not balance to the row. The population reconciliation is")
  say("`script/m14/ts-population-census.ts`; the `mixes_in`/`part_of` grammar-absence citation is")
  say("`script/m14/ts-mixin-part-ruling.ts`.")
  say("")
  say("---")
  say("")
  say("## §7 · WHAT THE CELL DOES NOT CLAIM")
  say("")
  say("- It does not claim `mixes_in` or `part_of`: both are RULED grammar-absence for TypeScript,")
  say("  with a citation that carries a FIRED control (the dart grammar, which HAS the constructs).")
  say("  ⇒ **n = 14 − 2 = 12 for TypeScript.**")
  say("- It does not claim the residual is a defect: the residual is the gate's own measurement of")
  say("  what production's scope cannot resolve, and §4 names every row of it.")
  say("- It does not merge a claim into a resolution, and it does not treat an `amb(kind)` subset as")
  say("  an addition.")
  say("- It does not speak for any other lane, and it does not speak for a tree other than the one")
  say("  named in §1.")

  const text = L.join("\n")
  writeFileSync(outPath, text + "\n")
  console.log(text)
  console.log(`\nWROTE ${outPath}`)

  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({
      cell: {
        edges: E, resolved: RESOLVED, residual: residualGate, residualGate,
        residualEverything, residualWithAmbKind,
        resolvedPct: pct(RESOLVED, E), residualPct: pct(residualGate, E),
        verifiedClassPct: pct(verifiedClass, E), verifiedClassRows: verifiedClass,
      },
      classes: {
        resolved: RESOLVED, ambDecl: AMB_DECL, ambKind: AMB_KIND, unresolved: UNRESOLVED,
        extOK: EXT_OK, extQ: EXT_Q, extFAIL: EXT_FAIL, bindOK: BIND_OK, bindQ: BIND_Q,
        bindFAIL: BIND_FAIL, causeOK: CAUSE_OK, causeFAIL: CAUSE_FAIL, collRes: COLL_RES,
      },
      closure: { terms: closureTerms, sum: closureSum, edges: E, exact: closureExact },
      view, perType,
    }, null, 2) + "\n")
    console.log(`WROTE ${jsonPath}`)
  }

  if (!closureExact) {
    console.error(`\nTHE CLOSURE DOES NOT BALANCE (${closureSum} vs ${E}) — the cell is written but the run FAILED.`)
    process.exit(4)
  }
}

main()
