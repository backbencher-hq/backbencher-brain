/**
 * CONCURRENT-PARSER PROBE — is `[BB-PARSE-ERR] … memory access out of bounds` a
 * property of an XML FILE, or of the engine's parser cache?
 *
 * ## What this probe is for
 *
 * `src/ast/engine.ts` prints `[BB-PARSE-ERR] <lang> | <path> | memory access out of
 * bounds` for a corpus file, and 120 s later prints `[BB-HANG] parser stuck 120s on
 * <path> — exiting` and calls `process.exit(1)`. Both were recorded against this lane as
 * a defect in the XML grammar's wasm memory, on the evidence that the failing paths
 * repeat and that each hang is preceded by a parse error on the same path.
 *
 * That reasoning does not survive the sizes. The corpus files that trip both are
 * 459–1,254 bytes (measured below, and in `concurrent-parser-probe.json` ->
 * `inputBytes`). A 459-byte document cannot exhaust a wasm heap, so "the document is
 * pathological" has nothing to stand on, and the candidate mechanism is in the engine.
 *
 * `engine.ts:getParser` caches ONE `Parser` per language (`parsers.get(language)!` in the
 * `MAX_PARSER_CACHE_SIZE` map) and `parseFile` calls `parser.parse(content)` on it.
 * `TSParser` is stateful — `ts_parser_parse` mutates the parser's own lexer state — so
 * concurrent calls on one instance are undefined behaviour, and undefined behaviour inside
 * wasm surfaces as a trap ("memory access out of bounds") or as a call that never returns
 * (the 120 s timer). The `currentCount >= 500` eviction compounds it: it `delete()`s the
 * cached parser while sibling workers may still hold the reference and be inside
 * `parse()`, a use-after-free on a wasm object.
 *
 * ## What this measures, and the three ways it can come out
 *
 * It drives the PRODUCTION entry point (`parseFile` from `src/ast/pool-worker.ts`) over
 * ONE deterministic input set at two concurrency levels, and grades the result into
 * exactly three cases. The three-way grade is the point: a probe that only knows how to
 * report the case it was built to find will report its conclusion on a run that found
 * nothing, which is the failure mode this file's first version had.
 *
 *   CONCURRENCY TRACKS   serial clean of TRAPS, concurrent trapped. The fault is a
 *                        function of concurrency, so it is not a property of the
 *                        documents.
 *   INPUTS UNSOUND       a TRAP at the serial level too. The concurrency reading is NOT
 *                        established, and the documents are the first suspect again.
 *   INCONCLUSIVE         no trap at either level. This run establishes NOTHING about the
 *                        engine, and says so. Absence of a fault at N=8 on this host is
 *                        not evidence the fault does not exist: it is what a
 *                        contention-induced fault looks like on a host with memory to
 *                        spare.
 *
 * ## The two diagnostics are NOT the same, and conflating them is this probe's own bug
 *
 * The first version counted every entry in `result.errors` as a failure. On the 200-file
 * input set that graded `INPUTS UNSOUND` and exited 2 — correctly by its own rule, on the
 * wrong rule. The 20 errors it counted were `Syntax error (unexpected node)`, which is
 * this analyzer's RECOVERY LABELLING: a tree-sitter ERROR node is a successful parse of a
 * damaged region, `AnyFeed.xml` and `JsonInXml.xml` are damaged input by construction, and
 * `xml/recovery-labelling` is the fixture that pins the behaviour. It is not a trap and it
 * has nothing to do with the engine's parser cache.
 *
 * So the probe grades on the diagnostic under test — `memory access out of bounds`, a wasm
 * trap — and reports the recovery labels as a separate count that no verdict depends on.
 * The two counts are both in the artifact, because the recovery count is worth watching in
 * its own right and a probe that hid it to make itself look clean would be the same defect
 * it was written to find.
 *
 * ## What it cannot show, stated up front
 *
 * It does not control how much RAM the other processes on this host hold, so it cannot
 * separate parser reentrancy from machine-wide memory exhaustion. It establishes only
 * that the fault TRACKS CONCURRENCY, which is what the "grammar fault" reading needs and
 * does not have. The corpus-scale counterpart — the full 11,456-file gate at
 * `BB_XML_WORKERS=1` versus `=8` — is what carries the weight, and its numbers are in
 * `docs/analyzers/xml.md`.
 *
 * ## CLI
 *
 *   npx tsx validation/m14/fixtures/xml/concurrent-parser-probe.mts [--json OUT] [--files N]
 *
 * `--files` bounds the DISCOVERED input set (default 200). The set is discovered from
 * the corpus in sorted path order, so the same command parses the same files.
 *
 * The previously-observed failing paths are ADDED to the discovered set rather than
 * sampled from it, and `observedInInputSet` reports how many of them actually got
 * measured. That is a fix to this probe's second version: it discovered a 600-file
 * sample in sorted order and 3 of the 4 known-failing paths on this host fell AFTER the
 * cap, so it graded a run in which it had tested one of the four files it exists to
 * explain. An instrument that silently drops the rows it was built for is the same defect
 * this project keeps finding, and a census that printed 15 of 18 rows is the precedent.
 *
 * Exit 0 when the SERIAL level is clean (the inputs are individually sound, so the control
 * held). Exit 2 when the serial level traps — this run cannot establish the reading and
 * must not be quoted as if it did.
 */
