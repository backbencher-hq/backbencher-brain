/**
 * The macro-label recovery population: how often does the analyzer publish a
 * symbol whose NAME is the source's TYPE, because a macro access-specifier label
 * (`JSON_PRIVATE_UNLESS_TESTED:`) put the grammar into ERROR recovery and the
 * `declarator` field landed on the type?
 *
 * The shape, measured from primitive_iterator.hpp:38:
 *   field_declaration [ERR] [type=type_identifier(LABEL), ERROR(":"), comment,
 *                        declarator=field_identifier(TYPE), ERROR(identifier(NAME)), "=", init]
 *
 * This probe counts BOTH readings so the fix is chosen on evidence, not taste:
 *   - sites where a real declaration is being published under the type's name
 *   - whether the ERROR sibling carries exactly one bare identifier (the shape a
 *     recovery-based name read would have to trust)
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,spdlog,abseil-cpp,zig").split(",").filter(Boolean)
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

type Site = {
  file: string; line: number; sourceLine: string
  typeField: string; declField: string; errSibling: string
  recoverable: boolean
}

const sites: Site[] = []
let files = 0
const t0 = Date.now()

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let tree: any
    let content: string
    try { content = readFileSync(f, "utf8"); ({ tree } = await ASTEngine.parseTree(f, content)) } catch { continue }
    files++
    const visit = (n: any) => {
      if (n.type === "field_declaration" || n.type === "declaration") {
        const decl = n.childForFieldName?.("declarator")
        if (decl && (decl.type === "field_identifier" || decl.type === "identifier") && n.hasError) {
          // the sibling AFTER the declarator
          let next: any = decl.nextSibling
          while (next && (next.isMissing || !next.isNamed)) next = next.nextSibling
          if (next && next.type === "ERROR") {
            const named = next.namedChildCount
            const inner = next.namedChild(0)
            const recoverable = named === 1 && !!inner && inner.type === "identifier" &&
              inner.startIndex > decl.endIndex
            const srcLine = content.split("\n")[decl.startPosition.row] ?? ""
            sites.push({
              file: f.replace(CORPUS + "/", ""),
              line: decl.startPosition.row + 1,
              sourceLine: srcLine.trim().slice(0, 100),
              typeField: (n.childForFieldName?.("type")?.text ?? "").slice(0, 40),
              declField: decl.text.slice(0, 40),
              errSibling: next.text.replace(/\n/g, "\\n").slice(0, 60),
              recoverable,
            })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
    }
    visit(tree.rootNode)
  }
  process.stderr.write(`${repo} done, files=${files}, sites=${sites.length}\n`)
}

const out = {
  generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0,
  totalSites: sites.length,
  recoverable: sites.filter((s) => s.recoverable).length,
  notRecoverable: sites.filter((s) => !s.recoverable).length,
  sites: sites.slice(0, 200),
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "macro-label-recovery.json"), JSON.stringify(out, null, 2))
console.log(`files=${files} wallMs=${out.wallMs}`)
console.log(`SITES where the declarator FIELD is error-adjacent: ${out.totalSites} (recoverable=${out.recoverable}, not=${out.notRecoverable})`)
for (const s of out.sites.slice(0, 25)) {
  console.log(`  ${s.file}:${s.line}  type=${JSON.stringify(s.typeField)} decl=${JSON.stringify(s.declField)} err=${JSON.stringify(s.errSibling)} recover=${s.recoverable}`)
  console.log(`      src: ${s.sourceLine}`)
}
