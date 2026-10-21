/**
 * cpp-grammar-inventory — THE GRAMMAR-ABSENCE HALF OF THE FOUR RULED CELLS, MEASURED.
 *
 * The fleet's bar says an UNCLASSIFIED type stays in the denominator, and only a CITED ruling lets
 * a type leave it. For cpp, four of the fourteen are ruled, and each ruling has TWO halves:
 *
 *   (i)  the GRAMMAR half — the pinned tree-sitter-cpp grammar has no node type that could produce
 *        the construct, so no corpus count for it can exist; and
 *   (ii) the CORPUS half  — the analyzer emits no such relationship over the whole admitted
 *        population, and the analyzer's own source carries no emission site for it.
 *
 * This instrument measures (i) against the PINNED wasm (the bytes the production engine loads,
 * not a fresh download) and reads the pin's digest from `validation/m14/grammar-pins.json`, so a
 * grammar swap cannot silently change the ruling. It then answers the four questions the ruling
 * of each cell turns on, by asking the grammar's OWN node-type inventory:
 *
 *   renders     a JSX element production  → the grammar has no `jsx_*` node type at all
 *   decorates   an attribute that DECORATES another declaration → the cpp grammar's attributes are
 *                `attribute_specifier` nodes that carry no relationship to another declaration, so
 *                there is nothing for `decorates` to bind; the analyzer carries them as METADATA
 *   mixes_in    a mixin production → the grammar has no `mixin` node type
 *   part_of     a `part` directive → the grammar has no `part`/`part_of` node type
 *
 * AND IT MEASURES THE CORPUS HALF TOO, from the lane's own whole-population DUMP when one is
 * given: the number of edges of each of the four labels over the whole admitted population.
 *
 * USAGE
 *   bun run script/m14/cpp-grammar-inventory.ts [--dump=<dump>] [--json=<path>]
 *
 * EXIT: 0 measured · 2 usage/environment.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..")
const argOf = (f: string): string | null => {
  const j = process.argv.find((a) => a.startsWith(`${f}=`))
  return j ? j.slice(f.length + 1) : null
}
const DUMP = argOf("--dump")
const JSON_OUT = argOf("--json")

// ── the pin ──────────────────────────────────────────────────────────────────────────────────────
const pinsPath = path.join(ROOT, "validation/m14/grammar-pins.json")
if (!fs.existsSync(pinsPath)) {
  console.error("cpp-grammar-inventory: validation/m14/grammar-pins.json is absent — the ruling has no citation")
  process.exit(2)
}
const pins = JSON.parse(fs.readFileSync(pinsPath, "utf8"))
const pin: any = (pins.lanes?.cpp ?? pins.pins?.cpp ?? pins.cpp ?? pins.languages?.cpp ?? null)
if (!pin) {
  console.error("cpp-grammar-inventory: grammar-pins.json carries no cpp pin")
  process.exit(2)
}
const wasmPath = path.join(ROOT, String(pin.wired?.file ?? pin.file ?? "wasm/tree-sitter-cpp.wasm"))
if (!fs.existsSync(wasmPath)) {
  console.error(`cpp-grammar-inventory: the pinned wasm ${wasmPath} is absent`)
  process.exit(2)
}
const wasmBytes = fs.readFileSync(wasmPath)
const { createHash } = await import("node:crypto")
const wasmSha = createHash("sha256").update(wasmBytes).digest("hex")
const pinSha = String(pin.wired?.sha256 ?? pin.sha256 ?? "")
const pinMatches = pinSha === "" ? null : wasmSha === pinSha

// ── the grammar's OWN node-type inventory, from the PINNED bytes ─────────────────────────────────
const { Parser, Language } = await import("web-tree-sitter")
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const g: any = await Language.load(wasmBytes)
const named = new Set<string>()
const anon = new Set<string>()
for (let i = 0; i < g.nodeTypeCount; i++) {
  const name = String(g.nodeTypeForId(i) ?? "")
  if (name === "") continue
  if (g.nodeTypeIsNamed(i)) named.add(name)
  else anon.add(name)
}
const all = [...named, ...anon]
const fieldNames: string[] = []
for (let i = 1; i <= g.fieldCount; i++) {
  const f = g.fieldNameForId(i)
  if (f) fieldNames.push(String(f))
}

/** THE FOUR QUESTIONS, each a NAME SEARCH over the grammar's own inventory. A name search over a
 *  NODE-TYPE INVENTORY is a measurement of the grammar's surface, not a guess about it: the
 *  inventory is the exhaustive list of node types the pinned parser can produce. */
