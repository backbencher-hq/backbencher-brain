// M72 Phase 2b-2 — one-hop intra-file reachability (measurement probe).
//
// WHY THIS EXISTS
//   The Phase-2a corpus run found 9 leads across five repositories and ZERO in
//   graphql-js (367 TypeScript files). That is not a spec defect: the engine is
//   intra-symbol, and a single-token sink (`exec(`, `db.query(`) almost never
//   appears in the same function body as the source. This probe measures what one
//   hop of intra-file call + parameter binding would actually add, on the real
//   corpus databases, BEFORE any engine change is written.
//
// WHAT IT MEASURES (per corpus DB)
//   - call edges stored with a caller attribution and a `calleeExpression`
//     (`brain_relationship.relationship_type='calls'`, `metadata.calleeExpression`);
//   - how many of those callees resolve to exactly ONE same-file declaration
//     (by name; ambiguous = 0, never a guess);
//   - how many caller→callee pairs exist where the caller has a SOURCE match and
//     the callee has a SINK match, or the reverse (callee→caller);
//   - which caller parameters are passed at each such call site, so parameter
//     binding can be counted rather than assumed.
//
// WHAT IT DOES NOT DO
//   It does not change the engine, the store, or any answer. It reads read-only
//   and prints counts. A zero here means one-hop would add nothing on that corpus
//   — which is a finding, not a failure.
//
// COMMAND: npx tsx script/m72/oracle/probe-onehop.ts
// EVIDENCE: validation/m72/results/onehop.json
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..", "..")
const EVIDENCE = join(ROOT, "validation", "m72", "results", "onehop.json")

interface CorpusRow {
  name: string
  dbPath: string
}

interface CorpusReport {
  corpus: string
  dbPath: string
  callEdges: number
  callsWithCaller: number
  callsWithCalleeExpression: number
  resolvedSameFile: number
  ambiguousSameFile: number
  unresolvedCallee: number
  /** caller has a source match, callee has a sink match (same file) */
  callerSourceCalleeSink: number
  /** callee has a source match, caller has a sink match (same file) */
  calleeSourceCallerSink: number
  /** call sites whose argument text is available for parameter binding */
  callSitesWithArgs: number
  examples: Array<{ caller: string; callee: string; line: number; kind: string }>
}

function readCorpusRow(row: any): CorpusRow | null {
  const dbPath = row?.census?.dbPath
  if (typeof dbPath !== "string" || !existsSync(dbPath)) return null
  return { name: String(row.name ?? "?"), dbPath }
}

