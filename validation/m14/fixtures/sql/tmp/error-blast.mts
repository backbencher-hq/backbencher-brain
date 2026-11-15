import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync } from "node:fs"
import * as path from "node:path"
import { Parser, Language } from "web-tree-sitter"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"
import { fileURLToPath } from "node:url"
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")
await Parser.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const language = await Language.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-sql.wasm")))
const parser = new Parser(); parser.setLanguage(language as any)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const admitted: {label:string;abs:string;text:string}[] = []
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try { if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512*1024*1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel); let text = ""
    try { if (statSync(abs).size > 512*1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "sql") continue
    admitted.push({ label: `${entry}/${rel}`, abs, text })
  }
}
admitted.sort((a,b)=> a.label<b.label?-1:a.label>b.label?1:0)
let filesWithError = 0, errorNodes = 0
let refsUnderError = 0, refsTotal = 0
let refsUnderErrorWithKeywordWith = 0
let cteNodesTotal = 0, filesWithCte = 0
const perFile: string[] = []
for (const f of admitted) {
  let tree: any
  try { tree = parser.parse(f.text) } catch { continue }
  if (!tree) continue
  let hasError = false, uE = 0, t = 0, uEwithWith = 0
  const stack: any[] = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === "ERROR" || n.isMissing) { hasError = true; errorNodes++; if (n.type === "ERROR") {
      // does this ERROR region contain a WITH keyword?
      const s2: any[] = [n]; let w = false
      while (s2.length) { const m = s2.pop()!; if (m.type === "keyword_with" || m.type === "with_clause") { w = true; break }
        for (let i=0;i<m.namedChildCount;i++) s2.push(m.namedChild(i)) }
      if (w) hasError = true
    } }
    if (n.type === "cte") cteNodesTotal++
    if (n.type === "relation" || n.type === "from") {
      t++
      for (let a = n.parent; a; a = a.parent) if (a.type === "ERROR") { uE++; break }
      // WITH inside the nearest ERROR ancestor
      for (let a = n.parent; a; a = a.parent) if (a.type === "ERROR") {
        const s2: any[] = [a]; let w = false
        while (s2.length) { const m = s2.pop()!; if (m.type === "keyword_with" || m.type === "with_clause") { w = true; break }
          for (let i=0;i<m.namedChildCount;i++) s2.push(m.namedChild(i)) }
        if (w) { uEwithWith++; break }
      }
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) stack.push(n.namedChild(i))
  }
  refsTotal += t; refsUnderError += uE; refsUnderErrorWithKeywordWith += uEwithWith
  if (hasError) filesWithError++
  if (uE) perFile.push(`${uE}\t${f.label}`)
}
console.log(`admitted files            ${admitted.length}`)
console.log(`files with an ERROR/MISSING ${filesWithError}`)
console.log(`ERROR nodes               ${errorNodes}`)
console.log(`cte nodes                 ${cteNodesTotal}`)
console.log(`relation+from nodes       ${refsTotal}`)
console.log(`  under an ERROR ancestor ${refsUnderError}  (${(100*refsUnderError/Math.max(1,refsTotal)).toFixed(2)}%)`)
console.log(`  under an ERROR that also contains a WITH: ${refsUnderErrorWithKeywordWith}`)
console.log(`\nfiles with a reference under ERROR (top 25):`)
perFile.sort((a,b)=>Number(b.split("\t")[0])-Number(a.split("\t")[0]))
for (const l of perFile.slice(0,25)) console.log("  " + l)
console.log(`  ... ${perFile.length} files total`)
