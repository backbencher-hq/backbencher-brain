/**
 * The COMPLETE keyword-callee enumeration for the cpp lane.
 *
 * #924 found one impossible-callee class (a callee spelled with a BUILTIN TYPE
 * keyword is a functional cast) and fixed it. The census then found
 * `fmt_vformat calls static_cast` — the CAST family, a different and equally
 * impossible class the fix never enumerated. This probe measures the whole
 * space rather than the next instance of it: every C++ keyword, counted as an
 * emitted `calls` target and as a published symbol name, over the real corpora.
 *
 * A keyword in either position is a fabrication by construction: the language
 * has no identifier spelled that way, so no consumer can resolve the name.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { parseFile } from "../../src/ast/engine"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/ishaq/fixtures/repositories"
const REPOS = (process.env.CPP_REPOS ?? "fmt,nlohmann-json,catch2,abseil-cpp,spdlog").split(",").filter(Boolean)
const EXTS = [".cpp", ".cc", ".cxx", ".c++", ".hpp", ".hxx", ".hh", ".h++"]
const SKIP = new Set([".git", "build", "node_modules", ".github", "cmake-build-debug"])
const OUT = process.env.CPP_OUT ?? "/tmp/opencode/cpp-review"

/**
 * Every C++ keyword (through C++23), split by what a keyword MEANS for the
 * analyzer. A keyword in the `cast`/`unary`/`special` groups is one the grammar
 * can surface as a `call_expression` callee; the rest cannot legally appear in
 * an expression at all and landing on a name is pure fabrication.
 */
const KEYWORDS = new Set([
  // cast family — the class #924's fix missed
  "static_cast", "dynamic_cast", "const_cast", "reinterpret_cast",
  // unary/operator spellings the grammar can wrap in a call_expression
  "sizeof", "alignof", "typeid", "throw", "defined", "__has_include", "__has_cpp_attribute",
  "_Pragma", "and", "or", "not", "xor", "compl", "bitand", "bitor", "and_eq", "or_eq", "xor_eq", "not_eq",
  "new", "delete", "this", "nullptr", "true", "false", "NULL",
  // declarations / statements
  "alignas", "asm", "auto", "bool", "break", "case", "catch", "char", "char8_t", "char16_t", "char32_t",
  "class", "concept", "const", "consteval", "constexpr", "constinit", "const_cast_", "continue", "co_await",
  "co_return", "co_yield", "decltype", "default", "delete_", "do", "double", "else", "enum", "explicit",
  "export", "extern", "float", "for", "friend", "goto", "if", "inline", "int", "long", "mutable", "namespace",
  "noexcept", "operator", "private", "protected", "public", "register", "reinterpret_cast_", "requires",
  "return", "short", "signed", "sizeof_", "static", "static_assert", "static_cast_", "struct", "switch",
  "template", "this_", "thread_local", "throw_", "try", "typedef", "typeid_", "typename", "union",
  "unsigned", "using", "virtual", "void", "volatile", "wchar_t", "while",
  // preprocessor / implementation-reserved
  "__attribute__", "__declspec", "__inline", "__forceinline", "__restrict", "__extension__",
  "__asm", "__typeof__", "__builtin_offsetof", "__func__", "__FUNCTION__", "__PRETTY_FUNCTION__",
])

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

const callHits = new Map<string, { n: number; file: string; source: string; repos: Set<string> }>()
const symHits = new Map<string, { n: number; file: string; kind: string; repos: Set<string> }>()
const useHits = new Map<string, { n: number; file: string; repos: Set<string> }>()
let files = 0
const t0 = Date.now()

for (const repo of REPOS) {
  for (const f of walk(path.join(CORPUS, repo))) {
    let r: any
    try { r = await parseFile(f, readFileSync(f, "utf8")) } catch { continue }
    files++
    for (const x of (r.relationships ?? []) as any[]) {
      if (x.type === "calls" && KEYWORDS.has(String(x.target))) {
        const p = callHits.get(x.target) ?? { n: 0, file: f, source: String(x.source), repos: new Set<string>() }
        p.n++; p.repos.add(repo); callHits.set(x.target, p)
      }
      if (x.type === "uses" && KEYWORDS.has(String(x.target))) {
        const p = useHits.get(x.target) ?? { n: 0, file: f, repos: new Set<string>() }
        p.n++; p.repos.add(repo); useHits.set(x.target, p)
      }
    }
    for (const s of (r.symbols ?? []) as any[]) {
      const n = String(s.name ?? "")
      if (KEYWORDS.has(n)) {
        const p = symHits.get(n) ?? { n: 0, file: f, kind: String(s.kind), repos: new Set<string>() }
        p.n++; p.repos.add(repo); symHits.set(n, p)
      }
    }
  }
  process.stderr.write(`${repo} done (files so far ${files})\n`)
}

const out = {
  generatedAt: new Date().toISOString(),
  files,
  wallMs: Date.now() - t0,
  keywordCallTargets: [...callHits].map(([k, v]) => ({ keyword: k, n: v.n, file: v.file, source: v.source, repos: [...v.repos] })).sort((a, b) => b.n - a.n),
  keywordUseTargets: [...useHits].map(([k, v]) => ({ keyword: k, n: v.n, file: v.file, repos: [...v.repos] })).sort((a, b) => b.n - a.n),
  keywordSymbolNames: [...symHits].map(([k, v]) => ({ keyword: k, n: v.n, file: v.file, kind: v.kind, repos: [...v.repos] })).sort((a, b) => b.n - a.n),
}
mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, "keywords.json"), JSON.stringify(out, null, 2))
console.log(`files=${files} wallMs=${out.wallMs}`)
console.log(`\n=== KEYWORD calls TARGETS (${out.keywordCallTargets.length} distinct) ===`)
for (const k of out.keywordCallTargets) console.log(`  ${String(k.n).padStart(5)}  ${k.keyword.padEnd(24)} from ${k.source}  @${k.file.replace(CORPUS + "/", "")}`)
console.log(`\n=== KEYWORD uses TARGETS (${out.keywordUseTargets.length} distinct) ===`)
for (const k of out.keywordUseTargets) console.log(`  ${String(k.n).padStart(5)}  ${k.keyword.padEnd(24)} @${k.file.replace(CORPUS + "/", "")}`)
console.log(`\n=== KEYWORD SYMBOL NAMES (${out.keywordSymbolNames.length} distinct) ===`)
for (const k of out.keywordSymbolNames) console.log(`  ${String(k.n).padStart(5)}  ${k.keyword.padEnd(24)} ${k.kind}  @${k.file.replace(CORPUS + "/", "")}`)
