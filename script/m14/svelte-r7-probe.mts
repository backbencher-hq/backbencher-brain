// SVELTE R7 PROBE — every symbol name and edge endpoint that the standing rules forbid.
//
// WHY A SEPARATE PROBE. `script/m14/svelte-census.mts` counts these and reports non-zero.
// The FIRST version of this lane's census reported ZERO for all of them, and it was wrong:
// `noteEndpoint` wrote its tallies into the per-type record `E` while the report read the
// global `G`, so `G.placeholderTarget` was never incremented and printed `0` from an
// `undefined++` that evaluates to NaN and then to 0 on a fresh object. A count that is
// structurally incapable of moving reads exactly like a count of zero, which is the
// failure the honesty contract's "an instrument must declare the population it covered"
// rule is really about. So the offenders are listed here BY NAME, and a reviewer can check
// each one against its file rather than trusting an aggregate.
//
// THE RULES. `validation/m60/ledger.json` standing rule R7 and the workstream's Standing
// rules section: no edge endpoint equal to the placeholder literal `unknown`; no empty
// symbol names; `SymbolKind` never empty and never `unknown`.
//
// NO REGEX. `Set` membership and string equality only.
//
//   bun script/m14/svelte-r7-probe.mts
//   OUT=/tmp/r7.json bun script/m14/svelte-r7-probe.mts

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const REPO = process.env.BB_REPO || fileURLToPath(new URL("../..", import.meta.url))
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const MAXBYTES = 512 * 1024

/** The R7 placeholder classes. `unknown` is the one the rule names; the rest are the
 *  classes the ledger's ledger.json records as placeholder-name sites. */
const PLACEHOLDER = new Set([
  "unknown", "anonymous", "<anonymous>", "TODO", "FIXME", "n/a", "None", "null", "undefined", "?", "",
])

function svelteFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 20) return
  let ents: any[]
  try {
    ents = readdirSync(dir, { withFileTypes: true }) as any[]
  } catch {
    return
  }
  for (const e of ents) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".git") continue
      svelteFiles(p, out, depth + 1)
    } else if (e.name.endsWith(".svelte")) out.push(p)
  }
}

const files: string[] = []
for (const e of readdirSync(CORPUS).sort()) {
  const dir = join(CORPUS, e)
  try {
    if (statSync(dir).isDirectory()) svelteFiles(dir, files)
  } catch {
    continue
  }
}
files.sort()

const eng: any = await import(`${REPO}/src/ast/engine.ts`)

type Hit = { file: string; kind: string; name: string; type?: string; line?: number; detail?: string }
const hits: Hit[] = []
let filesRead = 0
let filesParsed = 0

for (const abs of files) {
  let content: string
  try {
    if (statSync(abs).size > MAXBYTES) continue
    content = readFileSync(abs, "utf8")
  } catch {
    continue
  }
  if (content.length === 0) continue
  filesRead++
  const rel = abs.slice(CORPUS.length + 1)

  let res: any
  try {
    res = await eng.parseFile(abs, content)
  } catch {
    continue
  }
  filesParsed++

  for (const s of res.symbols ?? []) {
    const name = String(s.name ?? "")
    const kind = String(s.kind ?? "")
    if (name.length === 0) {
      hits.push({ file: rel, kind: "SYMBOL-NAME-EMPTY", name: "", detail: `kind=${kind} range=${JSON.stringify(s.range)}` })
    } else if (PLACEHOLDER.has(name)) {
      hits.push({ file: rel, kind: "SYMBOL-NAME-PLACEHOLDER", name, detail: `kind=${kind} line=${s.range?.startLine} owner=${s.ownerName ?? ""} meta=${JSON.stringify(s.metadata ?? {})}` })
    }
    if (kind.length === 0 || kind.toLowerCase() === "unknown") {
      hits.push({ file: rel, kind: "SYMBOL-KIND-FORBIDDEN", name, detail: `kind=${JSON.stringify(kind)}` })
    }
  }

  for (const r of res.relationships ?? []) {
    const t = String(r.relationshipType ?? r.type ?? "")
    const src = String(r.source ?? "")
    const tgt = String(r.target ?? "")
    if (src.length === 0) hits.push({ file: rel, kind: "EDGE-SOURCE-EMPTY", name: "", type: t, line: r.line_number })
    if (tgt.length === 0) hits.push({ file: rel, kind: "EDGE-TARGET-EMPTY", name: "", type: t, line: r.line_number })
    if (PLACEHOLDER.has(src)) hits.push({ file: rel, kind: "EDGE-SOURCE-PLACEHOLDER", name: src, type: t, line: r.line_number })
    if (PLACEHOLDER.has(tgt)) hits.push({ file: rel, kind: "EDGE-TARGET-PLACEHOLDER", name: tgt, type: t, line: r.line_number })
  }
}

const byClass = new Map<string, number>()
for (const h of hits) byClass.set(h.kind, (byClass.get(h.kind) ?? 0) + 1)

console.log(`svelte-r7-probe  corpus=${CORPUS}`)
console.log(`POPULATION (derived by readdir): ${files.length} .svelte files  read ${filesRead}  parsed ${filesParsed}`)
console.log(`R7 VIOLATIONS: ${hits.length}`)
for (const [k, v] of [...byClass.entries()].sort()) console.log(`  ${k.padEnd(26)} ${v}`)
console.log("")
console.log("EVERY OFFENDER, by name — each row is checkable against its file:")
for (const h of hits) {
  console.log(`  [${h.kind}] ${h.file}${h.line !== undefined ? `:${h.line}` : ""}`)
  console.log(`      name=${JSON.stringify(h.name)}${h.type ? ` type=${h.type}` : ""}${h.detail ? `  ${h.detail}` : ""}`)
}

if (process.env.OUT) {
  writeFileSync(process.env.OUT, JSON.stringify({ files: files.length, filesRead, filesParsed, byClass: [...byClass], hits }, null, 1))
  console.log(`\nwrote ${process.env.OUT}`)
}
// A non-zero count is a FINDING, not a crash: the probe's job is to report it.
process.exit(0)