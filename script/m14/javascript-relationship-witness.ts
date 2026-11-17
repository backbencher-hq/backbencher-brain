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

// ---------------------------------------------------------------------------
// SYNTAX-FORM WITNESSES
//
// The relationship witnesses above answer "does each LABEL fire". These answer a different question
// that no corpus can settle: when the analyzer meets a specific ES form, does it produce the thing it
// should? The forms here were chosen by `javascript-syntax-form-census.ts`, which counts the forms a
// corpus's parse tree actually contains — and the answer for the lane's original corpora was that most
// of these never appeared there, so "0 rows" proved nothing either way.
//
// Each case asserts the symbols that must appear (by name) and the relationship labels that must
// appear. `none` in either column means "asserted absent", which is only used where the lane's
// documented contract says there is nothing to emit.
// ---------------------------------------------------------------------------
type FormWitness = { name: string; source: string; symbols: string[]; rels: string[] }

const FORM_WITNESSES: FormWitness[] = [
  // an object literal bound to a name: its members ARE symbols, owned by the binding
  { name: "object shorthand method", source: "const api = { run(){ return 1; }, stop(){ return 2; } };\n", symbols: ["api", "api.run", "api.stop"], rels: ["contains"] },
  // an accessor pair: BOTH halves are published, each carrying its own accessorKind
  { name: "getter + setter pair", source: "class C { get value(){ return 1; } set value(v){} }\n", symbols: ["C", "C.value"], rels: ["contains"] },
  // both sides of a comma expression are walked
  { name: "sequence expression", source: "function f(){ g(), h(); }\nfunction g(){}\nfunction h(){}\n", symbols: ["f", "g", "h"], rels: ["calls"] },
  { name: "dynamic import()", source: "async function f(){ const m = await import('./x.js'); }\n", symbols: ["f"], rels: ["imports"] },
  { name: "top-level await", source: "const data = await fetch('/x');\n", symbols: ["data"], rels: ["calls"] },
  { name: "import.meta", source: "const u = import.meta.url;\n", symbols: ["u"], rels: [] },
  { name: "for-await-of", source: "async function f(){ for await (const x of y) { use(x); } }\n", symbols: ["f"], rels: ["calls"] },
  { name: "computed method key", source: "class C { [Symbol.iterator](){ return 1; } }\n", symbols: ["C"], rels: ["contains"] },
  { name: "async generator", source: "async function* gen(){ yield 1; }\n", symbols: ["gen"], rels: [] },
  { name: "class static block", source: "class C { static { init(); } }\n", symbols: ["C"], rels: ["calls"] },
  { name: "private field + method", source: "class C { #count = 0; #bump(){ this.#count++; } }\n", symbols: ["C"], rels: [] },
  { name: "nullish + optional chaining", source: "function f(o){ return o?.a ?? 1; }\n", symbols: ["f"], rels: [] },
  { name: "labelled loop", source: "outer: for (const a of [1]) { break outer; }\n", symbols: [], rels: [] },
]

const formFailures: string[] = []
const formTable: Array<{ name: string; verdict: string }> = []
for (const w of FORM_WITNESSES) {
  let res: any
  try {
    res = await ASTEngine.parseFile(`/tmp/form-${w.name.replace(/[^a-z0-9]+/gi, "-")}.js`, w.source)
  } catch (e) {
    formFailures.push(`${w.name}: the analyzer THREW (${(e as Error)?.message ?? e})`)
    formTable.push({ name: w.name, verdict: "THREW" })
    continue
  }
  const symNames = new Set((res.symbols ?? []).map((s: any) => (s.ownerName ? `${s.ownerName}.${s.name}` : String(s.name))))
  const relLabels = new Set((res.relationships ?? []).map((r: any) => String(r.type)))
  const missingSyms = w.symbols.filter((n) => !symNames.has(n) && !symNames.has(n.split(".").pop() ?? n))
  const missingRels = w.rels.filter((n) => !relLabels.has(n))
  if (missingSyms.length === 0 && missingRels.length === 0) {
    formTable.push({ name: w.name, verdict: "ok" })
  } else {
    const bits: string[] = []
    if (missingSyms.length > 0) bits.push(`missing symbols [${missingSyms.join(", ")}] (saw [${[...symNames].join(", ")}])`)
    if (missingRels.length > 0) bits.push(`missing rels [${missingRels.join(", ")}] (saw [${[...relLabels].join(", ")}])`)
    formFailures.push(`${w.name}: ${bits.join("; ")}`)
    formTable.push({ name: w.name, verdict: "FAIL" })
  }
}

console.log("\njavascript SYNTAX-FORM witnesses")
console.log(`\n  ${"form".padEnd(30)} verdict`)
for (const r of formTable) console.log(`  ${r.name.padEnd(30)} ${r.verdict}`)
if (formFailures.length > 0) {
  console.log("\nfailures:")
  for (const f of formFailures) console.log(`  ${f}`)
}

const missing = table.filter((r) => r.verdict.startsWith("MISSING") || r.verdict === "THREW" || r.verdict === "UNEXPECTED ROWS")
console.log(
  `\n${missing.length === 0 ? "PASS" : "FAIL"} — ${table.length - 1 - (missing.length > 0 ? missing.length : 0)}` +
  ` of 13 implementable labels fire; part_of is silent by declared disposition.`,
)
if (failures.length > 0) {
  console.log("\nfailures:")
  for (const f of failures) console.log(`  ${f}`)
}
if (formFailures.length > 0) {
  process.exit(1)
}
if (failures.length > 0) process.exit(1)