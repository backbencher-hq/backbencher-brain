/** THE ACCEPTANCE'S HARDEST CLAUSE, MEASURED: after the wiring, does ANY re-spelled edge name a module
 *  that is NOT in the project? R2's rule (leaf-in-index) produced 1,798 of those; this run must show 0. */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import * as mod from "../src/ast/project-index"
import { parseFile } from "../src/ast/pool-worker"
const CR = "/home/ishaq2321/bb_tests/repositories"
const WASM = "/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-java.wasm"
const dir = path.join(CR, "grails-core")
const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
const javaFiles = tracked.filter((f) => f.endsWith(".java") && (() => { try { return statSync(path.join(dir, f)).size <= 1024 * 1024 } catch { return false } })())
const idx: any = await mod.buildProjectIndexFromDisk(WASM, javaFiles.map((f) => path.join(dir, f)), (mod as any).JAVA_DECLARATION_SPEC)
console.log(`index: files ${javaFiles.length} | typeKinds ${idx.typeKinds.size} | qualified names present: ${[...idx.typeKinds.keys()].some((k: string) => k.includes(".") )}`)
const truth = (fqn: string): boolean => {
  const parts = fqn.split("."); const leaf = parts.pop() ?? ""; const d = parts.join("/")
  if (!leaf) return false
  return tracked.some((p) => (p.endsWith(`/${leaf}.java`) || p.endsWith(`/${leaf}.groovy`)) && (d === "" || p.slice(0, p.lastIndexOf("/")).endsWith("/" + d) || p.slice(0, p.lastIndexOf("/")) === d))
}
let respelled = 0, respelledTrueLocal = 0, FALSE_LOCALS = 0, unchanged = 0, unchangedTrueLocal = 0, unchangedExternal = 0
for (const rel of javaFiles) {
  const r: any = await parseFile(path.join(dir, rel), dir, { projectIndex: idx, projectRoot: dir } as any)
  for (const e of (r?.relationships ?? [])) {
    if (String(e.type) !== "imports") continue
    const tgt = String(e.target ?? "")
    const md: any = e.metadata ?? {}
    const modName = typeof md.module === "string" ? md.module : null
    if (modName !== null && tgt !== modName) {
      respelled++
      if (truth(modName)) respelledTrueLocal++; else FALSE_LOCALS++
    } else {
      unchanged++
      if (truth(modName ?? tgt)) unchangedTrueLocal++; else unchangedExternal++
    }
  }
}
console.log(`RE-SPELLED (bare target + module metadata): ${respelled} | of which TRUE LOCAL ${respelledTrueLocal} | **FALSE LOCALS ${FALSE_LOCALS}**`)
console.log(`UNCHANGED (target still the module):        ${unchanged} | of which external ${unchangedExternal} | true-local-but-unmoved ${unchangedTrueLocal}`)
