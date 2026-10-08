/**
 * VERIFY_ELIXIR / JOB 1 — DOES THE TYPE FIRE?
 *
 * The handover for this lane said "9/10, derived from source". A production run
 * measured 5/10. This script exists to make the number falsifiable on demand: it
 * runs the REAL analyzer through the PRODUCTION entry
 * (`getParser` -> `parse` -> `RealElixirAnalyzer.analyze`, i.e. exactly what
 * `pool-worker.parseFile` calls) over real corpus files and tallies the
 * relationship types that actually COME OUT, per type, with the files they came
 * from.
 *
 * WHY A LANE COPY INSTEAD OF `script/m14/firing-check.mjs`:
 *   1. that harness is MASTER-owned (`script/m14/**`) — this lane must not edit it;
 *   2. it samples 12 files (`pickFiles(dir, exts, 12)`), which is far below the
 *      120-file floor this lane's brief sets — a type can be silent on 12 files
 *      and live on 200;
 *   3. it imports the analyzer and engine from `$HOME/backbencher-brain`
 *      (the MAIN checkout), so a lane in a worktree would be measuring someone
 *      else's bytes. This copy resolves ROOT from its own location.
 * The rules are otherwise identical: same production path, same tally.
 *
 * NO REGEX (hard rule 1). File selection walks the directory tree with
 * `readdirSync(withFileTypes)` and matches extensions by string `endsWith`; every
 * construct probe lives in its own tree-walking census script.
 *
 * CLI:
 *   npx tsx script/m14/verify-elixir/firing.ts [--repo=elixir] [--n=200] [--per-file]
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..")
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const REPO = arg("repo") ?? "elixir"
const N = Number(arg("n") ?? "200")
const PER_FILE = process.argv.includes("--per-file")
const EXTS = [".ex", ".exs"]

/** The ontology's ten types, spelled the way `RelationshipType` spells them. */
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

function walk(dir: string, out: string[] = []): string[] {
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of ents.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === ".git" || e.name === "_build" || e.name === "deps" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (EXTS.some((x) => e.name.endsWith(x))) {
      try { if (fs.statSync(p).size < 400_000) out.push(p) } catch {}
    }
  }
  return out
}

/** Deterministic stride sample: a pure function of the sorted file list. */
function pick(files: string[], n: number): string[] {
  if (n <= 0 || n >= files.length) return files
  const step = files.length / n
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(files[Math.floor(i * step)]!)
  return [...new Set(out)]
}

async function main() {
  const { getParser } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { RealElixirAnalyzer } = await import(path.join(ROOT, "src/ast/real-elixir-analyzer.ts"))
  const { RelationshipType } = await import(path.join(ROOT, "src/ast/types.ts"))
  const enumValues = [...new Set(Object.values(RelationshipType) as string[])]

  const dir = path.join(CORPUS, REPO)
  const all = walk(dir)
  const files = pick(all, N)
  console.log(`elixir-verify firing check`)
  console.log(`root     ${ROOT}`)
  console.log(`corpus   ${dir} — ${all.length} .ex/.exs files available, ${files.length} analyzed`)
  console.log(`enum     ${enumValues.length} distinct values: ${enumValues.join(" ")}`)

  const tally = new Map<string, number>()
  const fileTally = new Map<string, Set<string>>()   // type -> files it came from
  const examples = new Map<string, string[]>()      // type -> first few edge spellings
  let parsed = 0
  const errs: string[] = []
  const perFile: { file: string; syms: number; rels: number; types: Record<string, number> }[] = []

  const parser = await getParser("elixir")
  for (const f of files) {
    let res: any
    try {
      const content = fs.readFileSync(f, "utf8")
      const pr = await parser.parse(content, f)
      res = new RealElixirAnalyzer().analyze(pr.rootNode, content, f)
      parsed++
    } catch (e) {
      errs.push(`${path.basename(f)}: ${String(e).slice(0, 60)}`)
      continue
    }
    const rel = path.relative(dir, f)
    const row: Record<string, number> = {}
    for (const r of res.relationships ?? []) {
      const t = String(r.type ?? r.relationshipType ?? "")
      tally.set(t, (tally.get(t) ?? 0) + 1)
      row[t] = (row[t] ?? 0) + 1
      if (!fileTally.has(t)) fileTally.set(t, new Set())
      const fs_ = fileTally.get(t)!
      if (fs_.size < 400) fs_.add(rel)
      if (!examples.has(t)) examples.set(t, [])
      const ex = examples.get(t)!
      if (ex.length < 3) ex.push(`${r.source} -[${t}]-> ${r.target} @${r.line_number ?? "?"}`)
    }
    perFile.push({ file: rel, syms: (res.symbols ?? []).length, rels: (res.relationships ?? []).length, types: row })
  }

  console.log(`parsed   ${parsed}/${files.length}   errors ${errs.length}`)
  for (const e of errs.slice(0, 5)) console.log(`   ERR ${e}`)
  console.log("")
  let fired = 0
  for (const t of ALL_TYPES) {
    const n = tally.get(t) ?? 0
    const files_ = fileTally.get(t)
    if (n > 0) fired++
    const mark = n > 0 ? "EMITTED" : "SILENT "
    console.log(`${mark} ${t.padEnd(14)} ${String(n).padStart(7)} edges   ${files_ ? files_.size : 0} files`)
    if (n > 0) for (const ex of examples.get(t)!) console.log(`        e.g. ${ex}`)
  }
  // Anything outside the ten, so a new label cannot hide here.
  const extra = [...tally.keys()].filter((t) => !(ALL_TYPES as readonly string[]).includes(t))
  if (extra.length) console.log(`\nlabels outside the ontology's ten: ${extra.map((t) => `${t}:${tally.get(t)}`).join(" ")}`)
  console.log(`\nFIRED ${fired}/10 relationship types on ${parsed} real files.`)
  if (PER_FILE) for (const p of perFile) console.log(`  ${p.file}  syms=${p.syms} rels=${p.rels} ${JSON.stringify(p.types)}`)
}

main().catch((e) => { console.error(String(e)); process.exit(1) })