// #917 sibling defect: a macro-wrapped heading whose FIRST macro argument is a
// POINTER type (`CMPP__EXPORT(void *, cmpp_mrealloc)(void *p, size_t n){…}`).
// The fixture refuses it as a different mechanism — this measures whether that
// refusal is still true with the #917 recovery in tree, and sizes the class.
import fs from "node:fs"
import path from "node:path"
const { parseFile } = await import(path.resolve("src/ast/engine.ts"))

const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const cLang = await L.load(fs.readFileSync("wasm/tree-sitter-c.wasm"))
const parser = new P()
parser.setLanguage(cLang)

const CASES: Array<[string, string]> = [
  [
    "value return (RECOVERED by #917)",
    `CMPP__EXPORT(int, cmpp_stream)( cmpp_input_f inF, void * inState ){\n  helperTarget();\n  return 0;\n}\n`,
  ],
  [
    "pointer return (the refused variant)",
    `CMPP__EXPORT(void *, cmpp_mrealloc)( void * p, size_t n ){\n  helperTarget();\n  return p;\n}\n`,
  ],
  [
    "pointer return, second spelling",
    `CMPP__EXPORT(const char *, cmpp_name)( void ){\n  helperTarget();\n  return 0;\n}\n`,
  ],
]

for (const [label, src] of CASES) {
  const r: any = await parseFile("probe.c", src, { language: "c" } as any)
  const syms = (r.symbols ?? []).map((s: any) => `${s.line}:${s.kind}:${s.name}`)
  const root = parser.parse(src).rootNode
  const rootKids: string[] = []
  for (let i = 0; i < root.childCount; i++) rootKids.push(root.child(i)!.type)
  console.log(`== ${label} ==`)
  console.log(`  root children: ${rootKids.join(", ")}`)
  console.log(`  symbols: ${syms.join(" | ") || "(none)"}`)
}

// Census: sqlite sites whose wrapping macro's first argument is a pointer type.
const REPO = "<corpus-root>/bb_tests/repositories/sqlite"
const files: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith(".c")) files.push(p)
  }
}
walk(REPO)

let sites = 0
const perFile = new Map<string, number>()
for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  // Only shapes that reach the analyzer as a heading: MACRO(...)(...) at line start.
  const re = /^([A-Za-z_][A-Za-z0-9_]*)\(([^()\n]*)\)\s*\(/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const first = (m[2].split(",")[0] ?? "").trim()
    if (!/\*$/.test(first)) continue
    if (first.includes('"')) continue
    sites++
    perFile.set(path.relative(REPO, f), (perFile.get(path.relative(REPO, f)) ?? 0) + 1)
  }
}
console.log(`\n== pointer-return wrapper census (sqlite .c) ==`)
console.log(`  sites: ${sites} across ${perFile.size} file(s)`)
for (const [f, n] of [...perFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`    ${n}  ${f}`)
}
