/**
 * PROTOBUF — the `renders` surface probe.
 *
 * Measures the nearest shape to a rendered component: the `google.api.*`
 * annotation family on services/methods/fields. There is no component or render
 * production in protobuf; the annotations are metadata, and the count is the
 * measured near miss, not a `renders` claim.
 *
 * Run: BB_CORPUS_ROOT=/path/to/corpus bun validation/m14/fixtures/protobuf/measurements/renders-surface.mts
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

let sites = 0
const filesWith = new Set<string>()
const tags = new Map<string, number>()

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  for (const m of src.matchAll(/google\.api\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    sites++
    filesWith.add(f)
    tags.set(m[1], (tags.get(m[1]) ?? 0) + 1)
  }
}

console.log(JSON.stringify({
  probe: "renders-surface",
  corpusRoot: ROOT,
  admittedProtoFiles: files.length,
  googleApiApplications: sites,
  filesCarryingGoogleApi: filesWith.size,
  byTag: [...tags.entries()].sort((a, b) => b[1] - a[1]),
}, null, 2))
