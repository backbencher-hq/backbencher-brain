/**
 * D7: a C++23 attribute `[[=qualified::name]]` is ERROR-recovered, and the
 * attribute's qualified_identifier lands in the specifier's `name` field — so the
 * enum publishes as `anonymous` and the real declared name is absent from the
 * graph.
 *
 * Measured at fmt/test/enum-test.cc:24:
 *
 *   declaration [ERR] [type=enum_specifier declarator=init_declarator]
 *     enum_specifier [ERR] [name=qualified_identifier] "enum class [[=fmt::as_identifiers"
 *       enum / class
 *       ERROR [ERR] "[[="
 *       qualified_identifier [scope=namespace_identifier name=type_identifier] "fmt::as_identifiers"
 *     ERROR [ERR] "]]"
 *     init_declarator [declarator=identifier value=initializer_list] "color { red, green, blue }"
 *       identifier "color"                <- the REAL declared name
 *
 * The evidence is local and unambiguous: an `enum_specifier` has no qualified
 * name in the C++ grammar (`enum class ns::E` is not valid C++ — you would write
 * `namespace ns { enum class E; }`), so a `::`-qualified path sitting in the
 * `name` slot is the grammar's account of something else. This probe measures how
 * often that happens, for EVERY specifier kind, before any fix is written.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { ASTEngine, parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog,zig").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

const SPECIFIERS = ["enum_specifier", "class_specifier", "struct_specifier", "union_specifier", "alias_declaration", "type_definition"]

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

const byKind = new Map<string, number>()
const sites: any[] = []
let files = 0, publishedAnon = 0, recoverable = 0
const t0 = Date.now()

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any, tree: any, content: string
    try {
      content = readFileSync(f, "utf8")
      r = await parseFile(f, content)
      ;({ tree } = await ASTEngine.parseTree(f, content))
    } catch { continue }
    files++
    const rel = f.replace(CORPUS + "/", "")
    const lines = content.split("\n")
    const anonEnums = new Set(
      (r.symbols ?? []).filter((s: any) => s.kind === "enum" && String(s.name) === "anonymous").map((s: any) => s.range?.startLine),
    )
    const publishedNames = new Set((r.symbols ?? []).map((s: any) => String(s.name)))
    const visit = (n: any) => {
      if (SPECIFIERS.includes(n.type)) {
        const nameField = n.childForFieldName?.("name")
        if (nameField && nameField.type === "qualified_identifier") {
          // the real name, when the recovery displaced it into the declaration
          const decl = n.parent
          let real: string | null = null
          if (decl && (decl.type === "declaration" || decl.type === "field_declaration")) {
            // declaration.declarator -> init_declarator -> .declarator -> identifier
            // (the enum body `{ red, green, blue }` makes the grammar read the
            //  real name as a brace-initialized declarator, one level down)
            const id0 = decl.childForFieldName?.("declarator")
            const id = id0 && id0.type === "init_declarator" ? id0.childForFieldName?.("declarator") : id0
            if (id && id.type === "identifier") real = id.text
          }
          const key = `${n.type}->${nameField.text}`
          byKind.set(key, (byKind.get(key) ?? 0) + 1)
          // what did the analyzer publish for it?
          let published = "(none)"
          if (n.type === "enum_specifier") {
            published = anonEnums.has(n.startPosition.row + 1) ? "anonymous" : (publishedNames.has(real ?? "\u0000") ? String(real) : "(other)")
            if (published === "anonymous") publishedAnon++
          }
          if (real && !publishedNames.has(real)) recoverable++
          if (sites.length < 60) {
            sites.push({
              repo, file: rel, line: n.startPosition.row + 1, specifier: n.type,
              nameField: nameField.text, realNameInDeclaration: real,
              published, hasError: n.hasError,
              src: (lines[n.startPosition.row] ?? "").trim().slice(0, 90),
            })
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) visit(c) }
    }
    visit(tree.rootNode)
  }
  process.stderr.write(`${repo} done files=${files} sites=${sites.length}\n`)
}

const total = [...byKind.values()].reduce((a, b) => a + b, 0)
const out = {
  generatedAt: new Date().toISOString(), files, wallMs: Date.now() - t0,
  qualifiedNameInSpecifierNameField: total,
  enumsPublishedAsAnonymous: publishedAnon,
  realNamePresentInDeclaration: recoverable,
  byKind: Object.fromEntries([...byKind].sort((a, b) => b[1] - a[1])),
  sites,
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "d7-attribute-name.json"), JSON.stringify(out, null, 2))
console.log(JSON.stringify({
  files, total, enumsPublishedAsAnonymous: publishedAnon, realNamePresentInDeclaration: recoverable,
  byKind: out.byKind,
}, null, 2))
console.log("\nsites:")
for (const s of sites.slice(0, 14)) console.log(`  ${s.file}:${s.line} ${s.specifier} name=${JSON.stringify(s.nameField)} real=${JSON.stringify(s.realNameInDeclaration)} published=${s.published} | ${s.src}`)