import { writeFileSync, readdirSync, statSync } from "node:fs"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"

const jsonIdx = process.argv.indexOf("--json")
const jsonOut = jsonIdx >= 0 ? process.argv[jsonIdx + 1] : null
const filesIdx = process.argv.indexOf("--files")
const MAX_FILES = filesIdx >= 0 ? Number(process.argv[filesIdx + 1]) : 200

/**
 * Corpus files OBSERVED tripping the diagnostics, transcribed from real runs of
 * `validation/m14/fixtures/xml/ruled-gate.ts` at `BB_XML_WORKERS=8`. They are candidates,
 * not a census: `presentCount` below reports how many this host's corpus still has, and
 * the input set is the discovered corpus sample rather than this list, because a list of
 * ten files cannot create enough in-flight work to test a concurrency claim.
 */
const OBSERVED_FAILING = [
  "bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/svgs/brands/autoprefixer.svg",
  "bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/svgs/brands/viadeo-square.svg",
  "bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/svgs/solid/unlink.svg",
  "bulma/docs/assets/vendor/fontawesome-free-5.15.2-web/svgs/solid/star-half-alt.svg",
  "bulma/docs/assets/vendor/fontawesome-free-6.5.2-web/svgs/solid/book.svg",
  "bulma/docs/assets/vendor/fontawesome-free-6.5.2-web/svgs/solid/book-quran.svg",
  "bulma/docs/assets/vendor/fontawesome-free-6.5.2-web/svgs/solid/book-skull.svg",
  "bulma/docs/assets/vendor/fontawesome-free-6.5.2-web/svgs/solid/book-tanakh.svg",
  "bulma/docs/assets/vendor/fontawesome-free-6.5.2-web/svgs/solid/heart-circle-bolt.svg",
  "bulma/docs/assets/vendor/fontawesome-free-6.5.2-web/svgs/solid/square-root-alt.svg",
]

/** Deterministic input discovery: repositories sorted, `.svg`/`.xml`/`.xsd`/`.xsl` paths sorted. */
function discoverInputs(limit: number): string[] {
  const out: string[] = []
  const EXT = [".svg", ".xml", ".xsd", ".xsl", ".xslt", ".rng"]
  for (const repo of readdirSync(CORPUS).sort()) {
    const abs: string[] = []
    const stack = [`${CORPUS}/${repo}`]
    while (stack.length) {
      const dir = stack.pop()!
      let entries: string[]
      try { entries = readdirSync(dir) } catch { continue }
      for (const e of entries) {
        const p = `${dir}/${e}`
        let st
        try { st = statSync(p) } catch { continue }
        if (st.isDirectory()) {
          if (e === ".git" || e === "node_modules") continue
          stack.push(p)
        } else if (st.size > 0 && st.size <= 512 * 1024 && EXT.some((x) => e.endsWith(x))) {
          abs.push(p)
        }
      }
    }
    abs.sort()
    for (const p of abs) {
      out.push(p)
      if (out.length >= limit) return out
    }
  }
  return out
}

