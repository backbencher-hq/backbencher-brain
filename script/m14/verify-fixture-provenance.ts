/**
 * M14.0.F7 — Fixture-Provenance Gate
 *
 * THE BUG CLASS THIS EXISTS FOR. `script/m14/run-fixtures.ts` is the F3 gate and
 * its contract is deliberate: fixtures RUN successfully, and failures are honest
 * defect findings tracked by count in `validation/m14/fixture-baseline.json`,
 * not harness errors. That contract has no way to tell a *tracked* wave item
 * from a fixture that landed WITHOUT the analyzer that satisfies it, because
 * both read as `N -> N failures` against the baseline.
 *
 * MEASURED, on this milestone's own history. `1719ff6b3` ("put the lane pin
 * corpus on main, and pick each lane's analyzer revision by measuring it",
 * 2026-10-07) landed 477 fixture files across 24 lanes and DID NOT TOUCH
 * `src/ast/real-cpp-analyzer.ts`. At that commit cpp read `41 pass / 6 fail` —
 * `contains-name-line-921`, `exports-marker-910`, `pure-virtual-abstract-919`,
 * `pure-virtual-signature-910`, `specifier-qualified-name-962`,
 * `unnamed-scope-919` — while `docs/analyzers/cpp.md` (landed by
 * the single-parent squash `4cf800a17`, which carried 25 lane documents and 23
 * analyzers and no cpp fixture at all) described the behavior those six fixtures
 * pin. `--update-baseline` recorded `cpp: 6` as the accepted state. Nothing
 * failed, and nothing could: the count was the count the baseline declared.
 *
 * WHAT THIS GATE ADDS. Provenance, not count. A fixture FILE that is new or
 * modified relative to the base ref must PASS in the commit that carries it.
 * Fixtures already present in the base ref keep the baseline's allowance
 * untouched, so the milestone's tracked failures are not re-litigated here.
 *
 *   `N -> N failures` against the baseline. Either land the analyzer in the
 *
 * The one exception is DECLARED, never silent: an expectation may carry
 *
 *   "expectedToFail": "<why this fixture is ahead of the code>"
 *
 * and then the fixture is reported as declared rather than as a violation. That
 * is the same shape as this milestone's other ratchets, where an unexplained
 * number is a claim on trust and an explained one is a decision with a name
 * attached (see `script/m14/verify-script-typecheck-baseline.ts`, whose
 * `--allow-increase <reason>` is the precedent). The C++ six carried no such
 * field: their `rationale` asserted the behavior was implemented.
 *
 * Usage:
 *   bun run script/m14/verify-fixture-provenance.ts                 # base HEAD
 *   bun run script/m14/verify-fixture-provenance.ts --base <ref>    # other base
 *   bun run script/m14/verify-fixture-provenance.ts --selftest      # decision rule
 *
 * Exit: 0 = no new/modified fixture fails; 1 = at least one does (each printed
 * with its file and whether the file is new or modified); 2 = usage error.
 *
 * WHAT THE SELFTEST DOES AND DOES NOT PROVE. It exercises `classify`, the
 * decision rule, on the five cases that matter (new+failing, modified+failing,
 * new+passing, untouched+failing, declared+failing). It does not stand up a
 * repository; the end-to-end behaviour — dirty-file detection against a real
 * base ref, and the declared-exception lookup reading real expectation files —
 * is the gate's own run, and the historical replay at `1719ff6b3 --base
 * 1719ff6b3^` is what proves that end-to-end path can fail: it reports 208
 * violating fixture files across 24 lanes and exits 1.
 */

import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { LANGS, runLang } from "./run-fixtures"

import { fileURLToPath } from "node:url"
const __dirname = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "")

const ROOT = path.resolve(__dirname, "..", "..")
const FIXTURES_REL = "validation/m14/fixtures"

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag)
  if (i < 0 || i + 1 >= process.argv.length) return null
  return process.argv[i + 1] ?? null
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" })
}

type Changed = { file: string; lane: string; stem: string; status: "new" | "modified" }

/** The fixture's stem: the name the runner reports it under. A `.expectation.json`
 *  is the same fixture as its source file (both are carried by one `Changed`). */
