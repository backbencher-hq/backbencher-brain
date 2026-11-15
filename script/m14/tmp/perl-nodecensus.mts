// M14.6 perl lane instrument. Re-runnable by the next reader, which is the point
// of tracking it here (reviews/LANE-AUDIT-FORMULA.md, evidence-integrity rule 4).
//
// Paths: REPO is derived from this file's own location, so the instrument travels
// with the repo. The corpora are NOT in the repo -- they are large upstream
// checkouts -- so point BB_PERL_CORPUS at them. Everything written lands in
// BB_PERL_OUT (default /tmp), never inside the repo.
const REPO = path.resolve(import.meta.dir, "..", "..", "..")
const CORPUS = process.env.BB_PERL_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const OUTDIR = process.env.BB_PERL_OUT ?? "/tmp"
/**
 * F8 NODE-TYPE CENSUS — every node type the Perl corpora actually contain,
 * with occurrence counts and total node volume, plus the analyzer's own
 * referenced type literals. The gap between the two is the blind spot.
 *
 * usage: tsx nodecensus.mts            # all corpora
 *        tsx nodecensus.mts mojo Moose # subset
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CORPUS_ROOT = process.env.BB_PERL_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const language: any = await Language.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-perl.wasm")))
const parser = new ParserClass()
parser.setLanguage(language)

const C: Record<string, { dir: string; exts: string[] }> = {
  mojo: { dir: path.join(CORPUS_ROOT, "mojo"), exts: ["pm", "pl", "t"] },
  plack: { dir: path.join(CORPUS_ROOT, "plack"), exts: ["pm", "pl", "t"] },
  perl5: { dir: path.join(CORPUS_ROOT, "perl5"), exts: ["pm", "pl", "PL", "t"] },
  Moose: { dir: path.join(CORPUS_ROOT, "cpan/Moose-2.4000"), exts: ["pm", "pl", "t", "PL"] },
  Moo: { dir: path.join(CORPUS_ROOT, "cpan/Moo-2.005005"), exts: ["pm", "pl", "t"] },
  Catalyst: { dir: path.join(CORPUS_ROOT, "cpan/Catalyst-Runtime-5.90132"), exts: ["pm", "pl", "t"] },
  DBI: { dir: path.join(CORPUS_ROOT, "cpan/DBI-1.654"), exts: ["pm", "pl", "t"] },
}

function walk(dir: string, exts: string[], out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out, depth + 1)
    else if (exts.includes(e.name.split(".").pop()!)) out.push(p)
  }
  return out
}

const names = process.argv.slice(2).filter((a) => !a.startsWith("-"))
const targets = names.length ? names : Object.keys(C)

const counts = new Map<string, number>()
const fieldPairs = new Map<string, number>()
const perCorpus = new Map<string, Set<string>>()
let totalNodes = 0
let totalFiles = 0

for (const name of targets) {
  const cfg = C[name]
  if (!fs.existsSync(cfg.dir)) continue
  perCorpus.set(name, new Set())
  for (const f of walk(cfg.dir, cfg.exts).sort()) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    totalFiles++
    let tree: any
    try {
      tree = parser.parse(src)
    } catch {
      continue
    }
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      totalNodes++
      counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
      perCorpus.get(name)!.add(n.type)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (!c) continue
        if (n.isNamed && c.isNamed) {
          const fld = n.fieldNameForNamedChild(i)
          if (fld) {
            const k = `${n.type} .${fld} -> ${c.type}`
            fieldPairs.set(k, (fieldPairs.get(k) ?? 0) + 1)
          }
        }
        stack.push(c)
      }
    }
  }
  console.error(`${name}: done`)
}

// Grammar-declared table for the "declared but never seen" direction.
const declaredTypes = new Set<string>()
for (let i = 0; i < language.nodeTypeCount; i++) {
  const n = language.nodeTypeForId(i)
  if (n) declaredTypes.add(n)
}
const declaredFields = new Set<string>()
for (let i = 1; i <= language.fieldCount; i++) {
  const f = language.fieldNameForId(i)
  if (f) declaredFields.add(f)
}

// The analyzer's own string literals compared against node types / fields.
const src = fs.readFileSync(path.join(ROOT, "src/ast/real-perl-analyzer.ts"), "utf8")
const literals = new Set<string>()
for (const m of src.matchAll(/"([a-z_][a-z0-9_]*)"/g)) literals.add(m[1])
for (const m of src.matchAll(/'([a-z_][a-z0-9_]*)'/g)) literals.add(m[1])
const literalNodeTypes = [...literals].filter((l) => declaredTypes.has(l))
const literalFields = [...literals].filter((l) => declaredFields.has(l))
const literalNeither = [...literals].filter((l) => !declaredTypes.has(l) && !declaredFields.has(l))

const out = {
  generatedAt: new Date().toISOString(),
  corpora: targets,
  files: totalFiles,
  totalNodes,
  distinctCorpusTypes: counts.size,
  corpusTypes: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1])),
  corpusFieldPairs: Object.fromEntries([...fieldPairs].sort((a, b) => b[1] - a[1])),
  grammarDeclaredTypes: declaredTypes.size,
  grammarDeclaredFields: [...declaredFields].sort(),
  analyzerLiteralsThatAreNodeTypes: literalNodeTypes.sort(),
  analyzerLiteralsThatAreFields: literalFields.sort(),
  analyzerLiteralsThatAreNeither: literalNeither.sort(),
  declaredButNeverSeenInCorpus: [...declaredTypes].filter((t) => !counts.has(t)).sort(),
}
fs.writeFileSync((process.env.BB_PERL_OUT ?? "/tmp") + "/perl-nodecensus.json", JSON.stringify(out, null, 2))
console.error(`\nfiles=${totalFiles} nodes=${totalNodes} distinctTypes=${counts.size}`)
console.error(`analyzer literals that ARE node types: ${literalNodeTypes.length}`)
console.error(`analyzer literals that ARE fields: ${literalFields.length}`)
console.error(`analyzer literals that are NEITHER: ${literalNeither.length} -> ${literalNeither.join(" ")}`)
