// script/m60/yaml-bucket-audit.ts — attack the lane's largest bucket.
//
// WHY THIS FILE EXISTS
// --------------------
// `yaml-f5-differential.ts` reports `unexplained: 0` over 1,004 files and 357,304
// oracle paths. That is the lane's headline number, and it is only as good as the
// buckets the disagreements were sorted into: 161,212 paths did not match, and every
// one of them was excused. The two largest excuses are the grammar's:
//
//     grammarLossProvenByOracle      121,796  (34.1% of all truth)
//     grammarContainmentLoss          38,240  (10.7%)
//
// Together that is 44.8% of the evidence, attributed to a defect in
// tree-sitter-yaml: it cannot lex a multi-line double-quoted scalar, and the file
// loses its containment. (The description of that defect at the time said "a 58-byte
// ERROR at the document ROOT" — WRONG, and this instrument is what proved it. The
// 58-byte node is NESTED; the ROOT node is itself the ERROR and the parse covers only
// 27.6-31.1% of the file, so 69-72% is never parsed at all.)
// The attribution was established on SAMPLES. This instrument is the adversarial
// question the attribution invites and the samples cannot answer:
//
//     Is every lost path explained by damage the GRAMMAR reported — its own span, an
//     ancestor's span, or the fact that the parse never reached those bytes at all?
//
// The three-clause form is the answer, not the first form. "Is the lost path's own span
// inside an ERROR?" is not sufficient, and reading the tree is what showed why: in v1.28
// the root node IS the ERROR, the tree's last child ends at byte 79,276 of 278,336, and
// the `paths:` section from line 2695 on — 199,090 bytes, 71% of the file — was never
// parsed. Those paths have clean bytes and no damaged ancestor, because they were never
// parsed. Scoring them "unexplained" convicts the analyzer of a defect it cannot have.
//
// If yes, the grammar explains the loss and the bucket is honest. If any lost path
// lies OUTSIDE every ERROR and every MISSING node, then the grammar cannot explain
// it, the bucket is absorbing an ANALYZER defect, and "0 unexplained" is softer
// than it reads. This is M60.SHARP's question — is the rule hiding a disagreement? —
// asked of this lane's own oracle, which is possible here precisely because the
// oracle is an independent implementation and its per-path byte offsets are
// available (script/m14/tmp/yaml-f5-ranges.py).
//
// WHAT IT DOES NOT DO
// -------------------
// It does not re-litigate the grammar defect or propose a workaround. The defect is
// filed; the fork policy governs what happens next. This asks one question about
// attribution only: is the loss co-extensive with the damage?
//
// USAGE: bun run script/m60/yaml-bucket-audit.ts [--per-repo=200]
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS_ROOT = "$HOME/fixtures/repositories"
const REPOS = ["grails-core", "docker", "ansible", "kubernetes", "terraform", "openapi-spec", "helm", "gh-cli"]
const RANGES = path.join(ROOT, "script/m14/tmp/yaml-f5-ranges.py")

const arg = (n: string, d: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? Number(hit.slice(n.length + 3)) : d
}
const PER_REPO = arg("per-repo", 100000)

function walk(dir: string, out: string[], depth = 0): void {
  if (depth > 14) return
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    else if (/\.(ya?ml)$/i.test(e.name)) out.push(p)
  }
}

/** The analyzer's key-tree paths, as the F5 harness computes them: the document root dropped. */
function analyzerPathsFor(sym: any): string[] {
  return sym.symbols
    .filter((s: any) => s.kind !== "module" && !s.metadata?.isAnchor)
    .map((s: any) => String(s.qualifiedName))
}

