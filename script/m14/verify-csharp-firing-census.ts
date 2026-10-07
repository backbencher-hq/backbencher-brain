/**
 * CSHARP_GAP firing census — DOES THE TYPE ACTUALLY FIRE?
 *
 * Source derivation answers only "is this type CONSTRUCTIBLE". This answers
 * question 2 of the six, "does it FIRE", by running the analyzer through the
 * PRODUCTION path (getParser -> parser.parse -> analyze) over a real corpus and
 * tallying the relationship types that actually come out of the result.
 *
 * That is deliberately the production path and not a direct `new
 * RealCSharpAnalyzer().analyze(tree, ...)` call: the engine wires context
 * companions (typeKinds, override context) that a bare call does not, and an
 * edge that only exists when the engine is present is a different edge.
 *
 * NO REGEX. File selection is by `endsWith(".cs")` on a directory walk and node
 * inspection is by `node.type` on the tree-sitter AST. The one `new RegExp` in
 * this file's neighbourhood would be a defect: a pattern over source text
 * matches comments and string literals, and the whole point of the census is to
 * measure the PARSE, not the text.
 *
 * Corpus note: the handover named
 * $HOME/fixtures/repositories/csharp-sample, which does not exist on
 * either laptop. The only real C# corpus on disk is `powershell` (1278 .cs
 * files, a first-class C# differential corpus for this lane since 2026-09-29)
 * plus incidental .cs files elsewhere. `--root` overrides.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { ASTEngine } from "../../src/ast/engine"
import { RealCSharpAnalyzer } from "../../src/ast/real-csharp-analyzer"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const DEFAULT_ROOT = "powershell"

/**
 * The enum is read from `engine.ts`, NOT `types.ts`, and the choice is not
 * cosmetic. The two enums disagree on one member:
 *
 *   engine.ts   Imports = "imports"
 *   types.ts    Imports = "brain_import"
 *
 * Every analyzer emits through `ASTEngine.RelationshipType`, so the string a
 * relationship actually carries at runtime is engine.ts's. `rel-type-coverage-gate.ts`
 * reads engine.ts and `firing-check.mjs` reads types.ts, which is how the two
 * instruments can disagree about the same lane. Both spellings are reported below
 * so a verdict cannot hide behind the choice.
 */
const ALL: string[] = [...new Set(Object.values(ASTEngine.RelationshipType))].sort()
const TYPES_TS_ONLY = "brain_import"

function walkCs(dir: string, out: string[], cap: number, depth = 0): string[] {
  if (out.length >= cap || depth > 12) return out
  let ents: ReturnType<typeof readdirSync>
  try {
    ents = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  // Sorted so a run is reproducible from the directory listing alone.
  const sorted = [...ents].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  for (const e of sorted) {
    if (out.length >= cap) return out
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      // No regex: exact name comparison against a deny list.
      if (e.name === ".git" || e.name === "node_modules" || e.name === "bin" || e.name === "obj") continue
      walkCs(p, out, cap, depth + 1)
    } else if (e.name.endsWith(".cs")) {
      try {
        if (statSync(p).size < 600_000) out.push(p)
      } catch {
        /* unreadable */
      }
    }
  }
  return out
}

type Row = { type: string; count: number; files: number; examples: string[] }

