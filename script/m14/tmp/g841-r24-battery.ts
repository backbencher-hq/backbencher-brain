// #841 r24 battery: targets, r17 casualty control, r17 landed shapes, tie-breakers
import fs from "node:fs"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync(process.argv[2] ?? "wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)
function verdict(src: string): string {
  const t = parser.parse(src).rootNode
  const errs: string[] = []
  const walk = (n: any): void => {
    if ((n.type === "ERROR" || n.isMissing) && n.endIndex > n.startIndex)
      errs.push(`${n.type}@r${n.startPosition.row + 1} len=${n.endIndex - n.startIndex}`)
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(t)
  return errs.length === 0 ? "CLEAN" : `ERR ${errs.slice(0, 2).join(",")}`
}
const CASES: Array<[string, string, string]> = [
  // targets
  ["T1 named-args multi (R24)", `def u = g.link controller: 'x', action: 'y', params: [p: 1], mapping: 'm', absolute: true\n`, "CLEAN"],
  ["T2 plain multi (SumController)", `int sum = sumService.sum 1, 2\n`, "CLEAN"],
  ["T3 multi in method body", `class C {\n  def m() {\n    String callbackUrl = g.link controller: 'x', action: 'y'\n  }\n}\n`, "CLEAN"],
  // r17 landed shapes must hold
  ["T4 single-arg (r17)", `def u = to UploadPage\n`, "CLEAN"],
  ["T5 named-arg single (r17)", `def u = g.link controller: 'x'\n`, "CLEAN"],
  ["T6 dotted callee (r17)", `def allMappings = evaluator.evaluateMappings mappings\n`, "CLEAN"],
  // refuted supersets must stay rejected
  ["R1 return foo bar", `def m() {\n  return foo bar\n}\n`, "ERR"],
  // tie-breaker controls
  ["C1 declarator list", `def a = 1, b = 2\n`, "CLEAN"],
  ["C2 method call parens map", `def u = g.link(controller: 'x', action: 'y')\n`, "CLEAN"],
  ["C3 statement multi-arg", `println 'a', 'b'\n`, "CLEAN"],
]
let fail = 0
for (const [name, src, want] of CASES) {
  const got = verdict(src)
  const ok = want === "ERR" ? got.startsWith("ERR") : got === want
  if (!ok) fail++
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${got}`)
}
console.log(fail === 0 ? "\nBATTERY GREEN" : `\n${fail} FAILURES`)
