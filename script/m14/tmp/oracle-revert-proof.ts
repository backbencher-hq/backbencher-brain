// "Proven by revert" for the two oracle gates added this round. A gate that
// cannot fail is not a gate.
//
//  SCAD11: the REAL pre-fix oracle module (git show HEAD:script/m14/differential.ts,
//          copied to /tmp) is exercised on the probe snippet — no wasm init of
//          its own is needed for deriveTreeEdges, so its OWN code answers.
//  VUED11: the pre-#906 dispatch is re-run at the level that changed — the
//          script block parsed with the JAVASCRIPT grammar (what its
//          /lang=["']ts["']/ test chose for lang="tsx") and fed to the SAME
//          deriveTypeScriptEdges the oracle uses today, so the comparison
//          isolates the dispatch and nothing else. (The full pre-fix module
//          cannot be loaded twice in one process: a second web-tree-sitter
//          wasm instantiation aborts the runtime.)
import fs from "node:fs"
import path from "node:path"
import { execSync } from "node:child_process"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
// Materialise the PRE-FIX oracle from git rather than depending on a /tmp
// artifact. Self-locating: the commit that introduced the privacy helper is
// found by pickaxe, and its parent is the oracle as it stood before #905 (a
// fixed SHA would go stale as later rounds land).
const intro = execSync(
  `git log -S scalaMemberIsBarePrivate --format=%H -- script/m14/differential.ts`,
  { cwd: ROOT },
).toString().trim().split("\n").filter(Boolean)
const preRev = intro.length > 0 ? `${intro[intro.length - 1]}^` : "HEAD"
const prefixPath = "/tmp/bb-prefix-differential.ts"
fs.writeFileSync(prefixPath, execSync(`git show ${preRev}:script/m14/differential.ts`, { cwd: ROOT })
  .toString()
  .replace(/"\.\.\/\.\.\/src/g, `"${ROOT}/src`)
  .replace(/"\.\//g, `"${ROOT}/script/m14/`))
console.log(`pre-fix oracle: ${preRev} -> ${prefixPath}`)

const pre: any = await import(prefixPath)
const fixed: any = await import(path.join(ROOT, "script/m14/differential.ts"))
const wts: any = await import("web-tree-sitter")
const P: any = wts.Parser ?? wts.default ?? wts
const L: any = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const mk = async (wasm: string) => {
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", wasm)))
  const p = new P()
  p.setLanguage(lang)
  return p
}
const eng: any = await import(path.join(ROOT, "src/ast/engine.ts"))

let bad = 0

// ── SCAD11 (real pre-fix oracle) ────────────────────────────────────────
const scalaSrc = [
  "package probe", "", "trait Base {",
  "  private def secret(x: Int): Int = 1",
  "  private[probe] def scoped(x: Int): Int",
  "  def open(x: Int): Int",
  "}", "", "class Child extends Base {",
  "  def secret(x: Int): Int = 2",
  "  def scoped(x: Int): Int = 3",
  "  def open(x: Int): Int = 4",
  "}", "",
].join("\n")
{
  const scala = await mk("tree-sitter-scala.wasm")
  const root = scala.parse(scalaSrc).rootNode
  const key = (e: any) => `${e.label}:${e.target}`
  const preOv = new Set<string>(pre.deriveTreeEdges(root, "scala").filter((e: any) => e.label === "overrides").map(key))
  const postOv = new Set<string>(fixed.deriveTreeEdges(root, "scala").filter((e: any) => e.label === "overrides").map(key))
  const forbidden = "overrides:Base.secret"
  const control = "overrides:Base.scoped"
  console.log(`SCAD11 pre-fix oracle:  forbidden ${forbidden} ${preOv.has(forbidden) ? "DERIVED — the probe would fail (oracle colludes)" : "absent (no defect reproduced)"}`)
  console.log(`SCAD11 post-fix oracle: forbidden ${forbidden} ${postOv.has(forbidden) ? "STILL DERIVED (fix failed)" : "absent — the probe passes"}`)
  console.log(`SCAD11 control: qualified private ${control} pre=${preOv.has(control)} post=${postOv.has(control)} (must be true/true)`)
  if (!preOv.has(forbidden)) bad++
  if (postOv.has(forbidden)) bad++
  if (!preOv.has(control) || !postOv.has(control)) bad++
}

// ── VUED11 (dispatch-level revert) ──────────────────────────────────────
const vueSrc = [
  `<script lang="tsx" setup>`,
  `import { ref } from 'vue'`,
  ``,
  `type Props = {`,
  `  value: boolean`,
  `  ariaLabel?: string`,
  `  onChange: (value: string) => void`,
  `}`,
  ``,
  `const Cell: FunctionalComponent<Props> = ({ value, onChange }) => {`,
  `  return (`,
  `    <ElCheckbox`,
  `      onChange={onChange}`,
  `      modelValue={value}`,
  `    />`,
  `  )`,
  `}`,
  ``,
  `const generateColumns = (length = 10, prefix = 'column-') =>`,
  `  Array.from({ length }).map((_, i) => ({ key: \`\${prefix}\${i}\` }))`,
  ``,
  `const columns = generateColumns(10)`,
  `</script>`,
  `<template><div /></template>`,
  ``,
].join("\n")
{
  const vue = await mk("tree-sitter-vue.wasm")
  const root = vue.parse(vueSrc).rootNode
  const jsParser = await mk("tree-sitter-javascript.wasm")
  const blocks = eng.ASTEngine.extractSfcScriptBlocks(root, vueSrc)
  const derive = (t: any) => {
    const out = new Set<string>()
    for (const e of fixed.deriveTypeScriptEdges(t)) out.add(`${e.label}:${e.target}`)
    return out
  }
  // old dispatch: `isTs = /lang=["']ts["']/` -> lang="tsx" fell to javascript
  const preSet = derive(jsParser.parse(blocks[0].body).rootNode)
  const postSet = new Set<string>()
  for (const t of await fixed.deriveEmbeddedScriptTrees(root, vueSrc, "vue")) for (const x of derive(t)) postSet.add(x)
  const want = ["calls:generateColumns", "calls:from", "calls:map"]
  const forbid = ["calls:return", "calls:key", "calls:string", "calls:if"]
  const fmt = (s: Set<string>, names: string[]) => names.filter((n) => s.has(n)).join(",") || "none"
  console.log(`\nVUED11 pre-fix dispatch (js grammar): derived real=[${fmt(preSet, want)}] invented keywords=[${fmt(preSet, forbid)}]`)
  console.log(`VUED11 post-fix dispatch (tsx):      derived real=[${fmt(postSet, want)}] invented keywords=[${fmt(postSet, forbid)}]`)
  const preFails = forbid.some((f) => preSet.has(f)) || want.some((w) => !preSet.has(w))
  const postPasses = !forbid.some((f) => postSet.has(f)) && want.every((w) => postSet.has(w))
  console.log(`VUED11 pre-fix would FAIL the probe: ${preFails}; post-fix passes: ${postPasses}`)
  if (!preFails || !postPasses) bad++
}

console.log(`\nrevert proof: ${bad === 0 ? "PASS — both gates are load-bearing" : `FAIL (${bad} problem(s))`}`)
process.exit(bad === 0 ? 0 : 1)
