// #912: which guard should admit the CALL-shaped declarator?
//
// Two candidates, measured on the SAME candidate set (an ERROR whose last named
// child is a call_expression with a same-line block after it, arguments present,
// identifier callee) across jq + sqlite:
//
//   (K) the keyword specifier run — contiguous bare identifiers immediately
//       before the call (<=3, comments skipped), containing >=1 reserved
//       declaration word. The new bespoke predicate.
//   (D) declarationHeaderBefore — the #907-reviewed rule the analyzer already
//       uses for the BARE-identifier arrival: is there an identifier token
//       between the last `;`/`{`/`}` and the name? (comments stripped, 400-char
//       window). Its own doc comment claims `static block gen_last_1(` as a
//       positive case, so it should admit the same site.
//
// Print every accepted site under each guard, then the DELTA (D accepts, K
// refuses) — that delta is exactly what reusing (D) would additionally admit,
// and each row has to be read by eye.
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
  "static", "extern", "auto", "register", "typedef", "inline", "_Noreturn", "_Thread_local",
  "const", "volatile", "restrict", "_Atomic",
  "void", "char", "short", "int", "long", "float", "double", "signed", "unsigned",
  "_Bool", "_Complex", "struct", "union", "enum",
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

// (K): the analyzer's spelling — <=3 bare identifiers directly before the call.
function guardK(call: any): string[] | null {
  const run: any[] = []
  let s = call.previousSibling
  while (s && run.length < 3) {
    if (s.type === "comment") { s = s.previousSibling; continue }
    if (s.type !== "identifier") break
    if (s.previousSibling?.type === "preproc_directive") break
    run.push(s); s = s.previousSibling
  }
  if (run.length === 0) return null
  for (const id of run) if (SPEC.has(id.text.trim())) return run
  return null
}

// (D): declarationHeaderBefore, transcribed (identifier token in the header
// window). Comment stripping here is `//`+`/* */` on the raw window.
function stripComments(s: string): string {
  let out = ""; let i = 0
  while (i < s.length) {
    if (s[i] === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue }
    if (s[i] === "/" && s[i + 1] === "/") { const e = s.indexOf("\n", i + 2); i = e < 0 ? s.length : e; continue }
    out += s[i]; i++
  }
  return out
}
const hasIdentifierToken = (t: string) => /[A-Za-z_][A-Za-z0-9_]*/.test(t)
function guardD(call: any, content: string): string | null {
  const from = Math.max(0, call.startIndex - 400)
  const window = content.slice(from, call.startIndex)
  let cut = -1
  for (const ch of [";", "{", "}"]) { const at = window.lastIndexOf(ch); if (at > cut) cut = at }
  const header = stripComments(window.slice(cut + 1))
  return hasIdentifierToken(header) ? header.trim().replace(/\s+/g, " ").slice(-60) : null
}

const REPOS = [
  ["jq", "/home/ishaq2321/bb_tests/repositories/jq"],
  ["sqlite", "/home/ishaq2321/bb_tests/repositories/sqlite"],
]
let cand = 0, accK = 0, accD = 0
const rows: Array<{ tag: string; where: string; name: string; k: string; d: string }> = []
for (const [name, repo] of REPOS) {
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
          let args = last.childForFieldName("arguments")
          if (!args) for (let i = 0; i < last.childCount; i++) if (last.child(i).type === "argument_list") { args = last.child(i); break }
          const callee = last.childForFieldName("function") ?? last.namedChild(0)
          if (!gapOk || !args || !callee || callee.type !== "identifier") continue
          cand++
          const k = guardK(last); const d = guardD(last, src)
          if (k) accK++
          if (d) accD++
          if (k || d) {
            const lines = src.split("\n")
            rows.push({ tag: name, where: `${f.replace(repo + "/", "")}:${last.startPosition.row + 1}`, name: callee.text, k: k ? k.map((t: any) => t.text).join(" ") : "—", d: d ?? "—" })
            console.log(`[${name}] ${rows[rows.length - 1].where} name=${callee.text}`)
            console.log(`      K=${k ? "ACCEPT <" + rows[rows.length - 1].k + ">" : "refuse"}   D=${d ? "ACCEPT header=" + JSON.stringify(d) : "refuse"}`)
            for (let i = Math.max(0, last.startPosition.row - 1); i < Math.min(lines.length, last.startPosition.row + 2); i++) console.log(`      ${i + 1}| ${lines[i]}`)
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) st.push(n.child(i))
    }
  }
}
console.log(`TOTAL candidates=${cand}  K accepts=${accK}  D accepts=${accD}`)
const delta = rows.filter((r) => r.d !== "—" && r.k === "—")
console.log(`DELTA (D accepts, K refuses) = ${delta.length}`)
for (const r of delta) console.log(`   ${r.tag} ${r.where} name=${r.name}  D-header=${JSON.stringify(r.d)}`)
const delta2 = rows.filter((r) => r.k !== "—" && r.d === "—")
console.log(`DELTA (K accepts, D refuses) = ${delta2.length}`)
for (const r of delta2) console.log(`   ${r.tag} ${r.where} name=${r.name}  K-tail=<${r.k}>`)
