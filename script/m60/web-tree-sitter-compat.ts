/**
 * M60 #278 — web-tree-sitter COMPATIBILITY gate.
 *
 * WHY THIS EXISTS. "Should we upgrade web-tree-sitter?" is a question this repo had
 * been answering by opinion, and the answer was wrong in both directions. Measured
 * against this repository's OWN 62 wired grammars, with the SAME wasm bytes on both
 * sides:
 *
 *   web-tree-sitter 0.25.9  (the current pin)   60 of 62 grammars load    2 fail
 *   web-tree-sitter 0.26.9                       41 of 62 grammars load   21 fail
 *   web-tree-sitter 0.27.0                       41 of 62 grammars load   21 fail
 *
 * So the upgrade does not merely add the silent ABI-13 corruption of
 * tree-sitter/tree-sitter#5963 — it makes nineteen further grammars fail to LOAD
 * outright, among them typescript, tsx, javascript, java, go, ruby, json, html, vue,
 * solidity, zig, ocaml, swift, toml and systemrdl. A version bump is therefore a
 * REGRESSION on this corpus, and the honest recommendation is to stay on 0.25.9 until
 * upstream changes that.
 *
 * This file exists so the next time the question is asked, it is answered by running
 * something. Three versions of "the pin" have now been on this repo's path, and a
 * number attributed to a version string is worth nothing next to a number attributed to
 * a load attempt against 62 real files.
 *
 * WHAT IT DOES, and what it deliberately does not claim.
 *
 * It loads every wired `.wasm` under the INSTALLED runtime and reports which load. It
 * does NOT compare parse results between versions: tree shape and error recovery
 * differ across runtime versions even where every grammar loads — measured separately
 * for PowerShell at 9% of files disagreeing in BOTH directions (see
 * `script/m60/powershell-runtime-skew.ts`). A green load matrix is a NECESSARY
 * condition for a bump and not a sufficient one, and the gate says so rather than
 * letting a green row imply more than it measured.
 *
 * It resolves the runtime entry point and the runtime wasm name FROM THE INSTALLED
 * PACKAGE, because 0.26.9+ renamed both (`tree-sitter.js` → `web-tree-sitter.js`,
 * `tree-sitter.wasm` → `web-tree-sitter.wasm`). A compatibility gate that only works on
 * one version of the thing it is testing is not a compatibility gate.
 *
 * Usage:
 *   bun run script/m60/web-tree-sitter-compat.ts            # report + diff vs baseline
 *   bun run script/m60/web-tree-sitter-compat.ts --write    # record the current result
 *
 * Exit 0 when no grammar that loaded before has stopped loading, or when a previously
 * failing grammar now loads (that is an improvement, and this is an adoption signal).
 * Exit 1 on a REGRESSION, so the gate can block a bump rather than comment on it.
 */
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")
const BASELINE = path.join(ROOT, "validation/m60/results/web-tree-sitter-compat.json")
const RUNTIME_WASM_NAMES = ["tree-sitter.wasm", "web-tree-sitter.wasm"]

function resolveEntry(mod: any, pkg: any): string {
  const imp = pkg?.exports?.["."]?.import
  return (typeof imp === "string" ? imp : imp?.default) ?? "./tree-sitter.js"
}