async function main() {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const grammar = await L.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-yaml.wasm")))
  const parser = new P()
  parser.setLanguage(grammar)

  // 1. The population the bucket was computed over.
  //
  // The selection is the whole point, and the first version got it backwards. It took
  // "files with a grammar ERROR node", which in these corpora is overwhelmingly Helm
  // Go templates (`{{- if .Values.ingress.enabled -}}`) — and PyYAML rejects those too,
  // so every one of them came back with no oracle truth and the audit reported a
  // confident `0 lost paths` over ZERO audited files. A verdict computed over an empty
  // population is the failure mode this file exists to catch, caught by it instead.
  //
  // The population that matters is the INVERSE: files the oracle parses cleanly and the
  // grammar still damages. Those are the only files where "the loss is the grammar's"
  // is a claim rather than a tautology — if both sides reject the file there is nothing
  // to attribute. That is exactly the `grammarLossProvenByOracle` bucket's population,
  // and it is where the 121,796 paths live.
  const damaged: string[] = []
  let scanned = 0
  for (const repo of REPOS) {
    const dir = path.join(CORPUS_ROOT, repo)
    if (!fs.existsSync(dir)) continue
    const all: string[] = []
    walk(dir, all)
    all.sort()
    // The oracle is asked only about grammar-damaged files, so the full walk is
    // affordable; the stride exists to bound the F5-style draw, not this audit.
    const stride = all.length > PER_REPO ? all.length / PER_REPO : 1
    const chosen = stride === 1 ? all : Array.from({ length: PER_REPO }, (_, i) => all[Math.floor(i * stride)]!)
    for (const f of chosen) {
      scanned++
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      const tree = parser.parse(content)
      let errs = 0
      const scan = (n: any): void => {
        if (n.type === "ERROR" || n.isMissing) errs++
        for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) scan(c) }
      }
      scan(tree.rootNode)
      if (errs > 0) damaged.push(f)
    }
  }
  console.log(`scanned ${scanned} file(s); grammar-damaged: ${damaged.length}`)

  // 2. the oracle's paths WITH byte ranges
  const oracle = JSON.parse(
    execFileSync("python3", [RANGES, JSON.stringify(damaged)], { encoding: "utf8", maxBuffer: 1 << 28 }),
  )

  // Both sides must ACCEPT the file for the attribution to be a claim; a file PyYAML
  // also rejects has no truth to compare and is reported, never counted.
  const bothAccept: string[] = damaged.filter((f) => oracle.results?.[f] && !oracle.results[f].error)
  console.log(`  of those, oracle ALSO parses cleanly: ${bothAccept.length} — the population the bucket is about`)
  console.log(`oracle rows returned: ${Object.keys(oracle.results ?? {}).length} / ${damaged.length} requested`)
  const missingRow = damaged.filter((f) => !(oracle.results ?? {})[f])
  if (missingRow.length) console.log(`  no row for: ${missingRow.slice(0, 3).map((f) => path.relative(CORPUS_ROOT, f)).join(", ")}`)
  const errored = damaged.filter((f) => oracle.results?.[f]?.error)
  if (errored.length) console.log(`  errored: ${errored.slice(0, 3).map((f) => `${path.relative(CORPUS_ROOT, f)}: ${oracle.results[f].error}`).join(" | ")}`)

  const perFile: any[] = []
  let totalLost = 0, lostInsideError = 0, lostOutsideError = 0

  for (const file of bothAccept) {
    const row = oracle.results[file]
    if (!row || row.error) continue
    const content = fs.readFileSync(file, "utf8")
    const tree = parser.parse(content)
    // every span the grammar itself marked as damaged
    const spans: Array<[number, number]> = []
    const collect = (n: any): void => {
      if (n.type === "ERROR" || n.isMissing) spans.push([n.startIndex, n.endIndex])
      for (let i = 0; i < n.childCount; i++) { const c = n.child(i); if (c) collect(c) }
    }
    collect(tree.rootNode)
    const inside = (a: number, b: number) => spans.some(([s, e]) => a >= s && b <= e)
    // THE RULE THIS AUDIT ACTUALLY NEEDED, found by reading the tree rather than
    // reasoning about the buckets.
    //
    // In v1.28 the ROOT NODE ITSELF is the ERROR, spanning bytes 0..79,276 of a
    // 278,366-byte file — and the tree's last child ends at 79,276. The parse simply
    // STOPS there: the entire `paths:` section, lines 2695 to the end and 199,090 bytes
    // (71% of the file), was never parsed, so no node exists that could carry those
    // keys. Those paths' own bytes are clean and no ancestor of theirs is damaged —
    // they are past the end of the parse. "Inside an ERROR span" cannot explain them,
    // because the ERROR is the whole prefix rather than a hole in the middle.
    //
    // So a lost path is explained by the grammar when its own span is damaged, OR when
    // an ancestor's span is damaged, OR when its bytes lie beyond the tree the parser
    // actually produced. The third clause is the one that matters here, and without it
    // this audit reported 76,332 false "unexplained" paths and a broken attribution
    // that was really just an incomplete rule.
    const treeEnd = tree.rootNode.endIndex
    const beyondParse = (r: [number, number]) => r[0] >= treeEnd

    const parsed: any = await parseFile(file, ROOT)
    const analyzer = new Set(analyzerPathsFor(parsed))
    const stem = path.basename(file).replace(/\.(ya?ml)$/i, "")

    // THE ANCESTOR-AWARE TEST, and the reason this file needed two attempts.
    //
    // The first version asked only whether a lost path's OWN bytes fall inside an ERROR
    // span, and answered "15,719 paths outside" — which reads as a damning result and is
    // not one. Containment is what gives a path its qualified name, so a grammar ERROR
    // anywhere in a path's ANCESTOR chain loses every descendant regardless of whether the
    // descendant's own bytes are damaged. Every "outside" path in v1.28 was of the form
    // `v1.28.definitions.<…>` at line 2596 while the ERROR spans cover 79,425 bytes
    // elsewhere in the file: if the single `definitions` key sits in the damaged region,
    // then all 1,053 are explained by one damaged ancestor and the analyzer is innocent.
    //
    // So a lost path counts as EXPLAINED when its own span is damaged OR when ANY
    // ancestor key's span is. What survives both is the thing worth reporting: a path
    // whose entire chain is clean and which the analyzer still failed to produce.
    const lost: Array<{ path: string; range: [number, number]; explained: boolean; by: string }> = []
    let iters = 0, hitAnalyzer = 0, hitNoRange = 0
    if (process.env.YAML_AUDIT_TRACE) {
      console.log(`    TRACE ${path.basename(file)}: row.documents is ${Array.isArray(row.documents) ? "array" : typeof row.documents} len=${row.documents?.length} inner0=${(row.documents as any[])?.[0]?.length} ranges=${Object.keys(row.ranges ?? {}).length} ancestors=${Object.keys(row.ancestors ?? {}).length}`)
    }
    row.documents.forEach((docPaths: string[], di: number) => {
      const document = di === 0 ? stem : `${stem}#${di + 1}`
      for (const rel of docPaths) {
        const abs = rel ? `${document}.${rel}` : document
        iters++
        if (analyzer.has(abs)) { hitAnalyzer++; continue }
        const range = row.ranges[rel] as [number, number] | undefined
        if (!range) { hitNoRange++; continue }
        let explained = inside(range[0], range[1])
        let by = explained ? "own-span" : ""
        if (!explained) {
          // The chain is the one the ORACLE recorded while walking, never one
          // reconstructed by splitting the flat path on ".". That reconstruction is
          // wrong for this corpus — an OpenAPI definition key is routinely
          // `AuthConfig.example`, so `definitions.AuthConfig.example.password` splits
          // into `definitions.AuthConfig` (real) and then `definitions.AuthConfig.exam…`
          // prefixes that are not keys at all. No range is found for those, every such
          // path is scored as having a clean chain, and v1.28 alone produced 5,294 false
          // "unexplained" paths. Only the walk knows the real chain.
          if (beyondParse(range)) { explained = true; by = "beyond-parse-extent" }
        }
        if (!explained) {
          // The TOP-MOST ancestor's span, shipped by the oracle as two ints. The full
          // chain was quadratic in depth and over 138 files it overflowed the caller's
          // maxBuffer, so execFileSync handed back a TRUNCATED payload: whole files
          // dropped out of the audit between runs and reported zero loss, which reads
          // as a clean result. If the top-most ancestor's own bytes are damaged, the
          // path could not have been named regardless of its own span; if it is clean,
          // the deeper chain cannot rescue the naming either.
          const ar = (row.ancestors ?? {})[rel] as [number, number] | undefined
          if (ar && inside(ar[0], ar[1])) explained = true
        }
        lost.push({ path: abs, range, explained, by })
      }
    })

    const unexplained = lost.filter((l) => !l.explained)
    const oraclePathCount = row.documents.reduce((n: number, d: string[]) => n + d.length, 0)
    let noRange = 0
    for (const docPaths of row.documents) for (const rel of docPaths) if (!row.ranges[rel]) noRange++
    totalLost += lost.length
    lostInsideError += lost.length - unexplained.length
    lostOutsideError += unexplained.length
    perFile.push({
      file: path.relative(CORPUS_ROOT, file),
      bytes: content.length,
      nonAscii: !/^[\x00-\x7F]*$/.test(content), // `isascii()` is Python; the byte check is why the oracle converts char marks to byte offsets at all
      errorSpans: spans.length,
      errorBytes: spans.reduce((n, [a, b]) => n + (b - a), 0),
      iters, hitAnalyzer, hitNoRange,
      oraclePathCount,
      analyzerPathCount: analyzer.size,
      intersection: oraclePathCount - lost.length - noRange,
      pathsWithNoRange: noRange,
      lostPaths: lost.length,
      lostInsideError: lost.length - unexplained.length,
      attribution: { byOwnSpan: lost.filter((l) => l.by === "own-span").length, byDamagedAncestor: lost.filter((l) => l.by.startsWith("ancestor")).length, beyondParseExtent: lost.filter((l) => l.by === "beyond-parse-extent").length, byNothing: unexplained.length },
      lostOutsideError: unexplained.length,
      treeEndBytes: treeEnd,
      fileBytes: content.length,
      parseCoverage: +(treeEnd / content.length).toFixed(4),
      unexplainedSamples: unexplained.slice(0, 8).map((l) => ({
        path: l.path,
        bytes: l.range,
        line: content.slice(0, l.range[0]).split("\n").length,
        text: content.slice(l.range[0], Math.min(l.range[1], l.range[0] + 60)).replace(/\n/g, "\\n"),
      })),
    })
    console.log(
      `  ${path.relative(CORPUS_ROOT, file).padEnd(52)} errorSpans=${String(spans.length).padStart(3)} ` +
      `lost=${String(lost.length).padStart(5)} inside=${String(lost.length - unexplained.length).padStart(5)} ` +
      `OUTSIDE=${unexplained.length} | oracle=${oraclePathCount} analyzer=${analyzer.size} noRange=${noRange} treeEnd=${treeEnd}/${content.length}`,
    )
  }

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "SHARP (lane-scoped)",
    at: new Date().toISOString(),
    question: "Is every path the analyzer lost in a grammar-damaged file INSIDE a span the grammar marked ERROR/MISSING? A lost path outside every such span is an analyzer defect the grammar bucket is absorbing.",
    authority: "lane-scoped",
    verdict: lostOutsideError === 0 ? "attribution-holds" : "ATTRIBUTION-BROKEN",
    draw: { corpora: REPOS, perRepo: PER_REPO, damagedFiles: damaged.length },
    totals: { lostPaths: totalLost, lostInsideError, lostOutsideError },
    perFile,
  }
  fs.mkdirSync(path.join(ROOT, "validation/m60/results"), { recursive: true })
  const out = path.join(ROOT, "validation/m60/results/yaml-bucket-audit.json")
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + "\n")
  console.log(`\nVERDICT: ${payload.verdict}`)
  console.log(`  lost ${totalLost} path(s): ${lostInsideError} inside a grammar ERROR span, ${lostOutsideError} OUTSIDE`)
  console.log(`  → ${path.relative(ROOT, out)}`)
}
main()
