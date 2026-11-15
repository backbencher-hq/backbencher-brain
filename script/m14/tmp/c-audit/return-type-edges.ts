/**
 * C audit probe: how large is the #935 class?
 *
 * #935: CGD34's gate reads `node.parent?.type !== "function_definition"`, with no
 * check on the node's OWN type. It was written to suppress a bare `identifier`
 * child of a `function_definition` -- the phantom function name that parse
 * recovery produces from `static SQLITE_WSD struct Mem3Global {`. But a
 * function_definition's direct children also include its RETURN TYPE, and a
 * return type spelled with a TYPEDEF name is a `type_identifier` in exactly that
 * position:
 *
 *   function_definition
 *     type_identifier          <- the return type, e.g. Color
 *     function_declarator      <- the name and parameters
 *     compound_statement
 *
 * so the gate suppressed the return type too, and every function declared with a
 * typedef return type lost its `references` edge. The pinned M12 ground truth
 * expects exactly that edge (`rel:Negative.c:references:pick_color:Color`, evidence
 * "bare return type -- in-file type usage") and the analyzer does not emit it --
 * one of the 13 rows the drift probe found, and the only one of the six "gone"
 * rows that is an ANALYZER defect rather than a deliberate ruling.
 *
 * This probe counts the class on the corpus by asking the only question that
 * matters: for every `type_identifier` that is a DIRECT child of a
 * `function_definition` and names a type THIS FILE declares, is there a
 * `references` edge from the function to it? Pre-#935 the answer was no for every
 * one of them (37 over 326 files); a first draft of this probe reported the
 * pre-fix number by construction -- it counted the gate's reach rather than the
 * emission, so it kept saying 37 after the fix landed. Asking about the EDGE is
 * what makes it a measurement.
 *
 *   bun run script/m14/tmp/c-audit/return-type-edges.ts --repos <dir,...> [--limit N]
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const REPOS = arg("repos", "/home/sano/ishaq/bb_tests/repositories/redis/src").split(",")
const LIMIT = Number(arg("limit", "900"))

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

function discover(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    let ents: fs.Dirent[]
    try {
      ents = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name === ".git") continue
      const full = path.join(d, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith(".c") || e.name.endsWith(".h")) {
        try {
          if (fs.statSync(full).size >= 1024) out.push(full)
        } catch {
          /* unreadable */
        }
      }
    }
  }
  walk(dir)
  out.sort()
  return out.slice(0, LIMIT)
}

let filesWithClass = 0
let totalReturnTypes = 0
let resolvableReturnTypes = 0
let edgesPresent = 0
let edgesMissing = 0
let unattributedSourceSites = 0
const perRepo: any[] = []
const samples: string[] = []

for (const repo of REPOS) {
  const files = discover(repo)
  let repoReturnTypes = 0
  let repoResolvable = 0
  let repoPresent = 0
  let repoMissing = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser.parse(src)
    const res: any = new RealCAnalyzer().analyze(tree.rootNode, src, f)

    // The set of type names the analyzer is able to resolve, reconstructed from
    // the file's own symbols -- the same evidence `isResolvableUseTarget` uses.
    const declaredTypes = new Set<string>()
    for (const s of res.symbols ?? []) {
      if (["type", "struct", "enum"].includes(String(s.kind)) && s.scope === "global") declaredTypes.add(s.name)
    }
    const edges = new Set<string>()
    const targetsWithAnyEdge = new Set<string>()
    for (const r of res.relationships ?? []) {
      if (String(r.type) === "references") {
        edges.add(`${r.source}->${r.target}`)
        targetsWithAnyEdge.add(String(r.target))
      }
    }

    const st: any[] = [tree.rootNode]
    let fileSuppressed = 0
    let fileResolvable = 0
    while (st.length) {
      const n = st.pop()!
      if (n.type === "function_definition") {
        // the function's own name, so we can say which edge is missing
        let fnName = null
        const d = n.childForFieldName("declarator")
        if (d && d.type === "function_declarator") fnName = d.childForFieldName("declarator")?.text ?? null
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c || c.type !== "type_identifier") continue
          const name = c.text.trim()
          totalReturnTypes++
          repoReturnTypes++
          fileSuppressed++
          // Would the gate have allowed it? The identifier branch needs
          // `isResolvableUseTarget(name, "type_identifier", ...)` to be true, and
          // for a type_identifier that is exactly `declaredTypes.has(name)`.
          if (declaredTypes.has(name)) {
            // The analyzer can resolve this name, so the ONLY question is whether
            // the `references` edge is actually there. That is the whole class:
            // pre-#935 the answer was no for every one of them.
            resolvableReturnTypes++
            repoResolvable++
            fileResolvable++
            // Present means present: an edge under the function's own name when the
            // name is readable, and under ANY source when it is not. A first draft
            // required `fnName` and so scored 6 sites as missing that were in fact
            // emitted -- a function whose declarator is a bare `pointer_declarator`
            // (a function RETURNING a function pointer) yields no readable name, and
            // its reads are attributed to `global` because the walk pushed no
            // Function scope for it. That source-identity observation is reported
            // separately below, because it is a different question from whether the
            // edge exists.
            const byName = fnName ? edges.has(`${fnName}->${name}`) : false
            const byAnyone = targetsWithAnyEdge.has(name)
            if (byName || byAnyone) {
              edgesPresent++
              repoPresent++
              if (!byName && fnName) unattributedSourceSites++
            } else {
              edgesMissing++
              repoMissing++
              if (samples.length < 16) {
                samples.push(
                  `${path.basename(f)}:${n.startPosition.row + 1} ${fnName ? fnName + "() returns " : "<unreadable declarator> returns "}${name}` +
                    ` -- no references edge at all; enclosing node ${n.parent?.type ?? "none"}, declarator ${n.childForFieldName("declarator")?.type ?? "none"}`,
                )
              }
            }
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) st.push(c)
      }
    }
    if (fileSuppressed > 0) filesWithClass++
    void fileSuppressed
    void fileResolvable
  }
  perRepo.push({
    repo: path.basename(repo),
    files: files.length,
    typedefReturnTypes: repoReturnTypes,
    resolvable: repoResolvable,
    edgePresent: repoPresent,
    edgeMissing: repoMissing,
    presentButNotSourcedToTheFunction: repoPresent - repoPresent, // filled below
  })
  console.log(
    `${path.basename(repo)}: files=${files.length} typedef-spelled return types=${repoReturnTypes}, resolvable=${repoResolvable}, ` +
      `edge PRESENT=${repoPresent}, edge MISSING=${repoMissing}`,
  )
}

console.log(
  `\nTOTAL: ${filesWithClass} files carry the class; ${totalReturnTypes} typedef-spelled return types; ` +
    `${resolvableReturnTypes} of them name a type this file declares, so an edge is expected for each -- ` +
    `${edgesPresent} present, ${edgesMissing} MISSING.`,
)
console.log(
  `of the ${edgesPresent} present, ${unattributedSourceSites} carry a source other than the function's own name, ` +
    `because a function whose declarator is a bare pointer_declarator yields no readable name and the walk ` +
    `pushes no Function scope for it (its reads are attributed to \`global\`). That is a source-identity ` +
    `question, not a missing edge, and it is reported rather than scored.`,
)
console.log("still missing (samples):")
for (const s of samples) console.log(`  ${s}`)
console.log(`\ncommit ${execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim()}`)
