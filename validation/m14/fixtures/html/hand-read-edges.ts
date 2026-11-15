/**
 * HAND-READ SUPPORT — print the edges that carry a claim, with the claim's own candidate, so ten of
 * them can be opened in the source and read. Not a gate and not a metric: it exists because "the fix
 * resolves N edges" is a count, and clause 5 asks what the edges MEAN.
 *
 * RUN: bun validation/m14/fixtures/html/hand-read-edges.ts <population-list.txt> <stride> <perChannel>
 */
import { existsSync, readFileSync } from "node:fs"
import * as path from "node:path"
const { parseFile } = await import("../../../../src/ast/pool-worker.ts")

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const listFile = process.argv[2]
const stride = Number(process.argv[3] ?? 40)
const perChannel = Number(process.argv[4] ?? 3)
const all = readFileSync(listFile, "utf8").split("\n").filter((l) => l.startsWith("BB_LIST_FILES_FILE: ")).map((l) => l.slice("BB_LIST_FILES_FILE: ".length))
const want = Number(process.env.BB_HAND_READ_FILES ?? 120)
const picked = all.filter((_, i) => i % stride === 0).slice(0, want)

const channelOf = (md: Record<string, unknown>): string => {
  if (Array.isArray(md.importProjectFile)) return "FILE(importProjectFile)"
  if (Array.isArray(md.sourcePathClaim)) return "SOURCE(sourcePathClaim)"
  return ""
}
const shown = new Map<string, number>()
for (const f of picked) {
  const root = path.join(CR, f.slice(CR.length + 1).split(path.sep)[0])
  let r: any
  try { r = await parseFile(f, root, { projectRoot: root } as any) } catch { continue }
  for (const rel of r.relationships ?? []) {
    if (String(rel.type) !== "uses") continue
    const md = (rel.metadata ?? {}) as Record<string, unknown>
    const ch = channelOf(md)
    if (ch.length === 0) continue
    const n = shown.get(ch) ?? 0
    if (n >= perChannel) continue
    shown.set(ch, n + 1)
    const cand = Array.isArray(md.importProjectFile) ? md.importProjectFile[0] : Array.isArray(md.sourcePathClaim) ? md.sourcePathClaim[0] : ""
    const onDisk = ch.startsWith("FILE") ? existsSync(path.join(root, String(cand))) : false
    console.log(`${ch} ${path.relative(CR, f)}:${rel.line_number} target=${JSON.stringify(rel.target)} candidate=${JSON.stringify(cand)} onDisk=${onDisk} admittable=${String(md.resourceType)}`)
  }
}
