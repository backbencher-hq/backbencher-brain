/**
 * TYPE-ONLY IMPORT/EXPORT COVERAGE — does `import type` produce an edge?
 *
 * ## The question
 *
 * `declared-construct-probe.ts` measures 655 `import type` sites across 279 of
 * 400 admitted element-plus files, against 1,845 `import_statement` nodes
 * total. TypeScript treats the type-only form as a distinct construct: it is
 * erased at compile time, it cannot be used as a value, and it is how a project
 * avoids a runtime cycle. So "does the analyzer read it" is a real question and
 * not a formality — 35% of the import statements on this corpus are type-only.
 *
 * Three outcomes are possible and only one of them is a defect:
 *
 *   A. Every type-only specifier produces an `imports` edge. The construct is
 *      read; the erasure is invisible, which is a policy choice, not a gap.
 *   B. Some specifiers produce no edge at all. That is a GAP: the construct is
 *      in the language, the analyzer is not reading it, and 655 sites is not a
 *      rounding error.
 *   C. An edge exists but is indistinguishable from the value form, so the graph
 *      cannot tell a type edge from a runtime edge. That is a labelling
 *      question, and the answer lives in whether the edge carries anything
 *      about the `type` modifier.
 *
 * ## How the two sides are compared without a regex
 *
 * Left side, the CONSTRUCT: a walk for `import_statement` nodes carrying an
 * anonymous `type` child, then `named_imports` -> `import_specifier` -> its
 * `name` field, paired with the statement's `source` field. Both are grammar
 * fields, not substrings.
 *
 * Right side, the EMISSION: `analyze()` on the same tree, then membership of the
 * pair in the analyzer's own edge set and in `res.imports[]`. Both channels are
 * checked, because ParseResult carries imports on a SEPARATE channel
 * (`src/ast/types.ts:206-216`) and an edge that exists only in `imports[]` is
 * invisible to a graph query that reads relationships.
 *
 * ## No regex
 *
 * Grammar node types and field reads only. `regex-free-check.ts` in this
 * directory classifies this file as an INSTRUMENT and counts its `regex` nodes.
 *
 * ## Population
 *
 * Derived by `readdirSync`, admitted count and examined count both printed.
 *
 * ## Usage
 *
 *   bun validation/m14/fixtures/typescript/type-only-import-coverage.ts [nfiles]
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { getParser } from "../../../../src/ast/engine"
import { RealTypeScriptAnalyzer } from "../../../../src/ast/real-typescript-analyzer"

const CORPUS_ROOT = process.env.BB_TS_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const CORPUS_DIR = process.env.BB_TS_REPO ?? "element-plus"
const NFILES = Number(process.argv[2] ?? process.env.NFILES ?? 400)
const DIR = join(CORPUS_ROOT, CORPUS_DIR)
const EXTS = [".ts", ".tsx", ".mts", ".cts"]
const SIGNALS = ["function ", "export ", "class ", "const "]
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".pnpm-store", "coverage"])
const MAX_BYTES = 400_000

// ── population, derived ─────────────────────────────────────────────────────
const files: string[] = []
let examined = 0
let noSignal = 0
let tooBig = 0
let wrongExt = 0
;(function walk(d: string) {
  let ents
  try {
    ents = readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of ents) {
    if (files.length >= NFILES) return
    const p = join(d, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p)
      continue
    }
    if (!EXTS.some((x) => e.name.endsWith(x))) {
      wrongExt++
      continue
    }
    examined++
    try {
      if (statSync(p).size > MAX_BYTES) {
        tooBig++
        continue
      }
      const s = readFileSync(p, "utf8")
      let has = false
      for (const sig of SIGNALS) {
        if (s.includes(sig)) {
          has = true
          break
        }
      }
      if (!has) {
        noSignal++
        continue
      }
      files.push(p)
    } catch {
      /* unreadable */
    }
  }
})(DIR)

const parser = await getParser("typescript")
const analyzer = new RealTypeScriptAnalyzer()

function hasChildOfType(n: any, type: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return true
  }
  return false
}

/** `(module, name)` for every specifier of an import_statement. The `type`
 *  modifier is an anonymous child of the statement; the names are `name` fields
 *  of `import_specifier` nodes under `named_imports`. */
function importSpecifiers(stmt: any): Array<{ module: string; name: string }> {
  const src = stmt.childForFieldName ? stmt.childForFieldName("source") : null
  const module = src ? String(src.text).slice(1, -1) : ""
  const out: Array<{ module: string; name: string }> = []
  const stack: any[] = [stmt]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "import_specifier") {
      const nameNode = n.childForFieldName ? n.childForFieldName("name") : null
      if (nameNode) out.push({ module, name: String(nameNode.text) })
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return out
}

type Counters = {
  typeOnlyStatements: number
  valueStatements: number
  typeOnlySpecifiers: number
  valueSpecifiers: number
  withRelEdge: number
  withImportsChannel: number
  withEither: number
  withNeither: number
  markedAsTypeOnly: number
}
const c: Counters = {
  typeOnlyStatements: 0, valueStatements: 0, typeOnlySpecifiers: 0, valueSpecifiers: 0,
  withRelEdge: 0, withImportsChannel: 0, withEither: 0, withNeither: 0, markedAsTypeOnly: 0,
}

const neitherExamples: string[] = []
const noMarkerExamples: string[] = []
let parsed = 0
let failed = 0