async function main() {
  const argRoot = process.argv[2] ?? DEFAULT_ROOT
  const want = Number(process.argv[3] ?? 200)
  const root = join(CR, argRoot)
  const files = walkCs(root, [], want)
  console.log(`corpus ${root}`)
  console.log(`files  ${files.length}`)

  const tally = new Map<string, { n: number; files: Set<string>; ex: string[] }>()
  const conf = new Map<string, Map<string, number>>()
  let parsed = 0
  let failed = 0
  const errors: string[] = []
  const parseErrNodes = new Map<string, number>()

  const parser = await ASTEngine.getParser("csharp")
  for (const f of files) {
    let content: string
    try {
      content = readFileSync(f, "utf8")
    } catch {
      failed++
      continue
    }
    try {
      const pr = await parser.parse(content, f)
      const res = new RealCSharpAnalyzer().analyze(pr.rootNode as any, content, f)
      parsed++
      // Count the parse tree's own error nodes directly. The analyzer's warning
      // list is its interpretation; this is the grammar's.
      const stack = [pr.rootNode]
      while (stack.length) {
        const n = stack.pop()
        if (!n) continue
        if (n.type === "ERROR" || n.isMissing) parseErrNodes.set(n.type, (parseErrNodes.get(n.type) ?? 0) + 1)
        for (let i = 0; i < n.childCount; i++) stack.push(n.child(i))
      }
      for (const r of res.relationships ?? []) {
        const t = String((r as any).relationshipType ?? (r as any).type)
        let e = tally.get(t)
        if (!e) {
          e = { n: 0, files: new Set(), ex: [] }
          tally.set(t, e)
        }
        e.n++
        e.files.add(f)
        if (e.ex.length < 3) {
          e.ex.push(`${(r as any).source} -[${t}]-> ${(r as any).target}  (${(r as any).line ?? "null"})`)
        }
        const c = (r as any).confidence
        const k = typeof c === "number" ? c.toFixed(2) : String(c)
        let cm = conf.get(t)
        if (!cm) {
          cm = new Map()
          conf.set(t, cm)
        }
        cm.set(k, (cm.get(k) ?? 0) + 1)
        // evidenceClass tally
        let ec = conf.get(`${t}::evidenceClass`)
        if (!ec) {
          ec = new Map()
          conf.set(`${t}::evidenceClass`, ec)
        }
        const ev = String((r as any).evidenceClass ?? "(none)")
        ec.set(ev, (ec.get(ev) ?? 0) + 1)
      }
    } catch (e) {
      failed++
      if (errors.length < 3) errors.push(String(e).slice(0, 160))
    }
  }

  console.log(`parsed ${parsed}  failed ${failed}`)
  if (errors.length) console.log(`errors: ${errors.join(" | ")}`)
  if (parseErrNodes.size) console.log(`parse-tree error nodes: ${[...parseErrNodes].map(([k, v]) => `${k}=${v}`).join(" ")}`)

  const rows: Row[] = []
  for (const t of ALL) {
    const e = tally.get(t)
    rows.push({ type: t, count: e?.n ?? 0, files: e?.files.size ?? 0, examples: e?.ex ?? [] })
  }
  // Anything the analyzer produced that is NOT an enum value at all.
  for (const [t, e] of tally) {
    if (ALL.includes(t)) continue
    rows.push({ type: `${t}  <-- NOT AN ENUM VALUE`, count: e.n, files: e.files.size, examples: e.ex })
  }

  console.log(`\n${"type".padEnd(34)}${"count".padStart(9)}${"files".padStart(8)}   confidence / evidenceClass`)
  console.log("-".repeat(120))
  for (const r of rows) {
    const cf = conf.get(r.type)
    const detail = cf
      ? [...cf.entries()]
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")
      : ""
    console.log(
      `${r.type.padEnd(34)}${String(r.count).padStart(9)}${String(r.files).padStart(8)}   ${detail}`,
    )
  }

  const fired = rows.filter((r) => r.count > 0).map((r) => r.type)
  const silent = ALL.filter((t) => !tally.has(t) || (tally.get(t)?.n ?? 0) === 0)
  console.log(`\nFIRED ${fired.length}/${ALL.length}: ${fired.join(" ")}`)
  console.log(`SILENT (constructible, produced nothing over ${parsed} files): ${silent.join(" ")}`)
  if (!fired.includes(TYPES_TS_ONLY) && !silent.includes(TYPES_TS_ONLY)) {
    console.log(`note: neither spelling of the import type fired — see the enum divergence in the header`)
  }

  if (process.env.CS_GAP_VERBOSE) {
    console.log("\n--- examples per type ---")
    for (const r of rows) {
      if (!r.count) continue
      console.log(`\n${r.type} (${r.count} over ${r.files} files)`)
      for (const e of r.examples) console.log(`   ${e}`)
    }
  }
}

await main()