/**
 * PROTOBUF — the `import` surface probe.
 *
 * Measures the nearest shape to a part/part-of directive: `import "file.proto"`.
 * A `.proto` import is a module dependency (published as `imports`), not a part
 * that shares the importing unit's scope; this probe records the sites, the
 * targets, and whether the target is an admitted file or only a string.
 *
 * Run: BB_CORPUS_ROOT=/path/to/corpus bun validation/m14/fixtures/protobuf/measurements/import-surface.mts
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
const admitted = new Set(files.map((f) => path.resolve(f)))

let sites = 0
let resolvedTargets = 0
let stringOnlyTargets = 0
const filesWith = new Set<string>()
const targets = new Map<string, number>()

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  for (const m of src.matchAll(/\bimport\s+(?:public\s+|weak\s+)?["']([^"']+)["']/g)) {
    sites++
    filesWith.add(f)
    const target = m[1]
    targets.set(target, (targets.get(target) ?? 0) + 1)
    const abs = path.resolve(path.dirname(f), target)
    const candidates = [abs, path.resolve(ROOT, target)]
    if (candidates.some((c) => admitted.has(c) || fs.existsSync(c))) resolvedTargets++
    else stringOnlyTargets++
  }
}

console.log(JSON.stringify({
  probe: "import-surface",
  corpusRoot: ROOT,
  admittedProtoFiles: files.length,
  importSites: sites,
  filesCarryingImport: filesWith.size,
  resolvedTargets,
  stringOnlyTargets,
  distinctTargets: targets.size,
  topTargets: [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
}, null, 2))
