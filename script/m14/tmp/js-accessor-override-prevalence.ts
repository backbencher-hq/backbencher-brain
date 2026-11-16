// Focused: how often does the ACCESSOR-OVERRIDE shape the JS analyzer
// structurally cannot emit actually occur in a JS-dominant corpus? (2026-09-26)
import * as WTS from "web-tree-sitter"
import { RealJavaScriptAnalyzer } from "../../../src/ast/real-javascript-analyzer"
import * as fs from "fs"
import * as path from "path"

const ROOT = "<corpus-root>/bb_tests/repositories/svelte"
const LIMIT = Number(process.env.LIMIT ?? 400)

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out, depth + 1)
    else if (e.name.endsWith(".js")) out.push(p)
  }
}
function has(n: any, tok: string): boolean {
  for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c && !c.isNamed && c.type === tok) return true }
  return false
}
function baseName(cls: any): string | undefined {
  for (let i = 0; i < cls.namedChildCount; i++) {
    const c = cls.namedChild(i)
    if (c && c.type === "class_heritage") {
      for (let j = 0; j < c.namedChildCount; j++) {
        const h = c.namedChild(j)
        if (h && (h.type === "identifier" || h.type === "member_expression")) return h.text
      }
    }
  }
  return undefined
}
/** member name -> "get"|"set"|"method"|"field" for one class node */
function membersOf(cls: any): Map<string, string> {
  const out = new Map<string, string>()
  const st = [cls]
  while (st.length) {
    const n: any = st.pop()
    if (n.type === "method_definition") {
      const nm = n.childForFieldName("name")?.text
      if (nm) out.set(nm, has(n, "get") ? "get" : has(n, "set") ? "set" : "method")
    } else if (n.type === "field_definition") {
      const nm = n.childForFieldName("property")?.text
      if (nm) out.set(nm, "field")
    }
    for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
  }
  return out
}

async function main() {
  const wts: any = WTS
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init()
  const lang = await L.load("wasm/tree-sitter-javascript.wasm")
  const p = new P(); p.setLanguage(lang)
  const a = new RealJavaScriptAnalyzer() as any

  const files: string[] = []
  walkFiles(ROOT, files); files.sort()
  const sample = files.slice(0, LIMIT)

  let filesWithAccessorOverride = 0
  let accessorOverrideSites = 0
  let methodOverrideSites = 0
  let emittedForThoseSites = 0
  const examples: string[] = []

  for (const f of sample) {
    let src: string
    try { src = fs.readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400000) continue
    let tree: any
    try { tree = p.parse(src) } catch { continue }

    // per-FILE closed world: base and derived must be in the same file, which is
    // the only case the analyzer's override pass can reason about.
    const classes: Array<{ name: string; base?: string; members: Map<string, string> }> = []
    const st = [tree.rootNode]
    while (st.length) {
      const n: any = st.pop()
      if (n.type === "class_declaration" || n.type === "class") {
        const nm = n.childForFieldName?.("name")?.text
        if (nm) classes.push({ name: nm, base: baseName(n), members: membersOf(n) })
      }
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
    }
    let hit = 0
    for (const d of classes) {
      if (!d.base) continue
      const base = classes.find((c) => c.name === d.base)
      if (!base) continue
      for (const [nm, kind] of d.members) {
        const bk = base.members.get(nm)
        if (bk === undefined) continue
        if (kind === "get" || kind === "set") {
          if (bk === "get" || bk === "set") {
            hit++; accessorOverrideSites++
            if (examples.length < 8) examples.push(`${path.basename(f)}: ${d.name}.${nm} (${kind}) overrides ${d.base}.${nm} (${bk})`)
          }
        } else if (kind === "method" && bk === "method") methodOverrideSites++
      }
    }
    if (hit) filesWithAccessorOverride++
    // what the analyzer actually emits for this file
    const r = await a.analyze(tree.rootNode, src, f, undefined)
    for (const rel of r.relationships ?? []) {
      if (String(rel.type).toLowerCase() !== "overrides") continue
      const m = String(rel.source).match(/^(.+)\.([^.]+)$/)
      if (!m) continue
      const d = classes.find((c) => c.name === m[1])
      const kind = d?.members.get(m[2])
      if (kind === "get" || kind === "set") emittedForThoseSites++
    }
  }

  console.log(JSON.stringify({
    corpus: "svelte (.js)", filesScanned: sample.length,
    filesContainingAnAccessorOverrideShape: filesWithAccessorOverride,
    accessorOverrideSites_sameFileClosedWorld: accessorOverrideSites,
    methodOverrideSites_sameFileClosedWorld: methodOverrideSites,
    accessorOverridesActuallyEmitted: emittedForThoseSites,
  }, null, 1))
  console.log("\nexamples:")
  for (const e of examples) console.log("  " + e)
}
main().catch((e) => { console.error(e); process.exit(1) })
