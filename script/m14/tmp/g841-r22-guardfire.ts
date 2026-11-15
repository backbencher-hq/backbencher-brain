// #841 round 22: does the r14 misparse signature (root-level `class` fragments /
// guard-fireable juxt nodes) still occur anywhere in the corpus?
import fs from "node:fs"
import path from "node:path"
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => "node_modules/web-tree-sitter/tree-sitter.wasm" })
const lang = await L.load(fs.readFileSync("wasm/tree-sitter-groovy.wasm"))
const parser = new P(); parser.setLanguage(lang)

let files = 0, rootClassFrag = 0, juxtGuardCandidates = 0
const examples: string[] = []
const walk = (d: string) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) { if (e.name !== ".git" && e.name !== "node_modules") walk(p) }
    else if (e.name.endsWith(".groovy")) {
      files++
      try {
        const src = fs.readFileSync(p, "utf8")
        const root = parser.parse(src).rootNode
        // r14 signature A: root-level `class` keyword fragment (degraded trees only)
        let hasFrag = false
        for (let i = 0; i < root.childCount; i++) {
          const c = root.child(i)
          if (c && c.type === "class") { hasFrag = true; break }
        }
        if (hasFrag) {
          rootClassFrag++
          if (examples.length < 6) examples.push(path.relative(CORPUS, p))
        }
        // r14 signature B: juxt nodes the guard would inspect (capitalized dotted callee + bare-id args)
        const walk2 = (n: any): void => {
          if (n.type === "juxt_function_call") {
            const name = n.childForFieldName?.("name") ?? n.child(0)
            if (name && /^[A-Z][A-Za-z0-9_.]*$/.test(name.text.trim())) {
              const args = n.childForFieldName?.("args")
              if (args && /^[A-Za-z_][A-Za-z0-9_.]*(\s*,\s*[A-Za-z_][A-Za-z0-9_.]*)*$/.test(args.text.trim())) juxtGuardCandidates++
            }
          }
          for (let i = 0; i < n.childCount; i++) walk2(n.child(i))
        }
        walk2(root)
      } catch {}
    }
  }
}
walk(CORPUS)
console.log(`files scanned: ${files}`)
console.log(`files with ROOT-LEVEL class fragment (r14 recovery trigger): ${rootClassFrag}`)
for (const e of examples) console.log(`   ${e}`)
console.log(`guard-candidate juxt nodes (capitalized callee, bare-id args): ${juxtGuardCandidates}`)
