import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const wts: any = await import("web-tree-sitter")
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const grammar = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-groovy.wasm")))
const parser = new ParserClass()
parser.setLanguage(grammar)
const files: string[] = []
for (const e of readdirSync(CORPUS, { withFileTypes: true })) {
  if (!e.isDirectory()) continue
  const dir = path.join(CORPUS, e.name)
  let tracked: string[] = []
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }); tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!/\.(groovy|gvy|gradle)$/i.test(rel)) continue
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > 1048576) continue } catch { continue }
    files.push(abs)
  }
}
files.sort()
const byExt: Record<string, {n:number, err:number}> = {}
for (const f of files.slice(0, 200)) {
  const content = readFileSync(f, "utf8")
  const tree = parser.parse(content)
  let err = 0
  const walk = (n: any) => { if (n.type === "ERROR") err++; for (const c of n.children) walk(c) }
  walk(tree.rootNode)
  const ext = f.slice(f.lastIndexOf("."))
  byExt[ext] ??= { n: 0, err: 0 }
  byExt[ext].n++
  if (err) byExt[ext].err++
}
console.log(JSON.stringify(byExt, null, 1))
