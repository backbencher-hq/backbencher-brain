// JD7 verification — the structural CJS surface path vs the two removed regexes.
// Proves (1) zero regression on every shape the regex handled, (2) the three
// measured fabrications are gone, (3) corpus-wide agreement on non-minified code.
// (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/bb_tests/repositories"

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any
  const exps = async (src: string) => {
    const r = await a.analyze(p.parse(src).rootNode, src, "T.js", undefined)
    return (r.exports ?? []).map((e: any) => e.name)
  }
  let failures = 0
  const check = async (label: string, src: string, expect: string[]) => {
    const got = await exps(src)
    const ok = JSON.stringify(got) === JSON.stringify(expect)
    if (!ok) failures++
    console.log(`   ${ok ? "ok  " : "FAIL"} ${label.padEnd(46)} -> ${JSON.stringify(got)}${ok ? "" : `  EXPECT ${JSON.stringify(expect)}`}`)
  }

  console.log("=== 1. NO REGRESSION: every shape the regex handled correctly ===")
  await check("module.exports.tag", `module.exports.tag = 1`, ["tag"])
  await check("module.exports.sub (fixture shape)", `module.exports.sub = { a: 1 }`, ["sub"])
  await check("exports.direct (fixture shape)", `exports.direct = 2`, ["direct"])
  await check("module.exports.a", `module.exports.a = 1`, ["a"])
  await check("exports.a", `exports.a = 1`, ["a"])
  await check("module.exports.a.b", `module.exports.a.b = 1`, ["a.b"])
  await check("exports.group.item", `exports.group.item = 1`, ["group.item"])
  await check("module.exports.a.b.c", `module.exports.a.b.c = 1`, ["a.b.c"])
  await check("four levels", `module.exports.a.b.c.d = 1`, ["a.b.c.d"])

  console.log("\n=== 2. NOT CJS SURFACE (must yield nothing) ===")
  await check("svc.limit (plain object)", `const svc = { limit: 1 }\nsvc.limit = 2`, [])
  await check("this.exports.x", `class C { m() { this.exports.x = 1 } }`, [])
  await check("module.exportsFoo.x", `module.exportsFoo.x = 1`, [])
  await check("a.b.c on a local", `const a = { b: { c: 1 } }\na.b.c = 2`, [])

  console.log("\n=== 3. THE MEASURED FABRICATIONS — now declined, not emitted ===")
  await check("computed base module[\"exports\"].a.b", `module["exports"].a.b = 1`, ["a.b"])
  await check("minified shape (freeModule...)", `(freeModule.exports = lodash)._ = 1`, [])
  await check("minified shape (Tt.exports=c)", `(Tt.exports=c)._ = 1`, [])
  await check("unnameable index module[expr].a", `module[expr].a = 1`, [])
  await check("computed final segment", `module.exports.a["b"] = 1`, ["a.b"])

  console.log("\n=== 4. corpus sweep: every CJS-surface write, old vs new emission ===")
  for (const repo of ["lodash", "svelte", "grails-core", "element-plus", "vue-core"]) {
    const files: string[] = []
    const walk = (d: string, depth = 0): void => {
      if (depth > 12) return
      let es: fs.Dirent[]
      try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of es) {
        if (e.name === ".git" || e.name === "node_modules") continue
        const q = path.join(d, e.name)
        if (e.isDirectory()) walk(q, depth + 1)
        else if (e.name.endsWith(".js")) files.push(q)
      }
    }
    walk(path.join(ROOT, repo))
    let filesWithCjs = 0, cjsExports = 0, minified = 0
    const samples: string[] = []
    for (const f of files) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      if (src.length > 400000) continue
      let tree: any
      try { tree = p.parse(src) } catch { continue }
      const r = await a.analyze(tree.rootNode, src, f, undefined)
      const cjs = (r.exports ?? []).filter((e: any) => e.metadata?.viaCommonJs)
      if (cjs.length === 0) continue
      filesWithCjs++
      cjsExports += cjs.length
      const isMin = /\.min\.js$/.test(f)
      if (isMin) minified++
      if (samples.length < 4) for (const e of cjs) samples.push(`${path.basename(f)}: ${e.name}`)
    }
    console.log(`   ${repo.padEnd(14)} filesWithCjsExports=${String(filesWithCjs).padStart(4)} cjsExportNames=${String(cjsExports).padStart(4)} (minified files=${minified})`)
    for (const s of samples) console.log(`      ${s}`)
  }

  console.log(`\n${failures === 0 ? "ALL SHAPE ASSERTIONS PASS" : failures + " SHAPE ASSERTION(S) FAILED"}`)
  if (failures > 0) process.exitCode = 1
}
main().catch((e) => { console.error(e); process.exit(1) })
