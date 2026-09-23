// groovy declared-type references: the `scoped_type_identifier` axis.
//
// The lane's declared-reference collectors (`collectTypeNames` and the two
// type-clause walks) select with `type === "type_identifier"` or
// `endsWith("type")` / `endsWith("_type")`. A QUALIFIED type is a
// `scoped_type_identifier`, which ends in "identifier" — so it matched NEITHER
// and the qualified half of every declared-type position was absent from the
// type-usage graph, while the lane's heritage path, object-creation type node,
// record-component extractor and `baseTypeName` doctrine had all accepted it for
// years.
//
// This instrument is the arbiter, and it is deliberately independent of the
// analyzer: the POPULATION is read from the parse tree (every declared position
// whose written type node is, or contains, a scoped type), and the CLAIM is read
// from the analyzer's output. Three verdicts per written name:
//
//   present   — the dotted name is published as a reference target
//   refused   — the written text is NOT a plain dotted name (grammar recovery
//               welded it across statements: an `import static X.*` whose node
//               also swallows the next import line, ERROR node included). The
//               honest verdict for this shape is NO EDGE, so it is counted
//               apart from `lost` — publishing its text would name a string
//               that appears nowhere in the source as a type.
//   lost      — nothing published for a well-formed name (the pre-fix state)
//   segmented — a QUALIFIER segment or the LEAF is published as a separate type
//               (the descent defect: `java.util.Map.Entry` -> java, util, Map,
//               Entry; `Outer.Criterion` -> Outer, Criterion). The leaf is only
//               counted when the file never writes it bare, so a legitimately
//               written `Criterion` elsewhere in the same file is not a finding.
//
// Corpus: BOTH groovy corpora the harness routes (grails-core, geb), fixed
// deterministic stride off a sorted walk — the same file set every run, so two
// runs of this script (or runs at two commits) are comparable.
import * as fs from "fs"
import * as path from "path"
import { RealGroovyAnalyzer } from "../../src/ast/real-groovy-analyzer"

const SKIP_DIR = new Set(["node_modules", ".git", "build", "out", "target", ".gradle", "generated"])
const CORPORA = ["grails-core", "geb"]
const SAMPLE_PER_CORPUS = 400
const TYPE_POSITIONS = new Set(["declared_type", "return_type", "cast_type", "throws_type"])

function walk(dir: string, out: string[] = [], cap = 60000): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (out.length >= cap) return out
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue
      walk(p, out, cap)
    } else if (e.isFile() && e.name.endsWith(".groovy")) out.push(p)
  }
  return out
}

/** Type node the two walks would select as a clause root. */
function isTypeRoot(type: string): boolean {
  return type.endsWith("type") || type === "type_identifier" || type === "scoped_type_identifier"
}

function scopedNamesIn(n: any, acc: string[]): void {
  if (n.type === "scoped_type_identifier") {
    acc.push(n.text)
    return
  }
  if (n.type === "type_identifier") return
  for (let i = 0; i < n.namedChildCount; i++) scopedNamesIn(n.namedChild(i)!, acc)
}

/** Every scoped type written in a declared position, with the declaration node kind. */
function writtenQualified(root: any): { name: string; kind: string }[] {
  const out: { name: string; kind: string }[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    const isClause =
      n.type === "field_declaration" ||
      n.type === "formal_parameter" ||
      n.type === "local_variable_declaration" ||
      n.type === "method_declaration" ||
      n.type === "constructor_declaration" ||
      n.type === "catch_formal_parameter"
    const isAsCast = n.type === "binary_expression" && n.childForFieldName?.("operator")?.text === "as"
    if (isClause) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)!
        if (!isTypeRoot(c.type)) continue
        const found: string[] = []
        scopedNamesIn(c, found)
        for (const name of found) out.push({ name, kind: c.type === "scoped_type_identifier" ? n.type : `generic_type(${n.type})` })
      }
    } else if (isAsCast) {
      const t = n.childForFieldName?.("type")
      if (t) {
        const found: string[] = []
        scopedNamesIn(t, found)
        for (const name of found) out.push({ name, kind: "as_cast" })
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!)
  }
  return out
}

/** Bare (unqualified) type identifiers written in a declared position. */
function writtenBare(root: any): Set<string> {
  const out = new Set<string>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()!
    const isClause =
      n.type === "field_declaration" ||
      n.type === "formal_parameter" ||
      n.type === "local_variable_declaration" ||
      n.type === "method_declaration" ||
      n.type === "constructor_declaration" ||
      n.type === "catch_formal_parameter"
    const isAsCast = n.type === "binary_expression" && n.childForFieldName?.("operator")?.text === "as"
    if (isClause || isAsCast) {
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)!
        if (!isTypeRoot(c.type)) continue
        const idents: any[] = []
        const st = [c]
        while (st.length) {
          const m = st.pop()!
          if (m.type === "type_identifier") { idents.push(m); continue }
          for (let j = 0; j < m.namedChildCount; j++) st.push(m.namedChild(j)!)
        }
        for (const id of idents) out.add(id.text)
      }
    }
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i)!)
  }
  return out
}

