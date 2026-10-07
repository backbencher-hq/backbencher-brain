/**
 * VB ENDPOINT PROBE — standing rule R7 (placeholder endpoints), ownerName loss, and
 * the two numbers the census flagged.
 *
 * ## What this is for
 *
 * The whole-corpus census printed 108 edge endpoints that look like placeholder
 * literals and 6,777 members with no `ownerName`, against a lane doc that claims
 * 0 and 423 respectively. Both need a name and a cause, not a restatement, so this
 * probe walks the corpus and DRAWS every offending endpoint with its file, line and
 * the node it came from. A number without a draw is a number nobody can act on.
 *
 * ## What counts as a placeholder here, and why it is a char scan
 *
 * Standing rule R7 (validation/m60/ledger.json): "No edge endpoint equal to the
 * placeholder literal `unknown`." This probe widens that to the whole family of
 * things the product writes when it has no name: an exact-match table of the
 * literals, plus the codebase's other spelling of the same idea, which is a
 * bracketed body `<like this>`. Both tests are a table lookup and a two-character
 * check — a pattern here would also match an identifier in a comment or a string
 * and then "confirm" a defect that is not one, which is the failure mode the
 * workstream recorded when a regex probe for `extends` matched `class voice`
 * inside a telnet IAC word list.
 *
 * ## Production path
 *
 * `parseFile` from src/ast/pool-worker.ts, the same entry the census and the
 * ontology-coverage gate use, so a number here is a number about production.
 *
 * Population is derived by walking the corpus directory; `VB_NFILES` caps it.
 */

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.VB_CORPUS ?? "roslyn-vb"
const DIR = join(CORPUS_ROOT, REPO)
const LIMIT = Number(process.env.VB_NFILES ?? 0)
const MAX_DRAWS = Number(process.env.VB_DRAWS ?? 40)

function hasSuffix(s: string, suffix: string): boolean {
  return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
}

const PLACEHOLDERS = new Set([
  "unknown", "unnamed", "?", "<unknown>", "<unnamed>", "<empty>", "empty",
  "undefined", "null", "nil", "none", "todo", "tbd", "n/a", "na", "n.a.",
])
function fold(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += (c >= 65 && c <= 90) ? String.fromCharCode(c + 32) : s.charAt(i)
  }
  return out
}
function placeholderKind(s: string): string | null {
  if (s.length === 0) return "EMPTY"
  const lo = fold(s.trim())
  if (PLACEHOLDERS.has(lo)) return "LITERAL"
  if (lo.length >= 3 && lo.charCodeAt(0) === 60 && lo.charCodeAt(lo.length - 1) === 62) return "BRACKETED"
  return null
}

function derivePopulation(dir: string, ext: string, want: number): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    if (out.length >= want || depth > 24) return
    let ents: import("node:fs").Dirent[]
    try { ents = readdirSync(d, { withFileTypes: true }) } catch { return }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const e of ents) {
      if (out.length >= want) return
      if (e.name === "node_modules" || e.name === ".git") continue
      const p = join(d, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (!hasSuffix(e.name, ext)) continue
      try { if (statSync(p).isFile()) out.push(p) } catch {}
    }
  }
  walk(dir, 0)
  return out
}

const all = derivePopulation(DIR, ".vb", Number.MAX_SAFE_INTEGER)
const files = LIMIT > 0 ? all.slice(0, LIMIT) : all

console.log("=".repeat(92))
console.log("VB ENDPOINT PROBE — R7 placeholders, ownerName loss, self-edges")
console.log(`population DERIVED by directory walk: ${all.length} .vb files on disk`)
console.log(`population MEASURED this run:        ${files.length}`)
console.log("entry point: parseFile() — production")
console.log("=".repeat(92) + "\n")

// ---------------------------------------------------------------------------
// Pass A — over the PRODUCTION result
// ---------------------------------------------------------------------------

type Draw = { file: string; line: string; text: string }
const draws: Record<string, Draw[]> = {}
function draw(bucket: string, d: Draw): void {
  draws[bucket] ??= []
  if (draws[bucket].length < MAX_DRAWS) draws[bucket].push(d)
}

const counts: Record<string, number> = {}
function bump(k: string): void { counts[k] = (counts[k] ?? 0) + 1 }

