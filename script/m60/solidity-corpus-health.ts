/**
 * M60 — Solidity corpus health and node-type coverage.
 *
 * The first measurement of a new lane, and the one that decides what the analyzer has to
 * handle. Three questions, in order:
 *
 *   1. Does the grammar parse a real corpus? A lane whose grammar damages most of its
 *      corpus cannot be measured, and every downstream number would be a statement about
 *      the grammar rather than the analyzer.
 *   2. If not, what exactly breaks? Counts do not say. This turns ERROR/MISSING totals
 *      into classes keyed by node type plus the source text, so each is adjudicable.
 *      The PowerShell lane shipped for weeks on a COUNT, and the classes it eventually
 *      itemised were three unrelated bugs wearing one number.
 *   3. Which of the grammar's named types does the corpus actually EXERCISE? A type that
 *      never appears is not covered by the corpus and cannot be gated by it, so this is
 *      the list of things the fixtures have to carry by hand.
 *
 * The draw is a hash of `repo/relative-path` rather than a directory listing, so it is
 * unbiased and reproducible, and the digest is recorded so a later run that drew a
 * different set says so instead of being compared. The language's own test tree is
 * excluded from the production figure, exactly as every other lane does: a test corpus
 * embeds deliberately-invalid syntax and mixing it into a damage rate measures the test
 * suite, not the parser.
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = process.cwd()
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_ONLY_REPO ?? "solidity"
const REV = process.env.BB_CORPUS_REV ?? "32b5b8c4655448291e27272d43607b9e3ae8c1d8"
const EXTS = ["sol"]
const SAMPLE = Number(process.env.BB_SAMPLE ?? 60)
const OUT = path.join(ROOT, "validation/m60/results/solidity-corpus-health.json")

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new P()
const lang: any = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-solidity.wasm")))
parser.setLanguage(lang)

const dir = path.join(CORPUS_ROOT, REPO)
if (!existsSync(dir)) {
  console.error(`  corpus absent: ${dir}`)
  process.exit(2)
}

const pattern = EXTS.map((e) => `'*.${e}'`).join(" ")
const all = execSync(`git -C ${dir} ls-files ${pattern}`, { encoding: "utf8", maxBuffer: 1 << 26 })
  .split("\n").map((s) => s.trim()).filter(Boolean)

/** Unbiased, reproducible draw. */
const h = (s: string) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 1676136261) >>> 0 } return x }
const isTest = (r: string) => /(^|\/)test(s)?\//i.test(r) || /\.t\.sol$/.test(r)
const production = all.filter((r) => !isTest(r))
const drawn = production
  .map((r) => ({ r, k: h(`${REPO}/${r}`) }))
  .sort((a, b) => a.k - b.k)
  .slice(0, SAMPLE)
  .map((x) => x.r)
const digest = (rels: string[]) => { let x = 2166136261; for (const c of rels.join("\n")) { x ^= c.charCodeAt(0); x = Math.imul(x, 1676136261) >>> 0 } return (x >>> 0).toString(16).padStart(8, "0") }

type Item = { file: string; line: number; type: string; text: string; missing: boolean }
const classes = new Map<string, Item[]>()
const seenTypes = new Set<string>()
let files = 0, damaged = 0, errNodes = 0, missNodes = 0
const perFile: Array<{ file: string; err: number; miss: number }> = []

const walk = (node: any, file: string, into: Item[]) => {
  seenTypes.add(node.type)
  if (node.isMissing) {
    into.push({ file, line: node.startPosition.row + 1, type: node.type, text: node.text.slice(0, 80), missing: true })
    return
  }
  if (node.type === "ERROR") {
    into.push({ file, line: node.startPosition.row + 1, type: "ERROR", text: node.text.slice(0, 80), missing: false })
  }
  for (let i = 0; i < node.childCount; i++) walk(node.child(i), file, into)
}

