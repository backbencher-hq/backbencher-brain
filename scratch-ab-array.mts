import { readFileSync } from "node:fs"
import * as path from "node:path"
import { admittedFiles } from "./validation/m14/fixtures/json/admitted-files"

const wts: any = await import("web-tree-sitter")
const Parser = wts.Parser ?? wts.default
const Language = wts.Language ?? wts.default?.Language
await Parser.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const wasm = readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-json.wasm"))

type Mode = "short" | "full"
function walkPaths(root: any, rootName: string, mode: Mode): Map<string, number> {
  const out = new Map<string, number>()
  const bump = (p: string): void => out.set(p, (out.get(p) ?? 0) + 1)
  const unquote = (t: string): string => {
    const v = t.trim()
    return v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"' ? v.slice(1, -1) : v
  }
  const keyOf = (pair: any): string | null => {
    if (pair?.type !== "pair") return null
    const k = pair.childForFieldName?.("key")
    if (!k) return null
    const c = k.namedChildren?.find((x: any) => x.type === "string_content")
    return c ? String(c.text ?? "") : unquote(String(k.text ?? ""))
  }
  const stack: any[] = [{ node: root, parentPath: rootName }]
  while (stack.length) {
    const { node, parentPath } = stack.pop()
    if (node.type === "document") {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (c) stack.push({ node: c, parentPath })
      }
      continue
    }
    if (node.type === "array") {
      let childBase: string
      if (mode === "full") {
        childBase = parentPath
      } else {
        const lastSeg = parentPath.slice(parentPath.lastIndexOf(".") + 1)
        const dot = parentPath.indexOf(".", rootName.length)
        childBase =
          parentPath === rootName
            ? rootName
            : lastSeg.endsWith("]")
              ? dot < 0
                ? parentPath.slice(rootName.length)
                : parentPath.slice(dot + 1)
              : lastSeg
      }
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i)
        if (c) stack.push({ node: c, parentPath: `${childBase}[${i}]` })
      }
      continue
    }
    if (node.type === "object") {
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const pair = node.namedChild(i)
        if (pair?.type !== "pair") continue
        const key = keyOf(pair)
        if (key === null) continue
        const value = pair.childForFieldName?.("value")
        const childPath = `${parentPath}.${key}`
        bump(childPath)
        if (value) stack.push({ node: value, parentPath: childPath })
      }
      continue
    }
  }
  return out
}

function documentName(fp: string): string {
  const base = fp.slice(fp.lastIndexOf("/") + 1)
  const lower = base.toLowerCase()
  for (const s of [".json", ".jsonc", ".json5"]) if (lower.endsWith(s)) return base.slice(0, base.length - s.length) || "document"
  return base || "document"
}

const walk = admittedFiles(process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories")
const p = new Parser()
p.setLanguage(await Language.load(wasm))

let shortDup = 0
let fullDup = 0
let multi = 0
let filesShort = 0
let filesFull = 0
const grew: { file: string; short: number; full: number }[] = []

for (const f of walk.files) {
  let tree: any
  try {
    tree = p.parse(readFileSync(f.abs, "utf8"))
  } catch {
    tree = null
  }
  if (!tree) continue
  const root = tree.rootNode
  const rn = documentName(f.abs)
  const a = walkPaths(root, rn, "short")
  const b = walkPaths(root, rn, "full")
  let da = 0
  let db = 0
  for (const [, n] of a) if (n > 1) da++
  for (const [, n] of b) if (n > 1) db++
  if (db > 0) multi++
  if (da > 0) filesShort++
  if (db > 0) filesFull++
  shortDup += da
  fullDup += db
  if (db > da) grew.push({ file: f.abs, short: da, full: db })
  tree.delete?.()
}
grew.sort((x, y) => y.full - x.full - (y.short - x.short) || y.full - x.full)
console.log("WHOLE POPULATION")
console.log(`  short-path dup names: ${shortDup} in ${filesShort} files`)
console.log(`  full-path  dup names: ${fullDup} in ${filesFull} files`)
console.log("")
console.log(`files where full > short (${grew.length}):`)
for (const g of grew.slice(0, 8)) console.log(`  ${g.file}\n     short=${g.short} full=${g.full}`)
