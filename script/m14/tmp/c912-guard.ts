// #912: candidate guard census. For every ERROR whose LAST named child is a
// call, with a same-line block after it, decide by the proposed discriminator:
// a contiguous run of bare identifiers immediately before the call (comments
// skipped) containing >=1 declaration-specifier keyword (or a known type name).
// Print every accepted site so each can be read by eye.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const wts: any = await import("web-tree-sitter")
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const lang = await L.load(readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm")))
const parser = new P(); parser.setLanguage(lang)

const SPEC = new Set([
  "static","extern","auto","register","typedef","inline","_Noreturn","_Thread_local",
  "const","volatile","restrict","_Atomic",
  "void","char","short","int","long","float","double","signed","unsigned",
  "_Bool","_Complex","struct","union","enum",
])
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    let st: any; try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (e.endsWith(".c") || e.endsWith(".h")) out.push(p)
  }
  return out
}
const REPOS = [
  ["jq", "/home/ishaq2321/bb_tests/repositories/jq"],
  ["sqlite", "/home/ishaq2321/bb_tests/repositories/sqlite"],
]
let totalAccepted = 0, totalCandidates = 0
for (const [name, repo] of REPOS) {
  let accepted = 0
  for (const f of walk(repo)) {
    const src = readFileSync(f, "utf8")
    const root = parser.parse(src).rootNode
    const st: any[] = [root]
    while (st.length) {
      const n = st.pop()!
      if (n.type === "ERROR") {
        const kids: any[] = []
        for (let i = 0; i < n.namedChildCount; i++) kids.push(n.namedChild(i))
        const last = kids[kids.length - 1]
        if (last && last.type === "call_expression" && !last.isMissing) {
          const after = n.nextNamedSibling
          const sameLine = after && after.type === "compound_statement" && after.startPosition.row === last.endPosition.row
          const gapOk = sameLine && src.slice(last.endIndex, after.startIndex).trim() === ""
          // brace test: the call's argument list ends at the body brace
          const args = last.childForFieldName("arguments") ?? (() => { for (let i = 0; i < last.childCount; i++) if (last.child(i).type === "argument_list") return last.child(i); return null })()
          const callee = last.childForFieldName("function") ?? last.namedChild(0)
          if (!gapOk || !args || !callee || callee.type !== "identifier") continue
          totalCandidates++
          // the specifier tail: contiguous identifiers immediately before the call
          const tail: any[] = []
          let s = last.previousSibling
          while (s && tail.length < 4) {
            if (s.type === "comment") { s = s.previousSibling; continue }
            if (s.type !== "identifier") break
            tail.push(s); s = s.previousSibling
          }
          const hit = tail.find((t: any) => SPEC.has(t.text))
          const verdict = hit ? `ACCEPT (specifier ${JSON.stringify(hit.text)})` : "refuse (no specifier)"
          if (!hit) continue
          accepted++
          console.log(`[${name}] ${f.replace(repo + "/", "")}:${last.startPosition.row + 1} name=${callee.text} tail=<${tail.map((t: any) => t.text).join(" ")}> ${verdict}`)
          // show the source line and the next two lines for a by-eye check
          const lines = src.split("\n")
          for (let i = last.startPosition.row; i < Math.min(lines.length, last.startPosition.row + 2); i++) console.log(`      ${i + 1}| ${lines[i]}`)
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  }
  console.log(`[${name}] accepted=${accepted}`)
  totalAccepted += accepted
}
console.log(`TOTAL candidates=${totalCandidates} accepted=${totalAccepted}`)
