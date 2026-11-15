/**
 * CONSTRUCT PROBE — TypeScript constructs that EXPRESS A DEPENDENCY, and
 * whether the analyzer reads them.
 *
 * ## Why this file exists
 *
 * The ten relationship types are all emitted somewhere in this lane, so JOB 2
 * ("does the LANGUAGE have the construct?") has no missing TYPE to close. What
 * it can still have is a construct the language uses to say something the graph
 * should know, which no emitted type currently carries. Naming candidates is
 * cheap; measuring them is the job, and a construct measured at zero is a
 * RULED verdict with a number behind it while a construct measured at
 * non-zero is a GAP that has to be implemented.
 *
 * Candidates, and the type each would carry if read:
 *
 *   1. TRIPLE-SLASH DIRECTIVE  `/// <reference path="..." />`,
 *      `/// <reference types="..." />`, `/// <reference lib="..." />`.
 *      TypeScript's own dependency declaration: the pre-module way to say
 *      "this file needs that file". Would be an `imports` edge, or a `uses`
 *      edge onto a module-level symbol.
 *   2. AMBIENT MODULE DECLARATION  `declare module "some-package" { ... }`.
 *      Declares the shape of an EXTERNAL module the repo does not contain.
 *   3. IMPORT EQUALS  `import fs = require("fs")` — the TypeScript-specific
 *      alias form.
 *   4. TYPE-ONLY IMPORT/EXPORT  `import type { T }`, `export type { T }`.
 *      Distinct in the grammar from the value forms; if the analyzer drops the
 *      `type` modifier these are invisible edges.
 *
 * ## THE FIRST VERSION OF THIS PROBE REPORTED 0 FOR ALL SEVEN ROWS
 *
 * It was wrong on three of the four candidates, and each error was a node type
 * the grammar does not use:
 *
 *   looked for                        the grammar actually produces
 *   ---------------------------       -------------------------------------
 *   `import_alias`                    `import_require_clause` (a CHILD of
 *                                     `import_statement`, not a node type)
 *   `internal_module` with a string   `ambient_declaration` -> `module`, whose
 *                                     name is a `string` child. `internal_module`
 *                                     is the INTERNAL form (`declare module
 *                                     Foo {}`), which is a namespace, not a
 *                                     dependency on an outside package.
 *   the `type` modifier among         an ANONYMOUS `type` child of the
 *   NAMED children                    `import_statement` / `export_statement`
 *                                     ITSELF — not inside `import_clause`.
 *
 * A probe that looks for a node type the grammar never emits reports 0 forever,
 * and 0 is indistinguishable from a RULED verdict unless the probe is tested
 * against a construct that is KNOWN to be present. That is what the self-test
 * below is for, and it runs before every corpus measurement and exits non-zero
 * if it fails. `element-plus` contains `import type { InjectionKey, VNode }
 * from 'vue'` in `packages/components/cascader-panel/src/types.ts:1`; the first
 * version of this file reported 0 for `import type` over 400 files of that same
 * repository while a three-line text search found it.
 *
 * ## Why this is a tree walk and not a text scan
 *
 * All four are measurable on the tree, and two of them ONLY on the tree:
 *
 *   - `///` is a `comment` node in tree-sitter-typescript 0.23.2, so counting it
 *     means counting comment nodes whose text begins with `///`. A text scan
 *     cannot tell that from a `///` inside a string literal, and this workstream
 *     has been burned by exactly that twice (`extends` matching `class voice`
 *     inside a telnet IAC word list; `new Map(` inside a bash heredoc).
 *   - `import type` vs `import` is an anonymous `type` child on the statement,
 *     which is a different thing from the substring "import type".
 *
 * StartsWith and String.includes are the only text operations, both anchored at
 * position 0 on a node's own text. No pattern matching. `regex-free-check.ts` in
 * this directory is the check for that claim and classifies this file as an
 * INSTRUMENT because it imports the analyzer.
 *
 * ## Population
 *
 * Derived by `readdirSync` over the corpus directory, never a written-down file
 * list. The admitted count and the examined count are both printed, per the
 * standing rule in docs/M14-HONESTY-CONTRACT.md.
 *
 * ## Usage
 *
 *   bun validation/m14/fixtures/typescript/declared-construct-probe.ts [nfiles]
 *   BB_TS_REPO=vuejs bun validation/m14/fixtures/typescript/declared-construct-probe.ts 400
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

type Bucket = { files: Set<string>; sites: number; spellings: Map<string, number> }
function blank(): Bucket {
  return { files: new Set(), sites: 0, spellings: new Map() }
}
type BucketName =
  | "refPath" | "refTypes" | "refLib"
  | "ambientModule" | "importEquals" | "importType" | "exportType"

const B: Record<BucketName, Bucket> = {
  refPath: blank(), refTypes: blank(), refLib: blank(),
  ambientModule: blank(), importEquals: blank(), importType: blank(), exportType: blank(),
}

const parser = await getParser("typescript")

function bump(name: BucketName, file: string, spelling: string) {
  B[name].files.add(file)
  B[name].sites++
  B[name].spellings.set(spelling, (B[name].spellings.get(spelling) ?? 0) + 1)
}

/** Every child, named or anonymous. The `type` modifier of `import type` is an
 *  ANONYMOUS child of the statement, so a named-only walk cannot see it — that
 *  was the bug. */
