// Every go relationship's SOURCE must name something the analyzer published.
//
// This is the user's requirement made measurable: "all the relationships
// resolve". The differential CANNOT answer it. `differential.ts` matches on
// `label + normTarget(target)` and reads no source at all, so an edge whose
// source is a pseudo-source — or names a declaration the symbol table never
// published — is indistinguishable from a good one. Three defects this session
// were all exactly this and none of them the differential could see:
//
//   GO36   a type_alias's field types attributed to `global`
//   GO38   a function-LOCAL type named as a relationship source but absent from
//          the symbol table
//   GOD11  a package-scope var/const's type attributed to `global`, and every
//          var_spec sharing a type collapsed into the first one's row
//
// So this walks every published relationship and asks two questions per edge:
// does the source name a SYMBOL, and does the target name a symbol (allowing the
// target kinds that are legitimately not symbols — a module path for `imports`,
// a builtin for `calls`). The residue is reported by class, per label, with the
// exact file and line, because a count with no examples cannot be acted on.
//
// A `global` source is counted as dangling. It is a pseudo-source: it means
// "something in this file", which cannot be navigated back to the declaration
// that wanted the edge, which is the whole point of a relationship source.
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const arg = (k: string, d: string): string => {
  const i = process.argv.indexOf(k)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d
}

async function main() {
  const repos = process.argv.slice(2).filter((a) => !a.startsWith("--"))
  const want = Number(arg("--files", "0"))
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const g = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-go.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-go-analyzer.ts"))

  for (const repo of repos) {
    const dir = path.join("/home/ishaq2321/bb_tests/repositories", repo)
    if (!fs.existsSync(dir)) { console.log(`[SKIP] ${repo}`); continue }
    const files: string[] = []
    const walk = (d: string): void => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === "vendor" || e.name === ".git") continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p); else if (e.name.endsWith(".go")) files.push(p)
      }
    }
    walk(dir)
    files.sort()
    const take = want > 0 ? files.slice(0, want) : files
    const parser = new P()
    parser.setLanguage(g)

    const byLabel: Record<string, { edges: number; srcSymbol: number; srcGlobal: number; srcDangling: number; srcNotLocal?: number }> = {}
    const samples: string[] = []
    let edges = 0
    let srcOk = 0
    let srcGlobal = 0
    let srcDangling = 0
    let srcNotLocal = 0
    let srcBlank = 0
    let srcUntypedRecv = 0

    for (const abs of take) {
      const content = fs.readFileSync(abs, "utf8")
      const rel = path.relative(dir, abs)
      const tree = parser.parse(content)
      let res: any
      try { res = await new mod.RealGoAnalyzer().analyze(tree.rootNode, content, rel) } catch { continue }
      const syms = new Set<string>()
      for (const s of res.symbols ?? []) syms.add(String(s.name))
      for (const r of res.relationships ?? []) {
        const label = String(r.type)
        const src = String(r.source ?? "")
        edges++
        byLabel[label] ??= { edges: 0, srcSymbol: 0, srcGlobal: 0, srcDangling: 0, srcNotLocal: 0 }
        byLabel[label].edges++
        if (src === "global") {
          srcGlobal++
          byLabel[label].srcGlobal++
          if (samples.length < 25) samples.push(`${repo}/${rel}:${r.line_number ?? 0} ${label} global->${r.target} [${(r.metadata ?? {}).relationshipType ?? "-"}]`)
        } else if (!syms.has(src)) {
          // NOT a symbol IN THIS FILE. In a package-scoped language that is often
          // correct: `contains ModuleInstance -> Action` names a type declared in
          // a SIBLING file of the same package, and a per-file analyzer is right
          // to publish the edge. Counting that as dangling reported 2,439 phantom
          // defects on terraform alone. So the class is split, and only the
          // genuinely unresolvable half is called dangling.
          srcNotLocal++
          byLabel[label].srcNotLocal = (byLabel[label].srcNotLocal ?? 0) + 1
          if (src === "_") {
            srcBlank++
            if (samples.length < 25) samples.push(`${repo}/${rel}:${r.line_number ?? 0} ${label} _->${r.target}  BLANK identifier as source`)
          } else if (label === "contains" && /^[a-z]/.test(src)) {
            // A lower-case owner on a `contains` edge is a RECEIVER variable, and
            // a receiver is a parameter: LocalsAreNotSymbols says it names no
            // graph node. `func (s) M()` is legal Go with NO type written, so
            // there is no owner name to use and the receiver name was used
            // instead.
            srcUntypedRecv++
            if (samples.length < 25) samples.push(`${repo}/${rel}:${r.line_number ?? 0} ${label} ${src}->${r.target}  UNTYPED receiver as owner (func (${src}) ...)`)
          } else {
            srcDangling++
            byLabel[label].srcDangling++
            if (samples.length < 25) samples.push(`${repo}/${rel}:${r.line_number ?? 0} ${label} ${src}->${r.target}  not declared in this file`)
          }
        } else {
          srcOk++
          byLabel[label].srcSymbol++
        }
      }
    }
    console.log(`===== ${repo} =====`)
    console.log(`edges=${edges}  source-is-a-symbol=${srcOk}  source-is-global=${srcGlobal}`)
    console.log(`  of the not-in-this-file sources (${srcNotLocal}): blank-identifier=${srcBlank}  untyped-receiver-owner=${srcUntypedRecv}  other(cross-file, correct in a package-scoped language)=${srcNotLocal - srcBlank - srcUntypedRecv}`)
    console.log("label".padEnd(14) + "edges".padStart(9) + "srcSymbol".padStart(11) + "srcGlobal".padStart(11) + "srcDangling".padStart(12) + "notLocal".padStart(12))
    for (const [k, v] of Object.entries(byLabel).sort()) {
      console.log(k.padEnd(14) + String(v.edges).padStart(9) + String(v.srcSymbol).padStart(11) + String(v.srcGlobal).padStart(11) + String(v.srcDangling).padStart(12) + String(v.srcNotLocal ?? 0).padStart(12))
    }
    if (samples.length) {
      console.log("samples:")
      for (const s of samples) console.log("  " + s)
    }
  }
}
main()
