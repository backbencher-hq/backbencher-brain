/**
 * ZIG WAVE 1 PROBE — the GRAMMAR CENSUS over three real corpora.
 *
 * The question this asks is not "does the analyzer agree with the oracle" (both
 * mirror each other, so a shared blind spot is invisible to the differential).
 * It asks: WHAT DOES THE TREE CONTAIN? Every named node type, every anonymous
 * token, every field name, with counts, over 3,800+ real .zig files.
 *
 * Outputs three tables so a later probe can diff the analyzer's string literals
 * against live vocabulary (dead literals) and, more importantly, so a human can
 * see which live constructs the analyzer never mentions.
 */
import * as fs from "fs"
import { init, zigFiles, walk, parser } from "./zigw-harness"

async function main(): Promise<void> {
  await init()
  const files = zigFiles()
  const named = new Map<string, number>()
  const anon = new Map<string, number>()
  const fields = new Map<string, number>()
  const filesWithError: string[] = []
  const errorRate = new Map<string, number>()

  for (const f of files) {
    const src = fs.readFileSync(f, "utf8")
    const tree = parser().parse(src)
    const root = tree.rootNode
    if (root.hasError) filesWithError.push(f)
    walk(root, (n: any) => {
      named.set(n.type, (named.get(n.type) ?? 0) + 1)
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && !c.isNamed) anon.set(c.type, (anon.get(c.type) ?? 0) + 1)
        if (c) {
          const fname = n.fieldNameForChild ? n.fieldNameForChild(i) : null
          if (fname) fields.set(fname, (fields.get(fname) ?? 0) + 1)
        }
      }
    })
    tree.delete()
  }

  const dump = (title: string, m: Map<string, number>, filter?: (k: string) => boolean) => {
    const rows = [...m.entries()].filter(([k]) => (filter ? filter(k) : true)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    console.log(`\n=== ${title} (${rows.length}) ===`)
    for (const [k, v] of rows) console.log(`${String(v).padStart(9)}  ${k}`)
  }

  console.log(`files: ${files.length}  withError: ${filesWithError.length} (${((filesWithError.length / files.length) * 100).toFixed(2)}%)`)
  dump("NAMED NODE TYPES", named)
  dump("ANONYMOUS TOKENS", anon)
  dump("FIELD NAMES", fields)
  if (filesWithError.length > 0) {
    console.log(`\n=== FILES WITH PARSE ERRORS (first 40 of ${filesWithError.length}) ===`)
    for (const f of filesWithError.slice(0, 40)) console.log(f)
  }
}

void main()
