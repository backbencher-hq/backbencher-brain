// #743 grammar-wave instrument: does a freshly built wasm reproduce the
// COMMITTED wasm's parse behaviour, file by file?
//
// The groovy wave's lesson (W18/W19) is the reason this compares BEHAVIOUR and
// not hashes: a grammar built from the same source in a different directory
// yields a different sha with identical measured behaviour, and a newer CLI
// shifts parser.c. So byte equality is neither achievable nor meaningful; what
// must hold is set-identity of the trees.
//
// Usage:
//   bun script/m14/tmp/c743-baseline.ts <wasm> <repoDir> <ext1,ext2,...> [limit]
//
// Prints one line per sampled file: <relpath>\t<sexp sha1>\t<ERROR files>\t<MISSING tokens>
// Run it once per wasm and `diff` the two outputs.
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { execSync } from "node:child_process"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"

const [wasmPath, repoDir, extsArg, limitArg] = process.argv.slice(2)
if (!wasmPath || !repoDir || !extsArg) {
  console.error("usage: c743-baseline.ts <wasm> <repoDir> <ext1,ext2,...> [limit]")
  process.exit(2)
}
const EXTS = extsArg.split(",").map((e) => e.trim()).filter(Boolean)
const LIMIT = limitArg ? Number(limitArg) : 200
const MIN_BYTES = 1024

// Deterministic, routing-independent sample: hash of the relative path then
// sort, the F10 rule. This is a strict compare between two builds, so the
// important property is only that both runs draw the SAME files.
function sampleFiles(): string[] {
  const out = execSync(
    `git ls-files ${EXTS.map((e) => `'*${e}'`).join(" ")}`,
    { cwd: repoDir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
  const rows = out
    .split("\n")
    .map((f) => f.trim())
    .filter((f) => f.length > 0)
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
  return rows.slice(0, LIMIT)
}

function census(root: any): { err: number; miss: number; errRows: number } {
  let err = 0
  let miss = 0
  const rows = new Set<number>()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n.type === "ERROR" || n.isError) {
      err++
      // The F10 unit: a distinct line carrying an ERROR node. A recovery that
      // splits one error region into two nodes on the same line is not a
      // regression of this metric; a new line is.
      rows.add(n.startPosition.row)
    }
    if (n.isMissing) miss++
    for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
  }
  return { err, miss, errRows: rows.size }
}

async function main() {
  // The F10 loader, verbatim: web-tree-sitter's own Parser.init with an
  // explicit locateFile, and the language loaded from BYTES. loadWebTreeSitter()
  // returns a module whose emscripten handle is not ready for Language.load in
  // this environment (measured: "Cannot read properties of undefined
  // (reading 'loadWebAssemblyModule')"), so this script uses the entry that the
  // working instrument uses.
  const wts: any = await import("web-tree-sitter")
  const Parser = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await Parser.init({
    locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm"),
  })
  const lang = await Language.load(readFileSync(wasmPath))
  const files = sampleFiles()

  // One child process per file would be the purest isolation, but the wasm
  // module is the leaky resource (F10: one module degrades after ~19-31 lanes
  // and then returns EMPTY trees before aborting). Reload every 40 files and
  // print an explicit marker if a parse comes back empty, so a dead parser can
  // never read as a clean file.
  let parser = new Parser()
  parser.setLanguage(lang)
  let parsedSinceReload = 0
  const lines: string[] = []

  for (const f of files) {
    const src = readFileSync(`${repoDir}/${f}`, "utf8")
    const tree = parser.parse(src)
    const root = tree.rootNode
    if (root.childCount === 0 && src.trim().length > 0) {
      lines.push(`${f}\tEMPTY-TREE\t-1\t-1\t-1`)
    } else {
      const { err, miss, errRows } = census(root)
      const digest = createHash("sha1").update(root.toString()).digest("hex").slice(0, 16)
      lines.push(`${f}\t${digest}\t${err}\t${miss}\t${errRows}`)
    }
    tree.delete()
    if (++parsedSinceReload >= 40) {
      parser.delete()
      parser = new Parser()
      parser.setLanguage(lang)
      parsedSinceReload = 0
    }
  }
  process.stdout.write(lines.join("\n") + "\n")
}

main().catch((e) => {
  console.error("c743-baseline failed:", e)
  process.exit(1)
})
