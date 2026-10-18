/**
 * c-k1-loss-probe — one-off forensic instrument for the K1 arm-A deviation (D7 measurement change).
 * K1 withdrew 43 calls edges where the prediction table said 35 (all non-resolved). To NAME the extra 8
 * rather than guess: (a) symbols whose NAME is a keyword or a non-identifier spelling — the targets K1
 * refuses, so a RESOLVED call to one of them explains a resolved-withdrawal; (b) calls whose target has the
 * same spellings, with whether the name is also a symbol in the scanned set. Light: parses only the files
 * given (the corpus's `$`-token files + the files whose rows K1 withdrew).
 *
 * usage: bun run script/m14/c-k1-loss-probe.ts <file1> [file2 ...]
 */
import * as fs from "node:fs"
import { getParser } from "$HOME/mcp/backbencher-brain/src/ast/engine"
import { RealCAnalyzer } from "$HOME/mcp/backbencher-brain/src/ast/real-c-analyzer"
const C_KEYWORDS = new Set(["if","else","for","while","do","switch","case","default","break","continue","return","goto","sizeof","typedef","struct","union","enum","static","extern","inline","register","volatile","const","auto","signed","unsigned","void","char","short","int","long","float","double","_Bool","_Complex","_Imaginary","restrict","_Alignas","_Alignof","_Atomic","_Generic","_Noreturn","_Static_assert","_Thread_local"])
const isIdent = (s: string): boolean => {
  if (s.length === 0) return false
  const c0 = s.charCodeAt(0)
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return false
  for (let i = 1; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95)) return false
  }
  return true
}
const interesting = (s: string): boolean => C_KEYWORDS.has(s) || !isIdent(s)
const parser: any = await getParser("c")
const analyzer = new RealCAnalyzer()
const symbolNames = new Set<string>()
const outputs: Array<{ file: string; src: string; r: any }> = []
for (const abs of process.argv.slice(2)) {
  let src = ""
  try { src = fs.readFileSync(abs, "utf8") } catch { continue }
  const r: any = await analyzer.analyze(parser.parse(src).rootNode, src, abs)
  outputs.push({ file: abs, src, r })
  for (const s of r.symbols ?? []) if (interesting(String(s.name ?? ""))) symbolNames.add(String(s.name))
}
console.log(`# files scanned: ${outputs.length}; interesting SYMBOL names (keyword or non-identifier spelling): ${symbolNames.size}`)
for (const n of [...symbolNames].slice(0, 40)) console.log(`  symbol-name: ${n}`)
let callsInteresting = 0
for (const { file, r } of outputs) {
  for (const e of r.relationships ?? []) {
    if (String(e.type) !== "calls") continue
    const t = String(e.target ?? "")
    if (!interesting(t)) continue
    callsInteresting++
    const resolvesHere = symbolNames.has(t)
    console.log(`  call ${file}: ${e.source} -> ${JSON.stringify(t)} @${e.line_number} symbol-in-scanned-set=${resolvesHere}`)
  }
}
console.log(`# calls to interesting spellings across scanned files: ${callsInteresting}`)