// BB_CENSUS_DUMP=<path>: write every declared-position edge as
// `corpus/rel<TAB>source<TAB>target<TAB>relationshipType<TAB>line`, so a run at
// one commit can be diffed against a run at another and EVERY added/removed
// edge reconciled by class rather than by a net count (a net count is the one
// number that can hide an equal-and-opposite pair of defects — the removed
// segment fabrications and the added dotted names move in opposite directions).
const DUMP = process.env.BB_CENSUS_DUMP ?? ""
const dumpLines: string[] = []

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
  const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
  const parser = new P()
  parser.setLanguage(lang)
  const az = new RealGroovyAnalyzer()

  let filesScanned = 0
  let typeEdges = 0
  let writtenTotal = 0
  let present = 0
  let lost = 0
  let refused = 0
  const refusedSamples: string[] = []
  let segmentedQualifier = 0
  let segmentedLeaf = 0
  const byKind: Record<string, { written: number; lost: number }> = {}
  const lostSamples: string[] = []
  const segSamples: string[] = []
  const dotTargets = new Set<string>()

  for (const corpus of CORPORA) {
    const root = path.resolve("$HOME/fixtures/repositories", corpus)
    const files = walk(root).sort()
    if (files.length === 0) {
      process.stdout.write(`  (corpus ${corpus}: not present)\n`)
      continue
    }
    const stride = Math.max(1, Math.floor(files.length / SAMPLE_PER_CORPUS))
    const picked: string[] = []
    for (let i = 0; i < files.length && picked.length < SAMPLE_PER_CORPUS; i += stride) picked.push(files[i])
    process.stdout.write(`corpus ${corpus}: ${picked.length} of ${files.length} groovy files\n`)

    for (const file of picked) {
      let source: string
      try {
        source = fs.readFileSync(file, "utf8")
      } catch {
        continue
      }
      let tree: any
      let res: any
      try {
        tree = parser.parse(source)
        res = az.analyze(tree.rootNode, source, file)
      } catch {
        continue
      }
      filesScanned++
      const rel = file.slice(root.length + 1)
      const rels = (res.relationships ?? []).filter((r: any) => String(r.type) === "references")
      const declared = rels.filter((r: any) => TYPE_POSITIONS.has(String((r.metadata ?? {}).relationshipType)))
      typeEdges += declared.length
      const targets = new Set(declared.map((r: any) => String(r.target)))
      for (const t of targets) if (t.indexOf(".") !== -1) dotTargets.add(t)
      if (DUMP) {
        for (const r of declared) {
          dumpLines.push([`${corpus}/${rel}`, String(r.source ?? r.from ?? ""), String(r.target ?? ""), String((r.metadata ?? {}).relationshipType ?? ""), String(r.line_number ?? "")].join("\t"))
        }
      }

      const written = writtenQualified(tree.rootNode)
      const bare = writtenBare(tree.rootNode)
      const seen = new Set<string>()
      for (const w of written) {
        if (seen.has(`${w.name}|${w.kind}`)) continue
        seen.add(`${w.name}|${w.kind}`)
        writtenTotal++
        const bucket = (byKind[w.kind] ??= { written: 0, lost: 0 })
        bucket.written++
        if (!/^[A-Za-z0-9_$.]+$/.test(w.name)) {
          refused++
          if (refusedSamples.length < 8) refusedSamples.push(`${JSON.stringify(w.name)} in ${w.kind} — malformed node text, correctly NOT published  <- ${corpus}/${rel}`)
          continue
        }
        if (targets.has(w.name)) {
          present++
          continue
        }
        lost++
        bucket.lost++
        if (lostSamples.length < 12) lostSamples.push(`${w.name} written in ${w.kind} — no edge  <- ${corpus}/${rel}`)
        const segs = w.name.split(".")
        for (const q of segs.slice(0, -1)) {
          if (targets.has(q)) {
            segmentedQualifier++
            if (segSamples.length < 12) segSamples.push(`QUALIFIER ${JSON.stringify(q)} of ${w.name} published as a type  <- ${corpus}/${rel}`)
          }
        }
        const leaf = segs[segs.length - 1]
        if (!bare.has(leaf) && targets.has(leaf)) {
          segmentedLeaf++
          if (segSamples.length < 12) segSamples.push(`LEAF ${JSON.stringify(leaf)} of ${w.name} published as a type  <- ${corpus}/${rel}`)
        }
      }
    }
  }

  process.stdout.write(`\nfiles scanned: ${filesScanned}\n`)
  process.stdout.write(`declared-position reference edges: ${typeEdges}\n`)
  process.stdout.write(`distinct dotted declared targets: ${dotTargets.size}\n`)
  process.stdout.write(`written qualified declared types: ${writtenTotal}\n`)
  process.stdout.write(`  present   (published under its full dotted name): ${present}\n`)
  process.stdout.write(`  refused   (malformed text — edge owed to nobody):  ${refused}\n`)
  process.stdout.write(`  lost      (no edge at all — the pre-fix state):   ${lost}\n`)
  process.stdout.write(`  segmented (a qualifier published as a type):      ${segmentedQualifier}\n`)
  process.stdout.write(`  segmented (the leaf published as a type):         ${segmentedLeaf}\n`)
  for (const [k, v] of Object.entries(byKind).sort()) {
    process.stdout.write(`    ${k}: written=${v.written} lost=${v.lost}\n`)
  }
  for (const s of refusedSamples) process.stdout.write(`    REFUSED ${s}\n`)
  for (const s of lostSamples) process.stdout.write(`    LOST ${s}\n`)
  for (const s of segSamples) process.stdout.write(`    SEG  ${s}\n`)
  if (DUMP) {
    dumpLines.sort()
    fs.writeFileSync(DUMP, dumpLines.join("\n") + "\n")
    process.stdout.write(`\ndumped ${dumpLines.length} declared-position edges -> ${DUMP}\n`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
