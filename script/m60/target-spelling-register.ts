// script/m60/target-spelling-register.ts — the M60.R10 register's only writer.
//
// The census (script/m60/target-spelling-census.ts) measures what each lane
// SPELLS. This file turns that measurement into the register the gate compares
// against, so the recorded counts cannot drift from the census they describe:
//
//   create (no register yet): build the entries from the artifact.
//   update (register exists): rebuild the ENTRIES from a fresh census, PRESERVE
//                             the hand-written `rulings` and `note` per lane by
//                             key, and record what changed under `changed`.
//
// What the register is NOT: a place to make a finding disappear. A lane's
// conviction counts are recorded exactly as measured; paying one down means
// fixing the rule and re-running this writer, which is why the gate refuses to
// adjudicate when a count moves either way. The `rulings` map is the only
// hand-written half: a ruled separator carries a reason and a relationship type,
// and an UNRULED triple stays `null`, which is the honest state for the 39 triples
// the first measurement found across the family — they are recorded as measured
// and owed, not blessed.
//
// Run: bun script/m60/target-spelling-register.ts --phase "php include/call spelling (#835)"
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CENSUS = path.join(ROOT, "validation/m60/results/target-spelling.json")
const OUT = path.join(ROOT, "validation/m60/target-spelling-register.json")

const phaseArg = process.argv.findIndex((a) => a === "--phase")
const phase = phaseArg >= 0 ? process.argv[phaseArg + 1] : "unspecified phase"

/** The owner standard's zero target; every other language is disclosed debt. */
const OO = new Set(["csharp", "dart", "objc", "php", "python", "ruby", "swift"])
const OO_LANES = [...OO]

const census = JSON.parse(readFileSync(CENSUS, "utf8"))
const prior: any = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : null

const changed: string[] = []
const lanes: Record<string, any> = {}
for (const row of census.rows) {
  const lang = row.lang
  const old = prior?.lanes?.[lang]
  const convictions = row.byClass ?? {}
  const separatorTriples: string[] = row.separatorTriples ?? []
  // Hand-written half, preserved by key.
  const rulings: Record<string, string | null> = old?.rulings ?? {}
  for (const tr of separatorTriples) if (!(tr in rulings)) rulings[tr] = null
  for (const tr of Object.keys(rulings)) if (!separatorTriples.includes(tr)) delete rulings[tr]
  const note = old?.note ?? ""
  // The whitespace class, split by the mechanism that decides its OWNER. Pinned
  // exactly like the convictions: a lane cannot move a target from `sourceText`
  // (the one subclass R10 owns) to `matchesOwnSymbol` without this failing until
  // the writer is re-run deliberately.
  const subclasses: Record<string, number> = row.whitespaceSubclasses ?? {}
  if (old) {
    const oldConv = JSON.stringify(old.convictions ?? {})
    if (oldConv !== JSON.stringify(convictions)) changed.push(`${lang}: convictions ${oldConv} -> ${JSON.stringify(convictions)}`)
    const oldSep = JSON.stringify([...(old.separatorTriples ?? [])].sort())
    if (oldSep !== JSON.stringify([...separatorTriples].sort())) changed.push(`${lang}: separator triples ${oldSep} -> ${JSON.stringify([...separatorTriples].sort())}`)
    const oldSub = JSON.stringify(old.convictionSubclasses ?? {})
    if (oldSub !== JSON.stringify(subclasses)) changed.push(`${lang}: whitespace sub-classes ${oldSub} -> ${JSON.stringify(subclasses)}`)
  }
  lanes[lang] = {
    verdict: row.verdict,
    family: OO.has(lang) ? "oo" : "other",
    convictions,
    convictionSamples: (row.anomalies ?? []).slice(0, 8).map((a: any) => ({ klass: a.klass, type: a.type, target: String(a.target).slice(0, 80) })),
    convictionSubclasses: subclasses,
    convictionSubclassSamples: row.whitespaceSamples ?? [],
    separatorTriples,
    rulings,
    note,
  }
}
for (const lang of Object.keys(prior?.lanes ?? {})) if (!lanes[lang]) changed.push(`${lang}: lane no longer measured (register entry dropped)`)
for (const lang of Object.keys(lanes)) if (prior && !prior.lanes?.[lang]) changed.push(`${lang}: new lane measured`)

const convicted = Object.entries(lanes).filter(([, l]: any) => Object.keys(l.convictions).length > 0).map(([k]) => k)
const unruled = Object.entries(lanes)
  .filter(([, l]: any) => Object.values(l.rulings ?? {}).some((v) => v === null))
  .map(([k]) => k)

