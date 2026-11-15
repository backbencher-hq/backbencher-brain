// Proves the AST path for the :646 regex exists and is equivalent-or-better.
// Does NOT modify the analyzer — this is a review probe.
import * as WTS from "web-tree-sitter"
import * as fs from "fs"
import * as path from "path"

const ROOT = "/home/ishaq2321/bb_tests/repositories"

/** The CURRENT implementation: text micro-parse of obj.text. */
function viaRegex(objText: string, propText: string): string {
  const afterBase =
    objText === "module.exports" ? [] :
    objText === "exports" ? [] :
    objText.replace(/^module\.exports\./, "").replace(/^exports\./, "").split(".")
  return [...afterBase, propText].join(".")
}

/** The AST path: walk the member_expression structurally. */
function stringContent(node: any): string {
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i)
    if (c && c.type === "string_fragment") return c.text
  }
  const t = node.text
  if (t.length >= 2) {
    const f = t[0]
    if ((f === '"' || f === "'" || f === "`") && t[t.length - 1] === f) return t.slice(1, -1)
  }
  return t
}
function viaAst(obj: any, propText: string): string | null {
  // collect the chain's property segments, base-first
  const segs: string[] = []
  let cur: any = obj
  while (cur && cur.type === "member_expression") {
    const p = cur.childForFieldName("property")
    if (!p) return null
    // a computed property is a real segment too — read it structurally
    segs.unshift(p.type === "string" ? stringContent(p) : p.text)
    cur = cur.childForFieldName("object")
  }
  if (!cur) return null
  const baseSegs: string[] = [cur.text]
  // `module.exports.a.b` -> cur is `module`, segs are [exports,a,b]
  if (baseSegs[0] === "module" && segs[0] === "exports") segs.shift()
  else if (baseSegs[0] === "exports") { /* the base itself */ }
  else return null // not a CJS surface write (e.g. svc.limit = 1)
  return [...segs, propText].join(".")
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)

  console.log("=== 1. unit equivalence on the shapes the regex claims to handle ===")
  const unit: Array<[string, string, string]> = [
    ["module.exports", "a", "a"],
    ["exports", "a", "a"],
    ["module.exports.a", "b", "a.b"],
    ["exports.a", "b", "a.b"],
    ["module.exports.a.b", "c", "a.b.c"],
    ["exports.group.item", "x", "group.item.x"],
  ]
  let uOk = 0
  for (const [objText, prop, expect] of unit) {
    const got = viaRegex(objText, prop)
    const ok = got === expect
    if (ok) uOk++
    console.log(`   ${ok ? "ok  " : "FAIL"} ${objText} . ${prop}  -> "${got}" (expect "${expect}")`)
  }
  console.log(`   regex: ${uOk}/${unit.length} on its own contract\n`)

  console.log("=== 2. the shapes the regex SILENTLY drops (the behavioural cost) ===")
  for (const src of [
    `module["exports"].a.b = 1;`,
    `module?.exports?.a = 1;`,
    `exports["a"].b = 1;`,
    `module.exports.a.b = 1;`,
  ]) {
    const root = p.parse(src).rootNode
    let regexOut: string | null = null
    let astOut: string | null = null
    const st = [root]
    while (st.length) {
      const n: any = st.pop()
      if (n.type === "assignment_expression") {
        // NB: `property`/`object` hang off the LHS member_expression, not off the
        // assignment_expression (which only has left/right).
        const left = n.childForFieldName("left")
        const prop = left?.childForFieldName?.("property")
        if (left && prop) {
          const objText = left.childForFieldName("object")?.text ?? ""
          if (/exports/.test(objText) || /exports/.test(prop.text)) {
            regexOut = viaRegex(objText, prop.text)
            astOut = viaAst(left.childForFieldName("object"), prop.text)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    console.log(`   ${src}`)
    console.log(`      regex -> ${JSON.stringify(regexOut)}`)
    console.log(`      AST   -> ${JSON.stringify(astOut)}`)
  }

  console.log("\n=== 3. differential over every CJS-surface write in the corpora ===")
  for (const repo of ["lodash", "svelte", "grails-core", "element-plus"]) {
    const files: string[] = []
    const walk = (d: string, depth = 0): void => {
      if (depth > 12) return
      let es: fs.Dirent[]
      try { es = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
      for (const e of es) {
        if (e.name === ".git" || e.name === "node_modules") continue
        const q = path.join(d, e.name)
        if (e.isDirectory()) walk(q, depth + 1)
        else if (e.name.endsWith(".js")) files.push(q)
      }
    }
    walk(path.join(ROOT, repo))
    let both = 0, agree = 0, regexOnly = 0, astOnly = 0, neither = 0
    const examples: string[] = []
    for (const f of files) {
      let src: string
      try { src = fs.readFileSync(f, "utf8") } catch { continue }
      if (src.length > 400000) continue
      let tree: any
      try { tree = p.parse(src) } catch { continue }
      const st = [tree.rootNode]
      while (st.length) {
        const n: any = st.pop()
        if (n.type === "assignment_expression") {
          const left = n.childForFieldName("left")
          const prop = left?.childForFieldName?.("property")
          const obj = left?.childForFieldName?.("object")
          if (left && prop && obj) {
            const objText = obj.text ?? ""
            if (objText.includes("exports")) {
              const r = viaRegex(objText, prop.text)
              const a = viaAst(obj, prop.text)
              if (r !== null && a !== null) { both++; if (r === a) agree++; else if (examples.length < 5) examples.push(`${path.basename(f)}: regex="${r}" ast="${a}"`) }
              else if (r !== null) { regexOnly++; if (examples.length < 5) examples.push(`${path.basename(f)}: regex-only="${r}"`) }
              else if (a !== null) { astOnly++; if (examples.length < 5) examples.push(`${path.basename(f)}: AST-only="${a}"`) }
              else neither++
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
    }
    console.log(`   ${repo.padEnd(14)} both=${both} agree=${agree} disagree=${both - agree} | regex-only=${regexOnly} AST-only=${astOnly} neither=${neither}`)
    for (const e of examples) console.log(`      ${e}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
