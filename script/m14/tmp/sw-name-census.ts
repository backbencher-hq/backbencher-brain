// script/m14/tmp/sw-name-census.ts — the swift lane's name-surface audit, at
// FULL EXTENT on both pinned corpora.
//
// The question #924 asks is the one a spelling-rule census can only answer
// against the lane's OWN output: is every published name a NAME? This walks
// every symbol name and every relationship target the analyzer publishes and
// classifies each against Swift's identifier rules, with the canonical
// non-identifier names the lane's contract allows (`constructor`, `deinit`,
// `subscript`, `operator <symbol>`, `anonymous_*`, dotted override targets,
// `module:`-style prefixes) counted, not ignored.
//
// Run: bun script/m14/tmp/sw-name-census.ts [capPerRepo]
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPOS = ["swift-nio", "alamofire"].map((r) => path.join("<corpus-root>/bb_tests/repositories", r))

function filesUnder(dir: string, out: string[] = []): string[] {
  let entries: any[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (!/^(\.|\.build|build|dist|\.git)/.test(e.name)) filesUnder(p, out) }
    else if (e.name.endsWith(".swift")) out.push(p)
  }
  return out
}

const CANONICAL = new Set(["constructor", "deinit", "subscript", "self", "root"])
const isIdentStart = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$"
const isIdentRest = (c: string): boolean => isIdentStart(c) || (c >= "0" && c <= "9")

/** A Swift identifier: `[A-Za-z_$][A-Za-z0-9_$]*`. */
function isIdentifier(s: string): boolean {
  if (!s) return false
  if (!isIdentStart(s[0])) return false
  for (let i = 1; i < s.length; i++) if (!isIdentRest(s[i])) return false
  return true
}

/** Operator overload spelling: `operator ==`, `operator <`, `operator []`. */
function isOperatorName(s: string): boolean {
  return s.startsWith("operator ") && s.length > "operator ".length
}

async function main() {
  const cap = Number(process.argv[2] ?? 10000)
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const LANG: any = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-swift.wasm")))
  const mod: any = await import(path.join(ROOT, "src/ast/real-swift-analyzer"))

  let files = 0, symbols = 0, targets = 0
  const illegalSymbols: string[] = []
  const illegalTargets: string[] = []
  const symbolClasses: Record<string, number> = {}
  const targetClasses: Record<string, number> = {}
  const distinctNames = new Set<string>()

  for (const repo of REPOS) {
    for (const f of filesUnder(repo).sort().slice(0, cap)) {
      files++
      const content = fs.readFileSync(f, "utf8")
      const p = new P()
      p.setLanguage(LANG)
      let r: any
      try { r = await new mod.RealSwiftAnalyzer().analyze(p.parse(content).rootNode, content, path.basename(f)) } catch { continue }
      const rel = path.relative(ROOT, f)
      for (const s of r.symbols ?? []) {
        symbols++
        const n = String(s.name ?? "")
        distinctNames.add(n)
        if (isIdentifier(n)) { symbolClasses["identifier"] = (symbolClasses["identifier"] ?? 0) + 1; continue }
        if (CANONICAL.has(n)) { symbolClasses["canonical:" + n] = (symbolClasses["canonical:" + n] ?? 0) + 1; continue }
        if (isOperatorName(n)) { symbolClasses["operator-overload"] = (symbolClasses["operator-overload"] ?? 0) + 1; continue }
        if (/^anonymous_/.test(n)) { symbolClasses["anonymous"] = (symbolClasses["anonymous"] ?? 0) + 1; continue }
        symbolClasses["ILLEGAL"] = (symbolClasses["ILLEGAL"] ?? 0) + 1
        if (illegalSymbols.length < 20) illegalSymbols.push(`${rel} ${s.kind} owner=${s.ownerName} name=${JSON.stringify(n)} L${s.range?.startLine}`)
      }
      for (const e of r.relationships ?? []) {
        targets++
        const t = String(e.target ?? "")
        if (isIdentifier(t)) { targetClasses["identifier"] = (targetClasses["identifier"] ?? 0) + 1; continue }
        if (CANONICAL.has(t) || t.includes(".") && isIdentifier(t.slice(t.lastIndexOf(".") + 1))) { targetClasses["canonical-or-dotted"] = (targetClasses["canonical-or-dotted"] ?? 0) + 1; continue }
        if (isOperatorName(t)) { targetClasses["operator-overload"] = (targetClasses["operator-overload"] ?? 0) + 1; continue }
        targetClasses["ILLEGAL"] = (targetClasses["ILLEGAL"] ?? 0) + 1
        if (illegalTargets.length < 20) illegalTargets.push(`${rel} ${e.type} ${e.source}->${JSON.stringify(t)} L${e.line_number}`)
      }
    }
  }

  console.log(`files=${files} symbols=${symbols} (distinct ${distinctNames.size}) relationship-targets=${targets}`)
  console.log("symbol classes:", JSON.stringify(symbolClasses))
  console.log("target classes:", JSON.stringify(targetClasses))
  for (const x of illegalSymbols) console.log("  ILLEGAL SYMBOL " + x)
  for (const x of illegalTargets) console.log("  ILLEGAL TARGET " + x)
  if ((symbolClasses["ILLEGAL"] ?? 0) + (targetClasses["ILLEGAL"] ?? 0) === 0) console.log("name census CLEAN: every published symbol name and relationship target is a name the lane's vocabulary allows")
}
main()
