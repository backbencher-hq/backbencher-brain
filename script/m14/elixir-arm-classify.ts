/**
 * ELIXIR LANE — whole-population WALL CLASSIFIER (task-25 STEP 2/3, read-only).
 *
 * Reads a gate `--dump` from the elixir no-index arm and rebuilds the SAME key space the gate
 * used by running the production analyzer over the corpus once, then classifies every non-resolved
 * edge into a named wall with its evidence:
 *
 *   same-file-intended       the edge's OWN FILE declares the target name (a resolution the
 *                            analyzer's own file could support: a name/owner model gap)
 *   cross-file-declared      only ANOTHER file declares it (the gate's arbitraryTwin class; an
 *                            index/import-aware resolver could bind it)
 *   kind-mismatch            declarations exist but of a different kind than the edge type allows
 *   nowhere-declared         no project declaration answers the name (library/erlang/BIF surface)
 *
 * plus a spelling family per label (module-qualified / erlang-atom / function-arity / bare leaf /
 * field leaf / operator). It resolves nothing: it classifies, with counts and samples, which is
 * what a D7 disposition needs.
 *
 * CLI: bun run script/m14/elixir-arm-classify.ts <dump> [--json]
 * EXIT 0 measured · 2 usage
 */
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const dumpPath = argv.find((a) => !a.startsWith("--"))
const asJson = argv.includes("--json")
if (!dumpPath) {
  console.error("usage: elixir-arm-classify.ts <dump> [--json]")
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

/** Symlink-aware corpus walk (the recorded trap: grep/find do not follow the repos). */
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
      else if (e.name.endsWith(".ex") || e.name.endsWith(".exs")) out.push(abs)
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
// production key space: symbol names per repo (the gate builds it from the SAME analyzer output)
const repoDecl = new Map<string, Map<string, number>>()
const fileDecl = new Map<string, Set<string>>()
for (const f of files) {
  const repo = repoOf(f)
  const map = repoDecl.get(repo) ?? new Map<string, number>()
  const own = new Set<string>()
  try {
    const r: any = await parseFile(f, path.dirname(f))
    for (const s of r.symbols ?? []) {
      const nm = String(s?.name ?? "")
      if (nm.length > 0) { map.set(nm, (map.get(nm) ?? 0) + 1); own.add(nm) }
    }
  } catch { /* unreadable file: counted as no declarations */ }
  repoDecl.set(repo, map)
  fileDecl.set(f, own)
}

const EXTERNAL_ROOTS = new Set(["erlang", "elixir", "elixir_erl", "lists", "dict", "maps", "io", "math", "unicode", "ets", "code", "file", "gen_server", "gen_event", "gen_statem", "supervisor", "logger", "application", "calendar"])
function familyOf(label: string, target: string): string {
  if (target.length === 0) return "empty"
  if (target.startsWith(":")) {
    const root = target.slice(1).split(".")[0]
    return EXTERNAL_ROOTS.has(root) ? "erlang-atom-remote" : "atom-qualified"
  }
  if (target.includes("/")) return "function-arity"
  if (target.includes(".")) {
    const first = target.split(".")[0]
    return first.length > 0 && first[0] >= "A" && first[0] <= "Z" ? "module-qualified" : "dotted-other"
  }
  if (/^[A-Z]/.test(target)) return "bare-module-leaf"
  if (/^[+*/|=<>!&^~.-]/.test(target) || target === "not") return "operator"
  return label === "uses" || label === "exports" ? "member-leaf" : "bare-leaf"
}
const CLASSES = ["same-file-intended", "cross-file-declared", "kind-mismatch", "nowhere-declared"] as const
type Cls = typeof CLASSES[number]
function classify(row: Row): Cls {
  const own = fileDecl.get(row.file)
  const count = repoDecl.get(repoOf(row.file))?.get(row.target) ?? 0
  if (own?.has(row.target)) return "same-file-intended"
  if (count > 0) return "cross-file-declared"
  if (count === 0 && row.outcome === "ambBoth") return "kind-mismatch"
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
  const fam = familyOf(row.label, row.target)
  const cls = classify(row)
  bump(`${row.label}\u0000${row.outcome}\u0000${fam}\u0000${cls}`, row)
}
const groups = [...agg.entries()].map(([k, v]) => {
  const [label, outcome, family, cls] = k.split("\u0000")
  return { label, outcome, family, class: cls, count: v.count, sample: v.samples }
}).sort((a, b) => b.count - a.count)

const byLabelClass = new Map<string, Map<string, number>>()
for (const g of groups) {
  const m = byLabelClass.get(g.label) ?? new Map<string, number>()
  m.set(g.class, (m.get(g.class) ?? 0) + g.count)
  byLabelClass.set(g.label, m)
}
const summary = [...byLabelClass.entries()].map(([label, m]) => ({
  label, total: [...m.values()].reduce((a, b) => a + b, 0), classes: Object.fromEntries(m),
})).sort((a, b) => b.total - a.total)

if (asJson) {
  console.log(JSON.stringify({ dump: dumpPath, corpusFiles: files.length, rows: rows.length, summary, groups }, null, 2))
} else {
  console.log(`corpus files: ${files.length} · dump rows: ${rows.length}`)
  for (const s of summary) {
    console.log(`\n${s.label} total ${s.total}: ` + Object.entries(s.classes).map(([k, v]) => `${k}=${v}`).join(" · "))
    for (const g of groups.filter((x) => x.label === s.label).slice(0, 4)) {
      console.log(`   ${g.outcome.padEnd(12)} ${g.family.padEnd(20)} ${g.class.padEnd(20)} ${String(g.count).padStart(6)}  ${g.sample[0] ?? ""}`)
    }
  }
}
