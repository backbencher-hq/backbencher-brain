#!/usr/bin/env bun
/**
 * SQL LANE — THE PINNED GRAMMAR'S NODE-TYPE INVENTORY.
 *
 * WHY IT EXISTS. The extended vocabulary (`decorates`, `renders`, `mixes_in`, `part_of`) is
 * adjudicated per lane against a POSITIVE grammar-inventory basis: a cell is `RULED` only when the
 * PINNED GRAMMAR cannot express the construct, so no corpus count can exist. The census keeps that
 * inventory at `.tmp-census/grammar-nodes.json`, keyed by language — and it has no `sql` key, because
 * the census instrument (`.tmp-census/census.mts`) imports the ts/js/dart/python/java analyzers and
 * nothing else. This lane therefore produces its OWN inventory, from the SAME wasm, under the SAME
 * rule, and writes it in the SAME shape — so the Lead can merge it as the `sql` key without
 * re-deriving anything.
 *
 * THE RULE, and it is the GATE's rule — `script/m14/completeness-inventory.ts:1360-1373`:
 *   1. `nodeTypeIsNamed(i)` — NAMED node types only. The anonymous tokens (the `(` `)` `,` `;` of
 *      every grammar) are NOT rows and never were.
 *   2. `!n.startsWith("_")` — the `_`-prefixed hidden types are NOT rows. tree-sitter uses a
 *      leading underscore for a node the grammar hides from the tree; counting them would inflate
 *      the denominator with things a query can never reach.
 *   3. DEDUP — four spellings are enumerated more than once by the wasm ABI (`dollar_quote`,
 *      `cast`, `field`, `from` for sql), and a duplicate is one type, not two.
 *   4. `ERROR` and `MISSING` are ADDED — they are produced by every tree-sitter parser but are NOT
 *      listed by `nodeTypeForId` in the wasm ABI, and the analyzer consults them, so they are rows.
 *
 * THE COUNTS DIFFER FROM THE RAW ENUMERATION, and the difference is stated rather than reconciled
 * by assertion: the wasm's `nodeTypeCount` is the TOTAL (named + anonymous + hidden), and this
 * file prints all three numbers — `totalCount` (every `nodeTypeForId` entry), `namedCount` (the
 * gate's rule), and `namedRawCount` (named entries before dedup) — so a reader can check which
 * number they are comparing against.
 *
 * THE CONTROL. A zero from an unreadable enumeration is not a zero. The script prints the
 * node types it DID read, and the caller can assert on a KNOWN type (`create_table`) being present.
 *
 * USAGE  bun run script/m14/sql-grammar-nodes.ts [--json <out>]
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { loadWebTreeSitter } from "../../src/util/wasm.ts"

const args = process.argv.slice(2)
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : ""
const ROOT = process.cwd()
const WASM = join(ROOT, "wasm", "tree-sitter-sql.wasm")

/**
 * THE LEAD'S INSTRUMENT OWNS `validation/m14/measurements/sql-grammar-nodes.json` — ITS SHAPE
 * (`namedTypeNames` / `allTypeNames` / `servedDigest` / `measuredAt`) IS THE TRACKED ARTIFACT, and
 * this script must not be able to overwrite it with a DIFFERENT shape. ⇒ ⇒ ⇒ **TWO INSTRUMENTS
 * WRITING ONE FILE WITH TWO SHAPES IS EXACTLY THE DIVERGENCE THE FLEET JUST PAID FOR**: a consumer
 * that reads `.named` from the Lead's artifact gets nothing, and a consumer that reads
 * `namedTypeNames` from this script's output gets nothing, and NEITHER failure is loud.
 * ⇒ ⇒ ⇒ SO THE WRITE IS REFUSED, BY NAME, AND THE LANE'S OWN PATH IS NAMED IN THE REFUSAL.
 */
