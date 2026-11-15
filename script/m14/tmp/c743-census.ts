// #743 class census: what constructs cause the ERROR nodes on the pinned
// corpora, grouped by signature, so the grammar work is aimed at measured
// classes instead of the alphabetically first failing file.
//
// The W21 lesson shapes this: an ERROR node's own start line is very often the
// RECOVERY point, not the cause. So the signature is built from the error
// region's STRUCTURE (the ancestor chain plus the first few child types) and a
// normalized first line, and each class is then reduced to a minimal repro by
// the separate reducer before any grammar edit.
//
// Usage:
//   bun script/m14/tmp/c743-census.ts <wasm> <repoDir> <ext1,ext2> [limit] [topN]
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const [wasmPath, repoDir, extsArg, limitArg, topArg] = process.argv.slice(2)
const EXTS = extsArg.split(",").map((e) => e.trim()).filter(Boolean)
const LIMIT = limitArg ? Number(limitArg) : 400
const TOP = topArg ? Number(topArg) : 18
const MIN_BYTES = 1024

function sampleFiles(): string[] {
  const out = execSync(`git ls-files ${EXTS.map((e) => `'*${e}'`).join(" ")}`, {
    cwd: repoDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => {
      try {
        return statSync(`${repoDir}/${f}`).size >= MIN_BYTES
      } catch {
        return false
      }
    })
    .map((f) => ({ f, k: createHash("sha1").update(f).digest("hex") }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((r) => r.f)
    .slice(0, LIMIT)
}

// Normalize a source line into a grouping key: identifiers, literals and
// numbers become placeholders so 40 different `#define X ...` sites share one
// class, while the SHAPE of the line is preserved.
function normLine(s: string): string {
  return s
    .trim()
    .replace(/\/\/.*$/, "")
    .replace(/"(\\.|[^"\\])*"/g, '"S"')
    .replace(/'(\\.|[^'\\])*'/g, "'C'")
    .replace(/\b\d+(\.\d+)?\b/g, "N")
    .replace(/\b[A-Za-z_]\w*\b/g, "ID")
    .replace(/\s+/g, " ")
    .slice(0, 70)
}

function ancestors(n: any): string[] {
  const out: string[] = []
  let p = n.parent
  while (p && out.length < 5) {
    out.push(p.type)
    p = p.parent
  }
  return out
}

function collectErrors(root: any): any[] {
  const out: any[] = []
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR") out.push(n)
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  // document order
  return out.sort((a, b) => a.startIndex - b.startIndex)
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({
    locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const lang = await Language.load(readFileSync(wasmPath))
  const files = sampleFiles()
  let parser = new Parser()
  parser.setLanguage(lang)

  const classes = new Map<string, { files: Set<string>; n: number; examples: string[]; firstLine: string }>()
  let errorFiles = 0
  let parsedSinceReload = 0

  for (const f of files) {
    const text = readFileSync(`${repoDir}/${f}`, "utf8")
    const tree = parser.parse(text)
    const errs = collectErrors(tree.rootNode)
    if (errs.length) {
      errorFiles++
      const e = errs[0]
      const lineText = (text.split("\n")[e.startPosition.row] ?? "").trim()
      const kids = Array.from({ length: Math.min(4, e.childCount) }, (_, i) => e.child(i).type)
      const sig = `${ancestors(e).slice(0, 2).reverse().join(">")} :: ERROR[${kids.join(",")}] :: ${normLine(lineText)}`
      const bucket = classes.get(sig) ?? { files: new Set<string>(), n: 0, examples: [], firstLine: lineText }
      bucket.files.add(f)
      bucket.n++
      if (bucket.examples.length < 3) bucket.examples.push(`${f}:${e.startPosition.row + 1}`)
      classes.set(sig, bucket)
    }
    tree.delete()
    if (++parsedSinceReload >= 40) {
      parser.delete()
      parser = new Parser()
      parser.setLanguage(lang)
      parsedSinceReload = 0
    }
  }

  const ranked = [...classes.entries()].sort((a, b) => b[1].files.size - a[1].files.size)
  console.log(`# ${repoDir} — ${files.length} files sampled, ${errorFiles} with ERROR nodes, ${classes.size} distinct signatures`)
  let cum = 0
  for (const [sig, b] of ranked.slice(0, TOP)) {
    cum += b.files.size
    console.log(`${String(b.files.size).padStart(4)}f ${String(b.n).padStart(4)}x  ${sig}`)
    console.log(`        e.g. ${b.examples.join(" · ")}`)
  }
  console.log(`# top ${Math.min(TOP, ranked.length)} signatures cover ${((100 * cum) / Math.max(1, errorFiles)).toFixed(1)}% of ${errorFiles} error files`)
}

main().catch((e) => {
  console.error("c743-census failed:", e)
  process.exit(1)
})
