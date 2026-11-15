// Z40: the NAME-LEVEL complement to the lane's five site-level gates.
//
// Those gates compare per SITE (imports/exports), per OWNER KEY (contains) or per
// (label, target, source-set) (uses/calls), so all of them can be 0/0 while an
// analyzer edge exists whose (label, target) NO truth row anywhere in the file
// accounts for. That is exactly what F5's `unexplained` counts, and F5 kept the
// number and printed no sample -- a count nobody can act on.
//
// Z40 was this gate's first finding, and it was in the ORACLE, not the analyzer:
// the analyzer has emitted a `references` twin for every `@import` since Z30
// (same path literal, same line, tiered `import_based` rather than
// `declared_type`), and no truth derived it. 29 `references -> std` rows in 120
// files plus the same shape for path literals such as `src/dev.zig`.
//
// Why it matters beyond the number: `references` is the label the engine
// resolves names through, so an import whose module is missing there is a module
// the graph cannot reach. The twin is load-bearing. Its absence from the truth
// was a hole in the oracle, not a redundant edge to be tidied away.
//
// Both directions are reported, and the MISSING direction is deliberately
// redundant with F5: a lane gate that only runs when the shared harness runs is
// not a gate, and a finding with a file and a line beats a count every time.
import * as fs from "fs"
import { stripZigQuoting } from "../../../src/ast/real-zig-analyzer"
import { init, parser, analyzer } from "./zigw-harness"
import {
  deriveZigBareUsesWithSource,
  deriveZigContainment,
  deriveZigEdgesWithSource,
  deriveZigExports,
  deriveZigImports,
  deriveZigInstantiation,
  deriveZigReferenceEdges,
} from "../zig-truth"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const REPOS = ["zig", "zls", "ghostty"]

// F5's own target normalisation, so this gate fails for the reason F5 would and
// not because the two disagree about what a name is. The canonicalizer is
// imported from the ANALYZER rather than restated: Z34 ruled that the truths
// import it, and a second copy in a gate is how Z24, Z25 and Z29 happened.
const norm = (t: unknown): string => stripZigQuoting(String(t ?? "")).replace(/\s+/g, " ").trim()

function collect(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`
    if (e.isDirectory()) collect(p, out)
    else if (e.name.endsWith(".zig")) out.push(p)
  }
}

await init()
const limit = Number(process.argv[2] ?? 200)
const files: string[] = []
for (const r of REPOS) collect(`${CORPUS}/${r}`, files)
const draw = files.slice(0, Math.min(limit, files.length))

const unexplained = new Map<string, { n: number; where: string }>()
const missing = new Map<string, { n: number; where: string }>()
const published = new Set<string>()
let edges = 0

for (const f of draw) {
  const src = fs.readFileSync(f, "utf8")
  const tree = parser().parse(src)
  const res = analyzer().analyze(tree.rootNode, src, f) as any
  const syms = res.symbols ?? []

  const derived: any[] = [
    ...deriveZigContainment(tree.rootNode, syms),
    ...deriveZigImports(tree.rootNode),
    ...deriveZigInstantiation(tree.rootNode),
    ...deriveZigExports(tree.rootNode),
    ...deriveZigReferenceEdges(tree.rootNode),
    ...deriveZigEdgesWithSource(tree.rootNode),
    ...deriveZigBareUsesWithSource(tree.rootNode, syms),
  ]
  const truth = new Set<string>()
  for (const e of derived) truth.add(`${e.label} ${norm(e.target)}`)

  for (const r of res.relationships ?? []) {
    edges++
    const key = `${r.type} ${norm(r.target)}`
    published.add(key)
    if (truth.has(key)) continue
    const prev = unexplained.get(key)
    const where = `${f.split("/").pop()}:${r.line_number}  ${r.type} ${r.source} -> ${r.target}`
    if (prev) prev.n++
    else unexplained.set(key, { n: 1, where })
  }

  for (const e of derived) {
    const key = `${e.label} ${norm(e.target)}`
    if (published.has(key)) continue
    const prev = missing.get(key)
    const where = `${f.split("/").pop()}:${e.line ?? "?"}  ${e.label} ${e.from} -> ${e.target}`
    if (prev) prev.n++
    else missing.set(key, { n: 1, where })
  }
  tree.delete()
}

const report = (title: string, m: Map<string, { n: number; where: string }>): void => {
  console.log(`${title}: ${m.size} class(es)`)
  for (const [k, v] of [...m].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(v.n).padStart(4)}x  ${k.replace(" ", " -> ")}`)
    console.log(`          e.g. ${v.where}`)
  }
}

console.log(`files: ${draw.length}  analyzer edges: ${edges}  published keys: ${published.size}`)
report("UNEXPLAINED (published, no truth row)", unexplained)
report("MISSING (truth row, not published)", missing)
process.exit(unexplained.size + missing.size === 0 ? 0 : 1)
