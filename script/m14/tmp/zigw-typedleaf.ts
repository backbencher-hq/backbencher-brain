/**
 * ZIG WAVE 1 PROBE — the DECLARED-TYPE LEAF CENSUS.
 *
 * `extractZigDeclaredTypeRefs` picks a declaration's type leaf by WALKING for
 * every `identifier` under the declaration node, dropping the first (assumed to
 * be the declared name) and taking the LAST. The grammar, however, hands the
 * type over as a FIELD: `parameter.type`, `container_field.type` (210,357 field
 * hits in the corpus census). This probe measures how often the walk and the
 * field disagree, and what the field says when they do.
 *
 * The walk replica is a transcription of the analyzer's `zigTypeLeafNode`, used
 * only to LOCATE disagreements; every disagreement is re-checked through the
 * real analyzer by the minimal repro that follows, so no finding rests on the
 * replica.
 */
import * as fs from "fs"
import { init, zigFiles, parser } from "./zigw-harness"

/** A verbatim transcription of zigTypeLeafNode (lines 1098-1123 of the analyzer). */
function analyzerLeaf(node: any): any {
  if (node.type === "identifier") return node
  const ids: any[] = []
  const stack: any[] = [node]
  let guard = 0
  while (stack.length > 0 && guard++ < 200) {
    const n = stack.pop()
    if (n.type === "identifier") ids.push(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (ids.length === 0) return null
  if (
    (node.type === "parameter" || node.type === "container_field") &&
    node.namedChildCount > 0 &&
    node.namedChild(0)?.type === "identifier"
  ) {
    ids.shift()
    if (ids.length === 0) return null
  }
  return ids[ids.length - 1]
}

/** What the grammar says: the type FIELD's own leaf. */
function fieldLeaf(typeNode: any): { name: string; kind: string } | null {
  if (!typeNode) return null
  if (typeNode.type === "identifier") return { name: typeNode.text, kind: "identifier" }
  if (typeNode.type === "builtin_type") return { name: typeNode.text, kind: "builtin" }
  // the last identifier under a qualified type, or the member of a qualified one
  const stack: any[] = [typeNode]
  const ids: any[] = []
  let guard = 0
  while (stack.length > 0 && guard++ < 200) {
    const n = stack.pop()
    if (n.type === "identifier") ids.push(n)
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  if (ids.length === 0) return { name: `<${typeNode.type}:none>`, kind: "none" }
  return { name: ids[ids.length - 1].text, kind: `under:${typeNode.type}` }
}

async function main(): Promise<void> {
  await init()
  const files = zigFiles()
  const same = new Map<string, number>()
  const diff = new Map<string, { n: number; ex: string[] }>()
  const add = (k: string, ex: string) => {
    const d = diff.get(k)
    if (d) { d.n++; if (d.ex.length < 3) d.ex.push(ex) }
    else diff.set(k, { n: 1, ex: [ex] })
  }
  let total = 0
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const where = (n: any) => `${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}`
    const visit = (n: any): void => {
      if (n.type === "parameter" || n.type === "container_field") {
        const tField = n.childForFieldName ? n.childForFieldName("type") : null
        if (tField) {
          total++
          const a = analyzerLeaf(n)
          const t = fieldLeaf(tField)
          const an = a ? a.text : "<null>"
          const tn = t ? t.name : "<null>"
          if (an === tn) {
            const k = `${n.type}|${tField.type}|same:${an.slice(0, 24)}`
            same.set(k, (same.get(k) ?? 0) + 1)
          } else {
            add(
              `${n.type}|${tField.type}|DIFF walk=${an.slice(0, 26)} field=${tn.slice(0, 26)}`,
              `${where(n)}  ${n.text.replace(/\s+/g, " ").slice(0, 84)}`,
            )
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) visit(c)
      }
    }
    visit(tree.rootNode)
    tree.delete()
  }
  console.log(`declarations with a type FIELD: ${total}  agreeing: ${[...same.values()].reduce((a, b) => a + b, 0)}  disagreeing: ${[...diff.values()].reduce((a, b) => a + b.n, 0)}`)
  console.log(`\n=== DISAGREEMENTS (${diff.size} shapes) ===`)
  for (const [k, v] of [...diff.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`\n${String(v.n).padStart(6)}  ${k}`)
    for (const e of v.ex) console.log(`        ${e}`)
  }
  console.log(`\n=== AGREEING shapes (top 40) ===`)
  for (const [k, v] of [...same.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`${String(v).padStart(7)}   ${k}`)
  }
}
void main()
