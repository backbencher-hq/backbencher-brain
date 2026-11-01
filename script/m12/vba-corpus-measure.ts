import { readdir } from "node:fs/promises"
import { join, relative, resolve } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const root = resolve(process.argv[2] ?? "validation/m14/fixtures/vba")
const extensions = new Set([".bas", ".cls", ".frm"])
const files: string[] = []

async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (extensions.has(path.slice(path.lastIndexOf(".")).toLowerCase())) files.push(path)
  }
}

await collect(root)
files.sort()
let symbols = 0
let relationships = 0
let errors = 0
let crashes = 0
for (const file of files) {
  try {
    const result = await parseFile(file, process.cwd())
    symbols += result.symbols?.length ?? 0
    relationships += result.relationships?.length ?? 0
    errors += result.errors?.length ?? 0
  } catch {
    crashes++
  }
}

console.log(JSON.stringify({
  language: "vba",
  root,
  files: files.map((file) => relative(root, file)),
  fileCount: files.length,
  symbols,
  relationships,
  errors,
  crashes,
  policy: "all .bas, .cls, and .frm files under the supplied root; no curated exclusions",
}, null, 2))
