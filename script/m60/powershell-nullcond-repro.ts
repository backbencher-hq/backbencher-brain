// Minimal repro for the null-conditional family, every form, with a control for
// each — because "?. works" and "?. does not break an ordinary ternary" are two
// different questions and the second is the one that can regress a corpus.
//
//   bun script/m60/powershell-nullcond-repro.ts [--grammar <wasm>]

import { Parser as TSParser, Language } from "web-tree-sitter"
import { readFileSync } from "fs"
import { join } from "path"

const ROOT = "$HOME/mcp/backbencher-brain"
const argv = process.argv.slice(2)
const GRAMMAR = argv.includes("--grammar") ? argv[argv.indexOf("--grammar") + 1] : join(ROOT, "wasm/tree-sitter-powershell.wasm")

const CASES: { id: string; src: string; control?: boolean }[] = [
  { id: "nullcond-member", src: "$a?.b\n" },
  { id: "nullcond-member-chain", src: "$a?.b.c\n" },
  { id: "nullcond-invoke", src: "$a?.b()\n" },
  { id: "nullcond-invoke-args", src: "$a?.b(1, 2)\n" },
  { id: "nullcond-element", src: "$a?[0]\n" },
  { id: "nullcond-static", src: "[int32]::MaxValue?.ToString()\n" },
  { id: "nullcond-chained", src: "${psObj}?.name?.nonExistent\n" },
  { id: "nullcond-cmd-paren", src: "(Get-Item $TestDrive)?.EnumerateFiles()?.Name\n" },
  { id: "nullcond-elem-range", src: "$a?[0..2]\n" },
  { id: "nullcond-assign-var", src: "$r = $a?.b\n" },
  { id: "nullcond-in-pipeline", src: "Get-Thing | ForEach-Object { $_.Name?.ToUpper() }\n" },
  // --- controls: each is the near-miss that a `?.` token could steal ---------
  { id: "CTL-ternary-member-arms", control: true, src: "$c ? $x.M : $y.N\n" },
  { id: "CTL-ternary-tight-left", control: true, src: "$c?$x : $y\n" },
  { id: "CTL-ternary-space-right", control: true, src: "$c ?$x.M : $y\n" },
  { id: "CTL-ternary-decimal-arm", control: true, src: "$c ? 0.5 : 1.5\n" },
  { id: "CTL-ternary-decimal-noSpace", control: true, src: "$c?0.5 : 1.5\n" },
  { id: "CTL-question-in-string", control: true, src: "$s = 'what? .5 : ok'\n" },
  { id: "CTL-question-in-comment", control: true, src: "# what? .5 : ok\n$x = 1\n" },
  { id: "CTL-optional-param", control: true, src: "function F($a) { param([switch]$Force) }\n" },
  { id: "CTL-null-cond", control: true, src: "$a = $null -eq $b\n" },
  { id: "CTL-dynamic-member", control: true, src: "$a.$b\n" },
  { id: "CTL-dotted-path", control: true, src: "Import-Module $PSScriptRoot\\..\\build.psm1\n" },
  { id: "CTL-ternary-space-then-dot5", control: true, src: "$c ?.5 : 1.5\n" },
  { id: "CTL-ternary-space-then-index", control: true, src: "$c ?[1,2] : $y\n" },
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
  rows.push({ id: c.id, control: !!c.control, err, missing, sexp: t?.rootNode.toString().slice(0, 150) })
  t?.delete?.()
}
p.delete?.()

const bad = rows.filter((r) => !r.control && r.err + r.missing > 0)
const brokenControls = rows.filter((r) => r.control && r.err + r.missing > 0)
console.log(`grammar: ${GRAMMAR.replace(ROOT + "/", "")}`)
for (const r of rows) {
  const mark = r.control ? (r.err + r.missing > 0 ? "CTL-BROKEN" : "ctl ok   ") : r.err + r.missing > 0 ? "BROKEN   " : "ok       "
  console.log(`  ${mark} ${r.id.padEnd(28)} ${r.err}e/${r.missing}m  ${r.sexp.replace(/\s+/g, " ").slice(0, 96)}`)
}
console.log("")
console.log(`null-conditional forms broken: ${bad.length}/${rows.filter((r) => !r.control).length}   ${bad.map((b) => b.id).join(", ") || "(none)"}`)
console.log(`CONTROLS broken: ${brokenControls.length}/${rows.filter((r) => r.control).length}   ${brokenControls.map((b) => b.id).join(", ") || "(none)"}`)