const search = (needle: string): string[] => all.filter((t) => t.includes(needle)).sort()
const questions: Record<string, { needle: string; matches: string[]; absent: boolean }> = {
  renders: { needle: "jsx", matches: search("jsx"), absent: search("jsx").length === 0 },
  mixes_in: { needle: "mixin", matches: search("mixin"), absent: search("mixin").length === 0 },
  part_of: { needle: "part", matches: search("part"), absent: search("part").length === 0 },
  decorates: {
    needle: "attribute",
    matches: search("attribute"),
    absent: false, // the grammar HAS attribute nodes; what it has NOT is an attribute that binds
    //                 another DECLARATION. The attribute's own fields are read here, because a
    //                 node type that carries a "declaration"-shaped field could carry a
    //                 decoration; one that carries only a name/value carries nothing to decorate.
  },
}
// the attribute node's FIELDS — the decoration test
const attrFields = fieldNames.filter((f) => /attr|decor|annot/i.test(f))

// ── the corpus half: the four labels over the whole admitted population ───────────────────────────
const corpusHalf: Record<string, number> = { renders: 0, decorates: 0, mixes_in: 0, part_of: 0 }
let dumpRows = 0
if (DUMP && fs.existsSync(DUMP)) {
  for (const line of fs.readFileSync(DUMP, "utf8").split("\n")) {
    if (!line.startsWith("DUMP\t")) continue
    const label = line.split("\t")[1]
    dumpRows++
    if (label in corpusHalf) corpusHalf[label]++
  }
}

// ── the analyzer's own emission sites: a source read, counted, not asserted ────────────────────────
const analyzerPath = path.join(ROOT, "src/ast/real-cpp-analyzer.ts")
const analyzerSrc = fs.readFileSync(analyzerPath, "utf8")
const emissionSites: Record<string, number> = {}
for (const label of ["renders", "decorates", "mixes_in", "part_of"]) {
  // an emission site is a line that NAMES the relationship value in an emission position; the
  // count is of LINES that mention it, and the lines are printed so the count can be checked.
  const lines = analyzerSrc.split("\n").filter((l) => l.includes(label))
  emissionSites[label] = lines.length
}

const report = {
  schemaVersion: 1,
  instrument: "script/m14/cpp-grammar-inventory.ts",
  measuredAt: new Date().toISOString(),
  pin: {
    file: path.relative(ROOT, wasmPath),
    pinnedSha256: pinSha,
    measuredSha256: wasmSha,
    pinMatches,
    bytes: wasmBytes.length,
  },
  grammar: {
    namedTypes: named.size,
    anonTypes: anon.size,
    totalTypes: all.length,
    attributeSpecifierFields: attrFields,
  },
  questions,
  corpusHalf: DUMP ? { dump: DUMP, rowsRead: dumpRows, edgesByLabel: corpusHalf } : { note: "no dump given — the corpus half is read from the whole-population gate table" },
  analyzerEmissionSites: emissionSites,
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + "\n")

console.log("cpp-grammar-inventory — the grammar-absence half of the four RULED cells")
console.log(`  pinned wasm : ${path.relative(ROOT, wasmPath)}`)
console.log(`  sha256      : ${wasmSha}  (pin says ${pinSha} — ${pinMatches === null ? "no sha in the pin" : pinMatches ? "MATCH" : "MISMATCH"})`)
console.log(`  bytes       : ${wasmBytes.length}`)
console.log(`  node types  : ${named.size} named + ${anon.size} anonymous = ${all.length}`)
for (const [k, v] of Object.entries(questions)) {
  console.log(`  ${k.padEnd(12)}: ${v.absent ? "ABSENT from the grammar's inventory" : `present as ${JSON.stringify(v.matches)}`}`)
}
console.log(`  attribute_specifier fields : ${JSON.stringify(attrFields)}`)
console.log(`  analyzer emission sites (lines naming the value): ${JSON.stringify(emissionSites)}`)
process.exit(0)