function stemOf(basename: string): string {
  if (basename.endsWith(".expectation.json")) return basename.slice(0, -".expectation.json".length)
  const dot = basename.lastIndexOf(".")
  return dot > 0 ? basename.slice(0, dot) : basename
}

function changedFixtures(base: string): Changed[] {
  const out: Changed[] = []
  const modified = git(["diff", "--name-only", base, "--", FIXTURES_REL]).split("\n").filter(Boolean)
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", FIXTURES_REL]).split("\n").filter(Boolean)
  for (const file of modified) {
    const parts = path.relative(FIXTURES_REL, file).split(path.sep)
    if (parts.length < 2) continue
    out.push({ file, lane: parts[0], stem: stemOf(parts[parts.length - 1]), status: "modified" })
  }
  for (const file of untracked) {
    const parts = path.relative(FIXTURES_REL, file).split(path.sep)
    if (parts.length < 2) continue
    out.push({ file, lane: parts[0], stem: stemOf(parts[parts.length - 1]), status: "new" })
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

/** The declared exception: a non-empty `expectedToFail` reason in the fixture's
 *  own expectation file. Read from the fixture id, which is the path under
 *  `validation/m14/fixtures/` without its extension. */
function declaredReason(fixtureId: string): string | null {
  const p = path.join(ROOT, FIXTURES_REL, `${fixtureId}.expectation.json`)
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>
    const reason = raw["expectedToFail"]
    return typeof reason === "string" && reason.trim().length > 0 ? reason : null
  } catch {
    return null
  }
}

/**
 * The decision rule, pure so the selftest can drive it: a FAILING fixture whose
 * stem belongs to a new-or-modified file is a violation unless its expectation
 * declares `expectedToFail`. A failing fixture whose stem is untouched by this
 * change is exactly what the baseline is for.
 */
function classify(
  details: Array<{ fixture: string; ok: boolean }>,
  changed: Changed[],
  isDeclared: (fixtureId: string) => boolean,
): { violations: Changed[]; declared: string[] } {
  const byStem = new Map<string, Changed[]>()
  for (const c of changed) {
    const key = `${c.lane}/${c.stem}`
    const list = byStem.get(key)
    if (list) list.push(c)
    else byStem.set(key, [c])
  }
  const violations: Changed[] = []
  const declared: string[] = []
  for (const d of details) {
    if (d.ok) continue
    const parts = d.fixture.split("/")
    const stem = parts.pop() ?? ""
    const lane = parts[0] ?? ""
    const list = byStem.get(`${lane}/${stem}`)
    if (!list) continue
    if (isDeclared(d.fixture)) declared.push(d.fixture)
    else violations.push(...list)
  }
  return { violations, declared }
}

function selftest(): number {
  const changedOf = (stem: string, status: "new" | "modified"): Changed => ({
    file: `${FIXTURES_REL}/cpp/${stem}.cpp`,
    lane: "cpp",
    stem,
    status,
  })
  const never = (): boolean => false
  const cases: Array<{ name: string; run: () => { violations: Changed[]; declared: string[] }; want: number }> = [
    {
      name: "new fixture fails -> violation",
      run: () => classify([{ fixture: "cpp/friend-definition-published", ok: false }], [changedOf("friend-definition-published", "new")], never),
      want: 1,
    },
    {
      name: "modified expectation fails -> violation",
      run: () => classify([{ fixture: "cpp/pure-virtual-signature-910", ok: false }], [changedOf("pure-virtual-signature-910", "modified")], never),
      want: 1,
    },
    {
      name: "new fixture passes -> no violation",
      run: () => classify([{ fixture: "cpp/friend-definition-published", ok: true }], [changedOf("friend-definition-published", "new")], never),
      want: 0,
    },
    {
      name: "untouched fixture fails -> baseline's business, no violation",
      run: () => classify([{ fixture: "cpp/class-self-call-925", ok: false }], [changedOf("other-fixture", "new")], never),
      want: 0,
    },
    {
      name: "changed fixture fails but declares expectedToFail -> declared, no violation",
      run: () => {
        const r = classify([{ fixture: "cpp/pure-virtual-signature-910", ok: false }], [changedOf("pure-virtual-signature-910", "modified")], (id) => id === "cpp/pure-virtual-signature-910")
        return { violations: r.violations, declared: r.declared }
      },
      want: 0,
    },
  ]
  let pass = 0
  for (const c of cases) {
    const got = c.run().violations.length
    if (got === c.want) {
      pass++
      console.log(`  ok    ${c.name}`)
    } else {
      console.log(`  FAIL  ${c.name}: want ${c.want} violation(s), got ${got}`)
    }
  }
  const declaredCase = cases[cases.length - 1]
  if (declaredCase && declaredCase.run().declared.length !== 1) {
    console.log("  FAIL  the declared case must be reported as declared (1), not silently dropped")
    return 1
  }
  console.log(`selftest: ${pass}/${cases.length} decision cases`)
  return pass === cases.length ? 0 : 1
}

async function main(): Promise<number> {
  if (process.argv.includes("--selftest")) return selftest()

  const base = argValue("--base") ?? "HEAD"
  let baseSha = ""
  try {
    baseSha = git(["rev-parse", "--short", base]).trim()
  } catch {
    console.error(`fixture-provenance gate: base ref ${JSON.stringify(base)} does not resolve`)
    return 2
  }

  const changed = changedFixtures(base)
  console.log(`fixture-provenance gate — base ${base} (${baseSha}), HEAD ${git(["rev-parse", "--short", "HEAD"]).trim()}`)
  if (changed.length === 0) {
    console.log(`  no new or modified fixture file under ${FIXTURES_REL}: nothing to attribute`)
    return 0
  }

  const lanes = [...new Set(changed.map((c) => c.lane))].sort()
  const unknown = lanes.filter((l) => !LANGS[l])
  const runnable = lanes.filter((l) => LANGS[l])
  console.log(`  ${changed.length} new/modified fixture file(s) in ${lanes.length} lane(s): ${lanes.join(", ")}`)
  if (unknown.length) {
    // A lane with fixtures and no runner lane is already a finding of
    // run-fixtures' own fixture-lane gate; this gate must not report it as clean.
    console.error(`  lanes with changed fixtures but no runner lane: ${unknown.join(", ")} — run-fixtures' fixture-lane gate owns this`)
    return 1
  }

  const violations: Changed[] = []
  const declared: string[] = []
  const tracked: string[] = []
  for (const lane of runnable) {
    const r = await runLang(lane)
    const details = r.details as Array<{ fixture: string; ok: boolean }>
    const laneChanged = changed.filter((c) => c.lane === lane)
    const res = classify(details, laneChanged, (id) => declaredReason(id) !== null)
    violations.push(...res.violations)
    declared.push(...res.declared)
    for (const d of details) if (!d.ok) tracked.push(d.fixture)
    console.log(`  ${lane}: ${r.pass} pass / ${r.fail} fail  (${laneChanged.length} changed file(s) in this lane)`)
  }

  if (declared.length) {
    console.log(`\ndeclared ahead-of-code fixture(s) — reported, not a violation:`)
    for (const id of declared) console.log(`  ${id}  — ${declaredReason(id)}`)
  }

  if (violations.length === 0) {
    console.log(`\nverdict: no fixture introduced or edited by this change fails (${tracked.length} failure(s) in these lanes are pre-existing and stay baseline-tracked)`)
    return 0
  }

  const seen = new Set<string>()
  console.error(`\nFIXTURE PROVENANCE VIOLATION: ${violations.length} changed fixture file(s) belong to a FAILING fixture.\n`)
  for (const v of violations) {
    if (seen.has(v.file)) continue
    seen.add(v.file)
    console.error(`  ${v.lane}/${v.stem}  [${v.status}]  ${path.relative(ROOT, v.file)}`)
  }
  console.error(
    [
      "",
      "A fixture is evidence about behavior that exists. If this fixture is new or was edited by this",
      "change and it does not pass here, then the behavior it describes did not land in this commit —",
      "the merge that dropped an analyzer while keeping its fixtures is exactly this shape, and it reads",
      'as `N -> N failures` against validation/m14/fixture-baseline.json.',
      "",
      "Two ways to proceed, both recorded rather than silent:",
      "  1. land the analyzer in the same commit, or",
      '  2. declare it in the expectation with a reason — `"expectedToFail": "..."` — when the fixture',
      "     is deliberately ahead of the code. The gate then reports it as declared instead of blocking.",
    ].join("\n"),
  )
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e)
    process.exit(2)
  })
