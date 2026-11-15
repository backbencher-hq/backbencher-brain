// go (round 3) — the harness pin, and the grammar-error blast radius.
//
// (1) THE PIN for the harness fix: `deriveGoImplements` is keyed by names READ
//     FROM SOURCE, and it used plain `{}` records, so a legal Go type named
//     `constructor`, `toString` or `valueOf` made `structMethods[name]` find an
//     Object.prototype member and `.add(...)` threw — the whole go lane died on
//     go-tools/go/callgraph/vta/vta.go (`func (c *constructor) ...`), a file the
//     canonical 60-file draw never reaches. The synthetic case below is the pin:
//     pre-fix it throws (`.add is not a function`), post-fix it derives the edges.
//     The real file is checked for "does not throw" only — how many implements
//     edges it has is a truth question, not this pin's.
//
// (2) THE BLAST RADIUS of a GRAMMAR error, not an analyzer rule: a package-scope
//     generic FUNCTION VALUE (`var _ = slices.Backward[[]int]`, legal Go 1.21+)
//     makes tree-sitter-go emit an ERROR node that swallows the FOLLOWING
//     declarations, so their symbols and edges are never published — and the
//     oracle walks the same broken tree, so the lane's own differential cannot
//     see it either. Measured from the TREE, not from a source-line heuristic:
//     every declaration keyword inside an ERROR region is a declaration the
//     grammar lost (a source-line count over-counts `_test.go` files that embed
//     Go source in string literals — the first draft of this probe did exactly
//     that and reported 1,838 "lost" declarations on go-tools).
//
// Run: bun script/m14/tmp/go-799-grammar-gap.ts [corpusRoot ...]
import * as fs from "node:fs"
import * as path from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { deriveGoImplements } from "../differential"

const REPOS = "/home/ishaq2321/bb_tests/repositories"
const roots = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [`${REPOS}/go-tools`, `${REPOS}/terraform`]

const parser = await ASTEngine.getParser("go" as any)

// ---------------------------------------------------------------- part 1: pin
console.log("=== (1) the harness pin: names that collide with Object.prototype ===")
const REAL_FILE = `${REPOS}/go-tools/go/callgraph/vta/vta.go`
let pinFailures = 0
{
  const realSrc = fs.readFileSync(REAL_FILE, "utf8")
  const tree: any = parser.parse(realSrc)
  try {
    const edges = deriveGoImplements(tree.rootNode)
    console.log(`  real file: oracle returned ${edges.length} edges without throwing (${edges.filter((e: any) => e.label === "implements").length} implements)`)
  } catch (e: any) {
    console.log(`  FAIL: the oracle THREW on a legal Go file: ${e?.message}`)
    pinFailures++
  }
}
{
  // The pin: three legal Go types whose names are Object.prototype members.
  const SYN = `package p

type constructor interface {
\tM() error
}

type toString struct{}

func (t toString) M() error { return nil }

type valueOf struct{}

func (v valueOf) M() error { return nil }
`
  const tree: any = parser.parse(SYN)
  try {
    const names = deriveGoImplements(tree.rootNode)
      .filter((e: any) => e.label === "implements")
      .map((e: any) => `${e.from}->${e.target}`)
      .sort()
    console.log(`  synthetic Object.prototype-named types: ${JSON.stringify(names)}`)
    for (const want of ["toString->constructor", "valueOf->constructor"]) {
      if (!names.includes(want)) {
        console.log(`  FAIL: expected implements ${want} — a legal Go type named like an Object.prototype member`)
        pinFailures++
      }
    }
  } catch (e: any) {
    console.log(`  FAIL: the oracle THREW on the synthetic case: ${e?.message}`)
    pinFailures++
  }
}

// -------------------------------------------------------- part 2: blast radius
const GENERIC_VALUE_LINE = /=\s*[A-Za-z_][A-Za-z0-9_.]*\[[^\]]*\]\s*$/

function errorRegions(root: any): any[] {
  const out: any[] = []
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === "ERROR" || n.isMissing) {
      out.push(n)
      continue // nested ERRORs are inside this one's text
    }
    for (let i = 0; i < n.namedChildCount; i++) stack.push(n.namedChild(i))
  }
  return out
}

console.log("\n=== (2) grammar-error blast radius (declarations inside ERROR regions) ===")
let total = { files: 0, filesWithAnyError: 0, filesWithSwallowedDecls: 0, swallowedDecls: 0, filesWhereGenericValueIsPresent: 0, swallowedFromThose: 0 }
for (const root of roots) {
  const files: string[] = []
  const walk = (d: string, depth = 0) => {
    if (depth > 16) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules" || e.name === "vendor") continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith(".go")) files.push(p)
    }
  }
  walk(root)
  files.sort()
  let filesCount = 0
  let withAnyError = 0
  let withSwallowed = 0
  let swallowed = 0
  let gvFiles = 0
  let gvSwallowed = 0
  const samples: string[] = []
  for (const f of files) {
    filesCount++
    const src = fs.readFileSync(f, "utf8")
    let tree: any
    try {
      tree = parser.parse(src)
    } catch {
      continue
    }
    const rootNode: any = tree.rootNode
    if (rootNode.hasError) withAnyError++
    const errs = errorRegions(rootNode)
    let lost = 0
    let hasGenericValue = false
    for (const e of errs) {
      for (const line of String(e.text).split("\n")) {
        if (/^(func|type)\s+[A-Za-z_(]/.test(line)) lost++
        if (GENERIC_VALUE_LINE.test(line.trim())) hasGenericValue = true
      }
    }
    if (lost > 0) {
      withSwallowed++
      swallowed += lost
      if (hasGenericValue) {
        gvSwallowed += lost
        gvFiles++
      }
      if (samples.length < 10) {
        samples.push(`${path.relative(root, f)}: swallowed=${lost} hasError=${rootNode.hasError} genericValueInError=${hasGenericValue}`)
      }
    }
  }
  console.log(`\n  ${path.basename(root)}: files=${filesCount} hasError=${withAnyError} filesWithSwallowedDecls=${withSwallowed} swallowedDeclarations=${swallowed} (from an ERROR region containing the generic-value shape: files=${gvFiles}, declarations=${gvSwallowed})`)
  for (const s of samples) console.log(`    ${s}`)
  total = {
    files: total.files + filesCount,
    filesWithAnyError: total.filesWithAnyError + withAnyError,
    filesWithSwallowedDecls: total.filesWithSwallowedDecls + withSwallowed,
    swallowedDecls: total.swallowedDecls + swallowed,
    filesWhereGenericValueIsPresent: total.filesWhereGenericValueIsPresent + gvFiles,
    swallowedFromThose: total.swallowedFromThose + gvSwallowed,
  }
}
console.log(`\n  TOTAL: ${JSON.stringify(total)}`)
console.log(`\nPIN RESULT: ${pinFailures === 0 ? "PASS — the oracle survives legal Go names that collide with Object.prototype" : `FAIL (${pinFailures})`}`)
if (pinFailures > 0) process.exitCode = 1
