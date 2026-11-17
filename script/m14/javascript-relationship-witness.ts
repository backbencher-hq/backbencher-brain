/**
 * JAVASCRIPT RELATIONSHIP WITNESSES — every one of the 14 vocabulary labels, proved to FIRE.
 *
 * WHY THIS GATE EXISTS. A lane can report a label as "EMITTED" in its doc and never actually emit it
 * on any input the corpora contain: `renders` has **0 rows on every corpus this lane measures** (no
 * JSX in the drawn `.js` files) and `mixes_in` is 81 rows across 7 corpora. A zero from a corpus is
 * indistinguishable from a broken code path, so the disposition "EMITTED" rested on triage counts
 * rather than on a construct that is KNOWN to produce the label.
 *
 * This gate answers the only question that separates the two: for each label, feed the analyzer a
 * MINIMAL construct that must produce it and assert a row comes out. It runs entirely on in-memory
 * strings, so it needs no corpus and cannot be skipped by a sample that happens not to contain the
 * construct.
 *
 * THE ONE LABEL WITH NO WITNESS IS DECLARED, NOT OMITTED. `part_of` cannot be witnessed because
 * JavaScript has no composition-part construct: the pinned grammar's supertype-shaped names are
 * `class_heritage` and `super` only, and (unlike `implements`) JSDoc has no `@partOf` tag, so there is
 * no second channel either. This gate asserts ZERO `part_of` rows for a construct that would carry a
 * part-of in a language that has one, and names it in the output as a RUINED-BY-LANGUAGE row rather
 * than silently passing.
 *
 * Exit 0 when every implementable label fires and `part_of` stays silent.
 *
 *   bun run script/m14/javascript-relationship-witness.ts
 */
import { ASTEngine } from "../../src/ast/engine"

type Witness = { label: string; source: string; note?: string }

const WITNESSES: Witness[] = [
  { label: "calls", source: "function f(){ g(); }\nfunction g(){}\n" },
  { label: "extends", source: "class A {}\nclass B extends A {}\n" },
  {
    label: "implements",
    source: "/** @implements {IFoo} */\nclass C {}\n",
    note: "JSDoc route — JavaScript has no implements clause",
  },
  { label: "uses", source: "const target = 1;\nfunction f(){ return target; }\n" },
  { label: "imports", source: "import { item } from './mod.js';\n" },
  { label: "exports", source: "export const value = 1;\n" },
  { label: "contains", source: "class Holder { member() { return 1; } }\n" },
  { label: "references", source: "function f(x){ return x instanceof Date; }\n" },
  {
    label: "overrides",
    source: "class A { run() { return 1; } }\nclass B extends A { run() { return 2; } }\n",
  },
  { label: "instantiates", source: "class Widget {}\nconst w = new Widget();\n" },
  {
    label: "decorates",
    source: "function deco(t){ return t; }\n@deco\nclass Decorated {}\n",
  },
  {
    label: "renders",
    source: "function App(){ return <Panel><Inner/></Panel>; }\n",
    note: "JSX — 0 population on every measured corpus, so only a witness can prove the path",
  },
  {
    label: "mixes_in",
    source: "function extend(...mixins){ return class {}; }\nclass Base {}\nclass App extends Base.extend(Mixin) {}\n",
  },
]

/** a construct that would be a part-of in a language that has the relation (nested member declaration) */
const PART_OF_NEGATIVE = "class Outer { \n  inner = class Inner { m(){ return 1; } };\n}\n"

async function rowsOf(src: string, file: string): Promise<Array<{ label: string }>> {
  const res: any = await ASTEngine.parseFile(file, src)
  return (res.relationships ?? []).map((r: any) => ({ label: String(r.type ?? "") }))
}

const failures: string[] = []
const table: Array<{ label: string; rows: number; verdict: string }> = []

for (const w of WITNESSES) {
  let rows: Array<{ label: string }>
  try {
    rows = await rowsOf(w.source, `/tmp/witness-${w.label}.js`)
  } catch (e) {
    failures.push(`${w.label}: the analyzer THREW on the witness (${(e as Error)?.message ?? e})`)
    table.push({ label: w.label, rows: 0, verdict: "THREW" })
    continue
  }
  const n = rows.filter((r) => r.label === w.label).length
  if (n > 0) {
    table.push({ label: w.label, rows: n, verdict: "fires" })
  } else {
    // which labels DID come out, so a renamed/mis-routed label is visible rather than just "0"
    const got = [...new Set(rows.map((r) => r.label))].join(", ") || "(none)"
    failures.push(`${w.label}: NO row. The same witness emitted: ${got}`)
    table.push({ label: w.label, rows: 0, verdict: `MISSING (saw: ${got})` })
  }
}

// the part_of negative: the construct must emit NOTHING for part_of
{
  const rows = await rowsOf(PART_OF_NEGATIVE, "/tmp/witness-part_of.js")
  const n = rows.filter((r) => r.label === "part_of").length
  if (n > 0) {
    failures.push(`part_of: ${n} row(s) emitted on the negative construct — the disposition says this language cannot express it`)
    table.push({ label: "part_of", rows: n, verdict: "UNEXPECTED ROWS" })
  } else {
    table.push({ label: "part_of", rows: 0, verdict: "silent (no construct exists — declared)" })
  }
}

console.log("javascript relationship witnesses — 14 vocabulary labels")
console.log(`\n  ${"label".padEnd(14)} ${"rows".padStart(5)}  verdict`)
for (const r of table) console.log(`  ${r.label.padEnd(14)} ${String(r.rows).padStart(5)}  ${r.verdict}`)

const missing = table.filter((r) => r.verdict.startsWith("MISSING") || r.verdict === "THREW" || r.verdict === "UNEXPECTED ROWS")
console.log(
  `\n${missing.length === 0 ? "PASS" : "FAIL"} — ${table.length - 1 - (missing.length > 0 ? missing.length : 0)}` +
  ` of 13 implementable labels fire; part_of is silent by declared disposition.`,
)
if (failures.length > 0) {
  console.log("\nfailures:")
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}