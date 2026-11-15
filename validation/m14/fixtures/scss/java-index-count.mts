/** THE COUNT, BEFORE THE SPEC: what would a JAVA project index actually contain?
 *  The channel is proven wired (parallel-indexer -> payload -> pool-worker -> ctx.projectIndex);
 *  this measures the payload a java spec would produce, so the spec is written against a number. */
import { execFileSync } from "node:child_process"
import { statSync } from "node:fs"
import path from "node:path"
import * as mod from "../src/ast/project-index"
const CR = "/home/ishaq2321/bb_tests/repositories"
const WASM = "/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-java.wasm"
const JAVA_SPEC: any = {
  typeNodes: { class_declaration: "class", interface_declaration: "interface", enum_declaration: "enum", annotation_type_declaration: "interface" },
  memberNodes: ["method_declaration", "field_declaration", "constructor_declaration", "enum_constant"],
  memberNodesCallable: ["method_declaration", "constructor_declaration"],
  baseNodes: ["superclass", "super_interfaces"],
}
for (const [repo, exts] of [["grails-core", [".java"]], ["geb", [".java", ".groovy"]]] as const) {
  const dir = path.join(CR, repo)
  const files = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
    .split("\0").filter((f) => exts.some((e) => f.endsWith(e)) && (() => { try { return statSync(path.join(dir, f)).size <= 1024 * 1024 } catch { return false } })())
  const abs = files.map((f) => path.join(dir, f))
  const idx: any = await mod.buildProjectIndexFromDisk(WASM, abs, JAVA_SPEC)
  const members = [...idx.typeMembers.values()].reduce((n: number, s: Set<string>) => n + s.size, 0)
  console.log(`${repo}: files ${abs.length} | types ${idx.typeKinds.size} | members ${members} | symbolNames ${idx.symbolNames.size} | damaged ${idx.stats.damaged}`)
  console.log(`   sample types: ${JSON.stringify([...idx.typeKinds.keys()].slice(0, 5))}`)
}
