/**
 * WHICH RECEIVER SHAPES THE ANALYZER TYPES — one source per shape, one parse, one table.
 *
 * WHY THIS EXISTS. The gate's marker table reports `receiverCause` as ONE key and the lane's
 * `receiver-cut-pricing.ts` splits it by cause VALUE (receiverTypeUnknown = 48.5 % of bare rows on
 * the 400-file stride). Neither says WHICH declaration forms the pass actually reads. This probe
 * measures the pass's own output, shape by shape: every case is a source in which the receiver's
 * declared type is WRITTEN IN THE SOURCE, so a bare leaf is a reader that did not look.
 *
 * The shapes are the ones `collectDartLocalTypes` and `collectDartParameterTypes` claim to read, and
 * the one that matters is the METHOD parameter: tree-sitter-dart writes a method as
 * `method_signature > function_signature > formal_parameter_list` (dumped, not assumed), so a
 * body's previous named sibling is the `method_signature` WRAPPER, and `extractParameters` searches
 * its DIRECT children for a `formal_parameter_list` — which is one level deeper. `findChildByType`
 * is a direct-child scan (`real-dart-analyzer.ts:4877`), so the method's parameters come back EMPTY
 * while the identical top-level function's parameters do not. `findInnerSignature` already unwraps
 * exactly this wrapper two hundred lines away, for the call context.
 *
 * Each case prints the edge the analyzer emitted and whether it matches the case's own expectation,
 * so this file is a PIN as well as a probe: it fails loudly if a later change un-types a shape that
 * was typed, or types one that must stay bare.
 *
 * The sources are written to the OS TEMP DIR, never into this fixture directory: the fixture runner
 * pairs every `.dart` here with an `.expectation.json` and counts a missing pair as a failure, so a
 * probe source parked beside the fixtures would break the suite it is measuring.
 *
 * Usage: bun run validation/m14/fixtures/dart/field-receiver-probe.ts
 * Exit 0 = every shape emitted what it should; 1 = at least one did not (the failing rows are named).
 */
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const HELPER = `class Helper {\n  int id = 0;\n  void poke() {}\n}\n`

type Case = {
  label: string
  src: string
  /** the edge whose target is the observation: its type and the substring that must not be a leaf */
  type: "calls" | "uses"
  member: string
  /** `qualified` = must carry an owner (the type the source writes); `bare` = must stay a leaf */
  want: "qualified" | "bare"
  /** when bare, the receiverCause the case must carry (null = any) */
  wantCause?: string | null
  why: string
}

const CASES: Case[] = [
  {
    label: "top-level fn PARAM",
    src: HELPER + `void f(Helper p) { p.poke(); }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "CONTROL — a top-level function's body hands its sibling `function_signature` to the reader, which holds the list directly.",
  },
  {
    label: "METHOD PARAM",
    src: HELPER + `class A { void run(Helper p) { p.poke(); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "THE DEFECT — `method_signature` wraps the function_signature that holds the list.",
  },
  {
    label: "STATIC method PARAM",
    src: HELPER + `class A { static void run(Helper p) { p.poke(); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "same wrapper as METHOD PARAM (static is a modifier on the same node).",
  },
  {
    label: "CONSTRUCTOR PARAM",
    src: HELPER + `class A { A(Helper p) { p.poke(); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "a constructor body's sibling is a `constructor_signature`, which is NOT wrapped — pinned so the fix cannot be read as having caused it.",
  },
  {
    label: "SETTER PARAM",
    src: HELPER + `class A { set value(Helper p) { p.poke(); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "`setter_signature` is a signature node; `findInnerSignature` leaves it alone.",
  },
  {
    label: "local ctor INFERRED",
    src: HELPER + `class A { void run() { final l = Helper(); l.poke(); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "CONTROL — `collectDartLocalTypes`' `constructedTypeName` arm (a descendant walk, so methods were never broken here).",
  },
  {
    label: "CLOSURE PARAM",
    src: HELPER + `class A { void run() { final cb = (Helper q) { q.poke(); }; cb(Helper()); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "CONTROL — pinned by typed-receiver-heads.dart (the body's sibling IS the formal_parameter_list).",
  },
  {
    label: "TYPED for-in",
    src: HELPER + `class A { void run() { for (final Helper r in <Helper>[]) { r.poke(); } } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "CONTROL — pinned by typed-receiver-heads.dart.",
  },
  {
    label: "METHOD PARAM member READ",
    src: HELPER + `class A { int run(Helper p) { return p.id; } }\n`,
    type: "uses", member: "id", want: "qualified",
    why: "the same reader feeds a `uses` member read, not only a call.",
  },
  {
    label: "METHOD PARAM, type OUTSIDE the file",
    src: `class Helper { void poke() {} }\nclass A { void run(Helper p) { p.poke(); } }\n`,
    type: "calls", member: "poke", want: "qualified",
    why: "the owner is still written in the source; the spelling branch decides what may be published.",
  },
  {
    label: "UNTYPED method param (var-free)",
    src: HELPER + `class A { void run(p) { p.poke(); } }\n`,
    type: "calls", member: "poke", want: "bare", wantCause: "receiverTypeUnknown",
    why: "CONTROL/DECLINE — nothing in the source names the type, so it must STAY bare.",
  },
  {
    label: "METHOD PARAM, owner in file, member NOT",
    src: HELPER + `class A { void run(Helper p) { p.absent(); } }\n`,
    type: "calls", member: "absent", want: "bare", wantCause: "receiverMemberOutsideRun",
    why: "DECLINE — the owner is visible and does not declare the member; a spelling would name a declaration that does not exist.",
  },
]

type Row = { label: string; observed: string; meta: string; ok: boolean; why: string }
const rows: Row[] = []

for (const c of CASES) {
  const root = mkdtempSync(path.join(tmpdir(), "dart-shape-"))
  writeFileSync(path.join(root, "pubspec.yaml"), "name: probe\n")
  const file = path.join(root, "probe.dart")
  writeFileSync(file, c.src)
  const r: any = await parseFile(file, root)
  const edges: any[] = (r?.relationships ?? []).filter(
    (e: any) => e.type === c.type && (String(e.target) === c.member || String(e.target).endsWith(`.${c.member}`)),
  )
  const hit = edges[0]
  if (!hit) {
    rows.push({ label: c.label, observed: "(no edge emitted)", meta: "", ok: false, why: c.why })
    continue
  }
  const target = String(hit.target).replace(/\u0000/g, "<SEP>")
  const meta = hit.metadata ?? {}
  const isQualified = target.endsWith(`.${c.member}`) && !target.includes("<SEP>")
  const cause = meta.receiverCause ?? null
  const ok =
    c.want === "qualified"
      ? isQualified
      : !isQualified && (c.wantCause === null || c.wantCause === undefined || cause === c.wantCause)
  rows.push({
    label: c.label,
    observed: `${c.type} -> ${target}`,
    meta: Object.keys(meta).sort().map((k) => `${k}=${String(meta[k])}`).join(", "),
    ok,
    why: c.why,
  })
}

const pass = rows.filter((r) => r.ok).length
console.log(`receiver-shape probe — ${pass}/${rows.length} shape(s) as expected`)
console.log("")
for (const r of rows) {
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label.padEnd(36)} ${r.observed.padEnd(30)} ${r.meta}`)
  if (!r.ok) console.log(`        why: ${r.why}`)
}
console.log("")
console.log(`exit ${pass === rows.length ? 0 : 1} — a FAIL names a declaration form whose written type the pass does not read`)
process.exit(pass === rows.length ? 0 : 1)
