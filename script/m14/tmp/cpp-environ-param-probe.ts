// cpp-environ-param-probe.ts — the two residuals the .cpp-inclusive full extent
// (nlohmann-json, 496 files) produced, reduced to their minimal shapes.
//
// From the real files (cpp-nlohmann-residual-probe.ts):
//   MISSING  FuzzerUtilDarwin.cpp :: uses -> environ.  The analyzer published ZERO
//            symbols named `environ` for `extern "C" char **environ;` (line 21) and
//            emitted no use at line 98. The oracle derived the use.
//   UNEXPLAINED  json_v3_10_5.hpp :: uses binary_reader -> strict (line 8299) and
//            uses parser -> strict (line 10866). `strict` there is a PARAMETER of
//            the enclosing member function; the file ALSO declares `enum class
//            error_handler_t { strict, ... }` at line 16079, and the analyzer's
//            resolution bound the parameter's name to that file-scope enum member.
//
// So this probe isolates four things independently: is the declaration dropped for
// LINKAGE (extern "C"), for a POINTER declarator, or both; and does a parameter
// shadowing a file-scope name still resolve to the file-scope symbol.
//
//   bun script/m14/tmp/cpp-environ-param-probe.ts
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"

const CASES: Array<{ id: string; file: string; src: string }> = [
  {
    id: "A. extern \"C\" POINTER global + read (the corpus shape)",
    file: "Probe.cpp",
    src: `extern "C" char **environ;\nint f(void) {\n  char **e = environ;\n  return e ? 0 : 1;\n}\n`,
  },
  {
    id: "B. extern \"C\" non-pointer global + read (isolates LINKAGE)",
    file: "Probe.cpp",
    src: `extern "C" int cacheSize;\nint f(void) {\n  int n = cacheSize;\n  return n;\n}\n`,
  },
  {
    id: "C. plain POINTER global + read (isolates POINTER declarator)",
    file: "Probe.cpp",
    src: `char **environ;\nint f(void) {\n  char **e = environ;\n  return e ? 0 : 1;\n}\n`,
  },
  {
    id: "D. extern \"C\" BLOCK, pointer global + read",
    file: "Probe.cpp",
    src: `extern "C" {\nchar **environ;\n}\nint f(void) {\n  char **e = environ;\n  return e ? 0 : 1;\n}\n`,
  },
  {
    id: "E. CONTROL: plain non-pointer global + read (works today?)",
    file: "Probe.cpp",
    src: `int cacheSize;\nint f(void) {\n  int n = cacheSize;\n  return n;\n}\n`,
  },
  {
    id: "F. parameter shadowing a file-scope enum member (the UNEXPLAINED shape)",
    file: "Probe.hpp",
    src: `enum class error_handler_t { strict, replace, ignore };\nclass R {\npublic:\n  bool parse(int fmt, bool strict = true) {\n    return fmt > 0 && strict;\n  }\n};\n`,
  },
  {
    id: "G. CONTROL: same class, parameter renamed so nothing shadows it",
    file: "Probe.hpp",
    src: `enum class error_handler_t { strict, replace, ignore };\nclass R {\npublic:\n  bool parse(int fmt, bool strictMode = true) {\n    return fmt > 0 && strictMode;\n  }\n};\n`,
  },
  {
    id: "H. local shadowing a file-scope int",
    file: "Probe.cpp",
    src: `int total = 0;\nint f(void) {\n  int total = 1;\n  return total;\n}\n`,
  },
]

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-cpp.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-cpp-analyzer"))

  for (const c of CASES) {
    const p = new P()
    p.setLanguage(LANG)
    const root = p.parse(c.src).rootNode
    const res: any = await new mod.RealCppAnalyzer().analyze(root, c.src, c.file)
    console.log(`\n=== ${c.id} ===`)
    console.log(`  source: ${JSON.stringify(c.src.split("\n")[0])}`)
    console.log(`  errors=${root.hasError}  symbols: ${res.symbols.length === 0 ? "(none)" : res.symbols.map((s: any) => `${s.kind}:${s.name}`).join(", ")}`)
    console.log(`  relationships: ${res.relationships.length === 0 ? "(none)" : res.relationships.map((r: any) => `${r.type}[${r.source}->${r.target}]`).join(", ")}`)
  }
}
main()
