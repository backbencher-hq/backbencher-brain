// Groovy wasm rebuild check: /tmp/groovy-new.wasm vs wasm/tree-sitter-groovy.wasm.
// 1) construct matrix (the 15 cells #742's evidence lists, 4 recorded-failed)
// 2) the exact M12 400-file sample (first-400 sorted grails-core)
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const GR = "<corpus-root>/bb_tests/repositories/grails-core"

const CONSTRUCTS: Array<[string, string, "clean" | "missing" | "either"]> = [
  ["untyped param", "def dyn(arg) { return arg }", "clean"],
  ["safe-nav ?.", "def x = obj?.prop", "clean"],
  ["spread *.", "def x = list*.name", "clean"],
  ["elvis ?:", "def x = val ?: fallback", "clean"],
  ["trait", "trait T { def m() { 1 } }", "clean"],
  ["as cast", "def x = o as String", "clean"],
  ["empty map [:]", "def m = [:]", "clean"],
  ["newline-terminated field", "class A {\n  def f = 1\n  def g = 2\n}", "clean"],
  ["unbraced body then stmt", "class A {\n  def m()\n\n  def other() { 1 }\n}", "clean"],
  ["local decl then use (delimited)", "def m() {\n  def x = 1;\n  return x\n}", "clean"],
  ["local decl then use (newline)", "def m() {\n  def x = 1\n  return x\n}", "clean"],
  ["gstring nested quotes", 'def s = "name=${obj."field"}"', "either"],
  ["spock string method", "def x = obj.someMethod() >> { 1 }", "either"],
  ["enum with ctor args", "enum E {\n  A(1), B(2)\n  E(int v) {}\n}", "clean"],
  ["command chain single arg", "def m() {\n  widget width 100\n}", "either"],
]

async function load(wasmPath: string) {
  await WTS.Parser.init()
  const Lang = await WTS.Language.load(wasmPath)
  const p = new WTS.Parser()
  p.setLanguage(Lang)
  return p
}

function hasError(node: WTS.Node): { err: number; missing: number } {
  let err = 0, missing = 0
  const visit = (n: WTS.Node) => {
    if (n.type === "ERROR") err++
    if (n.isMissing) missing++
    const c = n.namedChildCount
    for (let i = 0; i < c; i++) visit(n.namedChild(i))
  }
  visit(node)
  return { err, missing }
}

async function run(p: WTS.Parser, label: string) {
  console.log(`\n=== ${label} — construct matrix ===`)
  let fail = 0
  for (const [name, src, expect] of CONSTRUCTS) {
    const t = p.parse(src)
    const { err, missing } = hasError(t.rootNode)
    const bad = err + missing
    const ok = expect === "clean" ? bad === 0 : expect === "missing" ? err === 0 : true
    if (!ok) fail++
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ERROR=${err} MISSING=${missing}`)
  }
  return fail
}

async function main() {
  const which = process.argv[2] ?? "both"

  if (which === "new" || which === "both") {
    const pNew = await load("/tmp/groovy-new.wasm")
    const failNew = await run(pNew, "NEW /tmp/groovy-new.wasm")
    // exact M12 sample
    const files = fs.readdirSync(GR).filter((f) => f.endsWith(".groovy")).sort()
    const sample = files.slice(0, 400)
    const rel = (f: string) => f
    let errCount = 0, missCount = 0
    for (const f of sample) {
      const full = path.join(GR, f)
      if (!fs.statSync(full).isFile()) continue
      const src = fs.readFileSync(full, "utf8")
      const t = pNew.parse(src)
      const h = hasError(t.rootNode)
      if (h.err) errCount++
      else if (h.missing) missCount++
    }
    console.log(`\nNEW: M12 first-400 sample: ERROR ${errCount} | MISSING ${missCount} | either ${errCount + missCount} (${((errCount + missCount) / 4 * 10).toFixed(1)}%)`)

    // full-corpus-ish: sample 600 across all .groovy/.gradle for a broader signal
    const all: string[] = []
    const walk = (d: string) => {
      for (const f of fs.readdirSync(d)) {
        const full = path.join(d, f)
        const st = fs.statSync(full)
        if (st.isDirectory()) { if (!full.includes("/.git")) walk(full) }
        else if (/\.(groovy|gradle|jenkinsfile)$/i.test(f) || f === "Jenkinsfile") all.push(full)
      }
    }
    walk(GR)
    let ferr = 0, fmiss = 0
    for (const f of all) {
      const t = pNew.parse(fs.readFileSync(f, "utf8"))
      const h = hasError(t.rootNode)
      if (h.err) ferr++
      else if (h.missing) fmiss++
    }
    console.log(`NEW: full grails-core (${all.length} files): ERROR ${ferr} | MISSING ${fmiss} | either ${ferr + fmiss} (${((ferr + fmiss) / all.length * 100).toFixed(1)}%)`)
  }

  if (which === "old" || which === "both") {
    const pOld = await load(path.join(ROOT, "wasm/tree-sitter-groovy.wasm"))
    const failOld = await run(pOld, "OLD committed wasm")
    console.log(`OLD: construct failures: ${failOld}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
