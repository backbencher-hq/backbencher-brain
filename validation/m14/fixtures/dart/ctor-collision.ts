/**
 * CONSTRUCTOR-QUALIFIED-NAME COLLISION — is `Owner.constructor` a unique name?
 *
 * ## The question the ambiguity split raised
 *
 * `ambiguity-split.ts` at n=600 reports the fifth most-declared name in the
 * sample as `TypeInferenceElementTest.const` with 91 declarations in ONE file,
 * then `ElementDisplayStringTest.const` (72), `FileTest.constructor` (44) and
 * `FolderTest.constructor` (31) — every one of them a `constructor` kind, every
 * one of them a single FILE. A name that is not unique inside one file cannot be
 * made unique by any scope model: there is no scope to widen into. So either the
 * analyzer's owner attribution collapses many constructors onto one owner, or
 * those files genuinely declare many constructors on one class.
 *
 * Those two readings have opposite fixes, and the ambiguity split cannot tell
 * them apart because it counts names, not owners. This file separates them from
 * the collected parse records.
 *
 * ## What is measured
 *
 * Per file, among `constructor`-kind declarations:
 *   ctors        how many there are;
 *   owners       how many DISTINCT `q` (the published qualified name) they carry;
 *   collapse     ctors - owners, i.e. declarations sharing a qualified name.
 *
 * And the same over methods and properties, so a collapsed owner is shown to be
 * a property of how the analyzer computes `q` rather than of constructors alone.
 *
 * The expected-answer control is the PARSE TREE: for the same files, the tree
 * says how many distinct classes each file really declares. If the analyzer
 * publishes fewer owners than the tree declares classes, the analyzer is losing
 * owner identity, and the count says by how much.
 *
 * ## No regex
 *
 * Reads the collected records and the parse tree only. No source text is scanned.
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { dartSample, readRaw, samplePaths, type RawFile } from "./collect-sample"

interface Agg {
  ctors: number
  ctorOwners: number
  methods: number
  methodOwners: number
  props: number
  propOwners: number
}

/**
 * The corpus-relative path, for a table a reader can act on.
 *
 * A regular expression was here and the lane's own AST census counted it
 * (`regex-census.ts`: "2 regex construct(s) in the lane-owned set"). Stripping a
 * prefix is a string operation, and a path test by regex is also a text scan
 * over a path that a corpus root change can silently defeat. `CORPUS_PREFIX` is
 * compared by equality and the remainder taken by index arithmetic.
 */
const CORPUS_PREFIX = "/home/ishaq2321/bb_tests/repositories/"
function shortPath(f: string): string {
  return f.startsWith(CORPUS_PREFIX) ? f.slice(CORPUS_PREFIX.length) : f
}

function ownerSet(syms: RawFile["symbols"], kind: string): Set<string> {
  const s = new Set<string>()
  for (const y of syms) if (y.kind === kind) s.add(y.q.length > 0 ? y.q : y.name)
  return s
}

function countKind(syms: RawFile["symbols"], kind: string): number {
  let n = 0
  for (const y of syms) if (y.kind === kind) n++
  return n
}

