/**
 * CSHARP LANE — whole-population WALL CLASSIFIER (task-37 STEP 4 prep, read-only).
 *
 * Reads a gate `--dump` from the csharp no-index arm, rebuilds the SAME analyzer key space the
 * gate used by running the production analyzer over the corpus once, and classifies every
 * non-resolved edge into a named wall with its evidence:
 *
 *   same-file-intended    the edge's OWN FILE declares the exact target name
 *   cross-file-declared   only ANOTHER file declares the exact target name
 *   kind-mismatch         declarations exist, more than one symbol kind (the gate's ambBoth)
 *   nowhere-declared      no project declaration answers the exact name (external/library/BCL)
 *
 * plus a spelling family per label (type/dotted/qualified/bare/operator/keyword/global). It
 * resolves nothing: it classifies, with counts and samples — the D7 disposition input.
 * For dotted targets it also records whether the RECEIVER prefix is a declared project type
 * (a name-model join gap) or nothing at all (external), because that split is the wall.
 *
 * CLI: bun run script/m14/csharp-arm-classify.ts <dump> [--json]
 * EXIT 0 measured · 2 usage
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const dumpPath = argv.find((a) => !a.startsWith("--"))
const asJson = argv.includes("--json")
if (!dumpPath) {
  console.error("usage: csharp-arm-classify.ts <dump> [--json]")
  process.exit(2)
}
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")

type Row = { label: string; outcome: string; target: string; file: string; line: number; claimKind: string }
const rows: Row[] = []
for (const raw of readFileSync(dumpPath, "utf8").split("\n")) {
  if (!raw.startsWith("DUMP\t")) continue
  const p = raw.split("\t")
  if (p.length < 6) continue
  const loc = p[4]
  const colon = loc.lastIndexOf(":")
  rows.push({
    label: p[1], outcome: p[2], target: p[3],
    file: colon > 0 ? loc.slice(0, colon) : loc,
    line: colon > 0 ? Number(loc.slice(colon + 1)) || 0 : 0,
    claimKind: p[5],
  })
}

function walkCorpus(dir: string): string[] {
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const d = stack.pop()!
    let entries: import("node:fs").Dirent[]
    try { entries = readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const abs = path.join(d, e.name)
      let isDir = e.isDirectory()
      if (!isDir && e.isSymbolicLink()) {
        try { isDir = statSync(abs).isDirectory() } catch { isDir = false }
      }
      if (isDir) stack.push(abs)
      else if (e.name.endsWith(".cs") || e.name.endsWith(".csx")) out.push(abs)
    }
  }
  return out
}
const repoOf = (p: string): string => {
  const marker = `${path.sep}.corpus${path.sep}`
  const i = p.indexOf(marker)
  return i < 0 ? "" : p.slice(i + marker.length).split(path.sep)[0]
}

const files = walkCorpus(CORPUS).sort()
// production key space: symbol names + kinds per repo (the gate builds it from the SAME analyzer)
const repoDecl = new Map<string, Map<string, Set<string>>>()
const fileDecl = new Map<string, Set<string>>()
for (const f of files) {
  const repo = repoOf(f)
  const map = repoDecl.get(repo) ?? new Map<string, Set<string>>()
  const own = new Set<string>()
  try {
    const r: any = await parseFile(f, path.dirname(f))
    for (const s of r.symbols ?? []) {
      const nm = String(s?.name ?? "")
      if (!nm) continue
      const set = map.get(nm) ?? new Set<string>()
      set.add(String(s?.kind ?? ""))
      map.set(nm, set)
      own.add(nm)
    }
  } catch { /* unreadable: no declarations */ }
  repoDecl.set(repo, map)
  fileDecl.set(f, own)
}

