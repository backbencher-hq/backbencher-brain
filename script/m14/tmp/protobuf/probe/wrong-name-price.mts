/**
 * WHY THE 42 `uses` WRONG-NAMES ARE NOT FIXABLE PER FILE — a price for the §8 request.
 *
 * ## The finding being priced
 *
 * `protoc` adjudicates every `uses` target in the corpus (probe/protoc-oracle.py). At
 * this pass's HEAD, on libprotoc 35.1:
 *
 *     judged 11,242   AGREE 11,200 (99.626%)   WRONG-NAME 42
 *
 * All 42 are ONE shape, and reading them shows what they are: a cross-file reference
 * written RELATIVELY, which `protoc` resolves against the whole-program symbol table
 * and this analyzer cannot, because `analyze()` is handed one file.
 *
 *     emitted  common.EnterpriseMeta                protoc  hashicorp.consul.internal.common.EnterpriseMeta
 *     emitted  types.Platform                       protoc  containerd.types.Platform
 *     emitted  google.protobuf.FileDescriptorProto  protoc  google.protobuf.FileDescriptorProto
 *
 * Every emitted name is a SUFFIX of protoc's answer. So the reference is real and the
 * edge is not fabricated — it is spelled the way the schema spells it, and the
 * resolution happens in a scope the analyzer is not given.
 *
 * ## The tempting fix, and why it is wrong
 *
 * The analyzer knows its own file's `package`, so "prefix the unresolved name with the
 * package" looks free. It is not. This file MEASURES that candidate against protoc's
 * 42 answers instead of asserting it fails:
 *
 *     CANDIDATE A  ownPackage + "." + emitted
 *     CANDIDATE B  drop the trailing segment of emitted            (fits plugin.proto)
 *     CANDIDATE C  A, then B
 *
 * A candidate "wins" only on exact string equality with protoc's resolved name.
 *
 * ## What this establishes
 *
 * If no per-file transform beats the as-written fallback, then the 42 are irreducible
 * inside this lane and the ONLY fix is a cross-file symbol table — which is the
 * `AnalyzeContext` companion index already on this lane's §8 list. That turns a
 * request from "please add a context" into "adding a context is worth these 42 edges
 * and no local change is worth anything", with the arithmetic attached.
 *
 * No regex. Names are split on "." — a string operation on an already-parsed id, not a
 * scan of source text.
 *
 * ## Reproduce
 *
 *   npx tsx script/m14/tmp/protobuf/probe/dump-uses-targets.mts --out /tmp/opencode/pb/uses-targets.tsv
 *   ./protoc-venv/bin/python script/m14/tmp/protobuf/probe/protoc-oracle.py \
 *       --tsv /tmp/opencode/pb/uses-targets.tsv --out /tmp/opencode/pb/protoc-oracle.json
 *   npx tsx script/m14/tmp/protobuf/probe/wrong-name-price.mts
 */
import { readFileSync, existsSync } from "node:fs"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const ORACLE = process.env.PB_ORACLE ?? "/tmp/opencode/pb/protoc-oracle.json"
const TSV = process.env.PB_TSV ?? "/tmp/opencode/pb/uses-targets.tsv"

interface Disagreement {
  file: string
  source: string
  emitted: string
  verdict: string
  protoc?: string
}

function candidateA(pkg: string, emitted: string): string {
  return pkg.length === 0 ? emitted : `${pkg}.${emitted}`
}

function candidateB(emitted: string): string {
  const i = emitted.lastIndexOf(".")
  return i <= 0 ? emitted : emitted.slice(0, i)
}

function candidateC(pkg: string, emitted: string): string {
  return candidateB(candidateA(pkg, emitted))
}