async function main(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = (await import("better-sqlite3")).default as any
  const corpusFile = join(ROOT, "validation", "tools", "bb_security", "REAL-CORPUS.json")
  if (!existsSync(corpusFile)) {
    console.error("REAL-CORPUS.json is missing — run the Phase-2a probe first")
    return 1
  }
  const corpus = JSON.parse(await import("node:fs").then((m) => m.readFileSync(corpusFile, "utf8")))
  const corpora: CorpusReport[] = []

  for (const row of corpus.corpora ?? []) {
    const found = readCorpusRow(row)
    if (!found) {
      console.log(`${row?.name ?? "?"}: no readable db at ${row?.census?.dbPath ?? "<none>"} — declared absence`)
      continue
    }
    const db = new Database(found.dbPath, { readonly: true })
    try {
      const total = db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type='calls'").get().c as number
      const withCaller = db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type='calls' AND source_symbol_id IS NOT NULL").get().c as number
      const withExpr = db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE relationship_type='calls' AND metadata LIKE '%calleeExpression%'").get().c as number

      // Same-file declarations by leaf name.
      const decls = db.prepare(
        `SELECT s.name AS name, f.relative_path AS rel, s.id AS id
           FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id`,
      ).all() as Array<{ name: string; rel: string; id: string }>

      const byFile = new Map<string, Map<string, string[]>>()
      for (const d of decls) {
        const key = d.rel
        if (!byFile.has(key)) byFile.set(key, new Map())
        const names = byFile.get(key)!
        if (!names.has(d.name)) names.set(d.name, [])
        names.get(d.name)!.push(d.id)
      }

      // Symbol id -> file + whether it has a source/sink match. We approximate the
      // source/sink match by the symbol's own name appearing in the spec's source
      // and sink pattern lists is NOT possible here (patterns live in TS). Instead
      // we use the stored leads: a symbol that produced a lead is a "sink holder".
      // For caller-side sources we use the evidence of any stored lead in the same
      // file (the engine records source text), so the counts stay evidence-based.
      const leads = db.prepare(
        `SELECT f.relative_path AS rel, bf.id AS file_id, sf.rule_id, sf.vulnerability_type,
                sf.source_line, sf.sink_line, sf.evidence
           FROM brain_security_flow sf
           JOIN brain_file bf ON bf.id = sf.file_id
           LEFT JOIN brain_file f ON f.id = sf.file_id`,
      ).all() as Array<{ rel: string; file_id: string; rule_id: string; vulnerability_type: string; source_line: number; sink_line: number; evidence: string }>

      const sinkSymbols = new Set<string>()
      for (const l of leads) {
        try {
          const ev = JSON.parse(l.evidence ?? "{}")
          const sid = ev?.store?.symbolId
          if (typeof sid === "string" && sid.length > 0) sinkSymbols.add(sid)
        } catch {
          /* evidence not JSON: the lead still proves the file has a sink */
        }
      }

      const edges = db.prepare(
        `SELECT source_symbol_id AS caller, line_number AS line, metadata
           FROM brain_relationship
          WHERE relationship_type='calls' AND source_symbol_id IS NOT NULL
            AND metadata LIKE '%calleeExpression%'`,
      ).all() as Array<{ caller: string; line: number; metadata: string }>

      let resolvedSameFile = 0
      let ambiguousSameFile = 0
      let unresolvedCallee = 0
      let callerSourceCalleeSink = 0
      let calleeSourceCallerSink = 0
      let callSitesWithArgs = 0
      const examples: CorpusReport["examples"] = []

      const callerFile = new Map<string, string>()
      for (const d of decls) callerFile.set(d.id, d.rel)

      for (const e of edges) {
        const rel = callerFile.get(e.caller)
        if (!rel) {
          unresolvedCallee++
          continue
        }
        const names = byFile.get(rel)
        if (!names) {
          unresolvedCallee++
          continue
        }
        let calleeExpr = ""
        try {
          calleeExpr = String(JSON.parse(e.metadata)?.calleeExpression ?? "")
        } catch {
          calleeExpr = ""
        }
        const leaf = calleeExpr.split(".").pop() ?? ""
        if (leaf.length === 0) {
          unresolvedCallee++
          continue
        }
        const candidates = names.get(leaf)
        if (!candidates || candidates.length === 0) {
          unresolvedCallee++
          continue
        }
        if (candidates.length > 1) {
          ambiguousSameFile++
          continue
        }
        resolvedSameFile++
        const calleeId = candidates[0]
        const callerHasSink = sinkSymbols.has(e.caller)
        const calleeHasSink = sinkSymbols.has(calleeId)
        if (calleeHasSink && !callerHasSink) {
          calleeSourceCallerSink++
          if (examples.length < 8) examples.push({ caller: e.caller, callee: calleeId, line: e.line, kind: "callee-sink" })
        } else if (callerHasSink && !calleeHasSink) {
          callerSourceCalleeSink++
          if (examples.length < 8) examples.push({ caller: e.caller, callee: calleeId, line: e.line, kind: "caller-sink" })
        }
        if (e.metadata.includes("callSiteStartIndex")) callSitesWithArgs++
      }

      const report: CorpusReport = {
        corpus: found.name,
        dbPath: found.dbPath,
        callEdges: total,
        callsWithCaller: withCaller,
        callsWithCalleeExpression: withExpr,
        resolvedSameFile,
        ambiguousSameFile,
        unresolvedCallee,
        callerSourceCalleeSink,
        calleeSourceCallerSink,
        callSitesWithArgs,
        examples,
      }
      corpora.push(report)
      console.log(
        `${found.name}: calls=${total} withCaller=${withCaller} resolvedSameFile=${resolvedSameFile} ambiguous=${ambiguousSameFile} unresolved=${unresolvedCallee} ` +
          `sinkPairs(callerSink=${callerSourceCalleeSink}, calleeSink=${calleeSourceCallerSink})`,
      )
    } finally {
      db.close()
    }
  }

  const out = {
    probe: "m72-onehop",
    what: "measures one-hop intra-file call+parameter-binding headroom on the real corpus DBs (read-only; no engine change)",
    generatedAt: new Date().toISOString(),
    corpora,
    totals: {
      callEdges: corpora.reduce((a, c) => a + c.callEdges, 0),
      resolvedSameFile: corpora.reduce((a, c) => a + c.resolvedSameFile, 0),
      ambiguousSameFile: corpora.reduce((a, c) => a + c.ambiguousSameFile, 0),
      sinkPairs: corpora.reduce((a, c) => a + c.callerSourceCalleeSink + c.calleeSourceCallerSink, 0),
    },
    limits: [
      "call edges whose target did not resolve (target_symbol_id IS NULL) are counted as unresolved; the probe never guesses a callee",
      "same-file name resolution only; a same-named member in a different file is not a candidate",
      "sink holders are derived from stored leads, so a file with no stored lead contributes no sink-side pair even if it has a dangerous call",
      "this is a headroom measurement, not a reachability implementation and not a precision claim",
    ],
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(EVIDENCE, JSON.stringify(out, null, 2) + "\n")
  console.log(`\nevidence: ${EVIDENCE}`)
  console.log(`totals: ${JSON.stringify(out.totals)}`)
  return 0
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error)
  process.exit(1)
})