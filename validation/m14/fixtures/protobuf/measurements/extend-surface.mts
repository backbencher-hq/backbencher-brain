/**
 * PROTOBUF — the `extend` surface probe.
 *
 * Measures the nearest shape to a mixin: an `extend <Type> { ... }` block. The
 * ruling does not take it because protobuf has no supertype chain; this probe
 * counts the surface and splits the target into same-file and cross-file so the
 * near miss is inspectable rather than asserted.
 *
 * Run: BB_CORPUS_ROOT=/path/to/corpus bun validation/m14/fixtures/protobuf/measurements/extend-surface.mts
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
let sameFileTargets = 0
let crossFileTargets = 0
const filesWith = new Set<string>()
const targets = new Map<string, number>()

for (const f of files) {
  let src: string
  try { src = fs.readFileSync(f, "utf8") } catch { continue }
  const declared = new Set<string>()
  for (const m of src.matchAll(/\b(?:message|enum|service)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) declared.add(m[1])
  for (const m of src.matchAll(/\bextend\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\{/g)) {
    sites++
    filesWith.add(f)
    const target = m[1]
    targets.set(target, (targets.get(target) ?? 0) + 1)
    if (declared.has(target.split(".").pop()!)) sameFileTargets++
    else crossFileTargets++
  }
}

console.log(JSON.stringify({
  probe: "extend-surface",
  corpusRoot: ROOT,
  admittedProtoFiles: files.length,
  extendSites: sites,
  filesCarryingExtend: filesWith.size,
  sameFileTargets,
  crossFileTargets,
  distinctTargets: targets.size,
  topTargets: [...targets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
}, null, 2))
