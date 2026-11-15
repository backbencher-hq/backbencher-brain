// CLJ-DEEP · INSTRUMENT 7 — the RELATIONSHIP CENSUS.
//
// THE QUESTION. Two F5 labels are NOT compared for the clojure lane: `uses` and
// `contains`. The allowlist says so in the harness's own words — a label the
// truth side does not derive cannot be compared, because every analyzer edge of
// that label would be counted as fabrication (the #910 lesson). That is correct
// as far as it goes, and it leaves the lane with two relationship classes that
// NO gate has ever looked at. "No relationship missed" is not a claim anyone can
// make while two of the seven classes are unexamined.
//
// This instrument is the first half of the answer: it measures, per label, over
// the whole corpus —
//   · how many edges are emitted,
//   · how many carry a LINE (the store contract's `line_number`),
//   · how many carry an EXPLANATION (a metadata key that says WHY the edge
//     exists, so a reader is not left with a bare edge),
//   · and, for the tree, how many CANDIDATE sites exist for a class the analyzer
//     does not emit at all — which is how a MISSED class becomes visible rather
//     than merely absent.
//
// AST only. No regex. Read-only: it writes one JSON file and never edits code.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const argOf = (f: string): string | undefined => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : undefined }

// The metadata keys that count as an EXPLANATION — "why does this edge exist?".
// A `calls` edge with `isGeneralCall` says "a bare head under a function"; an
// `implements` with `isExtendType` says which form produced it. An edge with
// none of them is a bare edge, and a bare edge is one a reader cannot check.
const EXPLANATION_KEYS = [
  "isGeneralCall", "isThreadedStep", "isBareStep", "isAnonShorthand", "isRecursion",
  "isConstructor", "isJavaInterop", "isFieldAccess", "isCtorLiteral", "isRecord",
  "isReify", "isExtendType", "isExtendProtocol", "isProxy", "isTopLevel", "isProtocol",
  "isLibraryDep", "isImport", "isMethodImpl", "isProtocolMethod", "isInterfaceMethod",
  "isProtocolMethodImpl", "isRecordMethod", "isLocalFn", "isSpec", "isMultimethod",
  "isInterface", "callArity",
]

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try { tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean) } catch { tracked = [] }
  if (tracked.length === 0) {
    const walk = (d: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(d)) {
        if (e === ".git" || e === "target" || e === "node_modules") continue
        const p = path.join(d, e); const st = statSync(p)
        if (st.isDirectory()) walk(p, acc); else if (/\.(clj|cljc|cljs)$/i.test(e)) acc.push(p)
      }
      return acc
    }
    return walk(dir).sort()
  }
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

type Row = { count: number; lined: number; explained: number; unlinedSamples: string[]; unexplainedSamples: string[]; topMeta: Record<string, number> }