const OPERATOR_CHARS = "+-*/%=<>!&|^~?:"
function familyOf(label: string, target: string): string {
  const t = String(target ?? "")
  if (t.length === 0) return "empty"
  if (label === "exports") return t.includes(".") ? "qualified-type" : "bare-type"
  if (t.includes("(")) return "signature-ish"
  if (t.includes(".")) {
    const first = t.split(".")[0]
    return first.length > 0 && first[0] >= "A" && first[0] <= "Z" ? "dotted-type" : "dotted-lower"
  }
  if (t[0] >= "A" && t[0] <= "Z") return "bare-type"
  if (t.startsWith("global") || t === "root") return "root-like"
  if (t.length === 1 && OPERATOR_CHARS.includes(t)) return "operator"
  return "bare-leaf"
}
/** For a dotted target: is any prefix a declared project TYPE (module/receiver known)? */
function receiverKnown(row: Row): boolean {
  const t = row.target
  if (!t.includes(".") || t.startsWith("(")) return false
  const parts = t.split(".")
  const map = repoDecl.get(repoOf(row.file))
  if (!map) return false
  for (let n = parts.length - 1; n >= 1; n--) {
    const cand = parts.slice(0, n).join(".")
    const kinds = map.get(cand)
    if (kinds && (kinds.has("class") || kinds.has("struct") || kinds.has("interface") || kinds.has("enum") || kinds.has("module") || kinds.has("namespace"))) return true
  }
  return false
}
const CLASSES = ["same-file-intended", "cross-file-declared", "kind-mismatch", "nowhere-declared"] as const
type Cls = typeof CLASSES[number]
function classify(row: Row): Cls {
  const own = fileDecl.get(row.file)
  const kinds = repoDecl.get(repoOf(row.file))?.get(row.target)
  if (own?.has(row.target)) return "same-file-intended"
  if (kinds && kinds.size > 0) return "cross-file-declared"
  if (row.outcome === "ambBoth") return "kind-mismatch"
  return "nowhere-declared"
}

const agg = new Map<string, { count: number; samples: string[] }>()
const bump = (key: string, row: Row) => {
  const e = agg.get(key) ?? { count: 0, samples: [] }
  e.count++
  if (e.samples.length < 3) e.samples.push(`${row.target} @ ${row.file.split("/.corpus/").pop()}:${row.line}`)
  agg.set(key, e)
}
for (const row of rows) {
  const cls = classify(row)
  const fam = familyOf(row.label, row.target)
  const rx = row.target.includes(".") ? (receiverKnown(row) ? "receiver-project" : "receiver-external") : "n/a"
  bump(`${row.label}\u0000${row.outcome}\u0000${fam}\u0000${cls}\u0000${rx}`, row)
}
const groups = [...agg.entries()].map(([k, v]) => {
  const [label, outcome, family, cls, receiver] = k.split("\u0000")
  return { label, outcome, family, class: cls, receiver, count: v.count, sample: v.samples }
}).sort((a, b) => b.count - a.count)

const byLabelClass = new Map<string, { total: number; classes: Record<string, number>; receivers: Record<string, number> }>()
for (const g of groups) {
  const e = byLabelClass.get(g.label) ?? { total: 0, classes: {}, receivers: {} }
  e.total += g.count
  e.classes[g.class] = (e.classes[g.class] ?? 0) + g.count
  if (g.receiver !== "n/a") e.receivers[g.receiver] = (e.receivers[g.receiver] ?? 0) + g.count
  byLabelClass.set(g.label, e)
}
const summary = [...byLabelClass.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.total - a.total)
if (asJson) {
  console.log(JSON.stringify({ dump: dumpPath, corpusFiles: files.length, rows: rows.length, summary, groups }, null, 2))
} else {
  console.log(`corpus files: ${files.length} · dump rows: ${rows.length}`)
  for (const s of summary) {
    console.log(`\n${s.label} total ${s.total}: ` + Object.entries(s.classes).map(([k, v]) => `${k}=${v}`).join(" · ") +
      (Object.keys(s.receivers).length > 0 ? " | " + Object.entries(s.receivers).map(([k, v]) => `${k}=${v}`).join(" · ") : ""))
    for (const g of groups.filter((x) => x.label === s.label).slice(0, 5)) {
      console.log(`   ${g.outcome.padEnd(12)} ${g.family.padEnd(14)} ${g.class.padEnd(20)} ${g.receiver.padEnd(18)} ${String(g.count).padStart(6)}  ${g.sample[0] ?? ""}`)
    }
  }
}