async function main() {
  const entryDir = path.join(ROOT, "node_modules/web-tree-sitter")
  const pkg = JSON.parse(fs.readFileSync(path.join(entryDir, "package.json"), "utf8"))
  // Resolve the entry point BEFORE importing. 0.25.9 ships `tree-sitter.js`; 0.26.9+
  // ships `web-tree-sitter.js`. The first version of this file hardcoded the old path
  // and therefore could not even RUN on the version it exists to evaluate — which is
  // the most embarrassing possible failure for a compatibility gate, and the reason the
  // resolution is written down here rather than left implicit.
  const entry = resolveEntry(null, pkg)
  const wts: any = await import(path.join(entryDir, entry))
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  // 0.25.9 ships tree-sitter.wasm; 0.26.9+ ships web-tree-sitter.wasm. Resolve, do
  // not assume — a gate that only runs on one version tests nothing.
  const runtimeWasm =
    RUNTIME_WASM_NAMES.map((n) => path.join(entryDir, n)).find((p) => fs.existsSync(p)) ??
    RUNTIME_WASM_NAMES.map((n) => path.join(ROOT, "node_modules/web-tree-sitter", n)).find((p) => fs.existsSync(p)) ??
    path.join(entryDir, RUNTIME_WASM_NAMES[0])
  await P.init({ locateFile: () => runtimeWasm })

  const grammars = fs
    .readdirSync(WASM_DIR)
    // Exclude EVERY known runtime-wasm name, not just the current one: the repo keeps
    // `tree-sitter.wasm` in wasm/ and 0.26.9+ names its own copy `web-tree-sitter.wasm`,
    // so filtering on the installed name alone let the runtime's own artifact be counted
    // as a GRAMMAR — and the first simulated bump reported it as a 22nd failure.
    .filter((f) => f.endsWith(".wasm") && !RUNTIME_WASM_NAMES.includes(f))
    .sort()

  const loaded: string[] = []
  const failed: { grammar: string; error: string }[] = []
  const abi: Record<string, number> = {}
  for (const g of grammars) {
    try {
      const lang = await L.load(path.join(WASM_DIR, g))
      abi[g] = lang.abiVersion
      loaded.push(g)
    } catch (e: any) {
      failed.push({ grammar: g, error: String(e?.message ?? e).slice(0, 160) })
    }
  }

  const result = {
    runtime: pkg.version,
    entryPoint: resolveEntry(null, pkg),
    runtimeWasm: path.basename(runtimeWasm),
    grammars: grammars.length,
    loaded: loaded.length,
    failed: failed.sort((a, b) => a.grammar.localeCompare(b.grammar)),
    abiByGrammar: abi,
    abiHistogram: Object.entries(
      loaded.reduce<Record<string, number>>((acc, g) => {
        const k = String(abi[g]); acc[k] = (acc[k] ?? 0) + 1; return acc
      }, {}),
    ).sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, n]) => ({ abi: Number(k), count: n })),
  }

  const hasFlag = process.argv.includes("--write")
  let regressed = false
  let improved = 0
  let previous: any = null
  if (fs.existsSync(BASELINE)) {
    try { previous = JSON.parse(fs.readFileSync(BASELINE, "utf8")) } catch { previous = null }
  }

  console.log(`M60 #278 — web-tree-sitter compatibility`)
  console.log("")
  console.log(`  installed runtime : ${pkg.version}   entry ${result.entryPoint}   runtime wasm ${result.runtimeWasm}`)
  console.log(`  wired grammars    : ${grammars.length}`)
  console.log(`  LOAD ok           : ${loaded.length}`)
  console.log(`  LOAD failed       : ${failed.length}`)
  console.log(`  ABI histogram     : ${result.abiHistogram.map((h) => `ABI${h.abi}×${h.count}`).join("  ")}`)
  if (failed.length) {
    console.log("")
    for (const f of failed) console.log(`    FAILED  ${f.grammar}  —  ${f.error}`)
  }

  if (previous) {
    const prevFailed = new Set((previous.failed ?? []).map((f: any) => f.grammar))
    const nowFailed = new Set(failed.map((f) => f.grammar))
    const newFailures = [...nowFailed].filter((g) => !prevFailed.has(g)).sort()
    const fixed = [...prevFailed].filter((g) => !nowFailed.has(g)).sort()
    improved = fixed.length
    console.log("")
    console.log(`  vs recorded baseline (${previous.runtime}): ${previous.loaded} loaded, ${(previous.failed ?? []).length} failed`)
    if (newFailures.length) {
      regressed = true
      console.log(`  *** REGRESSION — ${newFailures.length} grammar(s) that loaded now FAIL:`)
      for (const g of newFailures) console.log(`        ${g}`)
    }
    if (fixed.length) console.log(`  ADOPTION SIGNAL — ${fixed.length} previously-failing grammar(s) now load: ${fixed.join(", ")}`)
    if (!newFailures.length && !fixed.length) console.log(`  no change against the baseline`)
  } else {
    console.log("")
    console.log("  no baseline recorded — run with --write to record this result")
  }

  if (hasFlag) {
    fs.writeFileSync(BASELINE, JSON.stringify(result, null, 1))
    console.log("")
    console.log(`  wrote ${path.relative(ROOT, BASELINE)}`)
  }

  console.log("")
  console.log("  A green load matrix is NECESSARY for a bump, not sufficient: tree shape and")
  console.log("  error recovery also differ across runtime versions even where every grammar")
  console.log("  loads. See script/m60/powershell-runtime-skew.ts for that second half.")
  process.exit(regressed ? 1 : 0)
}

await main()
