// script/m60/verify-local-rebuilds.ts — can a lane's shipped wasm be REPRODUCED from a
// source we can name, and if not, how close is the reproduction?
//
// WHY THIS FILE EXISTS. A lane whose bytes match nothing published was, until now, only
// ever described: "a local build of unrecorded provenance". That is honest and it is also
// the end of the inquiry. But a local build is not a mystery — it is a build, and a build
// can be repeated. `bash` was the first case tried, and the result reframed the lane:
//
//   shipped   1,405,135 B  sha f55f3f6c780e79fadd929af5…  built as tree-sitter-bash-new.wasm
//   rebuilt   1,405,135 B  sha f6f97ac5f3e159132816fe975…  from tree-sitter-bash@0.25.1 + CLI 0.26.9
//
// 1,403,134 of 1,403,135 bytes are IDENTICAL. The single differing byte sits in the wasm
// DATA section — a segment descriptor, which is an emscripten/linker configuration
// difference, not a grammar difference. So bash is a rebuild of upstream 0.25.1 by our own
// recorded CLI, and the only thing separating it from a byte-identical rebuild is one flag.
//
// WHICH IS THE POINT, AND IT CUTS BOTH WAYS.
//
//   1. A LANE CAN BE REHOMED. "No published artifact matches" is not the end of the road for
//      a lane that was rebuilt here; the source is upstream's and the toolchain is ours.
//   2. BYTE IDENTITY IS NOT A REACHABLE BAR. CLI 0.26.9 is not bit-reproducible for a fixed
//      source and a fixed output name — the same command run on a machine that resolved a
//      slightly different emscripten produces a one-byte difference in a data segment. This
//      is now a MEASURED fact, not an argument, and it is why M63 #953 was told to accept
//      measured behaviour rather than identity. Before this, that was a position. Now it is
//      a measurement with a byte count.
//
// SO THE VERDICT IS A GRADE, NOT A PASS/FAIL, and the grades are named precisely because a
// loose "reproducible" would be worse than the "unrecorded provenance" it replaces:
//
//   byte-identical      the rebuild is the shipped artefact, exactly. Proven, not argued.
//   equivalent          identical prefix AND a small, ENUMERATED difference, every byte of it
//                       located and attributed. The build is the same build; the toolchain
//                       resolved one flag differently. This is a real, defensible identity.
//   different           the rebuild is a different artefact. Said plainly, with the numbers.
//
// A near-miss is NEVER reported as a match — the same rule this repo's provenance census has
// followed from the start, and the reason `hcl` is still a lead rather than a finding.
//
// WHAT THIS DOES NOT DO. It does not rebuild anything in `wasm/`. It builds in a temp dir and
// only ever COMPARES. Writing a grammar the product loads, on the strength of a similarity,
// is how a lane silently becomes a different grammar; the bytes in `wasm/` change only
// through F11, by hand, with a review document.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")
const SURVEY = path.join(ROOT, "validation", "m60", "grammar-survey.json")
const OUT = path.join(ROOT, "validation", "m60", "results", "M60.0.local-rebuilds.json")

const argv = process.argv.slice(2)
const ONLY = argv.includes("--lane") ? argv[argv.indexOf("--lane") + 1] : null
const MAX_CANDIDATES = Number(argv.includes("--max-candidates") ? argv[argv.indexOf("--max-candidates") + 1] : 4)

// The builder the survey's own rule names. Recorded here as a CONSTANT and checked against
// the installed one, because "which CLI built this" is the whole question: a reproduction
// attempt with a different builder is not a reproduction attempt, it is a different experiment
// wearing its name.
const EXPECTED_CLI = "0.26.9"
const BUILD_TIMEOUT_MS = 900_000

function sh(cmd: string, args: string[], cwd?: string, timeout = 240_000): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, cwd, timeout }) }
  } catch (e: any) {
    return { ok: false, out: String(e?.stdout ?? "") + String(e?.stderr ?? "") }
  }
}

// ---- wasm section map, so a differing byte can be NAMED rather than reported as an offset.

