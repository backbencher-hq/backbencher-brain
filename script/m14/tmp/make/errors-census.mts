// READ-ONLY probe for the documentation page: count files carrying real
// ERROR/MISSING nodes over the whole gate-admitted make population (755).
// Writes nothing; prints one line.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
const ROOT = "<repo-root>"
const CR = join(ROOT, ".corpus")
const { detectLanguageFromPath } = await import(join(ROOT, "src/ast/language-detection.ts"))
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const g = await L.load(readFileSync(join(ROOT, "wasm", "tree-sitter-make.wasm")))
const parser = new P(); parser.setLanguage(g)
const EXT = ["mk", "mak", "makefile", "gnumakefile"]
const admit = (rel: string) => {
  const low = rel.toLowerCase(); const base = low.slice(low.lastIndexOf("/") + 1)
  if (EXT.some((e) => low.endsWith(`.${e}`))) return true
  return EXT.some((e) => base === e) && detectLanguageFromPath(rel) === "make"
}
let files = 0, errFiles = 0, errNodes = 0, missNodes = 0
const bad: string[] = []
for (const name of readdirSync(CR).sort()) {
  const dir = join(CR, name)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[] = []
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    if (!admit(rel)) continue
    const abs = join(dir, rel)
    let src: string
    try { if (statSync(abs).size > 1024 * 1024) continue; src = readFileSync(abs, "utf8") } catch { continue }
    files++
    const tree = parser.parse(src)
    let e = 0, m = 0
    const walk = (n: any) => { if (n.type === "ERROR") e++; if (n.isMissing) m++; for (const c of n.namedChildren ?? []) walk(c) }
    walk(tree.rootNode)
    if (e || m) { errFiles++; bad.push(`${name}/${rel} ERROR=${e} MISSING=${m}`) }
    errNodes += e; missNodes += m
  }
}
console.log(`files=${files} filesWithErrorOrMissing=${errFiles} ERROR=${errNodes} MISSING=${missNodes}`)
for (const b of bad.slice(0, 10)) console.log("  " + b)