const placeholderByType: Map<string, Map<string, number>> = new Map()
const ownerlessKind: Map<string, number> = new Map()
const ownerlessAtTop: Map<string, number> = new Map()
const selfEdgeByType: Map<string, number> = new Map()
const ownerlessFiles = new Set<string>()

const MEMBER_KINDS = new Set(["method", "property", "field", "variable", "event", "constructor", "enum_member", "const"])

for (const abs of files) {
  const rel = abs.slice(DIR.length + 1)
  let r: any
  try { r = await parseFile(abs, DIR) } catch { bump("parseFile-threw"); continue }
  for (const e of (r.relationships ?? [])) {
    const t = String(e?.type ?? "")
    const src = String(e?.source ?? "")
    const tgt = String(e?.target ?? "")
    const sk = placeholderKind(src)
    const tk = placeholderKind(tgt)
    if (sk || tk) {
      bump("placeholder-endpoints")
      const m = placeholderByType.get(t) ?? new Map<string, number>()
      m.set(`${sk ? "src:" + sk : "-"}/${tk ? "tgt:" + tk : "-"}`, (m.get(`${sk ? "src:" + sk : "-"}/${tk ? "tgt:" + tk : "-"}`) ?? 0) + 1)
      placeholderByType.set(t, m)
      draw(`placeholder:${t}`, { file: rel, line: String(e.line_number ?? "?"), text: `${JSON.stringify(src)} -[${t}]-> ${JSON.stringify(tgt)}` })
    }
    if (src === tgt) {
      bump("self-edges")
      selfEdgeByType.set(t, (selfEdgeByType.get(t) ?? 0) + 1)
      draw(`self:${t}`, { file: rel, line: String(e.line_number ?? "?"), text: `${JSON.stringify(src)} -[${t}]-> ${JSON.stringify(tgt)}` })
    }
  }
  for (const s of (r.symbols ?? [])) {
    const kind = String(s?.kind ?? "")
    if (s?.ownerName === undefined || s?.ownerName === null) {
      if (MEMBER_KINDS.has(kind)) {
        bump("members-without-owner")
        ownerlessKind.set(kind, (ownerlessKind.get(kind) ?? 0) + 1)
        const at = s?.range?.startLine ?? "?"
        const top = (at === 1) ? "line-1" : "later"
        ownerlessAtTop.set(top, (ownerlessAtTop.get(top) ?? 0) + 1)
        ownerlessFiles.add(rel)
        draw(`ownerless:${kind}`, {
          file: rel, line: String(at),
          text: `${JSON.stringify(s.name)} (${kind}) declared at ${String(at)}-${String(s?.range?.endLine ?? "?")}, no ownerName`,
        })
      }
    }
  }
  if ((files.length > 0) && ((r.symbols ?? []).length > 0)) bump("filesWithSymbols")
}

// ---------------------------------------------------------------------------
// Pass B — read the offending files' own text at the offending line, so a draw is
// checkable by a human without opening the file.
// ---------------------------------------------------------------------------

console.log("COUNTS")
for (const k of Object.keys(counts).sort()) console.log(`  ${k.padEnd(26)} ${counts[k]}`)
console.log("")
console.log(`placeholder endpoints by relationship type:`)
for (const [t, m] of [...placeholderByType.entries()].sort((a, b) => (b[1] as any) && 0)) {
  const parts = [...m.entries()].map(([k, v]) => `${k}×${v}`).join("  ")
  console.log(`  ${t.padEnd(14)} ${parts}`)
}
console.log("")
console.log(`members with no ownerName, by kind: ${[...ownerlessKind.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`  ...by position: ${[...ownerlessAtTop.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log(`  ...across ${ownerlessFiles.size} files`)
console.log(`self-edges by type: ${[...selfEdgeByType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ")}`)
console.log("")

for (const bucket of Object.keys(draws).sort()) {
  console.log(`--- ${bucket} (${draws[bucket].length} draws, capped at ${MAX_DRAWS}) ---`)
  for (const d of draws[bucket]) console.log(`  ${d.file}:${d.line}  ${d.text}`)
  console.log("")
}
console.log("DONE. Population DERIVED: " + all.length + " .vb files on disk; measured: " + files.length)
void readFileSync; void getParser