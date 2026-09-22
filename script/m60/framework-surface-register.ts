// script/m60/framework-surface-register.ts — the M60.R8 register's only writer.
//
// Two modes, and the second is the one that matters:
//
//   create (no register yet): build it from the census artifact.
//   update (register exists):  rebuild the ENTRIES from a fresh census, PRESERVE the
//                              hand-adjudicated notes by key, and record what changed
//                              under `shrunkBy`.
//
// The register is generated from the measurement rather than typed, so the recorded
// counts cannot drift from the census they describe. And because the gate refuses to
// adjudicate when a registered site vanishes, paying a violation down is impossible
// WITHOUT recording it here — which is the discipline the rule is for.
//
// Run: bun script/m60/framework-surface-register.ts --phase "ruby framework surface (#749)"
//
// It lives beside the census and the probe (script/m60/) rather than in a scratch dir
// because the gate reads its output: a shrink-only register needs a regenerator that
// ships with it, or the next wave cannot tell a repaid site from a drifted count.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CENSUS = path.join(ROOT, "validation/m60/results/framework-surfaces.json")
const OUT = path.join(ROOT, "validation/m60/framework-surface-register.json")

const phaseArg = process.argv.findIndex((a) => a === "--phase")
const phase = phaseArg >= 0 ? process.argv[phaseArg + 1] : "unspecified phase"

/** The OO lanes are the owner standard's zero target; every other language is disclosed debt. */
const OO = new Set(["csharp", "dart", "objective-c", "php", "python", "ruby", "swift"])

interface Entry {
  file: string
  lang: string
  shape: string
  key: string | null
  statement: string
  verdict: string
  count: number
  lines: number[]
  note: string
}

const keyOf = (e: { file: string; shape: string; key: string | null; statement: string }) =>
  [e.file, e.shape, e.key ?? "-", String(e.statement ?? "").replace(/\s+/g, " ").trim()].join("\u0000")

const c = JSON.parse(readFileSync(CENSUS, "utf8"))
if ((c.selfTests?.failures ?? []).length) {
  console.error("refusing to write the register: the census failed its own self-tests")
  process.exit(1)
}

const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null
const notesByKey = new Map<string, string>()
for (const e of prev?.entries ?? []) notesByKey.set(keyOf(e), e.note)

const groups = new Map<string, Entry>()
for (const s of c.sites) {
  const k = keyOf(s)
  const cur = groups.get(k)
  if (cur) {
    cur.count++
    cur.lines.push(s.line)
    continue
  }
  groups.set(k, {
    file: s.file,
    lang: s.lang,
    shape: s.shape,
    key: s.key,
    statement: s.statement,
    verdict: s.verdict,
    count: 1,
    lines: [s.line],
    note: OO.has(s.lang)
      ? "OO lane — owner standard: repay with a fixture and a reverting mutant."
      : "Not an OO lane: disclosed debt. Repayable by the owning lane; the class is non-recurrable meanwhile.",
  })
}
const entries = [...groups.values()].sort(
  (a, b) => a.file.localeCompare(b.file) || a.shape.localeCompare(b.shape) || String(a.key).localeCompare(String(b.key)),
)
// preserve adjudications, and default the note for anything NEW rather than silently
// inheriting the generic one
for (const e of entries) {
  const n = notesByKey.get(keyOf(e))
  if (n) e.note = n
}

const violations = entries.filter((e) => e.verdict === "violation")
const ooViolations = violations.filter((e) => OO.has(e.lang))

