/**
 * M14 ONTOLOGY LANE — DART `references` construct probe.
 *
 * ## The question
 *
 * `references` is the one type this lane does not emit. Whether that is a GAP or a
 * RULED verdict is a question about the LANGUAGE, so it is asked with the two
 * instruments the workstream defines, never with a regex over source text:
 *
 *   A. GRAMMAR INVENTORY — enumerate every node type the pinned wasm actually
 *      produces across the sample. Answers "does the grammar have a shape that
 *      expresses this?" and is positive evidence of absence when it does not.
 *
 *   B. PARSE-TREE COUNT — count the construct on the tree. Dart is statically
 *      typed, so a type MENTION is expressible, and a mention cannot be faked by
 *      a string literal or a comment the way a text probe can be. This is the
 *      instrument that settles it.
 *
 * The probe reports, for every `type_identifier` on the tree, the PARENT node type
 * it sits under — so the position inventory is measured, not recalled — plus, for
 * the positions that carry a type mention, how many name a type the SAME FILE
 * declares. That last number is the ceiling for an edge whose two endpoints both
 * bind to real symbols with no project index at all.
 *
 * It also records the negation set: a type mention that is NOT a reference edge
 * under the rule the analyzer adopts (type parameters, the type argument of a
 * heritage clause, generic parameters, and the type identifier that IS the
 * declaration being defined).
 *
 * CLI:
 *   npx tsx validation/m14/fixtures/dart/type-position-probe.ts
 *   BB_DART_PER_REPO=40 BB_DART_REPOS=dart-http npx tsx .../type-position-probe.ts
 *   BB_DART_OUT=/tmp/probe.json npx tsx .../type-position-probe.ts
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const REPOS = (process.env.BB_DART_REPOS ?? "proxicall,dart-http,riverpod,flutter-packages,dart-sdk").split(",").filter(Boolean)
const PER_REPO = Number(process.env.BB_DART_PER_REPO ?? 200)
const OUT = process.env.BB_DART_OUT ?? ""

// ---------------------------------------------------------------- sample
const files: { repo: string; rel: string; abs: string; text: string }[] = []
const repoStats: any[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z", "--", "*.dart"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch {
    repoStats.push({ repo, tracked: 0, sampled: 0, note: "not a git repo or no .dart tracked" })
    continue
  }
  tracked.sort()
  const stride = Math.max(1, Math.floor(tracked.length / PER_REPO))
  const picked: string[] = []
  for (let i = 0; i < tracked.length && picked.length < PER_REPO; i += stride) {
    const abs = path.join(dir, tracked[i])
    let text: string
    try {
      if (statSync(abs).size > 1024 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    picked.push(tracked[i])
    files.push({ repo, rel: tracked[i], abs, text })
  }
  repoStats.push({ repo, tracked: tracked.length, stride, sampled: picked.length })
}

// ---------------------------------------------------------------- parser
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-dart.wasm"))))

// ---------------------------------------------------------------- counters
const nodeTypes = new Map<string, number>()
const typeIdParents = new Map<string, number>()
const positionCounts = new Map<string, number>()
const declaredNames = new Map<string, number>()
let typeMentions = 0
let mentionsInFile = 0
let mentionsResolvableToType = 0
const filesWithMentions: string[] = []
const positionExamples = new Map<string, string[]>()
const nameExamples = new Map<string, { count: number; inFile: number }>()

/** The declaration containers whose NAMES a type mention can bind to. */
const TYPE_DECL_NODES = new Set(["class_definition", "mixin_declaration", "extension_declaration", "extension_type_declaration", "enum_declaration", "type_alias"])
/** The heritage positions: they already publish extends/implements/uses edges, so a
 *  mention there would DOUBLE-COUNT the same fact under a second label. */
const HERITAGE_PARENTS = new Set(["superclass", "interfaces", "mixins"])
/** `type_parameter` is a DECLARATION of a type variable (`class Box<T>`), not a
 *  mention of one. `formal_parameter`/`function_type` positions are counted
 *  separately because a parameter's type is a mention while the parameter's own
 *  name is a declaration. */