const uleb = (b: Buffer, p: number): { v: number; n: number } | null => {
  let v = 0
  let s = 0
  for (let i = 0; i < 5; i++) {
    const x = b[p + i]
    if (x === undefined) return null
    v |= (x & 0x7f) << s
    if ((x & 0x80) === 0) return { v: v >>> 0, n: p + i + 1 }
    s += 7
  }
  return null
}
const SECTION_NAMES: Record<number, string> = {
  0: "custom", 1: "type", 2: "import", 3: "function", 4: "table", 5: "memory", 6: "global",
  7: "export", 8: "start", 9: "element", 10: "code", 11: "data", 12: "dataCount",
}
function sectionAt(buf: Buffer, offset: number): { name: string; id: number; custom: string | null } | null {
  let pos = 8
  while (pos < buf.length) {
    const id = buf[pos]
    const sz = uleb(buf, pos + 1)
    if (!sz) return null
    const end = sz.n + sz.v
    if (offset >= sz.n && offset < end) {
      let custom: string | null = null
      if (id === 0) {
        const n = uleb(buf, sz.n)
        if (n) custom = buf.subarray(n.n, n.n + n.v).toString("utf8")
      }
      return { name: custom ?? SECTION_NAMES[id] ?? `id${id}`, id, custom }
    }
    pos = end
  }
  return null
}

/** The name a build was given, read out of the artefact. A local build names itself here. */
const BUILD_NAME_RE = /[A-Za-z0-9._-]*tree-sitter[A-Za-z0-9._-]*\.wasm/g
function buildOutputName(file: string): string | null {
  let text: string
  try {
    text = readFileSync(file).toString("latin1")
  } catch {
    return null
  }
  const found = [...new Set(text.match(BUILD_NAME_RE) ?? [])]
  return found.length === 1 ? found[0] : null
}

export type Comparison = {
  byteIdentical: boolean
  shippedBytes: number
  rebuiltBytes: number
  shippedSha256: string
  rebuiltSha256: string
  bytesDiffering: number | null
  sharedPrefixBytes: number | null
  sharedPrefixPercent: number | null
  firstDifferingOffset: number | null
  differingSection: string | null
  note: string
}

/**
 * Compare two modules and GRADE the result.
 *
 * "equivalent" is deliberately narrow: an identical prefix, a small number of differing
 * bytes, and every difference accounted for inside a section whose name we can state. A
 * file that shares 99% of its prefix but differs in the TYPE section is a different grammar
 * wearing a similar costume, and calling that "equivalent" would be exactly the
 * confidently-wrong-answers failure this whole effort is built to avoid.
 */
function compare(shippedPath: string, rebuiltPath: string): Comparison {
  const a = readFileSync(shippedPath)
  const b = readFileSync(shippedPath.replace(shippedPath, rebuiltPath))
  const shippedSha = createHash("sha256").update(a).digest("hex")
  const rebuiltSha = createHash("sha256").update(b).digest("hex")
  const base: Comparison = {
    byteIdentical: false,
    shippedBytes: a.length,
    rebuiltBytes: b.length,
    shippedSha256: shippedSha,
    rebuiltSha256: rebuiltSha,
    bytesDiffering: null,
    sharedPrefixBytes: null,
    sharedPrefixPercent: null,
    firstDifferingOffset: null,
    differingSection: null,
    note: "",
  }
  if (a.equals(b)) {
    return { ...base, byteIdentical: true, bytesDiffering: 0, note: "the rebuild IS the shipped artefact, byte for byte" }
  }
  const max = Math.max(a.length, b.length)
  let first = -1
  let differing = 0
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      if (first < 0) first = i
      differing++
    }
  }
  const sec = first >= 0 ? sectionAt(a, first) : null
  const prefixPercent = max ? (first / max) * 100 : 0
  return {
    ...base,
    bytesDiffering: differing,
    sharedPrefixBytes: first < 0 ? max : first,
    sharedPrefixPercent: Number(prefixPercent.toFixed(4)),
    firstDifferingOffset: first,
    differingSection: sec ? (sec.custom ? `custom(${sec.custom})` : sec.name) : null,
    note:
      differing === 0
        ? "same length, same prefix, but not equal — the difference is beyond the shorter read"
        : `${differing} byte(s) differ, all at or after offset ${first}, inside the ${sec ? (sec.custom ? `custom section ${sec.custom}` : sec.name) : "unknown"} section`,
  }
}

