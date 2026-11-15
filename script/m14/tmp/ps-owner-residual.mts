// Diagnostic probe (tmp): for the `owner`-claim rows the arbiter reports as UNVERIFIED, read the
// analyzer's OWN metadata for the same site, so the residual of `ext?` is split by the construct that
// produced it rather than by the target's spelling.
//
// Usage: bun script/m14/tmp/ps-owner-residual.mts <gate-dump.txt>
import { parseFile } from "../../../src/ast/pool-worker"
import * as fs from "node:fs"
import * as path from "node:path"

const dumpPath = process.argv[2]
if (!dumpPath) throw new Error("usage: ps-owner-residual.mts <gate-dump.txt>")

type Site = { file: string; line: number; target: string; label: string }
const sites: Site[] = []
for (const line of fs.readFileSync(dumpPath, "utf8").split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const cols = line.split("\t")
  if (cols[2] !== "externalUnverified" || cols[5] !== "owner") continue
  const loc = cols[4] ?? ""
  const at = loc.lastIndexOf(":")
  if (at <= 0) continue
  const n = Number(loc.slice(at + 1))
  if (!Number.isFinite(n)) continue
  sites.push({ file: loc.slice(0, at), line: n, target: cols[3] ?? "", label: cols[1] ?? "" })
}

const byFile = new Map<string, Site[]>()
for (const s of sites) {
  const list = byFile.get(s.file)
  if (list) list.push(s)
  else byFile.set(s.file, [s])
}

const buckets = new Map<string, number>()
const samples = new Map<string, string[]>()
const bump = (key: string, sample: string) => {
  buckets.set(key, (buckets.get(key) ?? 0) + 1)
  const arr = samples.get(key) ?? []
  if (arr.length < 3) arr.push(sample)
  samples.set(key, arr)
}

let seen = 0
for (const [file, want] of byFile) {
  const res: any = await parseFile(file, path.dirname(file))
  const rels: any[] = res.relationships ?? []
  for (const s of want) {
    const hit = rels.find((r) => {
      const t = String(r.targetName ?? r.target ?? "")
      const ln = r.line_number ?? r.line
      return t === s.target && (ln === s.line || ln === undefined)
    })
    const md = (hit?.metadata ?? {}) as Record<string, unknown>
    seen++
    const tgtLower = String(s.target).toLowerCase()
    const backslash = String(s.target).includes("\\")
    const key = tgtLower.startsWith("using:")
      ? "$using: scope read"
      : md.isConstantKey === true
        ? "constant element-access key (data)"
        : tgtLower.startsWith("env:")
          ? "env provider"
          : /^[a-z]:\\\\/.test(tgtLower) || tgtLower.startsWith("testdrive:")
            ? "drive-qualified path"
            : backslash && /\.(exe|psm1|ps1|dll|cmd|bat)$/.test(tgtLower)
              ? "relative path with an extension leaf"
              : backslash
                ? "module-qualified command (Module\\Command)"
                : String(s.target).includes(":")
                  ? "colon target (drive or scope)"
                  : "other"
    bump(key, `${s.target} @ ${path.basename(file)}:${s.line}`)
  }
}

console.log(`rows examined: ${seen} of ${sites.length}`)
for (const [k, n] of [...buckets].sort((a, b) => b[1] - a[1])) {
  console.log(`\n${String(n).padStart(5)}  ${k}`)
  for (const s of samples.get(k) ?? []) console.log(`         ${s}`)
}
