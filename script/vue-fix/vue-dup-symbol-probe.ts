/**
 * DUPLICATE-SYMBOL PROBE — lane-owned, no regex.
 *
 * `extends: { methods: { … } }` is an inline options MERGE: the analyzer
 * deliberately folds the object's members into the component (real-vue-analyzer
 * .ts:1517-1531), because at runtime they ARE this component's methods. But
 * that fold is a SECOND emitObjectMembers call with its OWN `seen` map, so a
 * key the component also declares is published TWICE — which contradicts the
 * M49/#745 last-wins ruling the same function implements (one symbol per key,
 * keyed to the LAST declaration).
 *
 * This counts the shape across the corpus and, on a probe case, shows the
 * duplication is real rather than theoretical.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"
import { ASTEngine, getParser } from "../../src/ast/engine"
import { detectLanguageFromPath } from "../../src/ast/language-detection"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPOS = (process.env.BB_REPOS ?? "vuejs,vue-element-admin,element-plus").split(",")
const MAX = 1024 * 1024

const files: { rel: string; abs: string }[] = []
for (const repo of REPOS) {
  const dir = path.join(CR, repo)
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try { if (statSync(abs).size > MAX) continue } catch { continue }
    if (detectLanguageFromPath(abs) !== "vue") continue
    files.push({ rel: `${repo}/${rel}`, abs })
  }
}

let inlineExtends = 0, inlineExtendsFiles: string[] = []
let inlineMerge = 0, inlineMergeFiles: string[] = []
const overlaps: string[] = []

const vu = await getParser("vue")
for (const f of files) {
  let src: string
  try { src = readFileSync(f.abs, "utf8") } catch { continue }
  let tree: any
  try { tree = await vu.parse(src) } catch { continue }
  const blocks = ASTEngine.extractSfcScriptBlocks(tree.rootNode, src)
  for (const b of blocks) {
    const lang = b.lang ?? "js"
    const p = await getParser(lang === "ts" ? "typescript" : lang === "tsx" ? "typescript" : "javascript")
    let st: any
    try { st = await p.parse(b.content) } catch { continue }
    // walk for a pair whose key is `extends` and whose value is an object
    const stack: Node[] = [st.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      if (n.type === "pair") {
        const key = n.childForFieldName("key")
        const val = n.childForFieldName("value")
        if (key?.type === "property_identifier" && key.text === "extends" && val?.type === "object") {
          inlineExtends++
          if (inlineExtendsFiles.length < 6) inlineExtendsFiles.push(f.rel)
          // The inline object's own methods/computed keys vs the component's.
          const inlineKeys = new Set<string>()
          for (let i = 0; i < val.namedChildCount; i++) {
            const sub = val.namedChild(i)
            if (!sub) continue
            if (sub.type !== "pair") continue
            const sk = sub.childForFieldName("key")
            const sv = sub.childForFieldName("value")
            if (!sk || !sv) continue
            if (sk.text !== "methods" && sk.text !== "computed") continue
            for (let j = 0; j < sv.namedChildCount; j++) {
              const m = sv.namedChild(j)
              if (!m) continue
              const mn = m.childForFieldName("name")?.text ?? m.childForFieldName("key")?.text
              if (mn && !mn.startsWith("[")) inlineKeys.add(`${sk.text}.${mn}`)
            }
          }
          if (inlineKeys.size) {
            inlineMerge++
            if (inlineMergeFiles.length < 6) inlineMergeFiles.push(f.rel)
            // Now the component's OWN methods/computed keys, from the same
            // options object that holds this `extends` pair.
            const opts = n.parent
            const ownKeys = new Set<string>()
            if (opts && opts.type === "object") {
              for (let i = 0; i < opts.namedChildCount; i++) {
                const sib = opts.namedChild(i)
                if (!sib || sib.id === n.id || sib.type !== "pair") continue
                const sk = sib.childForFieldName("key")
                const sv = sib.childForFieldName("value")
                if (!sk || !sv) continue
                if (sk.text !== "methods" && sk.text !== "computed") continue
                for (let j = 0; j < sv.namedChildCount; j++) {
                  const m = sv.namedChild(j)
                  if (!m) continue
                  const mn = m.childForFieldName("name")?.text ?? m.childForFieldName("key")?.text
                  if (mn && !mn.startsWith("[")) ownKeys.add(`${sk.text}.${mn}`)
                }
              }
            }
            for (const k of inlineKeys) if (ownKeys.has(k) && overlaps.length < 12) overlaps.push(`${f.rel}: ${k}`)
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) { const c = n.namedChild(i); if (c) stack.push(c) }
    }
  }
}
console.log(`\nfiles walked: ${files.length}`)
console.log(`inline \`extends: { … }\` objects:      ${inlineExtends} in ${inlineExtendsFiles.length <= 6 ? inlineExtendsFiles.length : ">6"} files`)
console.log(`  …carrying methods/computed members: ${inlineMerge}  e.g. ${inlineMergeFiles.join(", ")}`)
console.log(`  …whose member key the component ALSO declares (duplicate symbol): ${overlaps.length}`)
for (const o of overlaps) console.log(`     ${o}`)