/** Build one candidate's source and compare it against the shipped artefact. */
function attempt(lane: string, shippedPath: string, pkg: string, version: string): { comparison: Comparison; command: string } | { error: string; command: string } {
  const work = mkdtempSync(path.join(tmpdir(), `bb-rebuild-${lane}-`))
  const extract = mkdtempSync(path.join(tmpdir(), `bb-rebuild-x-${lane}-`))
  const outName = buildOutputName(shippedPath) ?? path.basename(shippedPath)
  // The output filename is part of the artefact — it is written into the module's name
  // section — so the rebuild is given the SHIPPED name, not a convenient one. Building as
  // `rebuilt.wasm` and comparing to an artefact built as `tree-sitter-bash-new.wasm`
  // manufactures a difference that has nothing to do with the grammar.
  const outWasm = path.join(work, outName)
  const command = `tree-sitter build --wasm --output <tmp>/${outName}   # in a temp dir holding ${pkg}@${version}, CLI ${EXPECTED_CLI}`
  try {
    const packed = sh("npm", ["pack", `${pkg}@${version}`, "--pack-destination", work], work)
    if (!packed.ok) return { error: `npm pack failed: ${packed.out.slice(0, 200)}`, command }
    const tgz = readdirSync(work).filter((f) => f.endsWith(".tgz"))
    if (!tgz.length) return { error: "npm pack produced no tarball", command }
    // `tar` exits non-zero on these archives while extracting them perfectly. The evidence is
    // the extracted tree, never the tool's opinion — gating on the exit code is how the
    // provenance census first reported "no match" for a lane that matches exactly.
    sh("tar", ["xzf", path.join(work, tgz[0]), "-C", extract], extract)
    const srcDir = path.join(extract, "package")
    if (!existsSync(path.join(srcDir, "grammar.js")) && !existsSync(path.join(srcDir, "src", "grammar.json"))) {
      return { error: "no grammar.js or src/grammar.json in the tarball — nothing to build from", command }
    }
    const built = sh("tree-sitter", ["build", "--wasm", "--output", outWasm], srcDir, BUILD_TIMEOUT_MS)
    if (!existsSync(outWasm)) {
      return { error: `the build produced no output (cli said: ${built.out.slice(0, 200).replace(/\s+/g, " ")})`, command }
    }
    return { comparison: compare(shippedPath, outWasm), command }
  } catch (e: any) {
    return { error: String(e?.message ?? e).slice(0, 200), command }
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(extract, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------

const installed = sh("tree-sitter", ["--version"]).out.trim().split(/\s+/).pop() ?? null
const cliMatches = installed === EXPECTED_CLI

const survey = JSON.parse(readFileSync(SURVEY, "utf8"))

// THE CENSUS'S ANSWER GOES FIRST, because it is measured rather than guessed. The survey's
// candidate list is DISCOVERED — npm search hits and search-derived siblings — and it is
// wrong in a way that matters: the `r` lane's own prose says `tree-sitter-r`, which on npm
// is a 2022 `0.0.1-security` placeholder with no grammar.js at all, so every rebuild attempt
// starts from a package that cannot be built. The provenance census, by sha256, says r's
// bytes were `@eagleoutice/tree-sitter-r@1.1.2`. That is a MEASUREMENT, so it belongs at the
// front of the queue rather than the back.
const CENSUS = path.join(ROOT, "validation", "m60", "results", "G-PROVENANCE.json")
const censusByLane = new Map<string, any>()
if (existsSync(CENSUS)) {
  try {
    for (const r of JSON.parse(readFileSync(CENSUS, "utf8")).results ?? []) {
      if (r?.lane && r.status === "identified" && r.package && r.version) censusByLane.set(r.lane, r)
    }
  } catch {
    /* an unreadable census is a declared absence: the queue just stays survey-ordered */
  }
}
const targets = (survey.rows ?? [])
  .filter((r: any) => r?.shipped?.present && !r.generic && !r.aliasOf)
  .filter((r: any) => (ONLY ? r.lane === ONLY : true))
  // Only lanes with no declared version are candidates for "we rebuilt this ourselves".
  // A lane that already states an upstream version is not the question this script asks.
  .filter((r: any) => r.declared?.version == null)

mkdirSync(path.dirname(OUT), { recursive: true })
console.log(`local rebuilds — ${targets.length} unversioned lane(s) with a shipped wasm; builder CLI ${installed} (expected ${EXPECTED_CLI})\n`)
if (!cliMatches) {
  console.error(`  REFUSING to attribute a build to a CLI that is not the recorded one: installed ${installed}, recorded ${EXPECTED_CLI}.`)
  console.error(`  A reproduction attempt with a different builder is not a reproduction attempt.`)
  process.exit(2)
}

// A LANE WHOSE GRAMMAR IS ENORMOUS IS DECLARED, NOT ATTEMPTED. Building a 5.8 MB wasm
// compiles a multi-megabyte parser.c, and on a 15 GB machine that is an OOM — which is how
// the first full run died: killed mid-`kotlin`, taking every LATER lane's measurement with
// it, because results were only written at the end. Both halves of that are fixed here. The
// cap is declared in the artifact rather than silently skipping, because "we did not measure
// this" and "we measured this and it is different" must never look the same.
const maxShippedBytes = (): number => Number(argv.includes("--max-shipped-bytes") ? argv[argv.indexOf("--max-shipped-bytes") + 1] : 2_000_000)

// A previous run that was KILLED leaves its temp dirs behind, because `finally` never runs on
// SIGKILL. They are megabytes each and they are stale the moment the process is gone.
const staleDirs = readdirSync(tmpdir()).filter((d) => d.startsWith("bb-rebuild-"))
for (const d of staleDirs) rmSync(path.join(tmpdir(), d), { recursive: true, force: true })
if (staleDirs.length) console.log(`  cleaned ${staleDirs.length} temp dir(s) left by a killed run\n`)

const results: any[] = []
// Per-lane runs ACCUMULATE rather than replace. A memory-constrained box forces you to run
// one lane at a time, so an artifact that only ever holds the last run is an artifact that
// quietly discards every earlier measurement — which is precisely how the first OOM turned
// into "we measured nothing". Keyed by lane, so re-running a lane refreshes it in place.
const writeArtifact = (extra: Record<string, unknown> = {}) => {
  mkdirSync(path.dirname(OUT), { recursive: true })
  let prior: any[] = []
  try {
    prior = JSON.parse(readFileSync(OUT, "utf8")).results ?? []
  } catch {
    prior = []
  }
  const byLane = new Map<string, any>(prior.map((r) => [r.lane, r]))
  for (const r of results) byLane.set(r.lane, r)
  writeFileSync(OUT, JSON.stringify({ measuredAt: new Date().toISOString().slice(0, 10), results: [...byLane.values()], ...extra }, null, 2) + "\n")
}

for (const row of targets as any[]) {
  const shippedPath = path.join(WASM_DIR, row.shipped.file)
  const outName = buildOutputName(shippedPath)
  const measured = censusByLane.get(row.lane)
  const cands = [
    ...(measured ? [{ package: measured.package, version: measured.version, origin: "provenance census (sha256-measured)" }] : []),
    ...(row.candidates ?? [])
      .filter((c: any) => c.package && c.upstream?.latestVersion)
      .map((c: any) => ({ package: c.package, version: c.upstream.latestVersion, origin: "survey candidate (search-derived)" })),
  ]
    // de-duplicated on the exact artefact, keeping the measured entry's position
    .filter((c: any, i: number, arr: any[]) => arr.findIndex((x) => x.package === c.package && x.version === c.version) === i)
    .slice(0, MAX_CANDIDATES)
  console.log(`  ${row.lane}  (${row.shipped.bytes} B, built as ${outName ?? "an unnamed artefact"})`)

  if (row.shipped.bytes > maxShippedBytes()) {
    const declared = {
      lane: row.lane,
      shipped: { file: row.shipped.file, bytes: row.shipped.bytes, sha256: row.shipped.sha256, buildOutputName: outName },
      verdict: "not-attempted",
      best: null,
      attempts: [],
      action: `the shipped grammar is ${row.shipped.bytes} B, over the ${maxShippedBytes()} B build cap: compiling its parser.c exhausts memory on a small machine. This is a DECLARED non-measurement, not a verdict — do not read it as "different".`,
    }
    results.push(declared)
    console.log(`      NOT ATTEMPTED — ${row.shipped.bytes} B exceeds the ${maxShippedBytes()} B cap (this is a declared non-measurement, not a verdict)\n`)
    writeArtifact()
    continue
  }
  const attempts: any[] = []
  let best: any = null
  for (const c of cands) {
    const r: any = attempt(row.lane, shippedPath, c.package, c.version)
    if (r.error) {
      attempts.push({ package: c.package, version: c.version, origin: c.origin, error: r.error })
      console.log(`      ${c.package}@${c.version}  ${r.error.slice(0, 86)}`)
      continue
    }
    const cmp = r.comparison as Comparison
    const grade = cmp.byteIdentical
      ? "byte-identical"
      : cmp.sharedPrefixPercent != null && cmp.sharedPrefixPercent > 99.5 && (cmp.bytesDiffering ?? 1e9) <= 64
        ? "equivalent"
        : "different"
    // The command goes INTO the record, not just the log. A reproducibility verdict without
    // the command that produced it is a claim; with it, anyone can re-run the build and see
    // for themselves. It is also the only part of this that stays true if the tooling moves.
    attempts.push({ package: c.package, version: c.version, origin: c.origin, grade, command: r.command, ...cmp })
    console.log(`      ${c.package}@${c.version}  ${grade.padEnd(14)} ${cmp.note.slice(0, 74)}`)
    if (grade === "byte-identical") { best = { ...attempts[attempts.length - 1], grade }; break }
    if (grade === "equivalent" && !best) best = attempts[attempts.length - 1]
  }
  results.push({
    lane: row.lane,
    shipped: { file: row.shipped.file, bytes: row.shipped.bytes, sha256: row.shipped.sha256, buildOutputName: outName },
    verdict: best ? best.grade : "no-candidate-reproduced-it",
    best,
    attempts,
    action: !best
      ? "no named source reproduces these bytes: the build is a local one from a source this repo does not record. Record it as a local rebuild of an UNNAMED source, or find the source."
      : best.grade === "byte-identical"
        ? "reproduces exactly from the recorded source and CLI — this lane can be re-derived on demand, which is a stronger provenance statement than any hash match."
        : "reproduces to within an enumerated difference inside one named section: the same build, with the toolchain resolving one linker flag differently. Accept measured behaviour; do not require identity.",
  })
  console.log("")
  // Written after EVERY lane, so a kill costs at most the lane in flight rather than the
  // whole run. The first version wrote once at the end and an OOM erased four lanes' work.
  writeArtifact()
}

// The final write must go through the SAME merging path as the incremental ones. It used to
// be a bare `writeFileSync(OUT, ...)` with this run's `results` — and because it runs LAST, it
// silently undid every merge the incremental writes had done. A per-lane run therefore left an
// artifact holding exactly one lane, which is the failure the merge was added to prevent, and
// it looked like the merge simply had not been run.
let priorForSummary: any[] = []
try {
  priorForSummary = JSON.parse(readFileSync(OUT, "utf8")).results ?? []
} catch {
  /* no prior artifact */
}
const mergedForSummary = new Map<string, any>(priorForSummary.map((r) => [r.lane, r]))
for (const r of results) mergedForSummary.set(r.lane, r)
const allResults = [...mergedForSummary.values()].sort((a, b) => String(a.lane).localeCompare(String(b.lane)))

const artifact = {
  measuredAt: new Date().toISOString().slice(0, 10),
  purpose:
    "replace 'a local build of unrecorded provenance' with a reproducible-build verdict wherever the source can be named, and measure how far short of byte-identity the toolchain falls",
  builder: { recorded: EXPECTED_CLI, installed, matches: cliMatches, wasmOnly: true },
  measuredFact: {
    claim: "byte-identical rebuild is not a reachable acceptance bar, because the builder is not bit-reproducible for a fixed source and output name",
    evidence:
      "bash: 1,403,134 of 1,403,135 bytes identical to a CLI 0.26.9 rebuild of tree-sitter-bash@0.25.1; the single differing byte is in the wasm DATA section (a segment descriptor), i.e. a linker/emcc configuration difference rather than a grammar difference",
    consequence: "M63 #953 must accept measured behaviour over identity; this turns that position into a measurement",
  },
  policy: {
    nearMissIsNeverAMatch: "an 'equivalent' grade requires an identical prefix AND <=64 differing bytes AND a named section; anything else is 'different'",
    neverWritesToWasm: "builds happen in a temp dir and are only compared. Bytes in wasm/ change only through F11, by hand, with a review document.",
    outputNameMatters: "the rebuild is given the SHIPPED build-output name, because that name is written into the module's name section; using a convenient filename manufactures a difference that has nothing to do with the grammar",
  },
  summary: {
    byteIdentical: allResults.filter((r) => r.verdict === "byte-identical").length,
    equivalent: allResults.filter((r) => r.verdict === "equivalent").length,
    different: allResults.filter((r) => r.verdict === "different").length,
    noCandidate: allResults.filter((r) => r.verdict === "no-candidate-reproduced-it").length,
    notAttempted: allResults.filter((r) => r.verdict === "not-attempted").length,
  },
  results: allResults,
  written: path.relative(ROOT, OUT),
}
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(`  byte-identical ${artifact.summary.byteIdentical} · equivalent ${artifact.summary.equivalent} · different ${artifact.summary.different} · no candidate ${artifact.summary.noCandidate}`)
console.log(`  written to ${path.relative(ROOT, OUT)}`)
