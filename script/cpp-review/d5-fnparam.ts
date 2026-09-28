/**
 * D5's fabrication sub-rule, measured: in C++ a parameter's declarator is NEVER
 * a `function_declarator` (unlike C, a function-TYPE parameter is ill-formed —
 * `void f(int g(int))` does not compile). So the shape
 *
 *   parameter_declaration [ declarator: function_declarator ]
 *
 * is always the grammar's ERROR recovery, never a declaration. The nlohmann
 * statement that produces it is the one the analyzer's own CPPD12b comment names:
 *
 *   push_back(typename object_t::value_type(std::move(key.get_ref<string_t&>()),
 *                                           (init.begin() + 1)->moved_or_copied()));
 *
 * which the grammar reads as a `function_definition` — so a STATEMENT inside a
 * function body is published as a function symbol, and (because its scope is
 * pushed) it becomes the owner of everything the walk attributes afterwards.
 *
 * This probe measures the shape's population and, for each site, whether the
 * enclosing `function_definition` is lexically inside another function body —
 * which is the discriminator between "a recovery that stole a name" (the shape
 * above) and a legitimate declaration.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const walk = (d: string, out: string[] = [], depth = 0): string[] => {
  if (depth > 10) return out
  let es: string[]
  try { es = readdirSync(d) } catch { return out }
  for (const e of es) {
    if (SKIP.has(e)) continue
    const p = path.join(d, e)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out, depth + 1)
    else if (EXTS.some((x) => p.endsWith(x)) && st.size > 0) out.push(p)
  }
  return out
}

const sites: any[] = []
let files = 0
const t0 = Date.now()

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let tree: any, content: string
    try { content = readFileSync(f, "utf8"); ({ tree } = await ASTEngine.parseTree(f, content)) } catch { continue }
    files++
    const visit = (n: any, inFnBody: boolean) => {
      let childInFn = inFnBody
      if (n.type === "function_definition") childInFn = true
      if (n.type === "parameter_declaration") {
        const d = n.childForFieldName?.("declarator")
        if (d && (d.type === "function_declarator" || d.type === "abstract_function_declarator")) {
          if (sites.length < 400) {
            sites.push({
              repo, file: f.replace(CORPUS + "/", ""),
              line: n.startPosition.row + 1,
              insideFunctionBody: inFnBody,
              header: (n.text.replace(/\n/g, " ").slice(0, 100)),
              src: (content.split("\n")[n.startPosition.row] ?? "").trim().slice(0, 100),
            })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c, childInFn) }
    }
    visit(tree.rootNode, false)
  }
  process.stderr.write(`${repo} done files=${files} sites=${sites.length}\n`)
}

const inside = sites.filter((s) => s.insideFunctionBody)
const outside = sites.filter((s) => !s.insideFunctionBody)
const out = {
  generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0,
  note: "C++ has no function-TYPE parameter (ill-formed since C++98), so parameter_declaration[declarator=function_declarator] is always recovery.",
  total: sites.length,
  insideFunctionBody: inside.length,
  atDeclarationScope: outside.length,
  sites,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "d5-fnparam.json"), JSON.stringify(out, null, 2))
console.log(`files=${files} sites=${sites.length} insideFunctionBody=${inside.length} atDeclarationScope=${outside.length}`)
console.log("\n--- INSIDE a function body (the fabrication shape) ---")
for (const s of inside.slice(0, 12)) console.log(`  ${s.file}:${s.line}  ${JSON.stringify(s.src)}`)
console.log("\n--- AT DECLARATION SCOPE (must be checked: a real declaration is possible here?) ---")
for (const s of outside.slice(0, 12)) console.log(`  ${s.file}:${s.line}  ${JSON.stringify(s.src)}`)