function hasChildOfType(n: any, type: string): boolean {
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (c && c.type === type) return true
  }
  return false
}

/** A comment node whose text begins with `///`. Returns the directive kind, or
 *  "" when the node is an ordinary comment. */
function tripleSlashKind(n: any): "path" | "types" | "lib" | "" {
  const t = String(n.text ?? "")
  if (!t.startsWith("///")) return ""
  const rest = t.slice(3)
  if (!rest.includes("<reference")) return "lib"
  if (rest.includes("path=")) return "path"
  if (rest.includes("types=")) return "types"
  return "lib"
}

/** The string-named ambient module: `ambient_declaration` -> `module` whose name
 *  child is a `string`. An `internal_module` (`declare module Foo {}`) is a
 *  namespace and is deliberately NOT counted here. */
function ambientModuleName(n: any): string {
  if (n.type !== "ambient_declaration") return ""
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c || c.type !== "module") continue
    const name = c.childForFieldName ? c.childForFieldName("name") : null
    const t = name ? String(name.text) : ""
    if (t.startsWith('"') || t.startsWith("'")) return t
  }
  return ""
}

/** Walk every node of a tree once, folding the constructs into the buckets. */
function scan(root: any, file: string, refFiles: Set<string>) {
  const stack: any[] = [root]
  let importStatements = 0
  let exportStatements = 0
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    const t = n.type
    if (t === "comment") {
      const kind = tripleSlashKind(n)
      if (kind) {
        refFiles.add(file)
        const spell = String(n.text ?? "").slice(0, 60)
        if (kind === "path") bump("refPath", file, spell)
        else if (kind === "types") bump("refTypes", file, spell)
        else bump("refLib", file, spell)
      }
    } else if (t === "ambient_declaration") {
      const name = ambientModuleName(n)
      if (name) bump("ambientModule", file, name.slice(0, 60))
    } else if (t === "import_statement") {
      importStatements++
      if (hasChildOfType(n, "import_require_clause")) {
        bump("importEquals", file, String(n.text ?? "").slice(0, 60).split("\n")[0])
      }
      if (hasChildOfType(n, "type")) bump("importType", file, "import type")
    } else if (t === "export_statement") {
      exportStatements++
      if (hasChildOfType(n, "type")) bump("exportType", file, "export type")
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return { importStatements, exportStatements }
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────
// A probe that reports 0 because it looks for a node type the grammar never
// produces is indistinguishable from a RULED verdict. This snippet is parsed by
// the same code path as the corpus, and every row must be non-zero. Exit
// non-zero otherwise: silence is guilt, and a zero here is the failure this
// file exists to prevent.
const SELF_TEST = [
  '/// <reference path="./a.d.ts" />',
  '/// <reference types="node" />',
  '/// <reference lib="es2020" />',
  'declare module "some-package" { export const q: number }',
  'import fs = require("fs")',
  'import type { InjectionKey } from "vue"',
  'export type { Foo } from "./x"',
  'export const keep = 1',
].join("\n")

{
  const saved: Array<[BucketName, number, number]> = []
  for (const k of Object.keys(B) as BucketName[]) saved.push([k, B[k].sites, B[k].files.size])
  const tree = await parser.parse(SELF_TEST, "self-test.ts")
  const refFiles = new Set<string>()
  const counts = scan(tree.rootNode, "self-test.ts", refFiles)
  const expected: Array<[BucketName, number, string]> = [
    ["refPath", 1, '/// <reference path="./a.d.ts" />'],
    ["refTypes", 1, '/// <reference types="node" />'],
    ["refLib", 1, '/// <reference lib="es2020" />'],
    ["ambientModule", 1, '"some-package"'],
    ["importEquals", 1, "import fs = require(\"fs\")"],
    ["importType", 1, "import type"],
    ["exportType", 1, "export type"],
  ]
  console.log("SELF-TEST — a synthetic snippet containing every construct, same code path as the corpus")
  let bad = 0
  for (const [k, want, what] of expected) {
    const got = B[k].sites
    const ok = got === want
    if (!ok) bad++
    console.log(`  ${ok ? "ok  " : "FAIL"} ${k.padEnd(15)} expected ${want}  got ${String(got).padStart(3)}   (${what})`)
  }
  // 2 import_statements (`import fs = require(...)`, `import type {...}`) and
  // 3 export_statements -- `export const q` INSIDE the ambient module body
  // counts too, which is the whole reason this total is asserted rather than
  // assumed. The first run of this self-test expected 3/2 and FAILED on the
  // probe's correct 2/3: the assertion was wrong, not the walk.
  if (counts.importStatements !== 2 || counts.exportStatements !== 3) {
    bad++
    console.log(
      `  FAIL statement totals          expected 2 imports / 3 exports  got ${counts.importStatements} / ${counts.exportStatements}`,
    )
  } else {
    console.log(`  ok   statement totals          2 imports / 3 exports`)
  }
  if (bad > 0) {
    console.log("")
    console.log(`SELF-TEST FAILED (${bad} rows). A zero from a probe that cannot find a construct it was`)
    console.log(`tested against is not a measurement. Corpus numbers are NOT printed.`)
    process.exit(2)
  }
  console.log(`  self-test passed; buckets reset before the corpus walk`)
  console.log("")
  // Reset EVERYTHING the self-test touched, including the spelling histograms.
  // The first version restored `sites` and faked `files` to the right SIZE but
  // left `spellings` populated, so every corpus row printed `distinct 1` for a
  // construct with 0 sites -- a correct-looking number about the self-test's
  // population, sitting in the corpus table.
  for (const [k, sites, files] of saved) {
    B[k].sites = sites
    B[k].files = new Set()
    for (let i = 0; i < files; i++) B[k].files.add("restored")
    B[k].spellings = new Map()
  }
}

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
      /* unreadable, not admitted */
    }
  }
})(DIR)

