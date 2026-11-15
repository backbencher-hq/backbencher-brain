/**
 * missing-truth-price — what the 115 MISSING rows of the dart differential are.
 *
 * ## The question
 *
 * `npx tsx script/m14/differential.ts --lang dart` prints, over 2 corpora x 60 files:
 *
 *   proxicall   tree-truth 6,295  covered 6,194 (98.4%)  MISSING 101  unexplained 0
 *   dart-http   tree-truth 2,277  covered 2,263 (99.4%)  MISSING  14  unexplained 0
 *
 * `UNEXPLAINED = 0` is the fabricated-edge verdict and it is settled. `MISSING = 115`
 * is NOT settled: the harness prints 12 SAMPLES per lane and a sample is not a
 * distribution. Every sampled row is a cross-file `overrides` whose base member is
 * declared in another file, which is a shape, not a cause — it does not say whether
 * the analyzer drops the edge, publishes it under a spelling the matcher cannot
 * reconcile, or publishes it correctly and the truth side is the one that is wrong.
 *
 * Those three have different owners. Only the first is this analyzer's to fix.
 *
 * ## Why this walks the ORACLE and not the analyzer
 *
 * The analyzer side is already measured at 600 files and recorded in
 * `validation/m14/measurements/dart-600-8237d3e31ac2.raw.ndjson`. What is unmeasured is
 * the TRUTH side's output for a named file, and the matcher's reconciliation rule. So
 * this probe prints three things per file and compares them by eye first:
 *
 *   1. every `overrides` edge the ORACLE derives from the parse tree;
 *   2. every `overrides` edge production `parseFile` publishes for the same file;
 *   3. whether an oracle row is present in the analyzer's set under three spellings —
 *      exact, last-segment-of-target, and last-segment-of-both — because the harness
 *      states it tolerates FQN vs last-segment and the tolerance's SCOPE is what this
 *      measures.
 *
 * ## What a result means, and what it does not
 *
 * If the oracle's row is absent from the analyzer set under all three spellings, the
 * edge is genuinely not published and the count is a real recall gap. If it is present
 * under a tolerated spelling, the MISSING row is a defect in the COMPARISON, not in
 * the analyzer, and it is a §8 item. Those are different verdicts and this probe is
 * built to keep them apart rather than to produce a number either way.
 *
 * Population: the two files the harness named in its own MISSING samples. Two files is
 * not a distribution and nothing here is reported as one; the per-file edge sets are
 * published in full so the counts can be recomputed by hand.
 *
 * Run: npx tsx validation/m14/fixtures/dart/missing-truth-price.ts
 */
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveDartOverridesTruth } from "../../../../script/m14/oracles/dart-overrides"

const CASES = [
  { repo: "proxicall", rel: "lib/models/roles/employee_settings.dart" },
  { repo: "proxicall", rel: "lib/core/di/connection_factories/glow_screen_factory.dart" },
  { repo: "dart-http", rel: "pkgs/cupertino_http/lib/src/cupertino_web_socket.dart" },
]

const ROOT = "/home/ishaq2321/bb_tests/repositories"

const lastSeg = (s: string): string => {
  const t = s.trim()
  const i = Math.max(t.lastIndexOf("."), t.lastIndexOf("::"))
  return i < 0 ? t : t.slice(i + 1)
}

/** key the analyzer's own publish path used, so this probe does not invent a normalisation. */
const key = (from: string, target: string, lbl: string) => `${lbl}|${from}|${target}`

/**
 * `UniversalRelationship` (src/ast/types.ts:148) declares `from?`/`to?` AND
 * `fromSymbol?`/`toSymbol?` AND `type?`/`relationshipType?`, all optional, with an
 * index signature. So which slot a given analyzer happens to fill is a property of the
 * emit site, not of the type, and reading `r.to` alone silently yields undefined.
 * This resolves the first slot that carries a string and REPORTS which one it was, so
 * the probe cannot quietly measure an empty set.
 */
const slot = (r: any, names: string[]): { v: string; via: string } => {
  for (const n of names) if (typeof r?.[n] === "string" && r[n] !== "") return { v: r[n], via: n }
  return { v: "", via: "<none>" }
}
const viaSeen = new Map<string, number>()

