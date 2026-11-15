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
 * PERL GRAMMAR A/B — wired bytes vs a fresh build of 1.2.1 vs a fresh build of
 * 2.0.0, measured on the lane's corpora.
 *
 * The provenance question and the upgrade question are DIFFERENT questions and
 * are answered separately here:
 *
 *   PROVENANCE  the wired bytes' enumerable surface is compared against each
 *               release's own build. Identical idOrderDigest means the wired
 *               bytes ARE a build of that source (the registry's rule: two
 *               builds of one source agree even when their bytes differ, so the
 *               digests are the fingerprint and the sha is the identity).
 *
 *   UPGRADE     2.0.0 adds exactly one declared type, `parenthesized_expression`.
 *               That is not cosmetic: the 1.2.1 tree gives ONE field name to
 *               SEVERAL children of a parenthesised construct, so
 *               `childForFieldName("right"/"arguments"/"invocant")` returns the
 *               empty `(` marker and the payload is unreachable (measured on
 *               mojo+Moose+DBI+plack: 1,593 + 1,058 + 168 sites). This measures
 *               whether 2.0.0 actually closes that, plus the parse-damage and
 *               tree-identity deltas the upgrade would cost.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CR = process.env.BB_PERL_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const sha256 = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex")

const BUILDS: Record<string, string> = {
  wired: path.join(ROOT, "wasm/tree-sitter-perl.wasm"),
  "fresh-1.2.1": "/tmp/perl-grammar/v1.2.1/tree-sitter-perl.wasm",
  "fresh-2.0.0": "/tmp/perl-grammar/v2.0.0/tree-sitter-perl.wasm",
}

function surfaceOf(language: any) {
  const ids: string[] = []
  const named = new Set<string>()
  for (let i = 0; i < language.nodeTypeCount; i++) {
    const n = language.nodeTypeForId(i)
    if (!n) continue
    ids.push(n)
    if (language.nodeTypeIsNamed(i)) named.add(n)
  }
  const fields: string[] = []
  for (let i = 1; i <= language.fieldCount; i++) {
    const f = language.fieldNameForId(i)
    if (f) fields.push(f)
  }
  return {
    ids: ids.length,
    uniqueNames: new Set(ids).size,
    namedUnique: named.size,
    fieldCount: fields.length,
    idOrderDigest: sha256(ids.join("\n")),
    typeSetDigest: sha256([...new Set(ids)].sort().join("\n")),
    fieldSetDigest: sha256([...new Set(fields)].sort().join("\n")),
    named: [...named].sort(),
    types: new Set(ids),
  }
}

// ---- 1. provenance: surface identity -----------------------------------
const surfaces: Record<string, any> = {}
const languages: Record<string, any> = {}
for (const [name, file] of Object.entries(BUILDS)) {
  if (!fs.existsSync(file)) {
    console.error(`missing build: ${file}`)
    continue
  }
  const language = await Language.load(fs.readFileSync(file))
  languages[name] = language
  surfaces[name] = surfaceOf(language)
  surfaces[name].sha256 = sha256(fs.readFileSync(file))
  surfaces[name].bytes = fs.statSync(file).size
  delete surfaces[name].named
  delete surfaces[name].types
}
console.log("=== SURFACES ===")
console.log(JSON.stringify(surfaces, null, 2))
const wiredS = surfaces.wired
for (const name of Object.keys(surfaces)) {
  if (name === "wired") continue
  const s = surfaces[name]
  console.log(
    `  wired vs ${name}: idOrderDigest ${s.idOrderDigest === wiredS.idOrderDigest ? "MATCH" : "DIFFER"} | ` +
      `typeSet ${s.typeSetDigest === wiredS.typeSetDigest ? "MATCH" : "DIFFER"} | fieldSet ${s.fieldSetDigest === wiredS.fieldSetDigest ? "MATCH" : "DIFFER"} | ` +
      `bytes ${s.sha256 === wiredS.sha256 ? "IDENTICAL" : "differ"}`,
  )
}

// ---------------------------------------------------------------------------
// PHASES. web-tree-sitter's wasm heap is fixed and one module dies after
// ~19-31 parser allocations (the constraint script/m14/differential.ts works
// around with per-batch child processes). Every phase that needs a parser
// therefore runs in its OWN process, selected by --phase, and the results are
// merged by the caller. `--phase all` is the merge-and-print step.
// ---------------------------------------------------------------------------
const PHASE = (() => {
  const i = process.argv.indexOf("--phase")
  return i >= 0 ? process.argv[i + 1] : "surface"
})()
const GRAMMAR = (() => {
  const i = process.argv.indexOf("--grammar")
  return i >= 0 ? process.argv[i + 1] : "wired"
})()
// Same argv trap as forward-compat.mts: `--grammar <value>` does not start with
// "-", so it was being read as a corpus name.
const argvRaw = process.argv.slice(2)
const corporaArgs: string[] = []
for (let i = 0; i < argvRaw.length; i++) {
  const a = argvRaw[i]
  if (a.startsWith("-")) { if (a === "--grammar" || a === "--phase") i++; continue }
  if (["surface", "fields", "damage", "identity", "all"].includes(a)) continue
  corporaArgs.push(a)
}

