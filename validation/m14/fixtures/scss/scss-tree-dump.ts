/**
 * SCSS — print the parse tree around a given byte offset, for one file.
 *
 * A tree dumper for hand-attribution. `scss-other-bucket.ts` measured 81 unresolved
 * `OTHER` targets / 100 edges of which 99 are `extends`, shaped
 * `"%skeleton-pulsation; height: cv.getVar"` — a placeholder name with a fragment of a
 * rule body glued on. `scss-extend-node-shape.ts` showed the RECOVERED path is clean (268
 * `placeholder` descendants, 0 with unnameable text), so the malformed edge is produced by
 * a node shape that instrument's filter does not admit. This dumper answers that directly:
 * it prints the tree with byte ranges and node text, so the offending node is visible
 * rather than inferred.
 *
 * READ-ONLY. Writes nothing.
 *
 * ## Usage
 *
 *   npx tsx validation/m14/fixtures/scss/scss-tree-dump.ts <file> [needle] [maxDepth]
 *
 * `needle` — only nodes whose text contains it are printed, along with their ANCESTORS up
 * to the root, so the path from the file root to the offending node is shown. Omit it to
 * print the whole tree up to `maxDepth` (default 6).
 */
import { readFileSync } from "node:fs"
import * as path from "node:path"
import type { Node } from "web-tree-sitter"

const file = process.argv[2]
const needle = process.argv[3] ?? ""
const MAXDEPTH = Number(process.argv[4] ?? 6)
if (!file) {
  console.error("usage: scss-tree-dump.ts <file> [needle] [maxDepth]")
  process.exit(2)
}

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-scss.wasm"))))

const src = readFileSync(file, "utf8")
const tree = parser.parse(src)

function text(n: Node): string {
  return src.slice(Number(n.startIndex), Number(n.endIndex)).replace(/\s+/g, " ").trim()
}

function print(n: Node, depth: number, prefix: string): void {
  if (depth > MAXDEPTH) return
  const t = text(n)
  const flag = needle && t.includes(needle) ? "  <== MATCH" : ""
  console.log(`${prefix}${n.type}${n.isNamed ? "" : " (anon)"}${n.isNamed ? "" : ` '${t.slice(0, 40)}'`}`)
  if (needle && t.includes(needle) && depth < MAXDEPTH) {
    console.log(`${prefix}   text: ${JSON.stringify(t.slice(0, 160))}${flag}`)
  }
  for (let i = 0; i < n.childCount; i++) {
    const c = n.child(i)
    if (!c) continue
    print(c, depth + 1, `${prefix}  `)
  }
}

if (needle) {
  // collect every node containing the needle, then print each one's root path
  const hits: Node[] = []
  const walk = (n: Node): void => {
    if (text(n).includes(needle)) hits.push(n)
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c)
    }
  }
  walk(tree.rootNode as Node)
  const keyOf = (n: Node): string => `${n.type}:${n.startIndex}:${n.endIndex}`
  // keep only the DEEPEST hits — an ancestor's text also contains the needle
  const deepest = hits.filter((h) => !hits.some((o) => o !== h && (o as any).descendantCount > 0 && contains(o, h)))
  // web-tree-sitter returns a FRESH wrapper object per .child() call, so `n === target`
  // is never true. Nodes are keyed by their byte span, which is unique in a tree.
  const pathOf = (target: Node): Node[] => {
    const want = keyOf(target)
    const chain: Node[] = []
    const rec = (n: Node): boolean => {
      if (keyOf(n) === want) {
        chain.push(n)
        return true
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && rec(c)) {
          chain.push(n)
          return true
        }
      }
      return false
    }
    rec(tree.rootNode as Node)
    return chain.reverse()
  }
  function contains(a: Node, b: Node): boolean {
    const ka = keyOf(a)
    let found = false
    const rec = (n: Node): void => {
      if (keyOf(n) === ka) found = true
      for (let i = 0; i < n.childCount && !found; i++) {
        const c = n.child(i)
        if (c) rec(c)
      }
    }
    rec(b)
    return found
  }
  console.log(`SCSS tree dump — ${file}`)
  console.log(`needle ${JSON.stringify(needle)}: ${hits.length} nodes contain it, ${deepest.length} are deepest\n`)
  // the OFFENDING node: the one whose text is exactly what the malformed target was.
  // matched by prefix from the corpus measurement, not by type.
  const offenders = hits.filter((h) => text(h).startsWith("%skeleton-pulsation;") || text(h).startsWith("%block;"))
  const shown = [...offenders.slice(0, 4), ...deepest.filter((d) => !offenders.includes(d)).slice(0, 3)]
  console.log(`offending nodes (text starts with the measured malformed target): ${offenders.length}`)
  for (const h of shown) {
    console.log("=".repeat(90))
    for (const n of pathOf(h)) {
      console.log(`  ${n.type.padEnd(28)} [${n.startIndex},${n.endIndex}] named=${n.isNamed}  ${JSON.stringify(text(n).slice(0, 110))}`)
    }
  }
  if (deepest.length > shown.length) console.log(`\n... ${deepest.length - shown.length} more deepest hits`)
} else {
  console.log(`SCSS tree dump — ${file}  (maxDepth ${MAXDEPTH})`)
  print(tree.rootNode as Node, 0, "")
}