const analyzer = new RealTypeScriptAnalyzer()
const refFiles = new Set<string>()
let parsed = 0
let failed = 0
let importStatements = 0
let exportStatements = 0
let edgesInRefFiles = 0
const refFilesWithEdges = new Set<string>()
const refEndpoints = new Set<string>()

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
  const before = refFiles.size
  const counts = scan(tree.rootNode, f, refFiles)
  importStatements += counts.importStatements
  exportStatements += counts.exportStatements
  if (refFiles.size !== before || B.refPath.files.has(f) || B.refTypes.files.has(f) || B.refLib.files.has(f)) {
    if (refFiles.has(f)) {
      const res = analyzer.analyze(tree.rootNode, src, f)
      const rels = res.relationships || []
      edgesInRefFiles += rels.length
      if (rels.length) refFilesWithEdges.add(f)
      for (const r of rels) {
        refEndpoints.add(String(r.source ?? r.from ?? ""))
        refEndpoints.add(String(r.target ?? r.to ?? ""))
      }
    }
  }
}

const LABEL: Record<BucketName, string> = {
  refPath: 'triple-slash <reference path=',
  refTypes: 'triple-slash <reference types=',
  refLib: 'triple-slash <reference lib=',
  ambientModule: 'ambient `declare module "x"`',
  importEquals: "import-equals (`import a = require`)",
  importType: "`import type`",
  exportType: "`export type`",
}
const ORDER: BucketName[] = ["refPath", "refTypes", "refLib", "ambientModule", "importEquals", "importType", "exportType"]

console.log(`DECLARED-CONSTRUCT PROBE — real-typescript-analyzer`)
console.log(`corpus            ${DIR}`)
console.log(`POPULATION        ${files.length} files admitted of ${examined} candidates examined`)
console.log(`                    rejected: ${noSignal} no code signal, ${tooBig} over ${MAX_BYTES} bytes, ${wrongExt} other extensions`)
console.log(`parsed            ${parsed}/${files.length} (${failed} failed)`)
console.log("")
console.log("CONSTRUCT SITES ON THE TREE (node.type + anonymous children, not text)")
console.log("construct                              sites  files  distinct")
console.log("-".repeat(76))
for (const k of ORDER) {
  const b = B[k]
  console.log(`${LABEL[k].padEnd(38)}${String(b.sites).padStart(5)}${String(b.files.size).padStart(7)}${String(b.spellings.size).padStart(10)}`)
  for (const [sp, n] of [...b.spellings.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3)) {
    console.log(`${"".padStart(40)}${sp}  x${n}`)
  }
}
console.log("")
console.log("ADJACENT TOTALS (so a ratio is not read as the whole story)")
console.log(`  import_statement nodes             ${importStatements}`)
console.log(`  export_statement nodes             ${exportStatements}`)
console.log(`  files with a triple-slash ref      ${refFiles.size}`)
console.log(`  relationships emitted in them      ${edgesInRefFiles}`)
console.log(`  of those, files that produced any  ${refFilesWithEdges.size}`)
console.log(`  distinct endpoint strings there    ${refEndpoints.size}`)
console.log("")
console.log("sites > 0 with no emitted edge naming the construct is a GAP.")
console.log("sites = 0 cannot be ruled from this corpus alone — widen the corpus, do not conclude.")
