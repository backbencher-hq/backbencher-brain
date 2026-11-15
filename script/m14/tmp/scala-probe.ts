// Per-file Scala adjudication probe (m60 deep review).
//
// WHY THIS EXISTS: the F5 lane summary dedupes samples by `label|target` and
// prints at most 12, so a lane run cannot enumerate every red row. Adjudicating
// a row means reading the AST for the one file it came from, so this tool takes
// a file path and prints, for one label:
//
//   MISSING     truth row the analyzer does not publish   (oracle incomplete OR
//               analyzer suppression — adjudicate by reading the source)
//   UNEXPLAINED analyzer row the oracle does not derive   (possible fabrication)
//
// It also dumps the AST so the node SHAPE is read, never guessed (hygiene 7/8).
//
// Usage:
//   npx tsx script/m14/tmp/scala-probe.ts --file <path> [--label contains]
//   npx tsx script/m14/tmp/scala-probe.ts --repo cats-effect --files a.scala,b.scala
//   npx tsx script/m14/tmp/scala-probe.ts --dump   (AST s-expression only)

import fs from "node:fs"
import path from "node:path"
import { deriveScalaContainsTruth, deriveScalaUsesTruth, deriveScalaEdges, deriveScalaReferencesTruth, deriveTreeEdges } from "../differential"
import { RealScalaAnalyzer } from "../../../src/ast/real-scala-analyzer"

const ROOT = path.resolve((import.meta as any).dirname ?? path.dirname(process.argv[1]), "..", "..", "..")

const argv = process.argv.slice(2)
const argOf = (k: string): string | undefined => {
  const i = argv.indexOf(k)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}
const has = (k: string): boolean => argv.includes(k)

type Row = { label: string; from: string; target: string; line_number: number }

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const lang = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-scala.wasm")))
  const parser = new ParserClass()
  parser.setLanguage(lang)

  const file = argOf("--file")
  const repo = argOf("--repo")
  const only = argOf("--label") ?? "contains"
  const corpusRoot = "/home/ishaq2321/bb_tests/repositories"
  // `--draw <file>` is the honest way to compare two runs: the lane's cold-pool
  // ROTATION changes the 60-file draw on every invocation, so two lane runs are
  // not the same measurement even at the same --sample. A captured draw is.
  const drawFile = argOf("--draw")
  const verbose = has("--verbose")