for (const f of files) {
  let src: string
  try {
    src = readFileSync(f, "utf8")
  } catch {
    failed++
    continue
  }
  let tree: any
  try {
    tree = await parser.parse(src, f)
    parsed++
  } catch {
    failed++
    continue
  }

  const typeOnly: Array<{ module: string; name: string }> = []
  const value: Array<{ module: string; name: string }> = []
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "import_statement") {
      const specs = importSpecifiers(n)
      if (hasChildOfType(n, "type")) {
        c.typeOnlyStatements++
        for (const s of specs) typeOnly.push(s)
      } else {
        c.valueStatements++
        for (const s of specs) value.push(s)
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) stack.push(ch)
    }
  }
  if (!typeOnly.length && !value.length) continue

  c.typeOnlySpecifiers += typeOnly.length
  c.valueSpecifiers += value.length

  const res = analyzer.analyze(tree.rootNode, src, f)
  const relPairs = new Set<string>()
  const relTargets = new Set<string>()
  let relMarked = false
  for (const r of res.relationships || []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    if (t !== "imports" && t !== "uses") continue
    const s = String(r.source ?? r.from ?? "")
    const g = String(r.target ?? r.to ?? "")
    relPairs.add(`${s}|${g}`)
    relTargets.add(g)
    const meta = r.metadata
    if (meta && (meta.isTypeOnly === true || meta.typeOnly === true || meta.importKind === "type" || meta.declarationKind === "type")) {
      relMarked = true
    }
  }
  const impPairs = new Set<string>()
  for (const im of (res as any).imports || []) {
    const s = String(im.source ?? im.module ?? im.from ?? "")
    const g = String(im.name ?? im.symbol ?? im.imported ?? "")
    impPairs.add(`${s}|${g}`)
  }
  if (relMarked) c.markedAsTypeOnly++

  // The emitted edge is `source = moduleLeafName()`, `target = "<module>:<name>"`
  // (real-typescript-analyzer.ts:5670). The FIRST version of this matcher
  // looked for `"<module>|<name>"` and a `module` substring, and therefore
  // reported 0 edges for 271 of 271 files -- including files whose VALUE
  // imports demonstrably produce edges. A module specifier may itself contain
  // `:` (`node:fs`) and `/`, so the target is matched by its SUFFIX after the
  // final colon, compared as a string. A matcher that cannot find an edge the
  // analyzer is known to emit is not measuring coverage.
  const judge = (list: Array<{ module: string; name: string }>, bucket: "type" | "value") => {
    let rel = 0
    let ch = 0
    for (const s of list) {
      const suffix = `:${s.name}`
      let inRel = false
      for (const k of relPairs) {
        if (k.endsWith(suffix) && (k.length > suffix.length ? k.includes(s.module) : true)) {
          inRel = true
          break
        }
      }
      let inCh = false
      for (const k of impPairs) {
        if (k.endsWith(suffix) && (k.length > suffix.length ? k.includes(s.module) : true)) {
          inCh = true
          break
        }
      }
      if (inRel) rel++
      if (inCh) ch++
      if (!inRel && !inCh && neitherExamples.length < 12) {
        neitherExamples.push(`${bucket}  ${s.module} : ${s.name}   ${f.replace(DIR + "/", "")}`)
      }
    }
    return { rel, ch }
  }

  const t = judge(typeOnly, "type")
  const v = judge(value, "value")
  if (typeOnly.length) {
    if (t.rel) c.withRelEdge++
    if (t.ch) c.withImportsChannel++
    if (t.rel || t.ch) c.withEither++
    else c.withNeither++
    if (t.rel && !relMarked && noMarkerExamples.length < 8) {
      noMarkerExamples.push(`${f.replace(DIR + "/", "")}  type-only import with an edge and no type-only marker`)
    }
  }
  void v
}

console.log(`TYPE-ONLY IMPORT COVERAGE — real-typescript-analyzer`)
console.log(`corpus            ${DIR}`)
console.log(`POPULATION        ${files.length} files admitted of ${examined} candidates examined`)
console.log(`                    rejected: ${noSignal} no code signal, ${tooBig} over ${MAX_BYTES} bytes, ${wrongExt} other extensions`)
console.log(`parsed            ${parsed}/${files.length} (${failed} failed)`)
console.log("")
console.log("CONSTRUCT (grammar fields, no text matching)")
console.log(`  import_statement carrying the \`type\` modifier   ${c.typeOnlyStatements}`)
console.log(`  import_statement without it                      ${c.valueStatements}`)
console.log(`  specifiers on type-only statements               ${c.typeOnlySpecifiers}`)
console.log(`  specifiers on value statements                   ${c.valueSpecifiers}`)
console.log("")
console.log("EMISSION, per FILE that has at least one type-only import")
console.log(`  files with >=1 type-only import                  ${c.withEither + c.withNeither}`)
console.log(`  ... an \`imports\` RELATIONSHIP edge for it       ${c.withRelEdge}`)
console.log(`  ... a row on res.imports[] for it                ${c.withImportsChannel}`)
console.log(`  ... at least one of the two channels             ${c.withEither}`)
console.log(`  ... NEITHER channel                               ${c.withNeither}`)
console.log(`  ... an edge carrying any type-only marker         ${c.markedAsTypeOnly}`)
console.log("")
if (neitherExamples.length) {
  console.log("specifiers with NO edge on either channel (up to 12)")
  for (const e of neitherExamples) console.log(`  ${e}`)
  console.log("")
}
if (noMarkerExamples.length) {
  console.log("type-only imports that DO have an edge but no type-only marker (up to 8)")
  for (const e of noMarkerExamples) console.log(`  ${e}`)
  console.log("")
}
console.log("READING: withEither == files-with-type-only-imports means the construct is READ.")
console.log("         withNeither > 0 is a GAP: sites in the language, no edge emitted.")
console.log("         markedAsTypeOnly == 0 with withEither > 0 means the edges exist but are")
console.log("         indistinguishable from value imports -- a labelling question (outcome C).")
