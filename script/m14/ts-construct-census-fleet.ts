/**
 * Is the construct in the corpus, or only the analyzer blind? A per-repo census
 * of the constructs `overrides` and `implements` need, so a zero can be
 * attributed to the right cause.
 *
 * The lane corpus (element-plus) has 13 class declarations in 1,213 files, so
 * `overrides` has nothing to pair and `implements` has one occurrence. That is a
 * fact about element-plus, not about TypeScript, and the distinction decides
 * whether a verdict is RULED or GAP. So measure the same constructs in every
 * corpus on disk that has real TypeScript in it, and print the denominators.
 *
 * No regular expression. No hand-written file list: the population is derived
 * from `git ls-files` in each repo present under the corpus root.
 *
 * USAGE
 *   bun run script/m14/ts-construct-census-fleet.ts [--out path.json] [--max-bytes N]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { getParser } from "../../src/ast/engine"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const OUT = argOf("--out")
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))
const REPO_FILTER = argOf("--repo")
/** A repo must hold at least this many tracked ts/tsx files to be reported. Derived
 *  threshold, not a name list: a repo with 3 .ts files cannot decide a verdict. */
const MIN_FILES = Number(argOf("--min-files") ?? "100")

type Repo = { name: string; dir: string; files: string[] }
const repos: Repo[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && !e.includes(REPO_FILTER)) continue
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  const files: string[] = []
  for (const rel of tracked) {
    const low = rel.toLowerCase()
    const isTs = low.endsWith(".ts") || low.endsWith(".tsx") || low.endsWith(".mts") || low.endsWith(".cts")
    if (!isTs) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
    files.push(abs)
  }
  if (files.length < MIN_FILES) continue
  repos.push({ name: e, dir, files })
}
repos.sort((a, b) => b.files.length - a.files.length)

type Count = { n: number; files: Set<string>; samples: string[] }
const mk = (): Count => ({ n: 0, files: new Set(), samples: [] })
const bump = (c: Count, label: string) => { c.n++; c.files.add(label); if (c.samples.length < 4) c.samples.push(label) }

/**
 * ITERATIVE walk over `child(i)`, not over a Cursor.
 *
 * MEASUREMENT DEFECT (found by running this file, 2026-10-05). The Cursor form
 * recurses through web-tree-sitter's own `walk` helper, and on the corpus's
 * largest TypeScript file that helper aborts the WASM module outright —
 * `RuntimeError: Aborted()`, unrecoverable, killing the whole census. The
 * exponential-looking `at walk (...:65:19)` repeated frames are the JS recursion
 * into that helper; the abort is inside the module, so no try/catch recovers it
 * and the process dies with every count so far unwritten.
 *
 * Two changes, both needed:
 *   - walk an explicit stack and index children with `child(i)`, which does not
 *     recurse through the WASM helper at all;
 *   - `setOnNode` throws are caught per node so one malformed subtree reports a
 *     file and moves on rather than ending the measurement.
 */
function walk(root: any, on: (n: any) => void): number {
  let nodes = 0
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    nodes++
    try { on(n) } catch { /* one bad subtree is reported by its own counter */ }
    const cc = n.childCount ?? 0
    for (let i = cc - 1; i >= 0; i--) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return nodes
}
const childrenOfType = (n: any, type: string): any[] => {
  const out: any[] = []
  const c = n.walk()
  if (!c.gotoFirstChild()) return out
  do { const cur = c.currentNode!; if (cur.type === type) out.push(cur) } while (c.gotoNextSibling())
  return out
}

const out: any = { at: new Date().toISOString(), corpusRoot: CR, minFiles: MIN_FILES, maxBytes: MAX_BYTES, repos: [] }
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`ts construct census — every corpus repo with >= ${MIN_FILES} tracked ts/tsx files (<= ${MAX_BYTES} bytes)`)
console.log(`${repos.length} repo(s) admitted; population derived from git ls-files, so adding a repo changes the denominator\n`)
console.log(`${w("repo", 20)}${w("files", 8)}${w("parsed", 8)}${w("nodes", 12)}${w("clsDecl", 9)}${w("implements", 11)}${w("extends", 9)}${w("ifaceExt", 10)}${w("override", 10)}${w("clsInFile", 11)}${w("ifaceInFile", 13)}${w("ovrSites", 10)}`)
console.log("-".repeat(140))