/** What changed against the register we are replacing, stated as evidence not as prose. */
function recordShrink(): unknown[] {
  if (!prev) return []
  const prevByKey = new Map<string, Entry>()
  for (const e of prev.entries ?? []) prevByKey.set(keyOf(e), e)
  const removed: string[] = []
  const reduced: string[] = []
  for (const [k, e] of prevByKey) {
    const now = groups.get(k)
    if (!now) removed.push(`${e.file} ${e.shape} [${e.key}] x${e.count}`)
    else if (now.count < e.count) reduced.push(`${e.file} ${e.shape} [${e.key}] x${e.count} -> x${now.count}`)
  }
  const grew: string[] = []
  const added: string[] = []
  for (const [k, now] of groups) {
    const before = prevByKey.get(k)
    if (before && now.count > before.count) grew.push(`${now.file} ${now.shape} [${now.key}] x${before.count} -> x${now.count}`)
    // ADDED is not the same as grew, and leaving it out made real growth silent: a widened
    // classifier that finds 18 new sites reported "grew 0" because each new key was seen
    // once before as well (never) and once now. A register whose whole discipline is
    // "added and removed are both deliberate acts" must name the added ones.
    if (!before) added.push(`${now.file} ${now.shape} [${now.key}] x${now.count} \`${String(now.statement).replace(/\s+/g, " ").slice(0, 80)}\``)
  }
  const prevOo = prev.ooTarget?.violations ?? 0
  if (!removed.length && !reduced.length && !grew.length && !added.length && prevOo === ooViolations.length) return prev.shrunkBy ?? []
  return [
    ...(prev.shrunkBy ?? []),
    {
      at: "2026-09-22",
      phase,
      removed,
      reduced,
      grew,
      added,
      violationsBefore: prev.baseline?.violations ?? 0,
      violationsAfter: violations.length,
      ooViolationsBefore: prevOo,
      ooViolationsAfter: ooViolations.length,
      note: "Every removal here is a site the census no longer finds, which means the source no longer contains it. That is the only way a registered violation may disappear.",
    },
  ]
}

const register = {
  ...(prev ?? {}),
  schemaVersion: 1,
  milestone: "M60",
  rule: "R8",
  purpose:
    prev?.purpose ??
    "No analyzer may publish a framework capability it does not have, or name one framework twice. The family contract (real-csharp-analyzer.ts CONV-CS-2 header, java sibling) is three metadata keys — `framework` (the deterministic primary pick), `detectedFrameworks` (always an array), `frameworkPatterns` (aligned) — plus the `hasFrameworkIntelligence` capability claim. Registered like the regex debt and like R7: entries are keyed by source statement (not line, because positions move and statements do not) with an exact count, so an added site and a removed one are both deliberate acts.",
  establishedAt: prev?.establishedAt ?? "2026-09-22",
  baseline: { occurrences: c.occurrences, violations: violations.length },
  shrinkOnly: true,    ooTarget: {
    violations: ooViolations.length,
    note:
      "Owner standard: the seven OO lanes must reach zero, lane by lane, with a fixture and a reverting mutant each — never by editing this register. MET as of this phase: ruby (#749 — the unreachable callback trigger, the Rails/Ruby on Rails divergence, the duplicate accumulator and the missing primary pick), pinned by ruby/framework-surface-pins with four caught mutants; python (#747 — the surface was initialized and never written while the capability claim was published on every file), pinned by python/framework-surface-pins with two caught mutants (the trigger surface going dead again, and the emitted order following import order instead of the marker table); swift (#838/#836 — no primary pick, no frameworkPatterns, 81 findings over 248 real corpus files) and objective-c (CONV-OC-1 — no frameworkPatterns, 7 findings over 7 detecting files), each pinned by its own framework-surface-pins fixture and caught mutants. NOT counted here because it is a static violation of nothing — php's two unreachable markers (`App\\` root, bare `TestCase`) are a detection false negative, proven by fixture and by a grammar-level probe, and are still owed.",
  },
  runtimeOwed: prev?.runtimeOwed,
  runtimeEvidence: prev?.runtimeEvidence,
  counts: { entries: entries.length, violations: violations.length, ooViolations: ooViolations.length },
  entries,
  shrunkBy: recordShrink(),
}

writeFileSync(OUT, JSON.stringify(register, null, 2) + "\n")
console.log(
  `${prev ? "updated" : "created"} ${path.relative(ROOT, OUT)}: ${entries.length} entries, ${violations.length} violations, ${ooViolations.length} OO violations`,
)
const last = register.shrunkBy[register.shrunkBy.length - 1]
if (last && last.phase === phase) {
  console.log(`  phase "${phase}": removed ${last.removed.length}, reduced ${last.reduced.length}, grew ${last.grew.length}, added ${last.added.length}`)
  for (const r of last.removed) console.log(`    removed: ${r}`)
  for (const a of last.added) console.log(`    ADDED: ${a}`)
}
for (const e of ooViolations) console.log(`  OO remaining: ${e.lang} ${e.shape} [${e.key}] x${e.count}`)
