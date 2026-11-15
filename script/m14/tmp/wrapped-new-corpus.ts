// #858 change-surface sweep. Walks the web corpora, selects only the files whose
// TEXT contains the wrapped-`new` shape (a line ending in the `new` keyword), and
// prints every relationship the given tree emits for them. Run once with
// --root=/tmp/bb-858 (pre-fix) and once with the working tree (post-fix), then
// diff the two sets: the change surface must be exactly these files, and the
// delta must be instantiates gained / calls lost.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "/home/ishaq2321/mcp/backbencher-brain"
const CORPORA = [
  "/home/ishaq2321/bb_tests/repositories/element-plus",
  "/home/ishaq2321/bb_tests/repositories/vue-core",
  "/home/ishaq2321/bb_tests/repositories/shadcn-svelte",
  "/home/ishaq2321/bb_tests/repositories/lodash",
]
const EXTS = (process.argv.find((a) => a.startsWith("--exts="))?.slice("--exts=".length) ?? ".ts,.tsx,.js,.jsx,.mjs,.cjs").split(",")

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (EXTS.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

/** A line that ENDS with the `new` keyword — the shape #858 is about. */
function hasWrappedNew(text: string): boolean {
  return text.split("\n").some((line) => {
    const t = line.trim()
    if (!t || t.startsWith("//") || t.startsWith("*")) return false
    return /(^|\s)new\s*$/.test(t)
  })
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  let candidates = 0
  let changedFiles = 0
  for (const corpus of CORPORA) {
    for (const file of walk(corpus).sort()) {
      const text = readFileSync(file, "utf8")
      if (!hasWrappedNew(text)) continue
      candidates++
      const res: any = await ASTEngine.parseFile(file, text)
      const rows = (res.relationships ?? []).map(
        (r: any) => `${r.type}|${r.source}|${r.target}|${r.line_number ?? "null"}`,
      )
      rows.sort()
      const rel = path.relative("/home/ishaq2321/bb_tests/repositories", file)
      process.stdout.write(`## ${rel}\n`)
      for (const row of rows) process.stdout.write(row + "\n")
      changedFiles++
    }
  }
  console.error(`candidate files (text contains the shape): ${candidates}`)
  console.error(`files emitted: ${changedFiles}`)
}

main()
