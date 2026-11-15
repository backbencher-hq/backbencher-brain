// script/m14/tmp/oc-hdr-bisect.ts — why does AFAutoPurgingImageCache.h lose its
// declared surface, and can the differential ever see it?
//
// The F5 objc row over sdwebimage is CLEAN with headers in the universe
// (247 files, MISSING=0, unexplained=0). So if a header's protocols, methods and
// properties are missing from the analyzer's output, the ORACLE must be missing
// them too — a differential compares two sides, and agreement is not correctness.
// This prints, for one file:
//   analyzer symbols, oracle rows, and the same again with the file's macro
//   prologue stripped, so the trigger is isolated instead of assumed.
//
// Run: bun script/m14/tmp/oc-hdr-bisect.ts
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const FILE = "/home/ishaq2321/bb_tests/repositories/afnetworking/UIKit+AFNetworking/AFAutoPurgingImageCache.h"

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P: any = wts.Parser ?? wts.default ?? wts
  const L: any = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-objc.wasm")))
  const ocmod: any = await import(path.join(ROOT, "src/ast/real-objective-c-analyzer"))
  const diff: any = await import("../differential")

  const src = fs.readFileSync(FILE, "utf8")
  // Strip the macro prologue/annotations the grammar has no productions for.
  const stripped = src
    .split("\n")
    .filter((l) => !/^\s*(NS_ASSUME_NONNULL_BEGIN|NS_ASSUME_NONNULL_END|NS_SWIFT_NAME|UIKIT_EXTERN|FOUNDATION_EXPORT)\b/.test(l))
    .map((l) => l.replace(/\s+NS_SWIFT_NAME\([^)]*\)/, "").replace(/\s+API_AVAILABLE\([^)]*\)/, ""))
    .join("\n")

  // WHERE does it break? If the declarations survive as nodes INSIDE the ERROR
  // node, the analyzer can be taught to descend into them (an AST fix). If they
  // were flattened into unparsed text, no walker can see them (a grammar limit).
  {
    const p = new P(); p.setLanguage(lang)
    const root: any = p.parse(src).rootNode
    const kids: any[] = []
    for (let i = 0; i < root.childCount; i++) kids.push(root.child(i))
    console.log("=== tree shape of the REAL file (top level) ===")
    for (const k of kids) {
      const isErr = k.type === "ERROR" || k.isMissing
      const text = String(k.text).replace(/\s+/g, " ").slice(0, 70)
      console.log(`  ${isErr ? "ERR " : "    "}${String(k.type).padEnd(24)} [${k.startPosition.row + 1}..${k.endPosition.row + 1}]  ${text}`)
    }
    const err: any = kids.find((k) => k.type === "ERROR")
    if (err) {
      const inner: string[] = []
      const walk = (n: any, d = 0) => { if (d > 4) return; for (let i = 0; i < n.childCount; i++) { const c = n.child(i); inner.push(`${c.type}`); walk(c, d + 1) } }
      walk(err)
      const counts: Record<string, number> = {}
      for (const t of inner) counts[t] = (counts[t] ?? 0) + 1
      const interesting = Object.entries(counts).filter(([t]) => /class|method|property|protocol|identifier|declaration/.test(t)).sort((a, b) => b[1] - a[1]).slice(0, 12)
      console.log(`  ERROR node spans lines ${err.startPosition.row + 1}..${err.endPosition.row + 1}; descendant node types that matter:`)
      for (const [t, n] of interesting) console.log(`      ${t.padEnd(28)} ${n}`)
    }
  }

  for (const [label, text] of [["REAL", src], ["MACROS STRIPPED", stripped]] as const) {
    const p = new P(); p.setLanguage(lang)
    const root = p.parse(text).rootNode
    const r: any = await new ocmod.RealObjectiveCAnalyzer().analyze(root, text, FILE)
    const p2 = new P(); p2.setLanguage(lang)
    const truth: any[] = diff.deriveObjcEdges(p2.parse(text).rootNode) ?? []
    const kinds: Record<string, number> = {}
    for (const s of r.symbols ?? []) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1
    const protos = (r.symbols ?? []).filter((s: any) => /AFImageCache|AFImageRequestCache|AFAutoPurgingImageCache/.test(String(s.name)))
    console.log(`\n=== ${label} ===`)
    console.log(`  hasError=${root.hasError}  analyzer symbols=${(r.symbols ?? []).length} ${JSON.stringify(kinds)}`)
    console.log(`  oracle rows=${truth.length}`)
    console.log(`  analyzer rows naming a declared protocol/class: ${protos.length}`)
    for (const s of protos.slice(0, 8)) console.log(`      ${s.kind.padEnd(10)} ${s.name}`)
    const oracleNames = truth.map((t) => `${t.label}:${t.from}->${t.target}`).filter((s) => /AFImageCache|AFAutoPurging/.test(s))
    console.log(`  oracle rows naming one of them: ${oracleNames.length}`)
    for (const s of oracleNames.slice(0, 8)) console.log(`      ${s}`)
  }
}
main()
