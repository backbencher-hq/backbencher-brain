/**
 * ZIG WAVE 1 PROBE — FIELD OWNERS and QUOTED IDENTIFIERS.
 *
 * Two facts the declared-type rework depends on, both of which must be MEASURED
 * before the code is written:
 *
 *  1. Which node types actually CARRY a `type` field. The rework prefers the
 *     field, so if (say) `error_union_type` also carries one, preferring it
 *     would silently take the wrong side of `!`.
 *  2. Whether `@"quoted"` identifiers exist in the corpus and where. The
 *     analyzer's only regex receiver is a type leaf, and a leaf can only be an
 *     `identifier` node's text — so the regex can fire ONLY on a quoted
 *     identifier, where it would mangle the name.
 */
import * as fs from "fs"
import { init, zigFiles, parser, walk } from "./zigw-harness"

async function main(): Promise<void> {
  await init()
  const files = zigFiles()
  const fieldOwners = new Map<string, Map<string, number>>()
  const quoted = new Map<string, { n: number; where: string[]; parent: string[] }>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    walk(root, (n: any) => {
      if (typeof n.fieldNameForChild === "function") {
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (!c) continue
          const fname = n.fieldNameForChild(i)
          if (!fname) continue
          let byField = fieldOwners.get(n.type)
          if (!byField) { byField = new Map(); fieldOwners.set(n.type, byField) }
          byField.set(fname, (byField.get(fname) ?? 0) + 1)
        }
      }
      if (n.type === "identifier" && n.text.startsWith('@"')) {
        const p = n.parent ? n.parent.type : "?"
        const cur = quoted.get(n.text) ?? { n: 0, where: [], parent: [] }
        cur.n++
        if (cur.where.length < 3) cur.where.push(`${f.split("/").slice(-2).join("/")}:${n.startPosition.row + 1}`)
        if (!cur.parent.includes(p)) cur.parent.push(p)
        quoted.set(n.text, cur)
      }
    })
    tree.delete()
  }

  console.log("=== node types carrying fields ===")
  for (const [type, byField] of [...fieldOwners.entries()].sort()) {
    console.log(`  ${type}: ${[...byField.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)
  }
  const total = [...quoted.values()].reduce((a, b) => a + b.n, 0)
  console.log(`\n=== quoted identifiers: ${total} occurrences, ${quoted.size} distinct ===`)
  const byParent = new Map<string, number>()
  for (const q of quoted.values()) for (const p of q.parent) byParent.set(p, (byParent.get(p) ?? 0) + 1)
  console.log(`  parents: ${[...byParent.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)
  for (const [k, v] of [...quoted.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) {
    console.log(`  ${String(v.n).padStart(4)}  ${k.replace(/\n/g, "\\n")}  parents=[${v.parent.join(",")}]  e.g. ${v.where.join(" ")}`)
  }
}
void main()
