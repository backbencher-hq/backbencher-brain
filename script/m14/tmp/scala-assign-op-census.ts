// The analyzer's write gate removed `++=`, `&&=`, `||=` with the comment "NOT
// Scala operators (no legal parse produces them)". A grammar has no list of legal
// operators — it lexes an operator_identifier — so a user-defined operator is
// indistinguishable from a built-in one at parse time. Count them.
import fs from "node:fs"
import path from "node:path"
const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")
const CORPUS = "<corpus-root>/bb_tests/repositories"
const repo = process.argv[2] ?? "scala3"
const limit = Number(process.argv[3] ?? 400)
function walkFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out); else if (e.name.endsWith(".scala")) out.push(p)
  }
  return out
}
async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new P(); parser.setLanguage(lang)
  const KNOWN = new Set(["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "<<=", ">>=", ">>>="])
  const counts: Record<string, number> = {}
  const ex: Record<string, string> = {}
  for (const f of walkFiles(path.join(CORPUS, repo)).sort().slice(0, limit)) {
    const src = fs.readFileSync(f, "utf8")
    const rel = path.relative(path.join(CORPUS, repo), f)
    const w = (n: any): void => {
      if (n.type === "infix_expression") {
        const op = n.childForFieldName?.("operator")?.text ?? n.namedChild(1)?.text ?? ""
        if (/=$/.test(op) && op !== "=" && !KNOWN.has(op) && !/^(==|!=|<=|>=|<-|=>|=:=|<:<|>:)$/.test(op)) {
          counts[op] = (counts[op] ?? 0) + 1
          if (!ex[op]) ex[op] = `${rel}:${n.startPosition.row + 1}  ${op}`
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) w(n.namedChild(i))
    }
    w(parser.parse(src).rootNode)
  }
  console.log(`# ${repo}: infix operators ending in '=' that are neither the known compound-assign set nor a comparison`)
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}   e.g. ${ex[k]}`)
  if (Object.keys(counts).length === 0) console.log("  (none)")
}
main().catch((e) => { console.error(e); process.exit(1) })
