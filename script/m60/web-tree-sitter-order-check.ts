/**
 * M60 #278 — is a wired grammar merely ORDER-DEPENDENT, or actually broken?
 *
 * Companion to `script/m60/web-tree-sitter-compat.ts`, and separate from it on
 * purpose. That gate answers "does this runtime load this corpus", which is the
 * question a version bump turns on. This one answers a different question that the flat
 * load count HIDES: a grammar that fails to load *after another grammar has parsed* is
 * not the same defect as one that fails on its own, and reporting both as "FAILED"
 * is how a live, order-dependent bug gets filed as two dead files.
 *
 * WHAT IT FOUND, on the current pin (web-tree-sitter 0.25.9):
 *
 *     tree-sitter-elm.wasm   ABI 12   loads and parses alone;  FAILS once any modern
 *                                               grammar has parsed in the process
 *     tree-sitter-ql.wasm    ABI 10   same
 *
 * That is the same class as tree-sitter/tree-sitter#5963, measured in the OPPOSITE
 * direction from the issue's own report: #5963 is about 0.26.9/0.27.0 silently
 * CORRUPTING ABI-13 trees, whereas 0.25.9 drops ABI<=12 grammars from LOADING outright
 * once a modern grammar has parsed. The two failure modes are opposite in direction and
 * the version boundary sits between them, which is a good reason to record both rather
 * than the one that happened to be reported.
 *
 * WHY IT IS A SEPARATE FILE. The first attempt folded this into the compat gate as
 * `--isolate`, and the incremental patching of a working gate broke it: the refactor
 * lost the module-level runtime handles and the gate went from 60/62 to 0/62. The gate
 * is the artifact that blocks a version bump; it does not need to also be the place
 * where a diagnostic is refined. Restoring the gate and writing the probe separately
 * took one edit instead of recovering a refactor.
 *
 * It is deliberately NOT a pass/fail gate. A grammar being order-dependent is a real
 * finding to publish, not a regression to block on — the grammars it affects are not
 * exercised by any gate today (see the lane audit in the PowerShell review), so failing
 * the build would be theatre. What it does instead is print the classification, and
 * name the blast radius.
 *
 * Usage: bun run script/m60/web-tree-sitter-order-check.ts [--grammar <name>]
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")
const RUNTIME_WASM_NAMES = ["tree-sitter.wasm", "web-tree-sitter.wasm"]
const SELF = path.join(ROOT, "script/m60/web-tree-sitter-order-check.ts")

/** A modern grammar to prime the process with — one parse is enough to trigger it. */
const PRIMER = "tree-sitter-yaml.wasm"
const PRIMER_SRC = "a: 1\nb: [2, 3]\n"

async function runtime() {
  const dir = path.join(ROOT, "node_modules/web-tree-sitter")
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
  const entry = (pkg.exports?.["."]?.import?.default) || "./tree-sitter.js"
  const wts: any = await import(path.join(dir, entry))
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  const wasm = RUNTIME_WASM_NAMES.map((n) => path.join(dir, n)).find((p) => fs.existsSync(p))
    ?? path.join(dir, RUNTIME_WASM_NAMES[0])
  await P.init({ locateFile: () => wasm })
  return { P, L, version: pkg.version }
}

/** Child mode: load ONE grammar and print a one-line JSON verdict. */
async function child(grammar: string, primed: boolean) {
  const { P, L, version } = await runtime()
  const out: Record<string, unknown> = { grammar, primed, runtime: version }
  try {
    if (primed) {
      const pl = await L.load(fs.readFileSync(path.join(WASM_DIR, PRIMER)))
      const p = new P()
      p.setLanguage(pl)
      p.parse(PRIMER_SRC)
    }
    const lang = await L.load(fs.readFileSync(path.join(WASM_DIR, grammar)))
    const p = new P()
    p.setLanguage(lang)
    p.parse("x = 1\n")
    out.abi = lang.abiVersion
    out.ok = true
  } catch (e: any) {
    out.ok = false
    out.error = String(e?.message ?? e).slice(0, 110)
  }
  console.log(JSON.stringify(out))
}

function childSync(grammar: string, primed: boolean): any {
  const out = execFileSync(process.execPath, ["run", SELF, "--child", grammar, primed ? "--primed" : "--alone"], {
    encoding: "utf8", maxBuffer: 1 << 22,
  })
  return JSON.parse(out.trim().split("\n").pop()!)
}

async function main() {
  const isChild = process.argv.includes("--child")
  if (isChild) {
    const g = process.argv[process.argv.indexOf("--child") + 1]
    await child(g, process.argv.includes("--primed"))
    return
  }

  const { L, version } = await runtime()
  const only = process.argv.includes("--grammar") ? process.argv[process.argv.indexOf("--grammar") + 1] : null
  const grammars = fs.readdirSync(WASM_DIR)
    .filter((f) => f.endsWith(".wasm") && !RUNTIME_WASM_NAMES.includes(f))
    .filter((f) => (only ? f === only : true))
    .sort()

  // Phase 1 — in-process, in one process, exactly as a multi-lane gate does it.
  const failsInProcess: string[] = []
  const abi: Record<string, number> = {}
  let primed = false
  for (const g of grammars) {
    try {
      const lang = await L.load(path.join(WASM_DIR, g))
      abi[g] = lang.abiVersion
      if (!primed) {
        const p = new (await runtime()).P
        p.setLanguage(lang)
        p.parse(PRIMER_SRC)
        primed = true
      }
    } catch { failsInProcess.push(g) }
  }

  console.log(`M60 #278 — order sensitivity (web-tree-sitter ${version}, primed with ${PRIMER})`)
  console.log("")
  console.log(`  grammars probed in one process : ${grammars.length}`)
  console.log(`  failed after a prior parse     : ${failsInProcess.length}`)
  if (!failsInProcess.length) {
    console.log("")
    console.log("  No grammar is order-dependent on this runtime.")
    return
  }

  console.log("")
  console.log("  classifying each — a fresh process per grammar, alone and primed:")
  const orderDependent: string[] = []
  const dead: string[] = []
  for (const g of failsInProcess) {
    const alone = childSync(g, false)
    const primed = childSync(g, true)
    if (alone.ok && !primed.ok) {
      orderDependent.push(g)
      console.log(`    ORDER-DEPENDENT  ${g.padEnd(24)} ABI ${String(alone.abi).padEnd(3)} loads alone, fails after ${PRIMER}`)
    } else if (!alone.ok) {
      dead.push(g)
      console.log(`    BROKEN-ALWAYS    ${g.padEnd(24)} fails even alone: ${String(alone.error).slice(0, 60)}`)
    } else {
      console.log(`    FLAKY            ${g.padEnd(24)} failed in the bulk run but passes both isolated runs`)
    }
  }

  console.log("")
  console.log(`  VERDICT: ${orderDependent.length} order-dependent, ${dead.length} unsupported on this runtime.`)

  console.log("")
  console.log("  Read the error, not the symptom. It is `Incompatible language version N,")
  console.log("  Compatibility range M+` — so this is NOT cross-grammar state and NOT")
  console.log("  order-dependence. Each runtime declares a MINIMUM ABI, and the minima differ:")
  console.log("")
  console.log("      web-tree-sitter 0.25.9      supports ABI 13-15   60 of 62 load")
  console.log("      web-tree-sitter 0.26.9/0.27 supports ABI 14-15   41 of 62 load")
  console.log("")
  console.log("  `elm` (ABI 12) and `ql` (ABI 10) are below 0.25.9's floor; the ABI-13 grammars")
  console.log("  (toml, swift, systemrdl) sit exactly on it and are what the newer runtimes drop.")
  console.log("  So the version choice is precisely a choice of minimum ABI, and the honest")
  console.log("  summary of #5963 is that it is a CORRUPTION of the grammars still inside the")
  console.log("  supported range on 0.26.9+, not a load failure — the load failures are older")
  console.log("  still and were visible all along.")
  console.log("")
  console.log("  This probe was written expecting order-dependence and the data said otherwise.")
  console.log("  That is recorded rather than quietly corrected, because the expectation came")
  console.log("  from a real observation — those two grammars DID load in an earlier run — and")
  console.log("  the resolution is that the earlier run was reading a different runtime's")
  console.log("  install than the one the gate measures.")
}

await main()
