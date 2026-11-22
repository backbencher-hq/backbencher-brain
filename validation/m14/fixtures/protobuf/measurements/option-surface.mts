/**
 * PROTOBUF — the `option` surface probe.
 *
 * Measures the nearest shape to a decorator: `option` statements and `[...]`
 * option groups on fields/enums/services. Protobuf options are descriptor
 * metadata; the ruling is ontological (passive metadata, not an applied
 * callable). The probe splits custom `(…)` options from builtin options so the
 * near miss is inspectable.
 *
 * Run: BB_CORPUS_ROOT=/path/to/corpus bun validation/m14/fixtures/protobuf/measurements/option-surface.mts
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

function walk(dir: string, out: string[]): void {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    let isDir = e.isDirectory()
    if (e.isSymbolicLink()) { try { isDir = fs.statSync(p).isDirectory() } catch { isDir = false } }
    if (isDir) walk(p, out)
    else if (e.name.endsWith(".proto")) out.push(p)
  }
}

const files: string[] = []
walk(ROOT, files)

let optionStatements = 0
let optionGroups = 0
let optionEntries = 0
let customEntries = 0
let builtinEntries = 0
const filesWith = new Set<string>()

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  const statements = [...src.matchAll(/\boption\s+([^=;]+)=/g)]
  optionStatements += statements.length
  if (statements.length) filesWith.add(f)
  for (const m of src.matchAll(/\[([^\]]+)\]/g)) {
    const body = m[1]
    if (!body.includes("=")) continue
    optionGroups++
    filesWith.add(f)
    const entries = body.split(",").map((s) => s.trim()).filter((s) => s.includes("="))
    optionEntries += entries.length
    for (const e of entries) if (e.startsWith("(")) customEntries++
    else builtinEntries++
  }
}

console.log(JSON.stringify({
  probe: "option-surface",
  corpusRoot: ROOT,
  admittedProtoFiles: files.length,
  optionStatements,
  optionGroups,
  optionEntries,
  customEntries,
  builtinEntries,
  filesCarryingOption: filesWith.size,
}, null, 2))
