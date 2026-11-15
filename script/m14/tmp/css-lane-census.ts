// Review instrument (NOT a gate): census the CSS analyzer's live output over the
// real corpora so the review's claims are measurements, not readings.
//
//   bun script/m14/tmp/css-lane-census.ts [--sample N] [--root <dir>]
//
// Reports, per lane: files, symbols, relationships, the relationship-type
// histogram, how many carry a line, how many resolve to a symbol emitted in the
// same file (self-resolution), how many name a synthesized/unknown source, and
// the unknown-kind census (dimension 5 of reviews/LANE-AUDIT-FORMULA.md).

import { ASTEngine } from "../../../src/ast/engine"
import { readdirSync, statSync, readFileSync } from "fs"
import { join, resolve } from "path"

const ROOT_CORPUS = "/home/ishaq2321/bb_tests/repositories"

const argv = process.argv.slice(2)
function flag(name: string, def?: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? def : argv[i + 1]
}
const SAMPLE = Number(flag("sample", "60"))
const ROOT = flag("root", ROOT_CORPUS)!

const LANES: { name: string; dir: string; ext: string }[] = [
  { name: "svelte", dir: "svelte", ext: ".css" },
  { name: "element-plus", dir: "element-plus", ext: ".css" },
  { name: "vue-core", dir: "vue-core", ext: ".css" },
  { name: "grails-core", dir: "grails-core", ext: ".css" },
  { name: "go-tools", dir: "go-tools", ext: ".css" },
  { name: "graphql-js", dir: "graphql-js", ext: ".css" },
  { name: "mojo", dir: "mojo", ext: ".css" },
  { name: "cargo", dir: "cargo", ext: ".css" },
  { name: "cython", dir: "cython", ext: ".css" },
  { name: "fsharp", dir: "fsharp", ext: ".css" },
  { name: "scala3", dir: "scala3", ext: ".css" },
  { name: "zig", dir: "zig", ext: ".css" },
  { name: "cloogle.org", dir: "cloogle.org", ext: ".css" },
]

function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function seededPick<T>(items: T[], seed: string): T[] {
  const out = items.slice()
  let s = fnv1a(seed) || 1
  const rand = () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 0x100000000
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = out[i]; out[i] = out[j]; out[j] = t
  }
  return out
}

function walk(dir: string, ext: string, out: string[], depth = 0): void {
  if (depth > 8) return
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const e of entries) {
    if (e === "node_modules" || e === ".git" || e === "target" || e === "dist") continue
    const p = join(dir, e)
    let st: import("fs").Stats
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, ext, out, depth + 1)
    else if (e.endsWith(ext) && st.size > 0) out.push(p)
  }
}

const KNOWN_KINDS = new Set([
  "function", "class", "interface", "type", "variable", "module", "property",
  "method", "struct", "enum", "constant", "field", "component", "namespace",
  "file", "concept", "parameter", "table", "macro", "trait", "protocol",
  "record", "union", "object", "primitive", "event", "hook", "template",
])

async function main() {
  await ASTEngine.init?.()
  const all: Record<string, any> = {}

  for (const lane of LANES) {
    const dir = join(ROOT, lane.dir)
    const files: string[] = []
    walk(dir, lane.ext, files)
    files.sort()
    if (files.length === 0) { all[lane.name] = { files: 0, note: "no files" }; continue }
    const sample = seededPick(files, `css-review:${lane.name}`).slice(0, SAMPLE).sort()

    const relTypes: Record<string, number> = {}
    const symKinds: Record<string, number> = {}
    let symbols = 0, relationships = 0, withLine = 0
    let selfEdges = 0, danglingTargets = 0, danglingSources = 0
    let unknownKind = 0, emptyName = 0, noOwner = 0
    const danglingExamples: string[] = []
    const unknownExamples: string[] = []
    let errorFiles = 0, crashFiles = 0

    for (const f of sample) {
      let res: any
      try {
        res = await ASTEngine.parseFile(f, readFileSync(f, "utf8"))
      } catch (e) {
        crashFiles++
        if (crashFiles === 1) process.stderr.write(`  crash shape: ${String(e).slice(0, 200)}\n`)
        continue
      }
      if (!res) { crashFiles++; continue }
      if ((res.errors?.length ?? 0) > 0) errorFiles++
      const names = new Set<string>()
      const allNames = new Set<string>()
      for (const s of res.symbols ?? []) {
        symbols++
        allNames.add(s.name)
        symKinds[String(s.kind)] = (symKinds[String(s.kind)] ?? 0) + 1
        if (!s.name || String(s.name).trim() === "") emptyName++
        if (s.kind === undefined || s.kind === null) unknownKind++
        if (s.metadata?.isSelector || s.metadata?.isAtRule || s.metadata?.isKeyframes || s.metadata?.isSupports || s.metadata?.isCustomProperty) names.add(s.name)
      }
      for (const r of res.relationships ?? []) {
        relationships++
        relTypes[String(r.type)] = (relTypes[String(r.type)] ?? 0) + 1
        if ((r.line_number ?? r.line) !== undefined && (r.line_number ?? r.line) !== null) withLine++
        const src = String(r.source ?? "")
        const tgt = String(r.target ?? "")
        if (src === tgt) selfEdges++
        if (tgt && !names.has(tgt)) {
          danglingTargets++
          if (danglingExamples.length < 8) danglingExamples.push(`${r.type}  ${JSON.stringify(src)} -> ${JSON.stringify(tgt)}`)
        }
        if (src && !allNames.has(src) && !names.has(src)) {
          danglingSources++
        }
        // symbols with a scope but no ownerName
      }
      for (const s of res.symbols ?? []) {
        if (s.scope !== undefined && s.ownerName === undefined) noOwner++
      }
      for (const k of Object.keys(symKinds)) {
        if (!KNOWN_KINDS.has(k) && unknownExamples.length < 8) unknownExamples.push(k)
      }
    }

    all[lane.name] = {
      corpusFiles: files.length,
      filesMeasured: sample.length,
      errorFiles,
      crashFiles,
      symbols,
      relationships,
      relationshipsWithLine: withLine,
      selfEdges,
      danglingTargets,
      danglingSources,
      emptyName,
      unknownKind,
      symbolsWithoutOwnerName: noOwner,
      relTypes,
      symKinds,
      danglingExamples,
      unknownKindExamples: unknownExamples,
    }
    process.stderr.write(`lane ${lane.name}: ${sample.length}/${files.length} files, ${symbols} sym, ${relationships} rel\n`)
  }

  console.log(JSON.stringify(all, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
