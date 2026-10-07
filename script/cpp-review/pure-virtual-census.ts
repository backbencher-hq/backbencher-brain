/**
 * PURE-VIRTUAL CENSUS — how many `= 0` declarations the grammar produces, and how
 * many of them the analyzer publishes as the member they declare.
 *
 * A pure virtual is how C++ spells an interface: there is no `interface` keyword,
 * no `implements` clause, and the ontology entry for `implements` is RULED partly
 * on that. So `virtual T f(...) = 0;` is not an edge case — it is the construct
 * the `overrides` and `implements` verdicts rest on, and if it is not published
 * then `overrides` is measuring nothing.
 *
 * The grammar produces TWO shapes for it, which is the whole difficulty:
 *
 *   field_declaration [declarator=function_declarator type=primitive_type]
 *     virtual, primitive_type "bool", function_declarator …
 *       <- declarator DIRECT. A shallow lookup finds it.
 *
 *   declaration [declarator=init_declarator type=primitive_type]
 *     init_declarator [declarator=function_declarator value=number_literal]
 *       <- declarator ONE LEVEL DOWN, behind `init_declarator`.
 *
 * Both appear in real code inside the same file, and the second is the one a
 * shallow declarator lookup cannot see. Measured: the fixture-shaped case
 * (`cpp/pure-virtual-signature-910`) parses as `field_declaration`, while
 * `cpp-sample/include/benchmark/reporter.h:132` and `:136` parse as
 * `declaration > init_declarator`.
 *
 *   BB_CORPUS_ROOT=... CPP_REPOS=sqlite,cpp-sample \
 *     bun run script/cpp-review/pure-virtual-census.ts
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"
const EXTS = new Set([".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++", ".h", ".ipp", ".tpp"])
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug", "bazel-bin", "CMakeFiles"])

function walkFiles(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) stack.push(full)
      else if (EXTS.has(path.extname(e.name))) out.push(full)
    }
  }
  return out.sort()
}

const arg = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

interface Site { shape: "field_declaration/direct" | "declaration/init_declarator" | "other"; name: string | null; owner: string | null; file: string; line: number }

async function main() {
  const rootsRaw = (process.env.CPP_REPOS ?? "").split(",").filter(Boolean)
  const roots = rootsRaw.length ? rootsRaw.map((r) => path.join(CORPUS, r)) : readdirSync(CORPUS).map((d) => path.join(CORPUS, d))
  let candidates: string[] = []
  for (const r of roots) candidates = candidates.concat(walkFiles(r))
  candidates = [...new Set(candidates)].sort().slice(0, Number(arg("--limit") ?? Number.POSITIVE_INFINITY))
  const files: string[] = []
  for (const f of candidates) {
    let c = ""
    try { c = readFileSync(f, "utf8") } catch { continue }
    if (detectLanguageFromPath(f, c) === "cpp") files.push(f)
  }

  const sites: Site[] = []
  const byShape: Record<string, { count: number; files: number }> = {}
  const shapeFiles: Record<string, Set<string>> = {}
  const perFile = new Map<string, Site[]>()

  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    if (content.length > 4_000_000) continue
    let tree: any
    try { tree = await ASTEngine.parseTree(f, content) } catch { continue }
    const label = `${path.basename(path.dirname(f))}/${path.basename(f)}`
    const here: Site[] = []
    const st: any[] = [tree.tree.rootNode]
    while (st.length) {
      const n = st.pop()
      if (n.type === "field_declaration" || n.type === "declaration") {
        // is this a pure virtual? a `function_declarator` plus a literal `0` as the
        // initializer, at any of the two shapes the grammar produces.
        let fd: any = null
        let shape: Site["shape"] = "other"
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (!c) continue
          if (c.type === "function_declarator") { fd = c; shape = "field_declaration/direct" }
          else if (c.type === "init_declarator") {
            for (let k = 0; k < c.namedChildCount; k++) {
              const kc = c.namedChild(k)
              if (kc && kc.type === "function_declarator") { fd = kc; shape = "declaration/init_declarator" }
            }
          }
        }
        let zero = false
        if (fd) {
          const owner = shape === "declaration/init_declarator" ? n : n
          const valueField = shape === "declaration/init_declarator" ? fd.parent?.childForFieldName?.("value") : null
          if (valueField && valueField.type === "number_literal" && valueField.text.trim() === "0") zero = true
          else for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && c.type === "number_literal" && c.text.trim() === "0") { zero = true; break } }
          void owner
        }
        if (fd && zero) {
          let name: string | null = null
          for (let i = 0; i < fd.namedChildCount; i++) { const c = fd.namedChild(i); if (c && (c.type === "identifier" || c.type === "field_identifier")) { name = c.text.trim(); break } }
          let owner: string | null = null
          let cur: any = n.parent
          for (let d = 0; d < 12 && cur; d++) {
            if (cur.type === "class_specifier" || cur.type === "struct_specifier" || cur.type === "union_specifier") {
              owner = cur.childForFieldName?.("name")?.text?.trim() ?? owner
              break
            }
            if (cur.type === "namespace_definition") {
              owner = cur.namedChild(0)?.text?.trim() ?? owner
              break
            }
            cur = cur.parent
          }
          const site: Site = { shape, name, owner, file: label, line: n.startPosition.row + 1 }
          sites.push(site)
          here.push(site)
          byShape[shape] ??= { count: 0, files: 0 }
          byShape[shape].count++
          shapeFiles[shape] ??= new Set()
          shapeFiles[shape].add(label)
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) st.push(c) }
    }
    perFile.set(f, here)
  }
  for (const k of Object.keys(byShape)) byShape[k].files = shapeFiles[k].size

  // --- what the analyzer PUBLISHED for those sites
  const published = new Map<string, Set<string>>()
  for (const f of files) {
    let content: string
    try { content = readFileSync(f, "utf8") } catch { continue }
    let r: any
    try { r = await parseFile(f, content) } catch { continue }
    const set = new Set<string>()
    for (const s of r.symbols ?? []) {
      if (s.kind !== "method" && s.kind !== "function") continue
      set.add(`${s.range?.startLine ?? -1}\u0000${s.name}`)
    }
    published.set(f, set)
  }
  const rows = sites.map((s) => {
    const abs = files.find((f) => `${path.basename(path.dirname(f))}/${path.basename(f)}` === s.file)
    const set = abs ? published.get(abs) : undefined
    // Matched on (LINE, NAME), not on owner. Two earlier versions of this probe got
    // it wrong in opposite directions and both were wrong in the direction that
    // flatters the analyzer: matching on OWNER read the owner's name off the
    // `class_specifier`'s `name` field, which on the macro-decorated shape holds the
    // MACRO rather than the class, so all three sites read as "missing" AFTER the
    // fix; matching on NAME alone matched the DERIVED class's member of the same
    // name and so read all three as "present" BEFORE it. A declaration's own line is
    // objective, grammar-independent, and is the thing a consumer navigates to.
    return { ...s, publishedAsMember: !!set && set.has(`${s.line}\u0000${s.name}`) }
  })
  const missed = rows.filter((r) => !r.publishedAsMember)

  const outPath = arg("--out") ?? path.join(OUT, "pure-virtual-census.json")
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({
    at: new Date().toISOString(), corpus: CORPUS, repos: rootsRaw, cppFiles: files.length,
    pureVirtualSites: rows.length, byShape,
    publishedAsMember: rows.length - missed.length,
    NOTPublished: missed.length,
    missedByShape: missed.reduce((a: Record<string, number>, r) => { a[r.shape] = (a[r.shape] ?? 0) + 1; return a }, {}),
    missed: missed.slice(0, 80), all: rows.slice(0, 300),
  }, null, 2))

  console.log(`cpp files ${files.length} | pure-virtual sites ${rows.length}`)
  for (const [k, v] of Object.entries(byShape)) console.log(`  ${k.padEnd(30)} ${String(v.count).padStart(5)}  files ${String(v.files).padStart(4)}`)
  console.log(`published as a method/function : ${rows.length - missed.length}`)
  console.log(`NOT published                 : ${missed.length}`)
  const byS: Record<string, number> = {}
  for (const m of missed) byS[m.shape] = (byS[m.shape] ?? 0) + 1
  console.log(`  by shape: ${JSON.stringify(byS)}`)
  for (const m of missed.slice(0, 20)) console.log(`      ${m.file}:${m.line} ${m.shape} name=${m.name} owner=${m.owner}`)
  console.log(`\nevidence: ${outPath}`)
}

await main()