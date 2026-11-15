// Header-half surface census: how much of the declared surface does the
// bare-macro swallow actually destroy, across every objc-routed file in the
// lane's two pinned repos?
//
// Method: parse the file as-is, then parse it again with the Foundation
// nullability prologue/epilogue macro lines neutralised into comments (line
// numbers preserved). The neutralised parse is the ceiling the grammar could
// reach; the difference is surface the parse cost. `//` keeps every other byte
// and every line number identical, so the two trees are directly comparable.
//
// The oracle walks the same tree, so no differential can see this (the #743 c
// review makes the same point: "F5 cannot tell a removed phantom from a lost
// edge"). This is the analyzer-side instrument.
import * as fs from "fs"
import * as path from "path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = "/home/ishaq2321/bb_tests/repositories"

const PROLOGUE = /^\s*(NS_ASSUME_NONNULL_BEGIN|NS_ASSUME_NONNULL_END)\s*$/

const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const ocLang: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-objc.wasm")))
const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection"))
const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
const analyzer = new ocmod.RealObjectiveCAnalyzer()

function walk(d: string, out: string[]) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      if (e.name === ".git" || e.name === "Pods" || e.name.includes("xcodeproj")) continue
      walk(p, out)
    } else if (/\.(m|h)$/.test(e.name)) out.push(p)
  }
}

async function measure(file: string) {
  const src = fs.readFileSync(file, "utf8")
  const routed = detectLanguageFromPath(path.basename(file), src)
  if (routed !== "objective-c") return null
  const lines = src.split("\n")
  const neutral = lines.map((l) => (PROLOGUE.test(l) ? "//" + l : l)).join("\n")
  const hadMacro = neutral !== src

  async function run(text: string) {
    const p = new P()
    p.setLanguage(ocLang)
    const tree: any = p.parse(text)
    const res: any = await analyzer.analyze(tree.rootNode, text, file)
    return {
      err: tree.rootNode.hasError as boolean,
      errNodes: (tree.rootNode.descendantsOfType?.("ERROR") ?? []).length,
      syms: (res.symbols ?? []) as any[],
      rels: (res.relationships ?? []) as any[],
    }
  }

  const a = await run(src)
  const b = hadMacro ? await run(neutral) : a
  // Real surface = class/protocol/method/property/function symbols.
  const real = (syms: any[]) =>
    syms.filter((s) => !["variable", "import"].includes(String(s.kind))).length
  return {
    file: file.replace(REPOS + "/", ""),
    hadMacro,
    err: a.err,
    errNodes: a.errNodes,
    syms: a.syms.length,
    symsN: b.syms.length,
    real: real(a.syms),
    realN: real(b.syms),
    rels: a.rels.length,
    relsN: b.rels.length,
    kinds: [...new Set(a.syms.map((s) => String(s.kind)))].sort().join("/"),
  }
}

const files: string[] = []
for (const repo of ["sdwebimage", "afnetworking"]) walk(path.join(REPOS, repo), files)

const rows = (await Promise.all(files.map(measure))).filter(Boolean) as any[]
const m = rows.filter((r) => r.file.endsWith(".m"))
const h = rows.filter((r) => r.file.endsWith(".h"))

console.log(`objc-routed files: ${rows.length}  (.m ${m.length}, .h ${h.length})`)
for (const [label, set] of [["all", rows], [".m", m], [".h", h]] as const) {
  const withErr = set.filter((r) => r.err).length
  const macro = set.filter((r) => r.hadMacro).length
  const lost = set.filter((r) => r.realN > r.real)
  const lostSyms = lost.reduce((n, r) => n + (r.realN - r.real), 0)
  console.log(
    `${label.padEnd(4)} hasError=${String(withErr).padStart(3)}  withNullabilityMacro=${String(macro).padStart(3)}  ` +
      `filesLosingSurface=${String(lost.length).padStart(3)}  realSymbolsLost=${String(lostSyms).padStart(4)}`,
  )
}

console.log(`\n-- files losing > 2 real symbols (original -> neutralised) --`)
const worst = rows.filter((r) => r.realN - r.real > 2).sort((x, y) => y.realN - y.real - (x.realN - x.real))
for (const r of worst.slice(0, 25)) {
  console.log(
    `  ${String(r.real).padStart(3)} -> ${String(r.realN).padStart(3)}  ` +
      `rels ${String(r.rels).padStart(4)} -> ${String(r.relsN).padStart(4)}  ` +
      `errNodes ${String(r.errNodes).padStart(3)}  ${r.file}`,
  )
}
console.log(`  (${worst.length} such files)`)
process.exit(0)
