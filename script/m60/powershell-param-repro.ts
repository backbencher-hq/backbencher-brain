// G1 — a script-level `param()` block that is not the first thing in the file.
//
//   bun script/m60/powershell-param-repro.ts [--grammar <wasm>]
//
// PowerShell's own rule: in a SCRIPT FILE the `param` block must be the first
// *statement*, but `using` statements may precede it. So `using namespace X` +
// `param(...)` is the ordinary shape for any script that needs a type and takes
// parameters — and .psm1 files are REQUIRED to declare `using module` when they
// need types, so this is the common shape for the language's own module surface,
// not an exotic one.
//
// The class is dangerous precisely because it is INVISIBLE to hasError-keyed
// gates: `using namespace …` followed by `param(…)` parses with hasError=false
// and silently loses every parameter. So every case here reports BOTH the error
// count and whether the parameters SURVIVED, and the control is the same script
// with the `using` line removed.

import { Parser as TSParser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = "$HOME/mcp/backbencher-brain"
const argv = process.argv.slice(2)
const GRAMMAR = argv.includes("--grammar") ? argv[argv.indexOf("--grammar") + 1] : join(ROOT, "wasm/tree-sitter-powershell.wasm")

const CASES: { id: string; src: string; control?: boolean; params: string[] }[] = [
  { id: "param-first", params: ["$Name"], src: "param($Name)\nWrite-Output $Name\n" },
  { id: "G1-using-namespace-then-param", params: ["$Name", "$Force"], src: "using namespace System.IO\nparam($Name, [switch]$Force)\nWrite-Output $Name\n" },
  { id: "G1-using-module-then-param", params: ["$Name"], src: "using module Utils\nparam($Name)\nWrite-Output $Name\n" },
  { id: "G1-two-using-then-param", params: ["$A", "$B"], src: "using namespace System.IO\nusing namespace System.Text\nparam($A, $B)\nWrite-Output $A\n" },
  { id: "G1-using-assembly-then-param", params: ["$X"], src: "using assembly System.Runtime\nparam($X)\nWrite-Output $X\n" },
  { id: "G1-comment-between", params: ["$Name"], src: "using namespace System.IO\n# a comment\nparam($Name)\nWrite-Output $Name\n" },
  { id: "G1-typed-params", params: ["Name", "Count"], src: "using namespace System.IO\nparam([string]$Name, [int]$Count = 0)\nWrite-Output $Name\n" },
  { id: "G1-validate-attr", params: ["Mode"], src: "using namespace System.IO\nparam([ValidateSet('a','b')][string]$Mode = 'a')\nWrite-Output $Mode\n" },
  { id: "G1-attr-no-using", control: true, params: ["Mode"], src: "param([ValidateSet('a','b')][string]$Mode = 'a')\nWrite-Output $Mode\n" },
  { id: "G1-typed-params-no-using", control: true, params: ["Name", "Count"], src: "param([string]$Name, [int]$Count = 0)\nWrite-Output $Name\n" },
  { id: "CTL-using-only", control: true, params: [], src: "using namespace System.IO\nWrite-Output 1\n" },
  { id: "CTL-param-empty", control: true, params: [], src: "param()\nWrite-Output 1\n" },
  { id: "CTL-param-then-using", control: true, params: ["$N"], src: "param($N)\nusing namespace System.IO\nWrite-Output $N\n" },
  { id: "CTL-using-as-command", control: true, params: [], src: "using stuff\nWrite-Output 1\n" },
  { id: "CTL-function-param-after-stmt", control: true, params: [], src: "function F { Write-Output 1\n  param($a) }\n" },
]

await TSParser.init({ locateFile: () => join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await Language.load(readFileSync(GRAMMAR))
const p = new TSParser()
p.setLanguage(lang)

const rows: any[] = []
for (const c of CASES) {
  const t = p.parse(c.src)
  let err = 0, missing = 0
  const walk = (n: any): void => { if (n.isError) err++; if (n.isMissing) missing++; for (let i = 0; i < n.childCount; i++) walk(n.child(i)) }
  if (t) walk(t.rootNode)
  // Did the parameters SURVIVE as script_parameter nodes? This is the question
  // hasError cannot answer, and the whole reason the class is dangerous.
  const found: string[] = []
  const collect = (n: any): void => {
    if (n.type === "script_parameter") {
      const v = n.descendantsOfType?.(["variable", "simple_name"])?.[0]
      found.push(v?.text ?? "?")
    }
    for (let i = 0; i < n.childCount; i++) collect(n.child(i))
  }
  if (t) collect(t.rootNode)
  const sexp = t?.rootNode.toString() ?? ""
  // Compare NORMALISED names. This matcher first compared raw text, so a case
  // written `param([string]$Name, …)` reported its parameters as LOST because the
  // expected list said `Name` and the tree said `$Name` — and the instrument then
  // printed two CONTROLS as broken that had `0e/0m` and `params 1/1` sitting right
  // there in the same row. A control that cries wolf is worse than no control,
  // because the next real failure gets read as more of the same.
  const bare = (x: string) => x.replace(/^\$/, "").replace(/^@/, "").toLowerCase()
  rows.push({
    id: c.id, control: !!c.control, err, missing,
    hasParamBlockNode: /param_block/.test(sexp),
    expected: c.params, found,
    lost: c.params.filter((x) => !found.some((y) => bare(y) === bare(x))),
  })
  t?.delete?.()
}
p.delete?.()

console.log(`grammar: ${GRAMMAR.replace(ROOT + "/", "")}`)
console.log("")
for (const r of rows) {
  const lost = r.lost.length
  const mark = r.control
    ? (r.err + r.missing > 0 ? "CTL-BROKEN" : "ctl ok   ")
    : lost > 0 || r.err + r.missing > 0 ? "LOST     " : "ok       "
  console.log(`  ${mark} ${r.id.padEnd(34)} ${String(r.err)}e/${String(r.missing)}m  param_block=${r.hasParamBlockNode ? "yes" : "NO "}  params ${r.found.length}/${r.expected.length}${lost ? `  LOST: ${r.lost.join(",")}` : ""}`)
}
console.log("")
const cases = rows.filter((r) => !r.control)
const controls = rows.filter((r) => r.control)
const lostCases = cases.filter((r) => r.lost.length > 0)
const brokenControls = controls.filter((r) => r.err + r.missing > 0 || r.lost.length > 0)
console.log(`param cases with LOST parameters : ${lostCases.length}/${cases.length}   ${lostCases.map((b) => b.id).join(", ") || "(none)"}`)
console.log(`SILENT (hasError=false but params lost): ${lostCases.filter((r) => r.err + r.missing === 0).map((r) => r.id).join(", ") || "(none)"}`)
console.log(`controls broken                   : ${brokenControls.length}/${controls.length}   ${brokenControls.map((b) => b.id).join(", ") || "(none)"}`)
