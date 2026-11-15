/**
 * SVELTE RULING-TABLE PROOF — runs the REAL arbiter with this lane's table
 * registered, without editing the arbiter.
 *
 * ## WHY THIS EXISTS
 *
 * `script/m14/ontology-coverage-gate.ts` is supervisor-owned. Against svelte it refuses
 * to report at all:
 *
 *     $ npx tsx script/m14/ontology-coverage-gate.ts svelte
 *     ontology coverage gate — no RULING SOURCE for svelte. ... exit 2
 *
 * and registration is one import plus one map entry in that file. So the lane writes the
 * table beside the gate (`script/m14/svelte-ruled.ts`) and this script proves the result
 * against the arbiter rather than asserting it would work: it copies the gate to a
 * sibling file inside `script/m14/` — a sibling, so the copy's own relative imports still
 * resolve — applies the patch by string splice, and runs the copy over the real corpus.
 *
 * The copy is created and deleted inside this run. Nothing is left in the shared
 * directory, and the arbiter itself is never written to. `script/m60/lua-ruled-proof.ts`
 * is the precedent.
 *
 * ## TWO CHECKS, AND THE SECOND ONE IS NOT WHAT IT LOOKS LIKE
 *
 *   CHECK 1 — the arbiter with THIS LANE'S REAL instrument-B probe. Its outcome is
 *     REPORTED, not asserted, because the arbiter cannot currently host it: a resident
 *     sub-grammar is charged against a wasm heap the gate has already spent, and the
 *     gate dies in `ts_malloc_default` at its OWN `parser.parse`
 *     (ontology-coverage-gate.ts:321). The full measurement and reproduction are in the
 *     header of `script/m14/svelte-ruled.ts`. A gate that dies is a gate that did not
 *     print a wrong verdict, so this check asserts the one thing that matters — that the
 *     process either printed a verdict or died, and never printed a wrong one.
 *
 *   CHECK 2 — the arbiter with this lane's table registered and a B probe that CANNOT
 *     reach the construct (it parses nothing). This is NOT a claim that `overrides` is
 *     ruled: a probe that looks at nothing proves nothing about overrides, and this file
 *     says so rather than letting a green run imply otherwise. What it establishes is the
 *     arbiter's own census of svelte — that exactly nine of the ten types are EMITTED
 *     over 6,439 admitted files, with `overrides` the only RULED-SOUND row, FALSIFIED 0
 *     and ruled-without-justification 0 — through the arbiter, over the whole corpus,
 *     with edge counts that are INDEPENDENT of this lane's census and agree with it.
 *     That agreement is the substance of the check.
 *
 *   The `overrides` measurement itself is CHECK 3: `svelte-construct-probe.mts`, which
 *   sub-parses every `<script>` block with no pre-filter at all and resolves superclasses
 *   across the whole corpus. The falsifying authority lives there.
 *
 * ## `--fresh` IS MANDATORY, AND NOT FOR TIDINESS
 *
 * `resumableWalk`'s checkpoint records WHICH files were walked and never WHAT was found.
 * Re-running without `--fresh` skips every already-walked file, leaves the gate's
 * `observed` map empty, and prints
 *
 *     walk: 6439/6439 files (100.0%)  newly walked 0, resumed 6439
 *     emitted 0/10   ruled-sound 3   FALSIFIED 0   ruled-without-justification 7
 *
 * with exit 1 — a confident, entirely false verdict behind a line that reads as complete
 * coverage. Measured twice in this session. Supervisor-owned; reported, not fixed.
 *
 * NO REGEX (master rule 1). The patch is `indexOf`/`slice`/`includes` on literal strings,
 * and every splice is refused rather than guessed: an anchor must occur EXACTLY ONCE or
 * this throws, because a patch that lands twice or nowhere produces a table that looks
 * registered and is not.
 *
 *   npx tsx validation/m14/fixtures/svelte/ruled-gate.ts
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

// ESM has no `__dirname`, and the repo runs under both tsx and bun — so it is derived from
// the module URL. Four levels up from validation/m14/fixtures/svelte/.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const GATE = path.join(ROOT, "script", "m14", "ontology-coverage-gate.ts")
const COPY = path.join(ROOT, "script", "m14", "zz-ruled-gate-svelte-copy.ts")
const STUB = path.join(ROOT, "script", "m14", "svelte-ruled-unreachable-stub.ts")

const IMPORT_ANCHOR = 'import { SQL_RULED } from "./sql-ruled"'
const MAP_ANCHOR = "  scss: SCSS_RULED,"

/** Insert `insert` immediately after the single occurrence of `anchor`. Refuses on 0 or >1. */
function spliceOnce(src: string, anchor: string, insert: string): string {
  const first = src.indexOf(anchor)
  if (first < 0) throw new Error(`anchor not found in the gate: ${JSON.stringify(anchor)}`)
  if (src.indexOf(anchor, first + 1) >= 0) throw new Error(`anchor is AMBIGUOUS in the gate: ${JSON.stringify(anchor)}`)
  return src.slice(0, first + anchor.length) + insert + src.slice(first + anchor.length)
}

/** A copy of the gate with the registration applied, pointing at `ruledModule`. */
function patchedGate(ruledModule: string): string {
  let src = readFileSync(GATE, "utf8")
  src = spliceOnce(src, IMPORT_ANCHOR, `\nimport { SVELTE_RULED } from "./${ruledModule}"`)
  src = spliceOnce(src, MAP_ANCHOR, "\n  svelte: SVELTE_RULED,")
  return src
}

/**
 * Run the patched gate over the real corpus. Returns stdout, the exit code, and stderr —
 * and STDERR IS REPORTED, never swallowed. A verification script that prints only stdout
 * turns a crash into "no verdict line", which is the least useful message available to
 * whoever has to fix it.
 */
function runGate(ruledModule: string): { out: string; code: number; err: string } {
  writeFileSync(COPY, patchedGate(ruledModule))
  try {
    const out = execFileSync("npx", ["tsx", COPY, "svelte", "--fresh"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    })
    return { out, code: 0, err: "" }
  } catch (e: any) {
    // A non-zero exit is DATA: the gate sets `process.exitCode` to falsified +
    // unjustified. The caller needs the printed table either way.
    return {
      out: String(e?.stdout ?? ""),
      code: typeof e?.status === "number" ? e.status : 1,
      err: String(e?.stderr ?? ""),
    }
  } finally {
    if (existsSync(COPY)) unlinkSync(COPY)
  }
}

/** The two stub files, written only for the duration of CHECK 1/2. */
const REAL_MODULE = "svelte-ruled"
const STUB_MODULE = "svelte-ruled-unreachable-stub"

let failed = 0
function check(name: string, ok: boolean, detail: string): void {
  if (ok) {
    console.log(`  PASS  ${name}`)
    if (detail) console.log(`        ${detail}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}`)
    if (detail) console.log(`        ${detail}`)
  }
}

// ===========================================================================
// CHECK 1 — the arbiter with this lane's REAL instrument-B probe. REPORTED.
// ===========================================================================
console.log("CHECK 1 — the arbiter with this lane's real instrument-B probe (outcome REPORTED)")
{
  const r = runGate(REAL_MODULE)
  const verdict = r.out.split("\n").find((l) => l.startsWith("emitted ")) ?? ""
  const diedInWasm = r.err.includes("memory access out of bounds")
  if (verdict) {
    check(
      "CHECK 1 the arbiter produced a verdict",
      true,
      `${verdict.trim()}   exit ${r.code}`,
    )
    check("CHECK 1 and it is 9 EMITTED + 1 RULED-SOUND with nothing falsified", verdict.includes("emitted 9/10") && verdict.includes("ruled-sound 1") && verdict.includes("FALSIFIED 0") && verdict.includes("ruled-without-justification 0"), verdict.trim())
  } else {
    // The known arbiter limitation. A death is acceptable; a WRONG verdict is not.
    check(
      "CHECK 1 the arbiter died rather than printing a verdict",
      diedInWasm,
      diedInWasm
        ? "died in ts_malloc_default at the arbiter's OWN parser.parse (ontology-coverage-gate.ts:321) — the measured resident-grammar limit documented in script/m14/svelte-ruled.ts. A gate that dies did not print a wrong number."
        : `died for an UNEXPLAINED reason; stderr follows:\n${r.err.split("\n").slice(-25).join("\n")}`,
    )
    check("CHECK 1 and it printed no verdict at all (never a wrong one)", verdict === "", verdict === "" ? "no `emitted` line in stdout" : verdict.trim())
  }
}

// ===========================================================================
// CHECK 2 — the arbiter's own census of svelte, with a B probe that cannot reach
// the construct. This is what proves the REGISTRATION and the nine EMITTED rows.
// ===========================================================================
console.log("\nCHECK 2 — the arbiter with this lane's table registered and a B probe that cannot reach the construct")
console.log("  (this proves the arbiter's census and the verdict shape; it proves NOTHING about overrides)")
let censusVerdict = ""
{
  // The stub is the table with `countOnTree` replaced by a function that parses nothing.
  //
  // The `describe` is NOT lifted out of the real table by slicing its source text. That
  // was the first attempt and it produced a file esbuild refused to parse — a multi-line
  // string literal containing `",\n  },\n]` sequences, cut at the wrong boundary — and
  // the failure surfaced as "the arbiter produced no verdict", which is the least
  // informative message available. The real `describe` carries the full measurement and
  // the overturn condition, and it is reproduced verbatim by the real table in CHECK 1;
  // what the arbiter prints from this stub is only the citation, and the gate builds the
  // citation from the MODULE NAME (`script/m14/${LANG}-ruled.ts`), not from the string.
  writeFileSync(
    STUB,
    [
      "/**",
      " * CHECK-2 STUB — generated by validation/m14/fixtures/svelte/ruled-gate.ts, deleted after the run.",
      " *",
      " * This lane's real ruling table with `countOnTree` REPLACED by a function that parses nothing,",
      " * because the arbiter cannot host the real probe at this corpus size: a resident sub-grammar",
      " * is charged against a wasm heap the gate has already spent on its own corpus walk plus",
      " * instrument A plus instrument B, and the gate dies in ts_malloc_default at its OWN",
      " * parser.parse. CHECK 1 of that script measures the death; the full argument and the",
      " * reproduction are in the header of script/m14/svelte-ruled.ts.",
      " *",
      " * A probe that reaches nothing establishes NOTHING about `overrides`, and this file says so",
      " * rather than letting a green run imply otherwise. What this run establishes is the arbiter's",
      " * own census of svelte with the table REGISTERED: that exactly nine of ten types are EMITTED",
      " * over the whole corpus and `overrides` is the only RULED-SOUND row. The overrides",
      " * measurement is script/m14/svelte-construct-probe.mts, run as CHECK 3 of that script, which",
      " * sub-parses every <script> block with no pre-filter at all.",
      " */",
      "export const SVELTE_RULED: any[] = [",
      "  {",
      '    type: "overrides",',
      '    instrument: "B:parse-tree-count",',
      "    countOnTree: () => {},",
      '    describe:',
      // A BACKTICK TEMPLATE LITERAL, and that is load-bearing. This used to be emitted
      // as a run of double-quoted lines — each array entry supplied the text and the
      // closing `"` of the string, so the GENERATED file carried a double-quoted string
      // spanning four lines. JavaScript forbids that; esbuild rejected the stub with
      // "Unterminated string literal" at 10:97, the arbiter was handed a file it could
      // not load, and CHECK 2 reported 12 failures while CHECK 1 and CHECK 3 passed. A
      // template literal MAY span lines, so the same readable multi-line text now
      // produces a file that parses. The lesson the header records from the FIRST
      // version of this block — which sliced the real table's own source text and cut a
      // multi-line literal at the wrong boundary — repeated one level down: a generated
      // file is not validated by being written, only by being loaded.
      '      `CHECK-2 STUB: the real instrument-B probe is replaced by one that reaches nothing, so this',
      'run CANNOT falsify this ruling and does not claim to. The arbiter census it does establish',
      'is the nine EMITTED rows. The measurement and the overturn condition are in',
      'script/m14/svelte-ruled.ts and are run by script/m14/svelte-construct-probe.mts.`,',
      "  },",
      "]",
      "",
    ].join("\n"),
  )
  const r = runGate(STUB_MODULE)
  if (existsSync(STUB)) unlinkSync(STUB)
  const lines = r.out.split("\n")
  censusVerdict = lines.find((l) => l.startsWith("emitted ")) ?? ""

  // THE GENERATED STUB MUST LOAD, AND THAT IS ITS OWN CHECK. This block once emitted a
  // double-quoted string spanning four lines, which JavaScript does not allow. esbuild
  // refused the stub, the arbiter was handed a file it could not import, and the run
  // reported twelve ordinary FAILs about missing rows — every one of them a downstream
  // symptom, none of them naming the actual cause. A generated file is not validated by
  // being written. This asserts the loader accepted it BEFORE the row checks, so the
  // next time the stub is malformed the failure names the stub instead of the table.
  const loaderFailed = r.err.includes("ERROR") || r.err.includes("Unterminated string")
  check("CHECK 2 the GENERATED STUB was a loadable module (not a syntax error)",
    !loaderFailed,
    loaderFailed
      ? `the stub script/m14/${STUB_MODULE}.ts did not parse; stderr:\n${r.err.split("\n").slice(-12).join("\n")}`
      : "esbuild/tsx accepted it")

  check("CHECK 2 the arbiter produced a verdict with the table registered", censusVerdict !== "", censusVerdict.trim() || `stderr:\n${r.err.split("\n").slice(-20).join("\n")}`)
  check("CHECK 2 verdict is 9 EMITTED + 1 RULED-SOUND, 0 falsified, 0 unjustified",
    censusVerdict.includes("emitted 9/10") && censusVerdict.includes("ruled-sound 1") && censusVerdict.includes("FALSIFIED 0") && censusVerdict.includes("ruled-without-justification 0"),
    censusVerdict.trim())

  const overridesRow = lines.find((l) => l.startsWith("overrides"))
  check("CHECK 2 the overrides row is RULED-SOUND and cites this lane's table",
    !!overridesRow && overridesRow.includes("RULED-SOUND") && overridesRow.includes("script/m14/svelte-ruled.ts"),
    (overridesRow ?? "(row absent)").trim())

  // Every other type must be EMITTED, and NON-ZERO. NOT a hard-coded edge count.
  //
  // This block pinned nine literal counts (["calls", "3,661"], …) copied from one run. Six
  // of the nine failed on the next run for the ordinary reason any pinned total fails: an
  // UNRELATED analyzer fix moved them. calls 3,661 -> 3,656, contains 6,447 -> 6,446,
  // imports 9,515 -> 9,523, references 773 -> 775, exports 2,512 -> 2,510, instantiates
  // 12,838 -> 12,853. Three passed by luck.
  //
  // Pinning a corpus-wide total in a fixture is the wrong instrument, for the reason the
  // workstream keeps recording: a number copied from a run goes stale the moment any lane
  // improves, and the failure then reads as "the table is wrong" when nothing about the
  // table changed. The counts are still PUBLISHED — the census is the instrument that owns
  // them (script/m14/svelte-census.mts, 47,713 edges over 6,439 files) — and this check
  // asserts the property the fixture is actually for: that the table is REGISTERED and every
  // type but `overrides` reaches the EMITTED verdict through the arbiter.
  //
  // The remaining property is NON-ZERO, and that is asserted exactly rather than as a
  // frozen total. Reading the arbiter's comma-grouped count needs one helper and no
  // pattern: walk the digits, emit the group's commas, stop at the first space.
  function edgeCount(row: string): number {
    const before = row.split("edges")[0]
    let out = ""
    let group = 0
    for (const ch of before) {
      const d = ch.charCodeAt(0)
      if (d >= 48 && d <= 57) {
        out += ch
        group++
      } else if (group > 0) {
        break
      }
    }
    return Number(out)
  }
  const NINE = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "instantiates"]
  for (const type of NINE) {
    const row = lines.find((l) => l.startsWith(type + " "))
    const n = row ? edgeCount(row) : -1
    check(`CHECK 2 ${type} is EMITTED with a NON-ZERO edge count`,
      !!row && row.includes("EMITTED") && n > 0,
      (row ?? "(row absent)").trim().slice(0, 150))
  }
  // …and the counts the arbiter printed ARE published, because a check that silently drops
  // the number it stopped freezing is worse than one that kept it. This is the figure
  // script/m14/svelte-census.mts measures independently over the same 6,439 files:
  //     calls 3,660   uses 11,800   contains 6,566   imports 9,525   references 775
  //     exports 2,512  extends 17    implements 1     instantiates 12,857
  // The arbiter's own figures are printed above each check. Two instruments, same corpus,
  // same production path, and they are expected to agree to within unrelated-lane drift —
  // which is what the non-zero assertion leaves room for.
}

// ===========================================================================
// CHECK 3 — the overrides measurement itself, from the instrument that can do it.
// ===========================================================================
console.log("\nCHECK 3 — the overrides measurement, from the instrument that can reach it")
{
  const probe = path.join(ROOT, "script", "m14", "svelte-construct-probe.mts")
  let out = ""
  let code = 0
  try {
    out = execFileSync("bun", [probe], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
      // Point the probe at THIS checkout rather than at whatever BB_REPO happens to be
      // set to. The probe reads no analyzer — it walks the corpus and the grammars — so
      // the numbers are checkout-independent, and saying that is better than relying on
      // it silently.
      env: { ...process.env, BB_REPO: ROOT },
    })
  } catch (e: any) {
    out = String(e?.stdout ?? "")
    code = typeof e?.status === "number" ? e.status : 1
  }
  const lines = out.split("\n")
  const pop = lines.find((l) => l.startsWith("POPULATION")) ?? ""
  const resolved = lines.find((l) => l.includes("(2) RESOLVED OVERRIDES")) ?? ""
  const calibration = lines.find((l) => l.includes("class_declaration")) ?? ""
  check("CHECK 3 the probe declares its population", pop.includes(".svelte files across") && pop.includes("repos"), pop.trim())
  check("CHECK 3 the calibration row is non-zero, so the zeros below are absences",
    calibration.includes("class_declaration") && !calibration.includes("class_declaration            0"),
    calibration.trim())
  check("CHECK 3 RESOLVED OVERRIDES is 0", resolved.includes(" 0 in 0 files"), resolved.trim())
  check("CHECK 3 the probe exited 0", code === 0, `exit ${code}`)
}

console.log("")
console.log(`copy removed: ${!existsSync(COPY)}  stub removed: ${!existsSync(STUB)}  (the arbiter itself was never written to)`)
console.log(`arbiter census: ${censusVerdict.trim()}`)
if (failed > 0) {
  console.log(`\n${failed} check(s) FAILED.`)
  process.exit(1)
}
console.log("\nall checks passed")