for (const repo of repos) {
  const C = {
    classDecl: mk(), implementsClause: mk(), extendsClause: mk(), extendsTypeClause: mk(),
    overrideModifier: mk(), classWithInFileBase: mk(), interfaceWithInFileBase: mk(), overrideSites: mk(),
  }
  let parsed = 0
  let failed = 0
  let nodes = 0
  const walkFailures: string[] = []
  for (const abs of repo.files) {
    let content: string
    try { content = readFileSync(abs, "utf8") } catch { failed++; continue }
    const label = path.relative(repo.dir, abs)
    let parser: any, tree: any
    try {
      parser = await getParser(label.toLowerCase().endsWith(".tsx") ? "tsx" : "typescript")
      tree = parser.parse(content, abs)
    } catch { failed++; continue }
    parsed++
    const root = tree.rootNode
    try {
    const classes: { name: string; bases: string[]; members: string[] }[] = []
    const interfaces: { name: string; bases: string[]; members: string[] }[] = []
    nodes += walk(root, (n: any) => {
      switch (n.type) {
        case "class_declaration":
        case "abstract_class_declaration": {
          bump(C.classDecl, label)
          const nm = n.childForFieldName("name")
          const bases: string[] = []
          const heritage = childrenOfType(n, "class_heritage")[0]
          if (heritage) {
            for (const clause of childrenOfType(heritage, "extends_clause")) {
              for (const ch of clause.namedChildren) {
                if (!ch || ch.type === "extends_clause") continue
                const leaf = ch.type === "member_expression" ? ch.childForFieldName("property") : ch
                if (leaf) bases.push(leaf.text)
              }
            }
            for (const ch of childrenOfType(heritage, "implements_clause")) {
              for (const c2 of ch.namedChildren) { const leaf = c2?.type === "member_expression" ? c2.childForFieldName("property") : c2; if (leaf) bases.push(leaf.text) }
            }
          }
          const members: string[] = []
          const body = n.childForFieldName("body")
          if (body) walk(body, (m: any) => {
            if (m.type === "method_definition" || m.type === "public_field_definition") { const x = m.childForFieldName("name"); if (x) members.push(x.text) }
          })
          classes.push({ name: nm ? nm.text : "", bases, members })
          break
        }
        case "implements_clause": bump(C.implementsClause, label); break
        case "extends_clause": bump(C.extendsClause, label); break
        case "extends_type_clause": bump(C.extendsTypeClause, label); break
        case "override_modifier": bump(C.overrideModifier, label); break
        case "interface_declaration": {
          const nm = n.childForFieldName("name")
          const bases: string[] = []
          walk(n, (m: any) => {
            if (m.type !== "extends_type_clause") return
            for (const c2 of m.namedChildren) { const leaf = c2?.type === "nested_type_identifier" ? (c2.childForFieldName("name") ?? c2.namedChild(0)) : c2; if (leaf) bases.push(leaf.text) }
          })
          const members: string[] = []
          const body = n.childForFieldName("body")
          if (body) walk(body, (m: any) => {
            if (m.type === "method_signature" || m.type === "property_signature") { const x = m.childForFieldName("name"); if (x) members.push(x.text) }
          })
          interfaces.push({ name: nm ? nm.text : "", bases, members })
          break
        }
        default: break
      }
    })
    const byName = new Map<string, string[]>()
    for (const it of interfaces) if (it.name) byName.set(it.name, it.members)
    for (const cl of classes) if (cl.name) byName.set(cl.name, cl.members)
    let clsInFile = 0
    let ifaceInFile = 0
    let sites = 0
    for (const cl of classes) {
      for (const base of cl.bases) {
        if (base === cl.name) continue
        const bm = byName.get(base)
        if (!bm) continue
        clsInFile++
        let hits = 0
        for (const mem of cl.members) if (bm.includes(mem)) hits++
        sites += hits
      }
    }
    for (const it of interfaces) {
      for (const base of it.bases) {
        if (base === it.name) continue
        const bm = byName.get(base)
        if (!bm) continue
        ifaceInFile++
        let hits = 0
        for (const mem of it.members) if (bm.includes(mem)) hits++
        sites += hits
      }
    }
    if (clsInFile) bump(C.classWithInFileBase, label)
    if (ifaceInFile) bump(C.interfaceWithInFileBase, label)
    if (sites) bump(C.overrideSites, label)
    } catch (e) {
      failed++
      parsed--
      walkFailures.push(`${label}: ${(e as Error)?.message ?? String(e)}`)
    }
  }
  const row = {
    repo: repo.name,
    files: repo.files.length,
    parsed,
    failed,
    nodes,
    walkFailures: walkFailures.slice(0, 10),
    classDeclarations: C.classDecl.n,
    implementsClauses: C.implementsClause.n,
    extendsClauses: C.extendsClause.n,
    extendsTypeClauses: C.extendsTypeClause.n,
    overrideModifiers: C.overrideModifier.n,
    classesWithInFileBase: C.classWithInFileBase.n,
    classesWithInFileBaseFiles: C.classWithInFileBase.files.size,
    interfacesWithInFileBase: C.interfaceWithInFileBase.n,
    interfacesWithInFileBaseFiles: C.interfaceWithInFileBase.files.size,
    overrideCandidateSites: C.overrideSites.n,
    overrideCandidateFiles: C.overrideSites.files.size,
    samples: {
      classDeclarations: C.classDecl.samples,
      implementsClauses: C.implementsClause.samples,
      overrideModifiers: C.overrideModifier.samples,
      classWithInFileBase: C.classWithInFileBase.samples,
      interfaceWithInFileBase: C.interfaceWithInFileBase.samples,
      overrideSites: C.overrideSites.samples,
    },
  }
  out.repos.push(row)
  console.log(`${w(repo.name, 20)}${w(String(repo.files.length), 8)}${w(String(parsed), 8)}${w(nodes.toLocaleString(), 12)}${w(String(C.classDecl.n), 9)}${w(String(C.implementsClause.n), 11)}${w(String(C.extendsClause.n), 9)}${w(String(C.extendsTypeClause.n), 10)}${w(String(C.overrideModifier.n), 10)}${w(String(C.classWithInFileBase.n), 11)}${w(String(C.interfaceWithInFileBase.n), 13)}${w(String(C.overrideSites.n), 10)}`)
}
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }