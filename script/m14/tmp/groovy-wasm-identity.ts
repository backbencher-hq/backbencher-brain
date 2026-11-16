// Which groovy wasm is which? The repo ships wasm/tree-sitter-groovy.wasm
// (93fb188a, committed by the M12.06 grammar-patch commit) while the runtime's
// data-dir cache (~/.bb/wasm) holds a DIFFERENT binary (0e68bb48). The runtime
// tries the repo copy first and falls back to the cache, so an installed binary
// can parse with a grammar the repo never validated. This measures both on the
// exact M12 sample and on the constructs the M12.06 patch claims to add.
//
// Usage: bun run script/m14/tmp/groovy-wasm-identity.ts
import * as fs from "fs"
import * as path from "path"
import * as WTS from "web-tree-sitter"

import { createRequire } from "node:module"
const require = createRequire(import.meta.url)

const ROOT = "<corpus-root>/mcp/backbencher-brain"
const REPO = "<corpus-root>/bb_tests/repositories/grails-core"
const SAMPLE = ROOT + "/validation/m12/results/groovy-corpus-sample.txt"

const CANDIDATES: { label: string; file: string }[] = [
  { label: "repo wasm/ (runtime candidate #1)", file: ROOT + "/wasm/tree-sitter-groovy.wasm" },
  { label: "data-dir ~/.bb/wasm (candidate #3)", file: path.join(process.env.HOME || "", ".bb/wasm/tree-sitter-groovy.wasm") },
]

function census(root: any): { err: boolean; miss: boolean } {
  const st = { err: false, miss: false }
  const stack: any[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()
    if (n.type === "ERROR") st.err = true
    if (n.isMissing) st.miss = true
    if (st.err && st.miss) break
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) stack.push(c)
    }
  }
  return st
}

// The M12.06 patch's own construct matrix — the cells the patch claims to fix.
const CONSTRUCTS: { label: string; src: string }[] = [
  { label: "untyped param  def dyn(arg)", src: "class A { def dyn(arg) { arg } }\n" },
  { label: "safe-nav ?.", src: "class A { def m(o) { return o?.name } }\n" },
  { label: "spread *.", src: "class A { def m(list) { return list*.name } }\n" },
  { label: "elvis ?:", src: "class A { def m(a, b) { return a ?: b } }\n" },
  { label: "trait", src: "trait Audited { def audit() { 1 } }\n" },
  { label: "as cast", src: "class A { def m(o) { def x = o as String } }\n" },
  { label: "empty map [:]", src: "class A { def m() { return [:] } }\n" },
  { label: "newline-terminated field", src: "class A {\n  private test\n  private String mode\n}\n" },
  { label: "unbraced body then stmt", src: "class A { def m(flag) { if (flag) throw new IllegalStateException('x')\n  return 1 } }\n" },
  { label: "local decl then use (delimited)", src: "class A { def m() { def x = 1; return x } }\n" },
  { label: "local decl then use (newline)", src: "class A {\n  def m() {\n    def x = 1\n    return x\n  }\n}\n" },
  { label: "gstring nested quotes", src: "class A { def m(s) { return \"(${s.join('$|')})\" } }\n" },
  { label: "spock string method", src: "class A { def \"a thing works\"() { 1 } }\n" },
  { label: "enum with ctor args", src: "enum C(String h) { RED('#f00') }\n" },
  { label: "command chain single arg", src: "class A { def m() { println \"hi\" } }\n" },
]

async function load(wts: any, file: string): Promise<any> {
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  const grammar = await Language.load(fs.readFileSync(file))
  const P = new Parser()
  P.setLanguage(grammar)
  return P
}

async function main() {
  const wts: any = WTS
  const Parser = wts.Parser ?? wts.default ?? wts
  await Parser.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })

  const sampleRels = fs
    .readFileSync(SAMPLE, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const sampleSrc = sampleRels.map((r) => {
    try {
      return fs.readFileSync(path.join(REPO, r), "utf8")
    } catch {
      return null
    }
  })

  for (const c of CANDIDATES) {
    if (!fs.existsSync(c.file)) {
      console.log("\n=== " + c.label + " — ABSENT ===")
      continue
    }
    console.log("\n=== " + c.label + " ===")
    console.log("   sha256 " + require("crypto").createHash("sha256").update(fs.readFileSync(c.file)).digest("hex").slice(0, 16) + "  " + fs.statSync(c.file).size + " bytes")
    const P = await load(wts, c.file)

    let files = 0, err = 0, miss = 0, either = 0
    for (const src of sampleSrc) {
      if (src === null) continue
      let root: any
      try {
        root = P.parse(src).rootNode
      } catch {
        err++; either++; files++
        continue
      }
      const st = census(root)
      files++
      if (st.err) err++
      if (st.miss) miss++
      if (st.err || st.miss) either++
    }
    console.log("   M12 sample (400): ERROR " + err + " | MISSING " + miss + " | either " + either + "  (" + ((either / Math.max(1, files)) * 100).toFixed(1) + "%)")

    console.log("   construct matrix:")
    for (const ct of CONSTRUCTS) {
      let root: any
      let thrown = false
      try {
        root = P.parse(ct.src).rootNode
      } catch {
        thrown = true
      }
      const st = thrown ? { err: true, miss: false } : census(root)
      const verdict = st.err ? "ERROR" : st.miss ? "MISSING" : "clean"
      console.log("     " + (verdict === "clean" ? "ok   " : "FAIL ") + ct.label.padEnd(34) + " " + verdict)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