const CORPORA: Record<string, string> = {
  mojo: path.join(CR, "mojo"),
  plack: path.join(CR, "plack"),
  Moose: path.join(CR, "cpan/Moose-2.4000"),
  Moo: path.join(CR, "cpan/Moo-2.005005"),
  Catalyst: path.join(CR, "cpan/Catalyst-Runtime-5.90132"),
  DBI: path.join(CR, "cpan/DBI-1.654"),
  perl5: path.join(CR, "perl5"),
}
function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of es) {
    if (e.name === ".git" || e.name === "build" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    // production's set (src/ast/language-detection.ts:42 maps pl|pm|t|perl only;
    // `PL` is not a perl extension to the engine). This read `|PL`, so the A/B
    // was measured over 101 files the product never routes.
    else if (/\.(pm|pl|t)$/.test(e.name)) out.push(p)
  }
  return out
}
const corpusNames = corporaArgs.length ? corporaArgs : Object.keys(CORPORA)
const fileLists: Record<string, string[]> = {}
for (const n of corpusNames) {
  const d = CORPORA[n]
  if (d && fs.existsSync(d)) fileLists[n] = walk(d).sort()
}
const allFiles = Object.values(fileLists).flat()

const language = await Language.load(fs.readFileSync(BUILDS[GRAMMAR]))
const parser = new ParserClass()
parser.setLanguage(language)

/** Sites where a payload field's FIRST child is an empty bracket marker, so
 *  `childForFieldName(field)` returns a childless node and the real payload is
 *  unreachable through the single-child API. */
function multiChildFieldSites() {
  const perField = new Map<string, number>()
  let filesWithAny = 0
  for (const f of allFiles) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(src)
    } catch {
      continue
    }
    let hit = false
    const stack: any[] = [tree.rootNode]
    while (stack.length) {
      const n = stack.pop()
      const seen = new Map<string, number>()
      for (let i = 0; i < n.childCount; i++) {
        const f = n.fieldNameForChild(i)
        if (!f) continue
        const c = (seen.get(f) ?? 0) + 1
        seen.set(f, c)
        if (c > 1) {
          const child = n.child(i)
          if (child && child.childCount === 0) {
            perField.set(`${n.type}.${f}`, (perField.get(`${n.type}.${f}`) ?? 0) + 1)
            hit = true
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    if (hit) filesWithAny++
  }
  return { filesWithAny, perField: Object.fromEntries([...perField].sort((a, b) => b[1] - a[1])) }
}

function damage() {
  let damaged = 0
  let errorNodes = 0
  for (const f of allFiles) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let tree: any
    try {
      tree = parser.parse(src)
    } catch {
      damaged++
      continue
    }
    if (tree.rootNode.hasError) {
      damaged++
      let n = 0
      const st: any[] = [tree.rootNode]
      while (st.length) {
        const x = st.pop()
        if (x.type === "ERROR" || x.isMissing) n++
        for (let i = 0; i < x.childCount; i++) {
          const c = x.child(i)
          if (c) st.push(c)
        }
      }
      errorNodes += n
    }
  }
  return { files: allFiles.length, damaged, errorNodes, damagedPct: +((damaged / allFiles.length) * 100).toFixed(3) }
}

/** Structural tree fingerprint (node types only, no offsets). */
function shape(n: any, out: string[] = []): string[] {
  out.push(n.type)
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c) shape(c, out)
  }
  return out
}
async function identity() {
  const other = new ParserClass()
  const otherFile = BUILDS[GRAMMAR === "wired" ? "fresh-2.0.0" : "wired"]
  other.setLanguage(await Language.load(fs.readFileSync(otherFile)))
  let same = 0
  let differ = 0
  const diffExamples: string[] = []
  for (const f of allFiles) {
    let src: string
    try {
      src = fs.readFileSync(f, "utf8")
    } catch {
      continue
    }
    let ta: any
    let tb: any
    try {
      ta = parser.parse(src)
      tb = other.parse(src)
    } catch {
      continue
    }
    if (shape(ta.rootNode).join(" ") === shape(tb.rootNode).join(" ")) same++
    else {
      differ++
      if (diffExamples.length < 10) diffExamples.push(path.relative(CR, f))
    }
  }
  return { against: path.basename(otherFile), same, differ, total: same + differ, diffExamples }
}

const result: any = { phase: PHASE, grammar: GRAMMAR, files: allFiles.length, corpora: Object.fromEntries(Object.entries(fileLists).map(([k, v]) => [k, v.length])) }
if (PHASE === "fields") result.multiChildFieldSites = multiChildFieldSites()
if (PHASE === "damage") result.damage = damage()
if (PHASE === "identity") result.identity = await identity()
console.log(JSON.stringify(result))