const main = async (): Promise<void> => {
  console.log("# missing-truth-price — dart overrides MISSING, oracle side vs analyzer side\n")
  console.log("population: 3 named files, the ones the harness printed in its own MISSING samples.")
  console.log("oracle:     script/m14/oracles/dart-overrides.ts (deriveDartOverridesTruth)")
  console.log("analyzer:   production parseFile (src/ast/pool-worker.ts), not analyze()")
  console.log("tree:       web-tree-sitter, wasm/tree-sitter-dart.wasm, the same core+grammar")
  console.log("            the differential harness parses with (differential.ts:21411,21700).\n")

  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  const ROOTDIR = process.cwd()
  await ParserClass.init({ locateFile: () => path.join(ROOTDIR, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new ParserClass()
  const lang = await Language.load(await (await import("node:fs/promises")).readFile(path.join(ROOTDIR, "wasm", "tree-sitter-dart.wasm")))
  parser.setLanguage(lang)

  let totTruth = 0
  let totAn = 0
  let totExact = 0
  let totTgtSeg = 0
  let totBothSeg = 0
  let totAbsent = 0

  for (const c of CASES) {
    const abs = path.join(ROOT, c.repo, c.rel)
    const res = await parseFile(abs)
    const text = res?.source ?? (await import("node:fs")).readFileSync(abs, "utf8")

    // The oracle needs a parse tree, and `parseFile` does not hand one back. So this
    // probe parses the file a SECOND time, with the same web-tree-sitter core and the
    // same wasm the differential harness uses (differential.ts:21411 and 21700). Two
    // parses per file is a real cost and is stated here rather than hidden: it is
    // 3 files, and it buys a per-file edge set that both sides can be checked against.
    const tree = parser.parse(text)

    const truth = deriveDartOverridesTruth(tree.rootNode)
    const all = (res?.relationships ?? []) as any[]
    const anRaw = all.filter((r: any) => slot(r, ["type", "relationshipType"]).v === "overrides")
    const an = anRaw.map((r: any) => {
      const f = slot(r, ["from", "source", "fromSymbol"])
      const t = slot(r, ["to", "target", "toSymbol"])
      const ty = slot(r, ["type", "relationshipType"])
      viaSeen.set(`from:${f.via}`, (viaSeen.get(`from:${f.via}`) ?? 0) + 1)
      viaSeen.set(`to:${t.via}`, (viaSeen.get(`to:${t.via}`) ?? 0) + 1)
      return { from: f.v, to: t.v, type: ty.v, conf: r.confidence }
    })

    const anExact = new Set(an.map((r: any) => key(r.from, r.to, r.type)))
    const anTgtSeg = new Set(an.map((r: any) => key(r.from, lastSeg(r.to), r.type)))
    const anBothSeg = new Set(an.map((r: any) => key(lastSeg(r.from), lastSeg(r.to), r.type)))

    let exact = 0
    let tgtSeg = 0
    let bothSeg = 0
    let absent = 0
    const absentRows: string[] = []

    for (const t of truth) {
      const k = key(t.from, t.target, t.label)
      if (anExact.has(k)) exact++
      else if (anTgtSeg.has(key(t.from, lastSeg(t.target), t.label))) tgtSeg++
      else if (anBothSeg.has(key(lastSeg(t.from), lastSeg(t.target), t.label))) bothSeg++
      else {
        absent++
        absentRows.push(`    ${t.from} -> ${t.target}`)
      }
    }

    totTruth += truth.length
    totAn += an.length
    totExact += exact
    totTgtSeg += tgtSeg
    totBothSeg += bothSeg
    totAbsent += absent

    console.log(`## ${c.repo}/${c.rel}`)
    console.log(`   truth overrides   ${truth.length}`)
    console.log(`   analyzer overrides ${an.length}`)
    console.log(`   reconciled: exact ${exact} | target-last-seg ${tgtSeg} | both-last-seg ${bothSeg} | ABSENT ${absent}`)
    console.log(`   ORACLE edges:`)
    for (const t of truth) console.log(`     ${t.label}  ${t.from} -> ${t.target}`)
    console.log(`   ANALYZER edges:`)
    for (const r of an) console.log(`     ${r.type}  ${r.from} -> ${r.to}   conf=${r.conf}`)
    if (absentRows.length) {
      console.log(`   TRUTH ROWS THE ANALYZER SET DOES NOT CONTAIN, under any of the three spellings:`)
      for (const r of absentRows) console.log(r)
    }
    console.log("")
  }

  console.log("## which slot each side's endpoint actually came from")
  for (const [k, v] of [...viaSeen].sort()) console.log(`   ${k}  used ${v} time(s)`)
  console.log("")
  console.log("## TOTAL over the 3 named files")
  console.log(`   truth overrides    ${totTruth}`)
  console.log(`   analyzer overrides ${totAn}`)
  console.log(`   exact ${totExact} | target-last-seg ${totTgtSeg} | both-last-seg ${totBothSeg} | ABSENT ${totAbsent}`)
  console.log("")
  console.log("Read this as a per-file reconciliation, not a rate: the population is 3 files the")
  console.log("harness chose because they disagree, so it cannot estimate a recall gap.")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})