const LEAD_ARTIFACT = "validation/m14/measurements/sql-grammar-nodes.json"
const LANE_ARTIFACT = "validation/m14/measurements/sql-grammar-nodes-fork.json"
if (jsonOut && jsonOut.replace(/^\.\//, "") === LEAD_ARTIFACT) {
  console.error(
    `REFUSED: ${LEAD_ARTIFACT} is the LEAD's instrument's artifact (script/m14/grammar-node-inventory.ts)` +
      ` and carries ITS shape (namedTypeNames / allTypeNames / servedDigest / measuredAt).\n` +
      `  THIS script measures the OTHER convention (the completeness gate's rule: nodeTypeIsNamed` +
      ` && !startsWith("_") && dedup, then + ERROR/MISSING) and writes ${LANE_ARTIFACT} instead.\n` +
      `  If you really mean the Lead's path, pass --force-lead-path and say why in the commit.`,
  )
  process.exit(2)
}
if (jsonOut && jsonOut.replace(/^\.\//, "") === LEAD_ARTIFACT && !args.includes("--force-lead-path")) {
  process.exit(2)
}
if (args.includes("--force-lead-path") && jsonOut.replace(/^\.\//, "") === LEAD_ARTIFACT) {
  console.warn("⚠ --force-lead-path: OVERWRITING THE LEAD'S ARTIFACT WITH THIS SCRIPT'S SHAPE.")
}

const W: any = await loadWebTreeSitter()
const Language = W.Language ?? W.default?.Language
const initFn = W.init ?? W.Parser?.init ?? W.default?.init
if (initFn) await initFn()
const lang: any = await Language.load(readFileSync(WASM))

const all: string[] = []
const namedRaw: string[] = []
const anonymous: string[] = []
for (let i = 0; i < lang.nodeTypeCount; i++) {
  const t = lang.nodeTypeForId(i)
  if (!t) continue
  all.push(t)
  if (lang.nodeTypeIsNamed(i)) namedRaw.push(t)
  else anonymous.push(t)
}
const seen = new Set<string>()
const named: string[] = []
for (const n of namedRaw) {
  if (n.startsWith("_")) continue
  if (seen.has(n)) continue
  seen.add(n)
  named.push(n)
}
for (const u of ["ERROR", "MISSING"]) if (!named.includes(u)) named.push(u)

const duplicates = namedRaw.filter((n, i) => namedRaw.indexOf(n) !== i)
const hidden = namedRaw.filter((n) => n.startsWith("_"))

const report = {
  language: "sql",
  wasm: "wasm/tree-sitter-sql.wasm",
  rule: "nodeTypeIsNamed && !startsWith('_') && dedup, then + ERROR/MISSING (script/m14/completeness-inventory.ts:1360-1373)",
  namedRawCount: namedRaw.length,
  anonymousCount: anonymous.length,
  hiddenCount: hidden.length,
  duplicateSpellings: [...new Set(duplicates)].sort(),
  control: {
    create_table_present: named.includes("create_table"),
    table_partition_present: named.includes("table_partition"),
    keyword_inherits_present: named.includes("keyword_inherits"),
    keyword_no_present: named.includes("keyword_no"),
    keyword_add_present: named.includes("keyword_add"),
    keyword_column_present: named.includes("keyword_column"),
    keyword_by_present: named.includes("keyword_by"),
    keyword_of_present: named.includes("keyword_of"),
    keyword_replace_present: named.includes("keyword_replace"),
    keyword_export_present: named.includes("keyword_export"),
    keyword_implements_present: named.includes("keyword_implements"),
    jsx_any: named.filter((n) => n.startsWith("jsx")).length,
    template_any: named.filter((n) => n.startsWith("template")).length,
    decorator_any: named.filter((n) => n.includes("decorat")).length,
    mixin_any: named.filter((n) => n.startsWith("mixin")).length,
    with_clause_present: named.includes("with_clause"),
    part_of_present: named.includes("part_of"),
    part_any: named.filter((n) => n.includes("part")),
  },
  // THE `named` LIST IS WHAT THE SHARED `.tmp-census/grammar-nodes.json` CARRIES FOR ITS OTHER SIX
  // KEYS, and a consumer that iterates `named` gets nothing for a key without it. The Lead asked for
  // it on 2026-10-21 and it is here.
  //
  // ⚠ AND THE COUNT IS ONE NUMBER SEEN THREE WAYS, NOT THREE NUMBERS. THE FLEET'S RULE (2026-10-22):
  // the grammar's own named node types, as `nodeTypeForId` reports them, PLUS the universal
  // `ERROR`/`MISSING` pair, because every parser produces those two and every analyzer consults
  // them. For sql on the wired bytes that is 594 + 2 = **596**.
  //
  // The completeness gate's rule (`script/m14/completeness-inventory.ts:1360-1373`) DEDUPS before
  // adding the pair, so it reads **592** for sql: 590 DISTINCT named types + the same pair. The
  // shared census's rule (`.tmp-census/grammar.mts:26-30`) is `nodeTypeIsNamed(id)` and nothing
  // else, so it reads **594** - the grammar's own count, carrying 4 duplicate spellings
  // (`cast`, `dollar_quote`, `field`, `from`).
  //
  // **⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒ ⇒⇒⇒
  // THE 592 IS NOT A THIRD RULE FOR ONE THING: IT IS THE FLEET'S 596 MINUS THE FOUR DUPLICATE
  // SPELLINGS, BECAUSE THE GATE DEDUPS AND THE FLEET'S RULE DOES NOT. The fleet's rule is the one
  // that stands; the deduped number is published as the DECOMPOSITION, named as such. A lane that
  // held three numbers for one thing could compare none of them - and that shape was found here
  // twice, once for a population and once for a node census, which is what makes it a shape.  // The shared file's `namedCount` for typescript (191), tsx (203), javascript (125), python (128) and
  // dart (222) all carry their DUPLICATE SPELLINGS (typescript: 8 of them — `call_expression`,
  // `identifier`, `member_expression`, …) and none carries ERROR/MISSING; java (143) has no
  // duplicates, but still no ERROR/MISSING.
  //
  // SO THE KEY CARRIES THE SHARED FILE'S CONVENTION in `named` — so it drops in beside the other six
  // and a consumer that iterates `named` gets a comparable list — AND THE GATE'S CONVENTION beside it,
  // under its own name and with its own rule, because 592 is the number the lane's coverage arithmetic
  // uses (82 handled + 478 silent + 17 gaps + 25 decisions = 592) and a reader who found 594 where the
  // arithmetic says 592 would be right to ask which one this is.
  //
  // IT IS SORTED, because the shared file's six lists are (typescript's begins
  // `abstract_class_declaration, abstract_method_signature, accessibility_modifier, …`), so a drop-in
  // merge has to agree on the ORDER or the merged file is not comparable with the rows already in it.
  // THE HEADLINE IS THE FLEET'S NUMBER: the grammar's own named types (594) + the universal
  // ERROR/MISSING pair (2). The raw, undeduped list stays in `namedInEnumerationOrder`, and the
  // deduped convention stays in `dedupedConvention` -- both NAMED, so a reader is never left
  // with three numbers for one thing.
  namedCount: namedRaw.length + 2,
  totalCount: all.length,
  named: [...new Set([...namedRaw, "ERROR", "MISSING"])].sort(),
  anonymousSample: anonymous.slice(0, 40),
  // THE FLEET'S RULE, under its own name, with its own rule and its own list.
  //
  // THE FLEET'S RULE (2026-10-22): the grammar's own named node types, as nodeTypeForId
  // reports them, PLUS the universal ERROR/MISSING pair, because every parser produces those
  // two and every analyzer consults them. For sql on the wired bytes: 594 + 2 = 596.
  fleetRule: {
    rule: "nodeTypeForId's named node types (594, carrying 4 duplicate spellings) + the universal ERROR/MISSING pair (2) = 596",
    namedCount: namedRaw.length + 2,
    named: [...new Set([...namedRaw, "ERROR", "MISSING"])].sort(),
  },
  // THE DEDUPED CONVENTION, and IT IS NOT A THIRD NUMBER FOR ONE THING: it is the fleet's rule
  // MINUS the four duplicate spellings, because the completeness gate dedups and the fleet's
  // rule does not. 590 distinct named types + the same universal pair = 592.
  dedupedConvention: {
    rule: "nodeTypeIsNamed && !startsWith('_') && dedup, then + ERROR/MISSING (script/m14/completeness-inventory.ts:1360-1373) - the fleet's rule minus the duplicate spellings",
    namedCount: named.length,
    named: [...named].sort(),
  },
  // the enumeration order, because the ORDER IS EVIDENCE: the pinned grammar lists
  // `psql_meta_command` first, which is the wasm's own layout, and a reader diffing the two orders
  // sees the grammar's shape rather than a re-sort.
  namedInEnumerationOrder: namedRaw,
  // what the shared file's convention means for SQL, spelled out rather than implied
  // THE GRAMMAR'S OWN COUNT, before the universal pair and before any dedup. It carries the
  // duplicate spellings, and that is exactly why the fleet's rule and the deduped rule differ.
  grammarOwnCount: {
    rule: "nodeTypeForId's named node types as the grammar reports them - no `_` filter, no dedup, no universal pair (.tmp-census/grammar.mts:26-30)",
    namedCount: namedRaw.length,
    duplicateSpellings: [...new Set(duplicates)].sort(),
    distinctNamed: new Set(namedRaw).size,
  },
  // THE DERIVATION, IN ONE PLACE, so the three numbers are ONE number seen three ways.
  derivation: {
    note: "ONE NUMBER FOR ONE THING. The fleet's rule is the grammar's own named types (594) plus the universal ERROR/MISSING pair (2) = 596. The deduped convention is the same rule minus the 4 duplicate spellings: 590 distinct + 2 = 592. The 592 is NOT a third rule - it is the fleet's number under a dedup.",
    grammarOwnNamedTypes: namedRaw.length,
    duplicateSpellings: [...new Set(duplicates)].sort(),
    distinctNamedTypes: new Set(namedRaw).size,
    universalPair: 2,
    fleetRuleCount: namedRaw.length + 2,
    dedupedCount: named.length,
  },
}

console.log("═".repeat(78))
console.log("SQL — THE PINNED GRAMMAR'S NODE-TYPE INVENTORY (the gate's rule)")
console.log("═".repeat(78))
console.log(`wasm                : ${WASM}`)
console.log(`total nodeTypeCount : ${report.totalCount}`)
console.log(`named (raw)         : ${report.namedRawCount}`)
console.log(`hidden (_-prefixed) : ${report.hiddenCount}`)
console.log(`anonymous           : ${report.anonymousCount}`)
console.log(`duplicate spellings : ${report.duplicateSpellings.join(", ") || "(none)"}`)
console.log(`NAMED COUNT (fleet) : ${report.fleetRule.namedCount}   <- the denominator's node-type base (594 named + the universal pair)`)
console.log(`NAMED COUNT (dedup) : ${report.dedupedConvention.namedCount}   <- the same rule minus the duplicate spellings`)
console.log("─".repeat(78))
console.log("CONTROLS:")
for (const [k, v] of Object.entries(report.control)) console.log(`  ${k.padEnd(30)} ${v}`)
console.log("─".repeat(78))
console.log("THE FOUR EXTENDED VALUES — their grammar-inventory basis:")
for (const [label, needles] of [
  ["renders", ["jsx", "template"]],
  ["decorates", ["decorat"]],
  ["mixes_in", ["mixin", "with_clause"]],
  ["part_of", ["part", "partition"]],
] as const) {
  const hits = named.filter((n) => needles.some((x) => n.includes(x)))
  console.log(`  ${label.padEnd(12)} node types matching [${needles.join(", ")}]: ${hits.length ? hits.join(", ") : "(NONE)"}`)
}
console.log("═".repeat(78))
if (jsonOut) {
  writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  console.log(`JSON written: ${jsonOut}`)
}