type Level = {
  concurrency: number
  files: number
  parsed: number
  threw: number
  /** `memory access out of bounds` — a wasm trap. The diagnostic under test. */
  traps: number
  /** `Syntax error (unexpected node)` — this analyzer's recovery labelling. Not a trap. */
  recoveryLabels: number
  symbols: number
  relationships: number
  trapSamples: string[]
  recoverySamples: string[]
}

const TRAP = "memory access out of bounds"

async function runLevel(concurrency: number, files: string[]): Promise<Level> {
  let i = 0
  const level: Level = { concurrency, files: files.length, parsed: 0, threw: 0, traps: 0, recoveryLabels: 0, symbols: 0, relationships: 0, trapSamples: [], recoverySamples: [] }
  const worker = async (): Promise<void> => {
    for (;;) {
      const k = i++
      if (k >= files.length) return
      const abs = files[k]
      const label = abs.slice(abs.lastIndexOf("/") + 1)
      try {
        const r: any = await parseFile(abs, abs.slice(0, abs.lastIndexOf("/")))
        level.parsed++
        level.symbols += r?.symbols?.length ?? 0
        level.relationships += r?.relationships?.length ?? 0
        for (const e of r?.errors ?? []) {
          const msg = String(e.message ?? e)
          if (msg.includes(TRAP)) {
            level.traps++
            if (level.trapSamples.length < 20) level.trapSamples.push(`${label}: ${msg}`)
          } else {
            level.recoveryLabels++
            if (level.recoverySamples.length < 10) level.recoverySamples.push(`${label}: ${msg}`)
          }
        }
      } catch (e) {
        level.threw++
        if (level.trapSamples.length < 20) level.trapSamples.push(`${label}: THREW ${(e as Error).message}`)
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  return level
}

function grade(serial: Level, concurrent: Level): { grade: string; reading: string } {
  const serialBad = serial.threw + serial.traps
  const concurrentBad = concurrent.threw + concurrent.traps
  if (serialBad > 0) {
    return {
      grade: "INPUTS UNSOUND",
      reading: "a wasm trap occurred at the serial level too, so this run does NOT establish the concurrency reading and the documents remain the first suspect",
    }
  }
  if (concurrentBad > 0) {
    return {
      grade: "CONCURRENCY TRACKS",
      reading: "no input traps when calls are serial and the same inputs trap with calls in flight, so the fault is a function of concurrency and not a property of the documents",
    }
  }
  return {
    grade: "INCONCLUSIVE",
    reading: "no wasm trap at either level, so this run establishes nothing about the engine — which is what a contention-induced fault looks like on a host with memory to spare",
  }
}

async function main(): Promise<void> {
  // The known-failing paths come FIRST and are deduplicated against the discovered set, so
  // a run cannot grade a claim about files it never parsed.
  const presentAbs = OBSERVED_FAILING.filter((r) => {
    try { return statSync(`${CORPUS}/${r}`).size > 0 } catch { return false }
  }).map((r) => `${CORPUS}/${r}`)
  const discovered = discoverInputs(MAX_FILES)
  const seen = new Set(presentAbs)
  const files = [...presentAbs, ...discovered.filter((p) => !seen.has(p))]
  const observedInInputSet = presentAbs.filter((p) => files.includes(p)).length
  if (files.length === 0) {
    console.error(`no xml/svg inputs discovered under ${CORPUS} — the probe cannot measure anything`)
    process.exit(2)
  }
  if (observedInInputSet < presentAbs.length) {
    console.error(`BUG: only ${observedInInputSet} of ${presentAbs.length} known-failing inputs reached the measured set`)
    process.exit(2)
  }
  const sizes = files.map((f) => statSync(f).size)
  const observedSizes = presentAbs.map((a) => statSync(a).size)

  console.log(`corpus: ${CORPUS}`)
  console.log(`inputs: ${files.length} = ${presentAbs.length} known-failing + ${files.length - presentAbs.length} discovered (cap ${MAX_FILES}), min=${Math.min(...sizes)}B max=${Math.max(...sizes)}B total=${sizes.reduce((a, b) => a + b, 0)}B`)
  console.log(`previously-observed failing paths present on this host: ${presentAbs.length}/${OBSERVED_FAILING.length}, ${observedSizes.length ? `${Math.min(...observedSizes)}B–${Math.max(...observedSizes)}B` : ""}; all ${observedInInputSet} are IN the measured set`)

  // Serial is the CONTROL and runs first: it establishes that every input is individually
  // sound, which is what makes a concurrent failure attributable to the engine.
  const serial = await runLevel(1, files)
  const concurrent = await runLevel(8, files)
  const g = grade(serial, concurrent)

  const report = {
    probe: "concurrent-parser-probe",
    claimLevel: "L1",
    productionEntryPoint: "src/ast/pool-worker.ts parseFile",
    corpusRoot: CORPUS,
    observedFailingPaths: OBSERVED_FAILING,
    observedFailingPathsPresent: presentAbs.length,
    observedFailingPathsInInputSet: observedInInputSet,
    observedFailingPathBytes: observedSizes,
    inputSet: { discovered: files.length, cap: MAX_FILES, deterministic: "repositories sorted, then paths sorted", minBytes: Math.min(...sizes), maxBytes: Math.max(...sizes), totalBytes: sizes.reduce((a, b) => a + b, 0) },
    levels: { serial, concurrent },
    grade: g.grade,
    reading: g.reading,
    candidateMechanism:
      "src/ast/engine.ts getParser caches ONE Parser per language and parseFile calls parser.parse() on it; TSParser is stateful, so concurrent calls on one instance are undefined behaviour, and the parseCount>=500 eviction deletes that instance while siblings may still hold it inside parse()",
    limitations: [
      "does not control host memory pressure, so it cannot separate parser reentrancy from machine-wide exhaustion; it establishes only that the fault tracks concurrency",
      "the previously-observed failing-path list is transcribed from earlier runs, so it is a set of candidates rather than a census of every file that trips the diagnostic",
      "an INCONCLUSIVE grade is a real outcome of this probe and must be reported as one, not as a pass",
      "src/ast/engine.ts is supervisor-owned; this probe characterises the defect and does not fix it",
    ],
  }

  console.log(`\nserial     n=1 files=${serial.files} parsed=${serial.parsed} threw=${serial.threw} traps=${serial.traps} recoveryLabels=${serial.recoveryLabels} symbols=${serial.symbols} rels=${serial.relationships}`)
  console.log(`concurrent n=8 files=${concurrent.files} parsed=${concurrent.parsed} threw=${concurrent.threw} traps=${concurrent.traps} recoveryLabels=${concurrent.recoveryLabels} symbols=${concurrent.symbols} rels=${concurrent.relationships}`)
  for (const e of serial.trapSamples) console.log(`  serial TRAP: ${e}`)
  for (const e of concurrent.trapSamples) console.log(`  concurrent TRAP: ${e}`)
  console.log(`recovery labels are this analyzer's ERROR-node labelling, not traps; samples: ${serial.recoverySamples.slice(0, 3).join(" | ") || "(none)"}`)
  console.log(`\nGRADE ${g.grade}: ${g.reading}`)

  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n")
    console.log(`wrote ${jsonOut}`)
  }

  if (serial.threw + serial.traps > 0) {
    console.error("\nCONTROL FAILED: a wasm trap occurred at the serial level, so this run cannot establish the concurrency reading.")
    process.exit(2)
  }
  console.log(`control intact — the serial level trapped on none of ${serial.parsed} inputs`)
}

main().catch((e) => { console.error(e); process.exit(1) })