async function main() {
  const repos = (argOf("--repos") ?? "clojure,clj-kondo,core.async").split(",")
  const outPath = argOf("--out") ?? "/tmp/opencode/clj-rel-census.json"
  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()

  const labels: Record<string, Row> = {}
  const row = (l: string): Row => (labels[l] ??= { count: 0, lined: 0, explained: 0, unlinedSamples: [], unexplainedSamples: [], topMeta: {} })

  // The CANDIDATE census: tree shapes for classes the analyzer does not emit.
  // Each counter answers "how many of these exist in the corpus?", which is the
  // only way to tell an absent class from an absent MEASUREMENT.
  const candidates: Record<string, number> = {
    // A keyword-headed form `(:key target)` — in Clojure this is a FIELD READ on
    // a record/map, i.e. a `uses` edge onto a declared field. The analyzer
    // emits nothing for it: the head is a kwd_lit, so formNameOf returns "" and
    // the generic-call branch cannot fire. Counted here so the decision to emit
    // or to declare is made against a number.
    keywordFieldRead: 0,
    // `(:key target)` where `key` IS a declared record/type field in the same
    // file — the subset with a resolvable target.
    keywordFieldReadResolvable: 0,
    // `@x` — a deref of a var/atom/agent/ref: a read, not a call.
    derefRead: 0,
    // A bare symbol in call position that is a LOCAL binding (param or let): a
    // call to something this file binds. The analyzer emits a bare edge for
    // these; counted so the class has a size.
    localCallSite: 0,
  }
  const candidateSamples: Record<string, string[]> = {
    keywordFieldRead: [], keywordFieldReadResolvable: [], derefRead: [], localCallSite: [],
  }
  const bump = (k: string, at: string) => {
    candidates[k] = (candidates[k] ?? 0) + 1
    if (candidateSamples[k]!.length < 8) candidateSamples[k]!.push(at)
  }

  let filesRead = 0, symbols = 0, throws = 0
  const perRepo: Record<string, any> = {}

  for (const repo of repos) {
    const files = listFiles(repo)
    let f0 = 0, s0 = 0, r0 = 0
    for (const file of files) {
      let content: string
      try { content = readFileSync(file, "utf8") } catch { continue }
      if (content.length > 1_500_000) continue
      let root: any
      try { root = parser.parse(content).rootNode } catch { continue }
      filesRead++; f0++
      let res: any
      try { res = analyzer.analyze(root, content, file) } catch { throws++; continue }
      symbols += (res.symbols ?? []).length; s0 += (res.symbols ?? []).length
      const rels = (res.relationships ?? []) as any[]
      r0 += rels.length
      const rel = path.relative(CORPUS_ROOT, file)
      for (const r of rels) {
        const rr = row(String(r.type))
        rr.count++
        const lined = typeof r.line_number === "number" && r.line_number > 0
        if (lined) rr.lined++
        else if (rr.unlinedSamples.length < 8) rr.unlinedSamples.push(`${rel} ${r.type} ${r.source} -> ${r.target}`)
        const meta = (r.metadata ?? {}) as Record<string, any>
        const why = EXPLANATION_KEYS.find(k => meta[k] !== undefined && meta[k] !== null)
        if (why) { rr.explained++; rr.topMeta[why] = (rr.topMeta[why] ?? 0) + 1 }
        else if (rr.unexplainedSamples.length < 8) rr.unexplainedSamples.push(`${rel} ${r.type} ${r.source} -> ${r.target} meta=${JSON.stringify(Object.keys(meta))}`)
      }

      // The candidate census, over the RAW tree.
      const declared = new Set<string>((res.symbols ?? []).map((s: any) => s.name))
      const fieldNames = new Set<string>((res.symbols ?? []).filter((s: any) => s.kind === "property").map((s: any) => s.name))
      const st: any[] = [root]
      while (st.length > 0) {
        const n = st.pop()!
        if (n.type === "derefing_lit") bump("derefRead", `${rel}:${n.startPosition.row + 1}`)
        if (n.type === "list_lit") {
          let head: any = null
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c && c.type !== "comment" && c.type !== "dis_expr" && c.type !== "meta_lit") { head = c; break }
          }
          const at = `${rel}:${head?.startPosition ? head.startPosition.row + 1 : n.startPosition.row + 1}`
          if (head && head.type === "kwd_lit") {
            const kwd = head.childForFieldName("name")?.text ?? ""
            if (kwd && n.namedChildCount > 1) {
              bump("keywordFieldRead", at)
              if (fieldNames.has(kwd)) bump("keywordFieldReadResolvable", at)
            }
          } else if (head && head.type === "sym_lit") {
            const nm = head.childForFieldName("name")?.text ?? head.text
            if (nm && !nm.includes("/") && declared.has(nm)) bump("localCallSite", at)
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) st.push(c) }
      }
    }
    perRepo[repo] = { files: f0, symbols: s0, relationships: r0 }
  }

  const summary: Record<string, any> = {}
  for (const [l, rr] of Object.entries(labels)) {
    summary[l] = {
      count: rr.count,
      linedPct: rr.count ? +(100 * rr.lined / rr.count).toFixed(2) : 100,
      explainedPct: rr.count ? +(100 * rr.explained / rr.count).toFixed(2) : 100,
      topExplanations: Object.fromEntries(Object.entries(rr.topMeta).sort((a, b) => b[1] - a[1]).slice(0, 5)),
      unlinedSamples: rr.unlinedSamples,
      unexplainedSamples: rr.unexplainedSamples,
    }
  }
  writeFileSync(outPath, JSON.stringify({ repos, filesRead, symbols, throws, perRepo, labels: summary, candidates, candidateSamples }, null, 1))

  console.log(`files=${filesRead} symbols=${symbols} threw=${throws}`)
  console.log("")
  console.log("label".padEnd(14) + "count".padStart(9) + "lined%".padStart(8) + "explained%".padStart(11) + "  top explanation")
  for (const [l, s] of Object.entries(summary).sort((a, b) => b[1].count - a[1].count)) {
    console.log(l.padEnd(14) + String(s.count).padStart(9) + String(s.linedPct).padStart(7) + "%" + String(s.explainedPct).padStart(10) + "%  " + (Object.entries(s.topExplanations)[0]?.[0] ?? "—"))
  }
  console.log("")
  console.log("CANDIDATE SITES — classes the tree has and the analyzer does not emit")
  for (const [k, v] of Object.entries(candidates)) console.log(`  ${String(v).padStart(7)}  ${k}   e.g. ${candidateSamples[k]![0] ?? ""}`)
  console.log(`\nwritten ${outPath}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