/** Distinct top-level type names the parse tree actually declares in a file. */
async function treeTypeCount(file: string, wts: any): Promise<number> {
  const parser = new wts.Parser()
  parser.setLanguage(
    await wts.Language.load(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm")),
  )
  const tree = parser.parse(readFileSync(file, "utf-8"))
  const names = new Set<string>()
  const rec = (n: any): void => {
    if (n.type === "class_definition" || n.type === "mixin_declaration" || n.type === "enum_declaration") {
      const c = n.childForFieldName("name")
      if (c) names.add(c.text)
    }
    for (let i = 0; i < n.namedChildCount; i++) rec(n.namedChild(i))
  }
  rec(tree.rootNode)
  parser.delete()
  return names.size
}

async function main(): Promise<void> {
  const sample = dartSample()
  const raw = readRaw(samplePaths(sample).raw)
  const byFile = new Map<string, RawFile>()
  for (const r of raw) byFile.set(r.f, r)

  console.log(`constructor owner-identity — ${raw.length} collected records`)
  console.log("")

  const filesWithCtor = [...byFile.values()].filter((r) => countKind(r.symbols, "constructor") > 0)
  const totalCtors = filesWithCtor.reduce((a, r) => a + countKind(r.symbols, "constructor"), 0)
  const totalCtorOwners = filesWithCtor.reduce((a, r) => a + ownerSet(r.symbols, "constructor").size, 0)
  console.log(`files declaring >=1 constructor: ${filesWithCtor.length} of ${raw.length}`)
  console.log(`constructor declarations:        ${totalCtors}`)
  console.log(`DISTINCT owner qnames among them: ${totalCtorOwners}`)
  console.log(
    `declarations sharing a qname:     ${totalCtors - totalCtorOwners} (${(
      (100 * (totalCtors - totalCtorOwners)) / totalCtors
    ).toFixed(1)}%)`,
  )
  console.log("")

  // Per-file: the worst offenders, ranked by declarations sharing one qname.
  const rows: { f: string; a: Agg; worst: { q: string; n: number } }[] = []
  for (const r of filesWithCtor) {
    const perQ = new Map<string, number>()
    for (const s of r.symbols) {
      if (s.kind !== "constructor") continue
      const k = s.q.length > 0 ? s.q : s.name
      perQ.set(k, (perQ.get(k) ?? 0) + 1)
    }
    let worst = { q: "", n: 0 }
    for (const [q, n] of perQ) if (n > worst.n) worst = { q, n }
    const a: Agg = {
      ctors: countKind(r.symbols, "constructor"),
      ctorOwners: ownerSet(r.symbols, "constructor").size,
      methods: countKind(r.symbols, "method"),
      methodOwners: ownerSet(r.symbols, "method").size,
      props: countKind(r.symbols, "property"),
      propOwners: ownerSet(r.symbols, "property").size,
    }
    rows.push({ f: r.f, a, worst })
  }
  rows.sort((x, y) => y.worst.n - x.worst.n || y.a.ctors - x.a.ctors)

  console.log("Worst 20 files by declarations sharing ONE constructor qname:")
  console.log("  shared  ctors  owners   methods/owners  props/owners  file")
  console.log("  " + "-".repeat(112))
  for (const { f, a, worst } of rows.slice(0, 20)) {
    const short = shortPath(f)
    console.log(
      `  ${String(worst.n).padStart(5)}  ${String(a.ctors).padStart(6)}  ${String(a.ctorOwners).padStart(6)}   ` +
        `${String(a.methods).padStart(6)}/${String(a.methodOwners).padEnd(6)}  ${String(a.props).padStart(5)}/${String(a.propOwners).padEnd(6)}  ${short}`,
    )
  }
  console.log("")

  const collapsed = rows.filter((r) => r.worst.n > 1)
  console.log(
    `files where >=2 constructors share one qname: ${collapsed.length} of ${filesWithCtor.length} (${(
      (100 * collapsed.length) / filesWithCtor.length
    ).toFixed(1)}%)`,
  )
  console.log(
    `declarations involved: ${collapsed.reduce((a, r) => a + r.worst.n, 0)} of ${totalCtors}`,
  )
  console.log("")

  // Control: does the parse tree declare more types than the analyzer published?
  const wts = await import("web-tree-sitter")
  const WSP = wts.Parser ?? (wts as any).default
  await WSP.init({
    locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const probes = rows.slice(0, 20)
  console.log("CONTROL — parse tree's distinct type declarations vs analyzer's distinct constructor owners:")
  console.log("  treeTypes  anlzOwners  ctors  file")
  console.log("  " + "-".repeat(112))
  let treeTotal = 0
  let anlzTotal = 0
  for (const { f, a } of probes) {
    const t = await treeTypeCount(f, wts)
    treeTotal += t
    anlzTotal += a.ctorOwners
    const short = shortPath(f)
    console.log(`  ${String(t).padStart(9)}  ${String(a.ctorOwners).padStart(11)}  ${String(a.ctors).padStart(6)}  ${short}`)
  }
  console.log(`  ${String(treeTotal).padStart(9)}  ${String(anlzTotal).padStart(11)}  (sum over the 20 probe files)`)
  console.log("")
  console.log("treeTypes > analyzer owners means the analyzer publishes FEWER distinct owners than the file")
  console.log("declares: owner identity is lost inside the analyzer, and no scope model recovers it.")
}

main()