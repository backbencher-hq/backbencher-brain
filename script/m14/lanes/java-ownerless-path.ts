/**
 * java-ownerless-path.ts — DERIV_EXPORTS_JAVA3.
 *
 * The ancestor chain of an owner-less method, printed from the tree.
 *
 * java-ownerless-probe.ts located the defect (60 symbols, 2 corpus paths, one
 * source file, a hard boundary between the method at line 995 which KEEPS its
 * owner and the method at line 1014 which LOSES it) but deliberately stopped
 * short of a cause. This probe prints what the cause has to be compatible with:
 * for each owner-less method_declaration, the full ancestor node-type chain and
 * the field/child index, plus the same for the nearest OWNED method, so the two
 * can be compared rather than one being assumed.
 *
 * It also does the obvious arithmetic the other probe could not: it counts how
 * many method_declarations the class_body holds, and how many of them the walk
 * ever pushed a scope for.
 *
 * NO REGEX. Tree walk and character walk only.
 */
import { readFileSync } from "node:fs"
import { getParser } from "../../../src/ast/engine"

const FILE = process.env.PROBE_FILE ??
  "$HOME/fixtures/repositories/java-lib/guava/src/com/google/common/base/Preconditions.java"

function chain(node: any): string[] {
  const out: string[] = []
  let cur = node
  while (cur) {
    out.push(cur.type)
    cur = cur.parent
  }
  return out.reverse().join(" > ")
}

function siblingIndex(node: any): string {
  const p = node.parent
  if (!p) return "no-parent"
  let idx = -1
  for (let i = 0; i < p.namedChildCount; i++) {
    if (p.namedChild(i)?.id === node.id) { idx = i; break }
  }
  const field = (() => {
    for (let i = 0; i < p.childCount; i++) {
      const c = p.child(i)
      if (c && c.id === node.id) return p.fieldNameForChild ? p.fieldNameForChild(i) ?? "(unnamed)" : "(no fieldNameForChild)"
    }
    return "(not a child)"
  })()
  return `namedChild#${idx}/${p.namedChildCount} field=${field}`
}

async function main() {
  const src = readFileSync(FILE, "utf8")
  const parser = await getParser("java")
  const tree = parser.parse(src)
  if (!tree) throw new Error("parser.parse returned no tree (null result)")

  // Walk every method_declaration with an explicit path + sibling index.
  const methods: { line: number; name: string; path: string; sib: string }[] = []
  const stack = [tree.rootNode]
  while (stack.length) {
    const n = stack.pop()
    if (!n) continue
    if (n.type === "method_declaration" || n.type === "constructor_declaration") {
      const nameChild = (() => {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c && c.type === "identifier") return c
        }
        return null
      })()
      methods.push({
        line: n.startPosition.row + 1,
        name: nameChild ? nameChild.text : "(no-identifier)",
        path: chain(n),
        sib: siblingIndex(n),
      })
    }
    for (let i = n.namedChildCount - 1; i >= 0; i--) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  methods.sort((a, b) => a.line - b.line)

  const paths = new Map<string, number>()
  for (const m of methods) paths.set(m.path, (paths.get(m.path) ?? 0) + 1)
  console.log(`FILE ${FILE}`)
  console.log(`method/constructor declarations in tree: ${methods.length}`)
  console.log(`distinct ANCESTOR CHAINS among them:`)
  for (const [p, n] of [...paths.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${p}`)
  }

  // Where does the chain change? Print the run-length encoding of chain ids.
  const ids = new Map<string, number>()
  for (const p of [...paths.keys()].sort()) { ids.set(p, ids.size) }
  let runs: string[] = []
  let curId = methods[0] ? ids.get(methods[0].path)! : -1
  let from = methods[0]?.line ?? 0
  for (let i = 1; i < methods.length; i++) {
    const id = ids.get(methods[i].path)!
    if (id !== curId) {
      runs.push(`  lines ${from}..${methods[i - 1].line}: chain#${curId} = ${[...ids.entries()].find(e => e[1] === curId)![0]}`)
      curId = id; from = methods[i].line
    }
  }
  runs.push(`  lines ${from}..${methods[methods.length - 1].line}: chain#${curId} = ${[...ids.entries()].find(e => e[1] === curId)![0]}`)
  console.log(`\nRUN-LENGTH ENCODING of the ancestor chain, in source order:`)
  for (const r of runs) console.log(r)

  console.log(`\nBOUNDARY DETAIL (5 before / 5 after each chain change):`)
  for (let i = 1; i < methods.length; i++) {
    if (methods[i].path === methods[i - 1].path) continue
    console.log(`  --- change at line ${methods[i].line} ---`)
    for (let j = Math.max(0, i - 3); j <= Math.min(methods.length - 1, i + 2); j++) {
      const m = methods[j]
      console.log(`    line ${String(m.line).padStart(5)} ${m.name.padEnd(18)} ${m.sib}`)
      console.log(`            path ${m.path}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })