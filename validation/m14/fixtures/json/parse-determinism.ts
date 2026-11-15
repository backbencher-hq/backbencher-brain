/**
 * JSON LANE PARSE DETERMINISM PROBE — is the WASM trap reproducible?
 *
 * ## The observation that forced this file
 *
 * Four harnesses read the SAME admitted population (12,543 files at this corpus state) and
 * disagreed about whether the parser traps:
 *
 *   validation/m14/fixtures/json/census.ts        12,543 files, parse failures 0
 *   validation/m14/fixtures/json/differential.ts  12,543 files, parse failures 0
 *   validation/m14/fixtures/json/trap-scan.ts     12,543 parsed, TRAPPING FILES 0
 *   validation/m14/fixtures/json/ruling-table.ts  [BB-PARSE-ERR] memory access out of bounds
 *                                                  on 7 files, then [BB-HANG] 120 s and exit 1
 *
 * The first three use `parseFile` (census, differential) or a raw tree-sitter pool
 * (trap-scan); only ruling-table.ts both uses `parseFile` AND runs the whole population in ONE
 * process, so a trap poisons the shared parser instance and the next parse hangs to a
 * hardcoded 120 s `process.exit(1)`.
 *
 * Two explanations fit, and they have opposite consequences:
 *
 *   A. The trap is a property of the FILE. Then every harness must see it, the census's
 *      "parse failures 0" is wrong, and every count derived from a run that silently skipped
 *      these files is overstated.
 *   B. The trap is a property of the RUN — nondeterministic, or dependent on how many parses
 *      share one WASM instance. Then counts are reproducible only in aggregate, a single
 *      sample is not a measurement, and the disagreement above is expected rather than a
 *      defect in any one harness.
 *
 * ## What it measures
 *
 * For each named file, N independent production `parseFile` calls, each in its own child
 * process, plus N calls in ONE process. Reported per file: traps, successes, and whether the
 * two agree. A file that traps sometimes and not others is explanation B, and it is a finding
 * about the engine rather than about JSON.
 *
 * Usage: npx tsx validation/m14/fixtures/json/parse-determinism.ts [--runs N] [--same-process]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const argOf = (f: string, d: number) => {
  const i = argv.indexOf(f)
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d
}
const RUNS = argOf("--runs", 5)
const SAME_PROCESS = argv.includes("--same-process")

/** The files the production path reported as trapping, named from the ruling-table run. */
const CANDIDATES = [
  "clj-kondo/resources/clj_kondo/impl/cache/built_in/java/clojure.lang.ITransientVector.transit.json",
  "clj-kondo/resources/clj_kondo/impl/cache/built_in/java/java.util.Properties.transit.json",
  "docker/vendor/github.com/sigstore/rekor/pkg/types/hashedrekord/v0.0.1/hashedrekord_v0_0_1_schema.json",
  "hasura-engine/v3/crates/engine/tests/execute/aggregates/root_field/typename/metadata.json",
  "hasura-engine/v3/crates/engine/tests/execute/relationships/across_namespace/expected.json",
  "hasura-engine/v3/crates/engine/tests/execute/relationships/across_namespace/metadata.json",
  "kubernetes/staging/src/k8s.io/api/testdata/HEAD/core.v1.Secret.json",
  "kubernetes/staging/src/k8s.io/api/testdata/HEAD/core.v1.ResourceQuota.json",
  "kubernetes/staging/src/k8s.io/kubectl/testdata/apply/rc.json",
  "duckdb/src/include/duckdb/storage/serialization/constraint.json",
]

/** A control: a file every harness agrees parses. */
const CONTROL = "otp/lib/stdlib/test/json_SUITE_data/n_structure_open_array_object.json"

const repoOf = (rel: string) => rel.split("/")[0]

async function attempt(abs: string, dir: string): Promise<{ ok: boolean; symbols: number; err: string }> {
  try {
    const r: any = await parseFile(abs, dir)
    const syms = Array.isArray(r?.symbols) ? r.symbols.length : -1
    return { ok: syms !== -1, symbols: syms, err: "" }
  } catch (e: any) {
    return { ok: false, symbols: 0, err: String(e?.message ?? e) }
  }
}

type Row = {
  file: string
  exists: boolean
  bytes: number
  parsesUnderJSONParse: boolean | null
  runs: number
  trapsInProcess: number
  timeouts: number
  symbolsPerRun: number[]
}

const rows: Row[] = []

// Child-process mode: this invocation IS the child. One parse, one line of JSON, exit.
// Checked BEFORE the loops, or a child would recurse into the whole census.
const oneIdx = argv.indexOf("--one")
if (oneIdx >= 0) {
  const a = await attempt(argv[oneIdx + 1], argv[oneIdx + 2])
  process.stdout.write(JSON.stringify(a) + "\n")
  process.exit(0)
}