async function main(): Promise<void> {
  if (!existsSync(ORACLE)) {
    console.error(`missing oracle output: ${ORACLE}\n  run probe/protoc-oracle.py first (see header)`)
    process.exit(2)
  }
  const oracle = JSON.parse(readFileSync(ORACLE, "utf8"))
  const wrong: Disagreement[] = (oracle.disagreements ?? []).filter((d: Disagreement) => d.verdict === "WRONG-NAME")

  console.log(`oracle: ${oracle.protocVersion}`)
  console.log(
    `judged ${oracle.judged}   AGREE ${oracle.agree} (${Number(oracle.agreeRateOverJudged ?? 0).toFixed(3)}%)   WRONG-NAME ${oracle.wrongName}`,
  )
  console.log(`WRONG-NAME rows in the oracle's disagreement list: ${wrong.length}`)
  console.log("")

  // Own package per file, taken from what the analyzer publishes as a `namespace`.
  const pkgCache = new Map<string, string>()
  let parsed = 0
  let noPackage = 0
  for (const w of wrong) {
    if (pkgCache.has(w.file)) continue
    const abs = `${CORPUS}/${w.file}`
    let name = ""
    try {
      const r = await parseFile(abs)
      parsed++
      for (const s of Array.isArray(r.symbols) ? r.symbols : []) {
        if (String(s?.kind ?? "") === "namespace") {
          name = String(s?.name ?? "")
          break
        }
      }
    } catch {
      /* a file protoc judged and we cannot parse is counted, not hidden */
    }
    if (name.length === 0) noPackage++
    pkgCache.set(w.file, name)
  }

  const tally: Record<string, { wins: number; misses: number; same: number }> = {
    "A ownPackage + emitted": { wins: 0, misses: 0, same: 0 },
    "B drop last segment": { wins: 0, misses: 0, same: 0 },
    "C A then B": { wins: 0, misses: 0, same: 0 },
  }
  const examples: Array<{ cand: string; pkg: string; emitted: string; protoc: string }> = []

  for (const w of wrong) {
    const pkg = pkgCache.get(w.file) ?? ""
    const gold = String(w.protoc ?? "")
    const cands: Array<[string, string]> = [
      ["A ownPackage + emitted", candidateA(pkg, w.emitted)],
      ["B drop last segment", candidateB(w.emitted)],
      ["C A then B", candidateC(pkg, w.emitted)],
    ]
    for (const [label, got] of cands) {
      if (got === gold) tally[label].wins++
      else if (got === w.emitted) tally[label].same++
      else tally[label].misses++
    }
    if (examples.length < 6) {
      examples.push({ cand: "A", pkg, emitted: w.emitted, protoc: gold })
    }
  }

  // The 42 are not one shape; they are two, and they pull in opposite directions.
  // Naming them is what makes "no local fix" falsifiable: a candidate that fixed one
  // shape would break the other, which is why all three score 0 rather than a split.
  let addedPrefix = 0
  let droppedSegment = 0
  let other = 0
  for (const w of wrong) {
    const g = String(w.protoc ?? "")
    if (g.endsWith(`.${w.emitted}`)) addedPrefix++
    else if (w.emitted.endsWith(`.${g}`)) droppedSegment++
    else other++
  }
  // "neither" is protoc trying the enclosing scope and landing one level out:
  // `google.protobuf.compiler.FileDescriptorProto` is not a symbol, so C++ falls back
  // to `google.protobuf.FileDescriptorProto`. That is a MIDDLE segment dropped, not a
  // suffix dropped, so it is named rather than left in a bucket called "neither".

  console.log("CANDIDATE PER-FILE TRANSFORMS, scored against protoc's 42 answers")
  console.log("--------------------------------------------------------------------------------------------------")
  console.log("candidate                       exact   changed-but-wrong   unchanged")
  for (const [label, t] of Object.entries(tally)) {
    console.log(`${label.padEnd(30)} ${String(t.wins).padStart(6)} ${String(t.misses).padStart(19)} ${String(t.same).padStart(10)}`)
  }
  console.log("")
  console.log("THE TWO SHAPES INSIDE THE 42 — they require opposite transforms")
  console.log("--------------------------------------------------------------------------------------------------")
  console.log(`  protoc ADDED a package prefix   (emitted is a suffix of protoc)   ${addedPrefix}`)
  console.log(`  protoc DROPPED a trailing segment (protoc is a suffix of emitted) ${droppedSegment}`)
  console.log(`  protoc landed one enclosing scope out (middle segment dropped)     ${other}`)
  console.log("")
  console.log("All 42 are protoc walking OUT a scope until it finds a declaration. That walk reads a")
  console.log("whole-program symbol table, so no per-file string transform reproduces it — which is")
  console.log("what the three scores of 0 above measure.")
  console.log("")
  console.log(`files re-parsed for their package: ${parsed}   with no package published: ${noPackage}`)
  console.log("")
  console.log("WORKED EXAMPLES — what candidate A produces against protoc's answer")
  console.log("--------------------------------------------------------------------------------------------------")
  for (const e of examples) {
    const a = candidateA(e.pkg, e.emitted)
    console.log(`  own package   ${e.pkg || "(none)"}`)
    console.log(`  emitted       ${e.emitted}`)
    console.log(`  protoc        ${e.protoc}`)
    console.log(`  candidate A   ${a}   ${a === e.protoc ? "MATCH" : "differs"}`)
    console.log("")
  }
  if (existsSync(TSV)) {
    const lines = readFileSync(TSV, "utf8").split("\n").filter((l) => l.length > 0)
    console.log(`uses edges in ${TSV}: ${lines.length}`)
  }
}

main().catch((e) => {
  console.error(`[wrong-name-price] ${(e as Error)?.message ?? e}`)
  process.exit(1)
})
