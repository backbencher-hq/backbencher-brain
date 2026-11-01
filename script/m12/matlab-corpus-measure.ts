import { readdir } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { ASTEngine } from "../../src/ast/engine"

const root = resolve(process.argv[2] ?? "validation/m14/fixtures/matlab")
const files: string[] = []

async function collect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name)
    if (entry.isDirectory()) await collect(file)
    else if (file.toLowerCase().endsWith(".m")) files.push(file)
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
    const result = await ASTEngine.parseFile(file, readFileSync(file, "utf8"))
    symbols += result.symbols?.length ?? 0
    relationships += result.relationships?.length ?? 0
    errors += result.errors?.length ?? 0
  } catch {
    crashes++
  }
}

console.log(JSON.stringify({
  language: "matlab",
  root,
  files: files.map((file) => relative(root, file)),
  fileCount: files.length,
  symbols,
  relationships,
  errors,
  crashes,
  policy: "all .m files under the supplied root; no curated exclusions",
}, null, 2))