for (const rel of drawn) {
  const content = readFileSync(path.join(dir, rel), "utf8")
  files++
  const tree = parser.parse(content)
  const found: Item[] = []
  walk(tree.rootNode, rel, found)
  if (!found.length) continue
  damaged++
  const e = found.filter((f) => !f.missing).length
  const m = found.length - e
  errNodes += e
  missNodes += m
  perFile.push({ file: rel, err: e, miss: m })
  for (const f of found) {
    const key = `${f.missing ? "MISSING" : "ERROR"} ${f.type} ${f.text.slice(0, 30)}`
    const arr = classes.get(key) ?? []
    arr.push(f)
    classes.set(key, arr)
  }
}

// Every named type the GRAMMAR declares, so "never exercised" is a real statement about
// the grammar's vocabulary rather than about whatever the draw happened to touch.
const nt = JSON.parse(readFileSync(path.join(ROOT, "grammars/tree-sitter-solidity/src/node-types.json"), "utf8")) as Array<{ type: string; named?: boolean }>
const declaredNamed = [...new Set(nt.filter((n) => n.named).map((n) => n.type))].sort()
const neverExercised = declaredNamed.filter((t) => !seenTypes.has(t))
const exercised = declaredNamed.filter((t) => seenTypes.has(t))

const classRows = [...classes.entries()]
  .map(([key, items]) => ({ key, count: items.length, files: [...new Set(items.map((i) => i.file))].length, sample: items.slice(0, 3) }))
  .sort((a, b) => b.count - a.count)

const out = {
  instrument: "m60-solidity-corpus-health",
  question: "Does the grammar parse a real Solidity corpus, what breaks if not, and which declared named types does the corpus never exercise?",
  corpus: { repo: REPO, rev: REV, dir, allSolFiles: all.length, productionFiles: production.length, testFiles: all.length - production.length },
  draw: { sample: SAMPLE, order: "hash of repo/relative-path ascending", digest: digest(drawn), excluded: "test/ and *.t.sol" },
  runtime: { wasm: "wasm/tree-sitter-solidity.wasm", abi: lang.abiVersion, nodeTypeCount: lang.nodeTypeCount, fieldCount: lang.fieldCount },
  totals: {
    files, damaged,
    damagedPct: Number(((damaged / Math.max(1, files)) * 100).toFixed(1)),
    errorNodes: errNodes, missingNodes: missNodes, distinctClasses: classRows.length,
  },
  typeCoverage: {
    declaredNamed: declaredNamed.length,
    exercised: exercised.length,
    neverExercised: neverExercised.length,
    neverExercisedList: neverExercised,
  },
  classes: classRows,
  worstFiles: perFile.sort((a, b) => b.err - a.err || b.miss - a.miss).slice(0, 10),
  howToRead:
    "damagedPct is the parser's, not the analyzer's. A MISSING node is a token the parser INSERTED to keep going, so it is a fabrication with no error attached and is the class worth reading first. A named type in neverExercised cannot be gated by this corpus and must be carried by a hand-written fixture or explicitly ruled out.",
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n")

console.log(`  corpus ${REPO}@${REV.slice(0, 8)}  ${all.length} .sol total, ${production.length} production`)
console.log(`  runtime: ABI ${lang.abiVersion}, ${lang.nodeTypeCount} node types, ${lang.fieldCount} fields`)
console.log(`\n  draw ${files} files (digest ${out.draw.digest})`)
console.log(`    damaged  ${damaged}  (${out.totals.damagedPct}%)`)
console.log(`    ERROR    ${errNodes}     MISSING ${missNodes}     classes ${classRows.length}`)
console.log(`\n  named-type coverage: ${exercised.length}/${declaredNamed.length} exercised, ${neverExercised.length} never exercised`)
if (neverExercised.length) console.log(`    ${neverExercised.slice(0, 24).join(", ")}${neverExercised.length > 24 ? ", …" : ""}`)
if (classRows.length) {
  console.log(`\n  damage classes:`)
  for (const c of classRows.slice(0, 12)) {
    console.log(`    ${String(c.count).padStart(3)}x ${c.files}f  ${c.key.replace(/\n/g, "\\n").slice(0, 72)}`)
    console.log(`          e.g. ${c.sample[0].file}:${c.sample[0].line}  ${JSON.stringify(c.sample[0].text.slice(0, 50))}`)
  }
}
console.log(`\n  wrote ${path.relative(ROOT, OUT)}`)
