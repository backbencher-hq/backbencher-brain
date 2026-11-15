/** CONDITION 3, self-contained: build each repo's scss index in-process (the exported spec + the
 *  production wasm path), then count how many `@use ... as ns` specifiers each matching rule reaches. */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import * as mod from "../src/ast/project-index"
const CR = "/home/ishaq2321/bb_tests/repositories"
const WASM = "/home/ishaq2321/mcp/backbencher-brain/wasm/tree-sitter-scss.wasm"
const norm = (s: string) => (s.split(/[\\/]/).pop() ?? s).replace(/\.(scss|sass|css)$/i, "").replace(/^_/, "")
let specifiers = 0, oldRule = 0, newRule = 0, builtins = 0, noIndex = 0
for (const repo of execFileSync("ls", [CR], { encoding: "utf8" }).split("\n").filter(Boolean).sort()) {
  const dir = path.join(CR, repo)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let files: string[] = []
  try { files = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter((f) => f.toLowerCase().endsWith(".scss")) } catch { continue }
  if (files.length === 0) continue
  const abs = files.map((f) => path.join(dir, f)).filter((f) => { try { return statSync(f).size <= 1024 * 1024 } catch { return false } })
  let keys = new Set<string>()
  try {
    const idx: any = await mod.buildProjectIndexFromDisk(WASM, abs, (mod as any).SCSS_DECLARATION_SPEC)
    keys = new Set([...idx.typeMembers.keys()])
  } catch { /* a repo whose files cannot be parsed */ }
  if (keys.size === 0) { noIndex++; continue }
  for (const f of abs) {
    let text = ""
    try { text = readFileSync(f, "utf8") } catch { continue }
    // the specifiers are read from the SOURCE (the analyzer's imports array needs a full parse);
    // `@use 'x' as ns` and `@forward 'x' as ns-*` are the two spellings
    const re = /@(?:use|forward)\s+['"]([^'"]+)['"]\s+as\s+([A-Za-z_][\w-]*)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const modPath = m[1]; specifiers++
      if (modPath.startsWith("sass:")) { builtins++; continue }
      if ([...keys].some((k) => k === modPath || k.endsWith("/" + modPath) || k.endsWith("\\" + modPath))) oldRule++
      if (norm(modPath) !== "" && [...keys].some((k) => norm(k) === norm(modPath))) newRule++
    }
  }
}
console.log(`namespaced @use/@forward specifiers: ${specifiers} (sass: built-ins ${builtins}) | repos whose index stayed EMPTY: ${noIndex}`)
console.log(`  OLD rule (path suffix):     reaches ${oldRule}`)
console.log(`  NEW rule (basename, normalised): reaches ${newRule}`)