// See the MODE note by the comparison below: `count` is the stricter instrument and the
  // right one for contains/uses/references; `set` is the right one for calls, whose
  // oracle emits one row per distinct TARGET while the analyzer emits one per CALL
  // SITE. Running `count` on calls reports 1,258 MISSING and 10,706 UNEXPLAINED on a
  // corpus where deriveScalaEdges is documented as sound.
  const SET_MODE = has("--set")
  // The HARNESS's own match rule, reproduced so the review can state two numbers
  // instead of one. differential.ts matches an analyzer row when
  //   normTarget(te.target) === normTarget(r.target)  ||  te.target.includes(normTarget(r.target))
  // and normTarget is the LAST SEGMENT with generics stripped. So the second
  // clause is a SUBSTRING test on a leaf: `map` is explained by any truth target
  // whose text happens to contain "map". `--harness-match` applies exactly that;
  // `--exact` is the strict test. Both are reported, because a label that reads
  // 100% under one and 70% under the other is a claim about the matcher, not
  // about the analyzer.
  const HARNESS_MATCH = has("--harness-match")
  const lastSeg = (t: string): string => {
    let s2 = String(t).replace(/<.*$/, "").replace(/\[.*$/, "").trim()
    const parts = s2.split(".")
    return parts[parts.length - 1]
  }

  const files: string[] = []
  if (file) files.push(path.resolve(file))
  if (repo && !drawFile) {
    const list = argOf("--files")
    if (!list) throw new Error("--repo requires --files (comma separated relative paths) so the draw stays the lane's draw")
    for (const f of list.split(",")) files.push(path.join(corpusRoot, repo, f))
  }
  if (drawFile) {
    const rp = repo ?? "scala3"
    for (const f of fs.readFileSync(drawFile, "utf8").split("\n")) {
      const t = f.trim()
      if (t) files.push(path.join(corpusRoot, rp, t))
    }
  }
  if (files.length === 0) throw new Error("need --file, --repo+--files, or --draw")

  const analyzer = new RealScalaAnalyzer()
  const totals = { truth: 0, analyzer: 0, missing: 0, unexplained: 0, duplicate: 0 }
  const missingRows: string[] = []
  const unexplainedRows: string[] = []
  const duplicateRows: string[] = []
  let erroredFiles = 0

  for (const fp of files) {
    const content = fs.readFileSync(fp, "utf8")
    const tree = parser.parse(content)
    const root = tree.rootNode

    if (has("--dump")) {
      console.log(`=== ${fp} ===`)
      console.log(root.toString())
      continue
    }

    const res: any = analyzer.analyze(root, content, fp)

    // Analyzer side: (label, from, target) triples from relationships.
    // Field precedence is copied from differential.ts:19936-19942 verbatim, so
    // this probe reads the same edges the lane reads. A probe that mapped
    // `source`/`target` where the lane maps `from`/`to` would measure a
    // different analyzer.
    const rels: Row[] = (res.relationships ?? []).map((r: any) => ({
      label: String(r.type ?? r.relationshipType ?? ""),
      from: String(r.source ?? r.from ?? r.fromSymbol ?? ""),
      target: String(r.target ?? r.to ?? r.toSymbol ?? ""),
      line_number: r.line_number ?? 0,
    }))
    const rel = path.relative(corpusRoot, fp)
    if (root.hasError) erroredFiles++

    let truth: Row[] = []
    if (only === "contains") truth = deriveScalaContainsTruth(root) as any
    else if (only === "uses") truth = deriveScalaUsesTruth(root) as any
    else if (only === "calls" || only === "instantiates") truth = deriveScalaEdges(root) as any
    else if (only === "references") truth = deriveScalaReferencesTruth(root) as any
    else if (["extends", "implements", "overrides", "exports"].includes(only)) {
      // The shared deriveTreeEdges is the truth for the heritage labels; it is
      // NOT scala-specific, which is why scala's own calls/instantiates oracle
      // exists beside it (M37.21 #610, the java precedent).
      truth = deriveTreeEdges(root, "scala") as any
    } else if (only === "raw") {
      // Print one label's analyzer rows verbatim — for mapping an emission site
      // or a divergence, before an oracle exists for it.
      const want = argOf("--raw-label") ?? "contains"
      console.log(`=== ${rel} raw ${want} (${rels.filter((r) => r.label === want).length}) ===`)
      for (const r of rels.filter((x) => x.label === want)) console.log(`  ${r.from} -> ${r.target} @${r.line_number}`)
      continue
    } else throw new Error(`no oracle wired for label ${only}`)

    // MODE. `count` (the default) compares row COUNTS as well as the (label,target)
// set, which is the stricter instrument and the one that catches a name shared
// by two declarations. `set` compares the set alone. The two disagree per label
// and using the wrong one is a DEGENERATE METRIC, not a finding:
//
//   contains / uses / references — both sides dedupe by (source, target), so the
//     counts are comparable and `count` is right. It reports the DUPLICATE class
//     separately rather than calling it fabrication.
//   calls — the ORACLE emits one row per distinct TARGET while the analyzer emits
//     one per CALL SITE, so the counts differ by construction. Read `calls` with
//     `set`, exactly as the harness does.
//
// The truth MUST be filtered to the label under test BEFORE the counts are
    // built. deriveScalaEdges emits `calls` AND `instantiates` from one walk, so
    // comparing all of it against a calls-only analyzer side reports every
    // instantiation as a MISSING call — 1,258 rows on the cats-effect corpus, all
    // of them `instantiates|(F ~> F)`, and the instantiates run then reports the
    // 5,252 calls as missing. Filtering AFTER the counts is the same bug with the
    // totals made to look right. The harness matches label-to-label for the same
    // reason.
    truth = truth.filter((r) => r.label === only)

    // MATCH ON (label, target) — never on target alone (hygiene 3: a label-blind
    // comparison reported a broken analyzer green). COUNTS are compared too, not
    // just set membership: two sources can satisfy one (from, target) pair, so a
    // set-only diff hides an extra row for a name already present (hygiene 4).
    const key = (r: Row): string => `${r.label}|${r.target}`
    const tCount = new Map<string, number>()
    for (const r of truth) tCount.set(key(r), (tCount.get(key(r)) ?? 0) + 1)
    const aCount = new Map<string, number>()
    for (const r of rels) if (r.label === only) aCount.set(key(r), (aCount.get(key(r)) ?? 0) + 1)

    const allKeys = new Set<string>([...tCount.keys(), ...aCount.keys()])
    for (const k of [...allKeys].sort()) {
      let t = tCount.get(k) ?? 0
      let a = aCount.get(k) ?? 0
      if (SET_MODE) { t = t > 0 ? 1 : 0; a = t > 0 ? 1 : 0; a = aCount.has(k) ? 1 : 0 }
      if (HARNESS_MATCH) {
        // analyzer-side only, exactly as the harness does it
        if (aCount.has(k)) {
          const leaf = lastSeg(k.split("|")[1] ?? "")
          const explained = truth.some((tr) => lastSeg(tr.target) === leaf || String(tr.target).includes(leaf))
          if (explained) continue
        }
        if (tCount.has(k)) { totals.missing += tCount.get(k)!; missingRows.push(`MISSING(harness-match) ${k}  (${rel})`) }
        else { totals.unexplained += aCount.get(k) ?? 0; unexplainedRows.push(`UNEXPLAINED(harness-match) ${k}  (${rel})`) }
        continue
      }
      if (t === a) continue
      const n = Math.abs(t - a)
      // A COUNT-only excess on a key both sides publish is not a fabrication:
      // it is one edge emitted once per DECLARATION of a shared name — Scala
      // overloads (`def Thicket()` x4 in dotty's Trees.Instance), a type alias
      // and a method of the same name, a class and its companion object both
      // holding a member called `getRandomValuesFun`. `contains` is a SET of
      // (owner, member); the analyzer emits one row per symbol, so a name shared
      // by two declarations under one owner yields extra rows that are all real.
      // Naming the class is the point: an instrument that folds these into
      // "unexplained" reports 65 fabrications on a clean 60-file scala3 draw.
      const tFroms = new Set(truth.filter((r) => key(r) === k).map((r) => r.from))
      const aFroms = new Set(rels.filter((r) => key(r) === k).map((r) => r.from))
      const sameOwners = !SET_MODE && t > 0 && a > 0 && tFroms.size === aFroms.size && [...tFroms].every((f) => aFroms.has(f))
      if (t > a) {
        totals.missing += n
        for (const tr of truth.filter((r) => key(r) === k)) missingRows.push(`MISSING     x${n} ${k}  ${tr.from}  (${rel})`)
      } else if (sameOwners) {
        totals.duplicate += n
        duplicateRows.push(`DUPLICATE   x${n} ${k}  owners: ${[...aFroms].join(", ")}  (${rel})`)
      } else {
        totals.unexplained += n
        for (const ar of rels.filter((r) => key(r) === k)) {
          unexplainedRows.push(`UNEXPLAINED x${n} ${k}  ${ar.from} L${ar.line_number}  (${rel})`)
        }
      }
    }
    // The truth MUST be filtered to the label under test. deriveScalaEdges
    // emits `calls` AND `instantiates` from one walk, so comparing all of it
    // against a calls-only analyzer side reports every instantiation as a
    // MISSING call — 1,258 rows on the cats-effect corpus, all of them
    // `instantiates|(F ~> F)`. The harness matches label-to-label for the same
    // reason.
    truth = truth.filter((r) => r.label === only)
    totals.truth += truth.length
    totals.analyzer += rels.filter((r) => r.label === only).length

    if (!drawFile) {
      console.log(`=== ${rel} ===`)
      console.log(`  symbols=${res.symbols?.length ?? 0} relationships=${rels.length} errors=${res.errors?.length ?? 0} hasError=${!!root.hasError}`)
      const byLabel = new Map<string, Row[]>()
      for (const r of rels) {
        if (!byLabel.has(r.label)) byLabel.set(r.label, [])
        byLabel.get(r.label)!.push(r)
      }
      console.log(`  analyzer labels: ${[...byLabel.entries()].map(([k, v]) => `${k}=${v.length}`).join(" ")}`)
      if (only === "raw") {
        for (const r of byLabel.get(argOf("--raw-label") ?? "") ?? []) console.log(`    ${r.label} ${r.from} -> ${r.target}`)
        continue
      }
      const tFroms = new Map<string, string[]>()
      for (const r of truth) {
        if (!tFroms.has(key(r))) tFroms.set(key(r), [])
        tFroms.get(key(r))!.push(r.from)
      }
      for (const k of [...allKeys].sort()) {
        const t = tCount.get(k) ?? 0
        const a = aCount.get(k) ?? 0
        if (t === a) continue
        const dir = t > a ? "MISSING    " : "UNEXPLAINED"
        console.log(`  ${dir} x${Math.abs(t - a)} ${k}`)
        console.log(`      truth   from: ${[...new Set(tFroms.get(k) ?? [])].join(", ") || "-"}`)
        console.log(`      analyzer from: ${[...new Set(rels.filter((r) => key(r) === k).map((r) => r.from))].join(", ") || "-"}`)
      }
      console.log(`  -- ${only}: truth=${truth.length} analyzer=${aCount.size} MISSING=${totals.missing} UNEXPLAINED=${totals.unexplained}`)
    }
  }

  if (drawFile) {
    console.log(`# draw: ${files.length} files (${erroredFiles} with parse errors), label=${only}`)
    console.log(`# mode=${SET_MODE ? "set" : "count"} truth=${totals.truth} analyzer=${totals.analyzer} MISSING=${totals.missing} UNEXPLAINED=${totals.unexplained} DUPLICATE(count-only)=${totals.duplicate}`)
    if (verbose) {
      console.log("--- MISSING ---")
      for (const r of [...new Set(missingRows)].sort()) console.log("  " + r)
      console.log("--- UNEXPLAINED ---")
      for (const r of [...new Set(unexplainedRows)].sort()) console.log("  " + r)
      console.log("--- DUPLICATE (one edge per declaration of a shared name) ---")
      for (const r of [...new Set(duplicateRows)].sort()) console.log("  " + r)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