const payload = {
  schemaVersion: 1,
  milestone: "M60",
  rule: "R10",
  purpose:
    "A relationship target must be spelled the way the lane spells its own symbols. Every other gate in the family asks whether an edge that EXISTS is right; none asked whether the target is a NAME at all, and the differential oracle cannot ask it because its truth comes from the same rules the analyzer runs — when both sides fabricate the same spelling, they agree. The first measurement found whole expression surfaces published as targets (source text with comments, lambdas, test-description strings, generic type expressions, `$`-sigil values) in 12 of 24 lanes, all of it invisible to the differential by construction.",
  establishedAt: "2026-09-23",
  phase,
  contract: {
    convicting: {
      literal: "the WHOLE target is a quoted string or a bare number — no language in the family declares such a symbol; needs no calibration and cannot false-positive",
      whitespace:
        "the target contains a space, tab or newline. CONVICTING, but SPLIT BY OWNER before it is acted on, because the rationale this class was first convicted on ('no identifier in any of these languages may contain whitespace') is REFUTED by the artifact — the same way the first draft of `separator` was refuted, and the retraction is recorded rather than quietly dropped. Measured (script/m14/tmp/r10-whitespace-split-probe.ts, on the real corpus files the artifact names): scala and groovy DO declare identifiers containing whitespace (scala's `` `popAll preserves iteration order` `` and groovy's `test entity with trait property` are quoted method names) and their lanes publish the very same string as a SYMBOL name, so the target is honest. `whitespaceSubclasses` on every lane pins the split exactly, and each subclass routes: `operatorMember` (the whole last dotted segment is `operator` + whitespace + a token) is the C2b member-NAMING question and not a spelling one — csharp's `operator ==` is its own symbol's name and the containment edge agrees; `payloadSigil` (the target begins with `@`) is a decorator/annotation payload or a sigil-quoted identifier published as if it were a name; `matchesOwnSymbol` means the lane is SELF-CONSISTENT — the string is one of the names that lane itself publishes, so no per-edge gate can adjudicate it (this holds for the honest quoted names AND for the lanes whose published name carries the quoting syntax, kotlin's `` `test char column read and write` `` and zig's `@\"zls env\"`, AND for a lane that publishes an EXPRESSION as a name, haskell's `M1 i c` and scala's `A, B` — three different owners, which is why it is routed and not excused); `sourceText` (the string is not a name the lane declares at all — a comment, a call expression, a type expression) is the only subclass R10 itself owns. Every subclass count is compared EXACTLY by the gate, so a target cannot be reclassified without re-running this writer. The routed halves are cited where they are owned: every lane whose split carries `matchesOwnSymbol` or `payloadSigil` counts now cites #924 (`M60 name surface`), and #924's definition of done requires exactly that citation, so a routed conviction is a handoff rather than an excuse.",
      delimiter: "the target contains `;`, `(`, `)`, `{`, `}` or `,` — statement and grouping syntax, never part of a name",
    },
    reported: {
      separator:
        "the target carries a NON-ALPHANUMERIC character that occurs in NONE of the lane's own symbol names. Legitimate in qualified names (`io:format`, `clojure.string/join`, `UIKit/UIKit.h`, `@version`, `Class.member`), so RECORDED, NEVER CONVICTED — the first draft convicted this class and the measurement refuted it (21 of 24 lanes carry it). Quotes and brackets were removed from the convicting set for the same reason: erlang's `'tpl_prv':init` is a quoted atom, haskell's `structureHash'` is a name, ruby's own `Hash.[]` is spelled with brackets.",
      unseenAlnum:
        "a target carrying a letter or digit absent from this draw's symbols — sampling noise, reported and never convicted",
    },
    measurement: "script/m60/target-spelling-census.ts — each lane's REAL analyzer through ASTEngine over a spread draw from LANG_REPOS + SECOND_CORPUS",
    censusCommand: "bun script/m60/target-spelling-census.ts",
    mechanism:
      "the gate compares the census to this register EXACTLY, per lane: conviction counts by class and the (relationshipType, char) separator set. A count that moves in EITHER direction fails until this writer is re-run, so a finding cannot be paid down by a rule change alone, and a new fabricated surface in any lane fails immediately. The `rulings` map is the only hand-written half: an UNRULED triple is `null` and is recorded as measured and owed, not blessed.",
  },
  // The owner standard's zero target: OO lanes with a provable fabricated spelling,
  // and OO lanes whose separator vocabulary is measured but UNRULED. Recorded from the
  // measurement when the register is created and PRESERVED afterwards, so debt may only be
  // paid down by a deliberate edit here — the same shrink-only discipline as R7's site
  // register. R9's `ooTarget` is the sibling of this field.
  ooTarget: prior?.ooTarget ?? {
    convictedLanes: OO_LANES.filter((l) => Object.keys(lanes[l]?.convictions ?? {}).length > 0).length,
    unruledSeparatorLanes: OO_LANES.filter(
      (l) => (census.rows.find((r: any) => r.lang === l)?.separatorAdjudicable ?? true) && Object.values(lanes[l]?.rulings ?? {}).some((v) => v === null),
    ).length,
    note: "The seven OO lanes are the owner standard's zero target: no OO lane may publish a target no symbol can be named, and none may leave its separator vocabulary unruled. This baseline records what the first measurement found (php was fixed in the same round; the rest are each lane's own next item). Debt above these numbers fails G1.",
  },
  baseline: {
    lanes: census.lanes,
    clean: census.clean,
    convicted,
    lanesWithUnruledSeparators: unruled,
    samplePerDraw: census.samplePerDraw,
    minSymbols: census.minSymbols,
    note: "OO lanes that own a conviction or an unruled separator are the owner standard's target; `clean` here means 'this draw found no fabrication AND no separator outside the lane's own symbol alphabet' — it is a statement about the DRAW, and the register pins the drawn file set through the census's own artifact.",
  },
  lanes,
}

writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
console.log(`wrote ${path.relative(ROOT, OUT)}`)
console.log(`lanes=${census.lanes} clean=${census.clean.length} convicted=${convicted.length} withUnruledSeparators=${unruled.length}`)
if (changed.length) {
  console.log("CHANGED since the previous register (each needs a deliberate look):")
  for (const c of changed) console.log("  " + c)
} else {
  console.log("no change since the previous register")
}
