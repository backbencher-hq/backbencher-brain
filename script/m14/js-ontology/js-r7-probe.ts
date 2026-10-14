// Probe: what node type does the JS grammar give `null`, `undefined`, `Na`, `this`,
// `NaN`? R7's placeholder question turns on the answer, so it is asked of the
// GRAMMAR, not of a classifier. AST walk, no regex.
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const parser = await getParser("javascript")
const src = [
  "function f(a) {",
  "  var x = null;",
  "  var y = undefined;",
  "  var z = NaN;",
  "  var w = Na;",
  "  var u = this;",
  "  return typeof a === 'null' ? null : undefined;",
  "}",
  "var o = { unknown: 1, 'na': 2 };",
  "g('unknown'); g(Na); g(null);",
].join("\n")
const tree = await parser.parse(src)
if (!tree) throw new Error("parser.parse returned no tree (null result)")
const stack: any[] = [tree.rootNode]
const rows: string[] = []
while (stack.length) {
  const n = stack.pop()
  if (!n) continue
  if (n.type === "identifier" || n.type === "property_identifier" || n.type.endsWith("word")) {
    rows.push(`${n.type}  ${n.text}`)
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) stack.push(c)
  }
}
console.log("identifier/property_identifier nodes in the probe source:")
for (const r of rows) console.log("  " + r)

// ── THE R7 CONVICTION, EXERCISED ON ITS OWN ARMS ─────────────────────────────
// The grammar probe above answers what a spelling IS. This answers what may be
// CONVICTED, and the two questions are different: `UNKNOWN` is an identifier node
// like any other, and the census used to convict two real `uses` edges for naming
// it. Four of these arms are the classes that must be told apart, and the first is
// the live case - svelte's css/utils.js declares `const UNKNOWN = {}` and reads it,
// so that spelling is a WRITTEN NAME there, while the SAME spelling in a file that
// never writes it, and a synthetic `<unknown>` or `?` anywhere, still convict. A
// predicate that only knows how to return false is not a rule, so the arms that
// must come back true are here beside the one that must not.
import { convictsPlaceholder } from "./js-census"

const svelteText = "const UNKNOWN = {};\nfunction f(set) {\n  if (set.has(UNKNOWN)) return;\n}\n"
const arms: { name: string; got: boolean; want: boolean }[] = [
  { name: "written word-shaped name (svelte `UNKNOWN`, the live case)", got: convictsPlaceholder("UNKNOWN", svelteText, new Set()), want: false },
  { name: "same spelling, file never writes it and nothing declares it", got: convictsPlaceholder("UNKNOWN", "const other = 1;\n", new Set()), want: true },
  { name: "synthetic angle-bracket spelling, whatever the file writes", got: convictsPlaceholder("<unknown>", svelteText, new Set()), want: true },
  { name: "`?` - in the list, not identifier-shaped", got: convictsPlaceholder("?", svelteText, new Set()), want: true },
  { name: "word-shaped spelling the file DECLARES as a symbol", got: convictsPlaceholder("TODO", "const x = 1;\n", new Set(["TODO"])), want: false },
  { name: "ordinary written name, in the list or not", got: convictsPlaceholder("resolve", svelteText, new Set()), want: false },
  { name: "`n/a` - in the list, not identifier-shaped", got: convictsPlaceholder("n/a", "const x = 1;\n", new Set()), want: true },
]
let wrong = 0
console.log("\nR7 conviction arms (convictsPlaceholder):")
for (const a of arms) {
  const ok = a.got === a.want
  if (!ok) wrong++
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${a.name} -> ${a.got} (want ${a.want})`)
}
console.log(wrong === 0 ? `R7 conviction probe: ${arms.length} of ${arms.length} arms` : `R7 conviction probe: ${wrong} arm(s) WRONG`)
process.exit(wrong === 0 ? 0 : 1)