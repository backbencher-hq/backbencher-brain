/** CAN THE INDEX DECIDE JAVA LOCALITY? The spec's extractor records BARE type names (no package), so
 *  "the leaf is in the index" alone may bind an external import to a same-named project type. Score
 *  three candidate rules against the path truth, on the same population as the split. */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import * as mod from "../src/ast/project-index"
import { parseFile } from "../src/ast/pool-worker"
const CR = "/home/ishaq2321/bb_tests/repositories"
const WASM = "/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-java.wasm"
const JAVA_SPEC: any = {
  typeNodes: { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", annotation_type_declaration: "interface" },
  memberNodes: ["method_declaration", "field_declaration", "constructor_declaration", "enum_constant"],
  memberNodesCallable: ["method_declaration", "constructor_declaration"],
  baseNodes: ["superclass", "super_interfaces"],
}
const dir = path.join(CR, "grails-core")
const tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
const allFiles = new Set(tracked)
const javaFiles = tracked.filter((f) => f.endsWith(".java") && (() => { try { return statSync(path.join(dir, f)).size <= 1024 * 1024 } catch { return false } })())
const idx: any = await mod.buildProjectIndexFromDisk(WASM, javaFiles.map((f) => path.join(dir, f)), JAVA_SPEC)
const typeNames = new Set<string>([...idx.typeKinds.keys()])
console.log(`index: ${javaFiles.length} files · ${typeNames.size} type names`)
// path truth: the FQN maps onto a file the project holds
const truth = (fqn: string): boolean => {
  const parts = fqn.split("."); const leaf = parts.pop() ?? ""; const d = parts.join("/")
  if (!leaf) return false
  return tracked.some((p) => (p.endsWith(`/${leaf}.java`) || p.endsWith(`/${leaf}.groovy`)) && (d === "" || p.slice(0, p.lastIndexOf("/")).endsWith("/" + d) || p.slice(0, p.lastIndexOf("/")) === d))
}
let r1 = { tp: 0, fp: 0, fn: 0 }, r2 = { tp: 0, fp: 0, fn: 0 }, r3 = { tp: 0, fp: 0, fn: 0 }
for (const rel of javaFiles) {
  const r: any = await parseFile(path.join(dir, rel), dir, { projectIndex: idx, projectRoot: dir } as any)
  const ownPkg = rel.split("/").slice(0, -1).join(".")
  const segs = ownPkg.split(".").filter(Boolean).slice(-3).join(".")
  for (const e of (r?.relationships ?? [])) {
    if (String(e.type) !== "imports") continue
    const fqn = String(e.target ?? ""); if (!fqn.includes(".")) continue
    const leaf = fqn.slice(fqn.lastIndexOf(".") + 1)
    const isTrue = truth(fqn)
    const p1 = segs !== "" && fqn.startsWith(segs.split(".").slice(0, 2).join(".") + ".")
    const p2 = typeNames.has(leaf)
    const p3 = p1 && p2
    for (const [acc, pred] of [[r1, p1], [r2, p2], [r3, p3]] as const) {
      if (pred && isTrue) acc.tp++; else if (pred && !isTrue) acc.fp++; else if (!pred && isTrue) acc.fn++
    }
  }
}
const score = (a: any) => ({ precision: +(a.tp / Math.max(1, a.tp + a.fp)).toFixed(4), recall: +(a.tp / Math.max(1, a.tp + a.fn)).toFixed(4), falseBindings: a.fp, missed: a.fn })
console.log("R1 package-prefix          :", JSON.stringify(score(r1)))
console.log("R2 leaf-in-index           :", JSON.stringify(score(r2)))
console.log("R3 package-prefix AND leaf :", JSON.stringify(score(r3)))