const DECLARATION_SELF = new Set(["type_parameter"])

const bump = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)

for (const f of files) {
  let tree: any
  try { tree = parser.parse(f.text) } catch { continue }
  if (!tree) continue
  const root = tree.rootNode

  // pass 1 — inventory every node type (instrument A) and the file's declared names
  const typeDecls: string[] = []
  const walk = (n: any): void => {
    bump(nodeTypes, n.type)
    if (TYPE_DECL_NODES.has(n.type)) {
      const nm = n.childForFieldName?.("name")?.text ?? (n.type === "mixin_declaration" ? null : null)
      if (nm) typeDecls.push(nm)
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c)
    }
  }
  walk(root)
  const declaredSet = new Set(typeDecls)

  // pass 2 — every type mention, by parent position
  const perFile = (n: any): void => {
    if (n.type === "type_identifier") {
      const p = n.parent
      const pt = p ? p.type : "<root>"
      bump(typeIdParents, pt)
      if (!HERITAGE_PARENTS.has(pt) && !DECLARATION_SELF.has(pt)) {
        typeMentions++
        bump(positionCounts, pt)
        const key = n.text
        const rec = nameExamples.get(key) ?? { count: 0, inFile: 0 }
        rec.count++
        if (declaredSet.has(key)) { rec.inFile++; mentionsResolvableToType++ }
        nameExamples.set(key, rec)
        if (declaredSet.has(key)) mentionsInFile++
        const ex = positionExamples.get(pt)
        if (ex && ex.length < 3) ex.push(`${f.repo}/${f.rel}: ${n.text}`)
        else if (!ex) positionExamples.set(pt, [`${f.repo}/${f.rel}: ${n.text}`])
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) perFile(c)
    }
  }
  perFile(root)
  if (typeMentions > 0) filesWithMentions.push(`${f.repo}/${f.rel}`)
}

const top = (m: Map<string, number>, n = 40) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
const resolvable = [...nameExamples].filter(([, v]) => v.inFile > 0).sort((a, b) => b[1].inFile - a[1].inFile)

const out = {
  corpusRoot: CR,
  sampling: { method: "deterministic stride over git ls-files '*.dart', sorted, per repo; files >1MB skipped (pool-worker routes those to structural extraction)", perRepo: PER_REPO, repos: repoStats },
  filesParsed: files.length,
  distinctNodeTypes: nodeTypes.size,
  instrumentA_nodeTypes: top(nodeTypes, 200),
  instrumentB_typeMentions: {
    totalExcludingHeritageAndTypeParameters: typeMentions,
    filesWithMentions: filesWithMentions.length,
    byParentPosition: top(positionCounts, 40),
    positionExamples: Object.fromEntries(positionExamples),
    bindingToATypeDeclaredInTheSameFile: {
      mentions: mentionsResolvableToType,
      rateOfAllMentions: typeMentions === 0 ? "n/a" : `${((100 * mentionsResolvableToType) / typeMentions).toFixed(2)}%`,
      distinctTypeNames: resolvable.length,
      topNames: resolvable.slice(0, 40).map(([k, v]) => `${k}=${v.inFile}`),
    },
  },
  typeIdentifierParentsIncludingHeritage: top(typeIdParents, 40),
}

const line = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`dart type-position probe — ${files.length} files, ${nodeTypes.size} distinct node types (instrument A)`)
console.log(`type mentions outside heritage/type-parameter: ${typeMentions} across ${filesWithMentions.length} files (instrument B)`)
console.log(`  of those, ${mentionsResolvableToType} name a type declared in the SAME file (${out.instrumentB_typeMentions.bindingToATypeDeclaredInTheSameFile.rateOfAllMentions}) over ${resolvable.length} distinct names\n`)
console.log(`${line("parent position", 34)}mentions`)
console.log("-".repeat(60))
for (const [k, v] of top(positionCounts, 30)) console.log(`${line(k, 34)}${v}`)
console.log(`\ntop type names bound in-file: ${resolvable.slice(0, 25).map(([k, v]) => `${k}=${v.inFile}`).join(", ")}`)

if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
