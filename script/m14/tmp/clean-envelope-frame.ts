// The clean lane's M12 envelope frame, re-derived and then attacked.
//
// Two questions, and the second is the one the program keeps paying for:
//   1. Is the manifest RE-DERIVABLE? #909 says a corpus row is only evidence when its set can be
//      reconstructed. So the set digest is recomputed here from the files on disk by an
//      implementation that shares nothing with the harness but the format (path:size lines,
//      sha256, first 16 hex). If the digest matches, anyone can rebuild the exact file set.
//   2. Is the verdict EARNED BY THE FACTS? A scorable row must become unscorable the moment a
//      frame fact is removed or falsified — loadRule, the manifest, the digest, the extension
//      filter, the load context, the load-stable number. Each mutation below is applied to a
//      COPY in a temp dir and the gate's own reader must name a gap; a reader that still reads
//      "within budget" is the permissive branch this file exists to rule out.
//
// Usage: bun script/m14/tmp/clean-envelope-frame.ts
import { readFileSync, writeFileSync, mkdtempSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

const ROOT = process.cwd()
const ART = join(ROOT, "validation/m12/results/clean-complexity.json")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"
const GATE = join(ROOT, "script/m60/analyzer-complexity-gate.ts")

let failures = 0
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "ok  " : "FAIL"}  ${msg}`)
  if (!cond) failures++
}
const corpusRow = (d: any) => d.runs.find((r: any) => r.name === "corpus_subset").measurement

async function main() {
  const doc = JSON.parse(readFileSync(ART, "utf8"))
  const row = corpusRow(doc)
  const man = doc.corpusManifest

  // -------------------------------------------------------------- 1. the set is re-derivable
  // The harness's own rule — every non-empty .icl/.dcl ≤ 1 MiB under the root, whole-list sort —
  // re-implemented with `find` rather than with the harness's walker, then digested the same way.
  const listed = execFileSync("find", [CORPUS, "-type", "f", "(", "-name", "*.icl", "-o", "-name", "*.dcl", ")",
    "-size", "+0", "-size", "-1048577"], { encoding: "utf8" })
    .split("\n").filter(Boolean).sort()
  const sizes = listed.map((f) => statSync(f).size)
  const digest = createHash("sha256")
    .update(listed.map((f, i) => `${f}:${sizes[i]}`).join("\n"))
    .digest("hex")
    .slice(0, 16)
  const total = sizes.reduce((a, b) => a + b, 0)

  ok(listed.length === man.fileCount, `manifest fileCount ${man.fileCount} == find's ${listed.length}`)
  ok(digest === man.setDigest, `setDigest ${man.setDigest} is re-derivable (recomputed ${digest})`)
  ok(total === man.totalBytes, `manifest totalBytes ${man.totalBytes} == find's ${total}`)
  ok(Math.round(total / listed.length) === man.avgBytes, `manifest avgBytes ${man.avgBytes} == recomputed`)
  ok(Math.max(...sizes) === man.maxFileBytes, `manifest maxFileBytes ${man.maxFileBytes} == recomputed`)
  ok(man.extensionFiltered === true && man.extensions.includes(".icl") && man.extensions.includes(".dcl"),
    "extensionFiltered=true with both clean extensions (a bare number here would describe other languages)")

  // Internal consistency, because the two rate fields are the ones a reader quotes: the stored
  // symbolsPerSecond/relationshipsPerSecond must be the row's own counts over its own wall time.
  // (This check is what caught the doc quoting draw 1's rate beside draw 2's wall time.)
  const symRate = row.symbols / (row.wallTimeMs / 1000)
  const relRate = row.relationships / (row.wallTimeMs / 1000)
  ok(Math.abs(symRate - row.symbolsPerSecond) < 1 && Math.abs(relRate - row.relationshipsPerSecond) < 1,
    `stored rates == counts/wall (${symRate.toFixed(0)}/${relRate.toFixed(0)} symbols/s, relationships/s)`)
  console.log(`      the doc must quote ${symRate.toFixed(0)} / ${relRate.toFixed(0)} for this draw; ` +
    `a re-measure changes them and the doc with them`)

  // -------------------------------------------------------------- 2. the facts are load-bearing
  const mutations: { name: string; apply: (d: any) => void }[] = [
    { name: "no loadRule (#871)", apply: (d) => { delete d.loadRule } },
    { name: "no corpusManifest (#909)", apply: (d) => { delete d.corpusManifest } },
    { name: "manifest without setDigest", apply: (d) => { delete d.corpusManifest.setDigest } },
    { name: "extensionFiltered=false", apply: (d) => { d.corpusManifest.extensionFiltered = false } },
    { name: "corpus row without loadAvg1", apply: (d) => { delete corpusRow(d).loadAvg1 } },
    { name: "corpus row on a busy box (loadQuiet=false)", apply: (d) => { corpusRow(d).loadQuiet = false } },
    { name: "corpus row without userCpuMsPerFile", apply: (d) => { delete corpusRow(d).userCpuMsPerFile } },
    { name: "fixtures only (no corpus row)", apply: (d) => { d.runs = d.runs.filter((r: any) => r.name !== "corpus_subset") } },
  ]

  // The gate's reader, when it is in the tree. It is NOT in git in this checkout (§13 of the round
  // record), so its absence is printed rather than allowed to read as a pass.
  let gate: any = null
  try {
    gate = await import(GATE)
  } catch {
    gate = null
  }
  if (!gate) {
    console.log("SKIP  gate reader not importable — script/m60/analyzer-complexity-gate.ts is untracked here")
  }

  const tmp = mkdtempSync(join(tmpdir(), "clean-envelope-"))
  for (const mut of mutations) {
    const mutated = JSON.parse(JSON.stringify(doc))
    mut.apply(mutated)
    const raw = JSON.stringify(mutated)
    const file = join(tmp, "m.json")
    writeFileSync(file, raw)
    if (gate) {
      const frameGaps = gate.frameGaps(gate.readFrame(file, raw)) as string[]
      ok(frameGaps.length > 0, `${mut.name} → reader names a gap: ${frameGaps[0]?.slice(0, 70) ?? "(none)"}`)
    } else {
      const g: string[] = []
      if (!mutated.loadRule) g.push("loadRule")
      if (!mutated.corpusManifest) g.push("manifest")
      if (mutated.corpusManifest && !mutated.corpusManifest.setDigest) g.push("digest")
      if (mutated.corpusManifest && mutated.corpusManifest.extensionFiltered === false) g.push("filter")
      ok(g.length > 0, `${mut.name} → frame fact missing (${g.join(",") || "none"})`)
    }
  }

  // Control: the mutations only mean something if the unmutated artifact reads COMPLETE.
  if (gate) {
    const frameGaps = gate.frameGaps(gate.readFrame(ART, readFileSync(ART, "utf8"))) as string[]
    ok(frameGaps.length === 0, `control: the committed artifact has no frame gap (${frameGaps.join("; ") || "none"})`)
    const verdict = gate.classify("clean", "src/ast/real-clean-analyzer.ts", gate.readFrame(ART, readFileSync(ART, "utf8")), gate.parseBudget(readFileSync(join(ROOT, "docs/analyzers/clean.md"), "utf8"), "docs/analyzers/clean.md"), "docs/analyzers/clean.md")
    ok(verdict.verdict === "within-budget", `control: the lane reads ${verdict.verdict}${verdict.verdict === "within-budget" ? "" : " — " + verdict.reasons.join("; ")}`)
  }

  console.log(failures === 0
    ? `\nclean envelope frame: ${mutations.length} mutations, 0 failures`
    : `\nclean envelope frame: ${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("clean-envelope-frame failed:", e)
  process.exit(1)
})