if (SAME_PROCESS) {
  // All files, all runs, ONE process and therefore one WASM instance per language slot.
  for (const rel of [...CANDIDATES, CONTROL]) {
    const repo = repoOf(rel)
    const dir = path.join(CR, repo)
    const abs = path.join(dir, rel.split("/").slice(1).join("/"))
    if (!existsSync(abs)) {
      rows.push({ file: rel, exists: false, bytes: 0, parsesUnderJSONParse: null, runs: 0, trapsInProcess: 0, timeouts: 0, symbolsPerRun: [] })
      continue
    }
    const syms: number[] = []
    let traps = 0
    for (let i = 0; i < RUNS; i++) {
      const a = await attempt(abs, dir)
      if (a.ok) syms.push(a.symbols)
      else traps++
    }
    let jsonOk: boolean | null = null
    try {
      JSON.parse(readFileSync(abs, "utf8"))
      jsonOk = true
    } catch {
      jsonOk = false
    }
    rows.push({ file: rel, exists: true, bytes: statSync(abs).size, parsesUnderJSONParse: jsonOk, runs: RUNS, trapsInProcess: traps, timeouts: 0, symbolsPerRun: syms })
  }
} else {
  // One child process per (file, run): a trap in one run cannot affect another.
  const self = path.resolve(process.argv[1])
  for (const rel of [...CANDIDATES, CONTROL]) {
    const repo = repoOf(rel)
    const dir = path.join(CR, repo)
    const sub = rel.split("/").slice(1).join("/")
    const abs = path.join(dir, sub)
    if (!existsSync(abs)) {
      rows.push({ file: rel, exists: false, bytes: 0, parsesUnderJSONParse: null, runs: 0, trapsInProcess: 0, timeouts: 0, symbolsPerRun: [] })
      continue
    }
    const syms: number[] = []
    let traps = 0
    let timeouts = 0
    for (let i = 0; i < RUNS; i++) {
      let out = ""
      try {
        const budget = statSync(abs).size > 200_000 ? 400_000 : 90_000
        out = execFileSync("npx", ["tsx", self, "--one", abs, dir], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: budget })
      } catch (e: any) {
        // A fresh process pays WASM init plus the engine's own 30 s analyzer budget. The
        // 250 KB otp control is ~249 s of work, so it is given its own budget below and a
        // timeout here is reported as a TIMEOUT, never counted as a parse.
        if (e?.code === "ETIMEDOUT" || e?.signal === "SIGTERM") timeouts++
        else traps++
        continue
      }
      const line = out.trim().split("\n").pop() ?? ""
      if (line.includes('"ok":true')) {
        // Parse the child's JSON rather than regexing a number out of it. The line is
        // already known to be a JSON object carrying `"ok":true`, so the field is
        // reachable as a field — and reading it as a field means a child that renamed or
        // nested the number yields `undefined` (counted -1, as before) instead of
        // silently matching a DIFFERENT number that happens to sit after that text.
        let n = -1
        try {
          const v = (JSON.parse(line) as { symbols?: unknown }).symbols
          if (typeof v === "number") n = v
        } catch {
          n = -1
        }
        syms.push(n)
      } else traps++
    }
    let jsonOk: boolean | null = null
    try {
      JSON.parse(readFileSync(abs, "utf8"))
      jsonOk = true
    } catch {
      jsonOk = false
    }
    rows.push({ file: rel, exists: true, bytes: statSync(abs).size, parsesUnderJSONParse: jsonOk, runs: RUNS, trapsInProcess: traps, timeouts, symbolsPerRun: syms })
  }
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`json parse determinism — ${RUNS} runs per file, ${SAME_PROCESS ? "ONE process (shared WASM instance)" : "one child process per run"}`)
console.log(`corpus: ${CR}`)
console.log("")
console.log(pad("file", 62) + pad("bytes", 10) + pad("JSON.parse", 12) + pad("traps", 7) + "symbols per successful run")
console.log("-".repeat(120))
for (const r of rows) {
  console.log(
    pad(r.file, 62) +
      pad(r.exists ? String(r.bytes) : "ABSENT", 10) +
      pad(r.parsesUnderJSONParse === null ? "-" : r.parsesUnderJSONParse ? "ok" : "FAILS", 12) +
      pad(`${r.trapsInProcess}/${r.runs}`, 7) +
      pad(r.timeouts ? `+${r.timeouts} to` : "", 7) +
      (r.symbolsPerRun.length ? [...new Set(r.symbolsPerRun)].join(",") : "-"),
  )
}
const present = rows.filter((r) => r.exists)
const anyTrap = present.filter((r) => r.trapsInProcess > 0)
const nondet = anyTrap.filter((r) => r.trapsInProcess < r.runs)
console.log("")
const to = present.filter((r) => r.timeouts > 0)
console.log("")
console.log(`files present ${present.length}/${rows.length}   trapped at least once ${anyTrap.length}   of those NONDETERMINISTIC ${nondet.length}   timed out ${to.length}`)
if (!anyTrap.length) console.log("VERDICT: every named file parsed on every run — the trap is not reproducible on these files by this route.")
else if (!nondet.length) console.log("VERDICT: traps are REPRODUCIBLE per file (explanation A) — a file-level property.")
else console.log("VERDICT: at least one file traps on SOME runs and not others — the trap is a property of the RUN (explanation B), so a single sample is not a measurement.")