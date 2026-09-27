// script/m60/measure-runtime-stragglers.ts — MEASURE which shipped grammars
// block a web-tree-sitter upgrade, instead of recording how many do.
//
// WHY THIS FILE EXISTS. The migration note in the survey said, in full:
//
//   "moving this pin to 0.27.0 breaks 20 of 55 shipped grammar wasms"
//   phaseA: { runtime0270: { failures: 20 } }
//
// A COUNT, with no list. That is not a measurement, it is a number someone typed,
// and it is the single most consequential claim in the whole migration plan: the
// 20 unnamed lanes are the entire scope of M63. Nothing downstream could check
// it, so nothing downstream did, and the plan proceeded on a number that no
// artifact in this repo could reproduce. The sibling field
// `runtime0259.failures` DID carry a list — the two elms — so the omission was
// visible in the shape of the data.
//
// THE MECHANISM IS A CLAIM TOO. The recorded cause is that 0.27.0 calls
// getDylinkMetadata() and refuses a grammar wasm lacking the newer emscripten
// `dylink.0` custom section. A wasm built by CLI 0.26.9 carries it and loads on
// BOTH runtimes, so the migration is a REBUILD, not a version bump. That is a
// testable prediction with a sharp edge: if the dylink scan and the load test
// disagree about which lanes break, the mechanism story is wrong and the whole
// "rebuild instead of bump" plan is built on a false cause.
//
// So this measures three INDEPENDENT things and ASSERTS they agree:
//
//   1. LOAD on the pinned runtime 0.25.9        (the baseline: must be 53/55)
//   2. LOAD on the candidate runtime 0.27.0     (ground truth for the blocker)
//   3. BINARY SCAN for the `dylink.0` section   (the stated mechanism)
//
//   assert  {fails on 0.27.0} == {lacks dylink.0}
//
// Three methods, one expected agreement. If they disagree the script FAILS rather
// than reporting a difference, because a silent disagreement is exactly the class
// of defect this repo's gates exist to kill. `elm` and `ql` are the declared
// exception: they fail on 0.25.9 too, so they are a pre-existing condition, not
// an upgrade blocker, and the gate says so out loud instead of folding them in.
//
// WHY THE LOAD TEST RUNS IN CHILD PROCESSES. Two copies of the same package
// cannot be imported into one process reliably — the emscripten module is
// initialised per copy and Bun dedupes aggressively. So each runtime gets its own
// child, and the parent merges. A measurement whose own harness could perturb the
// thing it measures is not a measurement.
//
// NO NETWORK. Both runtimes are resolved from disk; 0.27.0 is fetched once by
// the caller into an isolated prefix and its path is passed in. If that path is
// absent the script reports the candidate as UNMEASURED and exits non-zero rather
// than falling back to the pinned runtime — a fallback here would quietly answer
// a different question than the one asked.

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const WASM_DIR = path.join(ROOT, "wasm")
const OUT_DIR = path.join(ROOT, "validation", "m60", "results")
const OUT = path.join(OUT_DIR, "M60.0.runtime-stragglers.json")
const SELF = path.resolve(import.meta.filename ?? process.argv[1]!)

const PINNED = "0.25.9"
const CANDIDATE = "0.27.0"

// ---------------------------------------------------------------- child mode

const childMode = process.argv.includes("--load-only")
if (childMode) {
  const i = process.argv.indexOf("--runtime-path")
  const runtimePath = process.argv[i + 1]
  const outFile = process.argv[process.argv.indexOf("--out") + 1]
  const mod: any = await import(pathToFileURLShim(runtimePath)).catch(() => null)
  if (!mod) {
    writeFileSync(outFile, JSON.stringify({ error: `cannot import ${runtimePath}` }, null, 2))
    process.exit(2)
  }
  const Parser = mod.Parser ?? mod.default ?? mod
  const Language = mod.Language ?? mod.default?.Language
  const initFn = mod.init ?? Parser.init ?? mod.default?.init
  try {
    await initFn?.()
  } catch (e: any) {
    writeFileSync(outFile, JSON.stringify({ error: `init failed: ${e?.message ?? e}` }, null, 2))
    process.exit(2)
  }
  const results: Record<string, { ok: boolean; error?: string; abi?: number | null; nodeTypes?: number | null }> = {}
  const coreArg = process.argv.includes("--core-path") ? process.argv[process.argv.indexOf("--core-path") + 1] : ""
  if (coreArg) {
    // The ENGINE's real load path: `init({ locateFile })` pointed at the repo's own
    // `wasm/tree-sitter.wasm`, not at whatever core the package happens to bundle.
    // initFn was already called above, so this is applied on a re-init.
    try {
      await initFn({ locateFile() { return coreArg } })
    } catch (e: any) {
      writeFileSync(outFile, JSON.stringify({ error: `init with core ${coreArg} failed: ${e?.message ?? e}` }, null, 2))
      process.exit(2)
    }
  }
  for (const f of readdirSync(WASM_DIR).filter((f) => f.endsWith(".wasm")).sort()) {
    if (f === "tree-sitter.wasm") continue
    try {
      const bytes = readFileSync(path.join(WASM_DIR, f))
      // `Language.load` is ASYNC (the engine awaits it at src/ast/engine.ts:1081). Without
      // the await, setLanguage receives a Promise and every grammar reports
      // "Argument must be a Language" — 61/61 failures, all of them this bug.
      const lang: any = await Language.load(bytes)
      // `Language.load()` is LAZY. The sabotage control proved it: a truncated wasm,
      // a clobbered magic number and a scrambled payload all "loaded" without
      // throwing, so a harness that stops at load() reports 61/61 for a tree full of
      // garbage. The module is only really compiled and validated when it is
      // INSTANTIATED and USED, so the load is forced here — attach it to a parser and
      // parse. Until this was added, the honest result was "0 stragglers" and it was
      // a measurement of nothing at all.
      const probe = new Parser()
      if (typeof probe.setLanguage === "function") probe.setLanguage(lang)
      else probe.language = lang
      const tree = probe.parse("x")
      tree?.delete?.()
      probe.delete?.()
      results[f] = {
        ok: true,
        // The ABI/language version the binding reports is the number that actually
        // gates grammar-vs-core compatibility, so it is recorded rather than inferred
        // from a section name.
        abi: typeof lang?.version === "number" ? lang.version : null,
        nodeTypes: typeof lang?.nodeTypeCount === "number" ? lang.nodeTypeCount : null,
      }
    } catch (e: any) {
      results[f] = { ok: false, error: String(e?.message ?? e).slice(0, 200) }
    }
  }
  writeFileSync(outFile, JSON.stringify({ runtime: mod.__version ?? null, core: coreArg || "(bundled)", results }, null, 2))
  process.exit(0)
}

function pathToFileURLShim(p: string) {
  return "file://" + p.replace(/\\/g, "/")
}

// ------------------------------------------------- binary dylink.0 presence

// A wasm module is a chain of sections: id (1 byte) + size (varuint32) + payload.
// Section id 0 is CUSTOM, and its payload begins with the section NAME as a
// varuint32 length + bytes. Emscripten's linker emits the shared-library metadata
// as a custom section literally named "dylink.0". So walking the chain and
// reading custom-section names is the whole job — no wasm parser needed, and no
// assumption that a parse of a malformed module would be trustworthy anyway.
function uleb(buf: Buffer, pos: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  for (let i = 0; i < 5; i++) {
    if (pos + i >= buf.length) return null
    const byte = buf[pos + i]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: pos + i + 1 }
    shift += 7
  }
  return null
}

type Section = { id: number; name: string | null; offset: number; size: number }

function wasmSections(buf: Buffer): Section[] | null {
  if (buf.length < 8) return null
  if (buf.readUInt32LE(0) !== 0x6d736100) return null // "\0asm" magic
  const out: Section[] = []
  let pos = 8
  while (pos < buf.length) {
    const id = buf[pos]
    const size = uleb(buf, pos + 1)
    if (!size) return null
    const body = pos + 1 + (size.next - (pos + 1))
    if (body + size.value > buf.length) return null
    let name: string | null = null
    if (id === 0) {
      const n = uleb(buf, body)
      if (n && body + n.next + n.value <= buf.length) {
        name = buf.subarray(n.next, n.next + n.value).toString("utf8")
      }
    }
    out.push({ id, name, offset: body, size: size.value })
    pos = body + size.value
  }
  return out
}

// BOTH names are read, because the data says the split is not "has section" vs
// "has none": 40 wasms carry `dylink.0` and 21 carry the older plain `dylink`.
// The first version of this scan only looked for `dylink.0` and so reported the 21
// as having NO dylink section at all, which reads as "these were built with no
// linker metadata" and is simply not what the bytes say.
function dylinkScan(file: string): { dylink0: boolean; dylinkLegacy: boolean; customSections: string[]; parsed: boolean } {
  let buf: Buffer
  try {
    buf = readFileSync(file)
  } catch {
    return { dylink0: false, dylinkLegacy: false, customSections: [], parsed: false }
  }
  const secs = wasmSections(buf)
  if (!secs) return { dylink0: false, dylinkLegacy: false, customSections: [], parsed: false }
  const names = secs.filter((s) => s.id === 0 && s.name).map((s) => s.name as string)
  return { dylink0: names.includes("dylink.0"), dylinkLegacy: names.includes("dylink"), customSections: names, parsed: true }
}

// ------------------------------------------------------------- parent driver

function runLoad(runtimePath: string, label: string, outFile: string, corePath?: string): { error?: string; results?: Record<string, any> } {
  if (!runtimePath || !existsSync(runtimePath)) return { error: `runtime not found on disk: ${runtimePath || "(not supplied)"}` }
  const argv = [SELF, "--load-only", "--runtime-path", runtimePath, "--out", outFile]
  if (corePath) argv.push("--core-path", corePath)
  const r = spawnSync(process.execPath, argv, { encoding: "utf8", timeout: 300_000 })
  if (r.status !== 0 && !existsSync(outFile)) return { error: `child exited ${r.status}: ${(r.stderr ?? "").slice(0, 300)}` }
  try {
    return JSON.parse(readFileSync(outFile, "utf8"))
  } catch {
    return { error: `unreadable child output: ${(r.stderr ?? "").slice(0, 300)}` }
  }
}

// ---------------------------------------------------------------- control
//
// A HARNESS THAT CANNOT DETECT A FAILURE CANNOT CERTIFY A "0 FAILURES" RESULT.
// This is the same discipline the provenance instrument needed: before believing a
// clean answer, feed the harness something whose answer is known and check it
// reports what it must. A truncated wasm and a wasm with a corrupted body both
// have to fail to load on BOTH runtimes. If either loads, the result below is
// meaningless and this script says so rather than reporting zero stragglers.
//
// The temptation this guards against is the comfortable one: a harness that
// reports everything-OK is indistinguishable from a working harness until you
// try to make it fail on purpose.
const SABOTAGE: Array<{ name: string; mutate: (b: Buffer) => Buffer }> = [
  { name: "truncated-half", mutate: (b) => b.subarray(0, Math.floor(b.length / 2)) },
  { name: "magic-clobbered", mutate: (b) => { const c = Buffer.from(b); c.writeUInt32LE(0xdeadbeef, 0); return c } },
  { name: "payload-scrambled", mutate: (b) => { const c = Buffer.from(b); for (let i = 64; i < c.length; i += 997) c[i] = c[i] ^ 0xff; return c } },
]

function sabotageControl(runtimePath: string, outFile: string): { checked: number; wronglyLoaded: string[]; note: string } {
  const wronglyLoaded: string[] = []
  let checked = 0
  const victim = readFileSync(path.join(WASM_DIR, "tree-sitter-javascript.wasm"))
  for (const s of SABOTAGE) {
    const broken = path.join(outFile + "." + s.name + ".wasm")
    writeFileSync(broken, s.mutate(victim))
    checked++
    const r = runLoad(runtimePath, s.name, path.join(outFile + "." + s.name + ".json"))
    const res = r.results?.[path.basename(broken)]
    if (!res) {
      // The harness only enumerates wasm/, so an out-of-tree file is not offered to
      // it at all. Load the broken file directly instead of expecting enumeration.
      const direct = loadOne(runtimePath, broken)
      if (direct.ok) wronglyLoaded.push(s.name)
    } else if (res.ok) {
      wronglyLoaded.push(s.name)
    }
  }
  return { checked, wronglyLoaded, note: "each mutation must FAIL to load on every runtime; a mutation that loads means the harness cannot detect failure" }
}

function loadOne(runtimePath: string, file: string): { ok: boolean; error?: string } {
  const probe = path.join(path.dirname(file), ".probe." + path.basename(file))
  const r = spawnSync(process.execPath, ["-e", PROBE_SRC, runtimePath, file, probe], { encoding: "utf8", timeout: 60_000 })
  if (existsSync(probe)) {
    try { return JSON.parse(readFileSync(probe, "utf8")) } finally { }
  }
  return { ok: false, error: `probe did not report: ${(r.stderr ?? "").slice(0, 200)}` }
}

const PROBE_SRC = `
const [rt, file, out] = process.argv.slice(1)
const mod = await import("file://" + rt)
const Parser = mod.Parser ?? mod.default ?? mod
const Language = mod.Language ?? mod.default?.Language
const initFn = mod.init ?? Parser.init ?? mod.default?.init
try { await initFn?.() } catch {}
let res
try {
  const lang = await Language.load(require("fs").readFileSync(file))
  const probe = new Parser()
  if (typeof probe.setLanguage === "function") probe.setLanguage(lang); else probe.language = lang
  const t = probe.parse("x"); t?.delete?.(); probe.delete?.()
  res = { ok: true }
} catch (e) { res = { ok: false, error: String(e?.message ?? e).slice(0, 200) } }
require("fs").writeFileSync(out, JSON.stringify(res))
`

mkdirSync(OUT_DIR, { recursive: true })
const tmpDir = path.join(OUT_DIR, ".straggler-load")
mkdirSync(tmpDir, { recursive: true })

const argv = process.argv.slice(2)
const candArg = argv.includes("--candidate-runtime") ? argv[argv.indexOf("--candidate-runtime") + 1] : undefined
// The two releases do NOT agree on an entry filename, which is why this is
// resolved rather than guessed: 0.25.9 ships `tree-sitter.js` (its own package
// name) and 0.27.0 renamed it to `web-tree-sitter.js`. Hardcoding one path and
// passing it for both silently measures the same runtime twice, which would make
// the straggler count 0 and look like good news.
function resolveRuntime(dir: string, candidates: string[]): string {
  for (const c of candidates) {
    const p = path.join(dir, c)
    if (existsSync(p)) return p
  }
  return path.join(dir, candidates[0])
}
const pinnedRuntime = resolveRuntime(path.join(ROOT, "node_modules", "web-tree-sitter"), ["tree-sitter.js", "web-tree-sitter.js"])

const wasmFiles = readdirSync(WASM_DIR)
  .filter((f) => f.endsWith(".wasm") && f !== "tree-sitter.wasm")
  .sort()
  .map((f) => path.join(WASM_DIR, f))

const base = path.basename

console.log(`runtime stragglers — ${wasmFiles.length} shipped grammar wasm(s)\n`)

// A SINGLE runtime/candidate pair is the wrong shape of experiment. The engine does
// not use the core that the package happens to bundle: `src/ast/engine.ts` calls
// `init({ locateFile })` pointing at the repo's own `wasm/tree-sitter.wasm`. So
// "does 0.27.0 work?" has three different answers depending on which core is loaded
// against it, and measuring only one of them is how a count like 20 gets recorded
// and never reproduced. The migration's real shape is PROFILE 2: the new runtime
// with the core the repo already pins.
const repoCore = path.join(WASM_DIR, "tree-sitter.wasm")
const profiles: Array<{ label: string; runtime: string; core?: string; role: string }> = [
  { label: `P1 today: ${PINNED} + repo core`, runtime: pinnedRuntime, core: repoCore, role: "the baseline. Every shipped grammar must load here or the tree is already broken." },
  { label: `P2 migration: ${CANDIDATE} + repo core`, runtime: candArg ?? "", core: repoCore, role: "THE migration shape — new runtime, existing pinned core. This is the number M63's scope is supposed to be." },
  { label: `P3 candidate self-consistent: ${CANDIDATE} + its own core`, runtime: candArg ?? "", role: "runtime matched to its own core. Isolates 'runtime upgrade' from 'core upgrade'." },
]

const results: Record<string, any> = {}
for (const [i, p] of profiles.entries()) {
  console.log(`  [${i + 1}/3] LOAD ${p.label} ...`)
  if (p.runtime && !existsSync(p.runtime)) {
    console.error(`  MEASUREMENT FAILED for ${p.label}: runtime not found: ${p.runtime || "(not supplied)"}`)
    console.error("  This script does NOT substitute another runtime: a substitution answers a different question than the one asked.")
    process.exit(2)
  }
  const r = runLoad(p.runtime, p.label, path.join(tmpDir, `p${i + 1}.json`), p.core)
  if (r.error) {
    console.error(`  MEASUREMENT FAILED for ${p.label}: ${r.error}`)
    process.exit(2)
  }
  const ok = wasmFiles.map((f) => base(f)).filter((f) => r.results![f]?.ok)
  const failed = wasmFiles.map((f) => base(f)).filter((f) => !r.results![f]?.ok)
  const abis = new Map<string, Set<number>>()
  for (const f of wasmFiles) {
    const v = r.results![base(f)]?.abi
    if (typeof v === "number") abis.set(base(f), new Set([v]))
  }
  results[p.label] = { ...p, results: r.results, ok, failed, abiSeen: [...abis.values()].map((s) => [...s][0]) }
  console.log(`      ok ${ok.length}/${wasmFiles.length}${failed.length ? `   FAILED: ${failed.join(", ")}` : ""}`)
  const abiVals = [...new Set([...abis.values()].map((s) => [...s][0]))].sort()
  if (abiVals.length) console.log(`      ABI versions seen: ${abiVals.join(", ")}`)
}

console.log("\n  CONTROL — can this harness detect a failure at all? ...")
const ctrl = [
  { rt: pinnedRuntime, name: `${PINNED} + repo core` },
  { rt: candArg ?? "", name: `${CANDIDATE} + bundled core` },
]
const controlFindings: Array<{ runtime: string; checked: number; wronglyLoaded: string[] }> = []
for (const c of ctrl) {
  if (!c.rt || !existsSync(c.rt)) { controlFindings.push({ runtime: c.name, checked: 0, wronglyLoaded: ["<runtime absent — control not run>"] }); continue }
  const s = sabotageControl(c.rt, path.join(tmpDir, "sabotage." + c.name.replace(/\W+/g, "_") + ".json"))
  controlFindings.push({ runtime: c.name, checked: s.checked, wronglyLoaded: s.wronglyLoaded })
  console.log(`      ${c.name}: ${s.checked} mutations, ${s.wronglyLoaded.length} wrongly LOADED ${s.wronglyLoaded.length ? "-> " + s.wronglyLoaded.join(", ") : ""}`)
}
const controlBroken = controlFindings.filter((c) => c.wronglyLoaded.length > 0)

console.log("\n  BINARY SCAN for the emscripten dylink custom section ...")
const scan: Record<string, { dylink0: boolean; dylinkLegacy: boolean; customSections: string[]; parsed: boolean }> = {}
let unparsed = 0
for (const f of wasmFiles) {
  const s = dylinkScan(f)
  scan[base(f)] = s
  if (!s.parsed) unparsed++
}
const withDylink0 = Object.keys(scan).filter((k) => scan[k].dylink0).length
const withLegacyDylink = Object.keys(scan).filter((k) => scan[k].dylinkLegacy).length
console.log(`     ${withDylink0} carry dylink.0 (newer emscripten);  ${withLegacyDylink} carry plain dylink (older);  ${unparsed} unparsable`)
const lacksDylink0 = Object.keys(scan).filter((k) => scan[k].parsed && !scan[k].dylink0)
const unparsable = wasmFiles.map((f) => base(f)).filter((f) => !scan[f].parsed)

const p1 = results[profiles[0].label]
const p2 = results[profiles[1].label]
const p3 = results[profiles[2].label]

const preExisting = p1.failed
const stragglers = p2.failed.filter((f) => !preExisting.includes(f))
const onlyOnOwnCore = p3.failed.filter((f) => !p2.failed.includes(f))

console.log(`\n  P1 today  (${PINNED} + repo core)  failures: ${p1.failed.length}  ${p1.failed.join(", ") || "(none)"}`)
console.log(`  P2 migration (${CANDIDATE} + repo core) failures: ${p2.failed.length}`)
console.log(`  P3 candidate + own core           failures: ${p3.failed.length}`)
console.log(`  of P2's failures, PRE-EXISTING (already broken today, NOT upgrade blockers): ${p2.failed.filter((f) => preExisting.includes(f)).length}  ${p2.failed.filter((f) => preExisting.includes(f)).join(", ") || "(none)"}`)
console.log(`  UPGRADE STRAGGLERS (break only when the runtime is swapped, core unchanged): ${stragglers.length}`)
for (const s of stragglers) console.log(`    ${s}`)
if (onlyOnOwnCore.length) console.log(`  fixed by ALSO upgrading the core (P3 recovers): ${onlyOnOwnCore.join(", ")}`)

// ------------------------------------------------------------- the assertions

const problems: string[] = []

// A1 — THE HARNESS MUST BE ABLE TO FAIL. Checked FIRST and treated as fatal. A
// measurement that cannot detect a failure cannot certify a clean one, and every
// other assertion below is worthless if this one fails. This is the check the
// previous version of this script did not have, and it is the reason its
// "0 failures, cause falsified" result needed re-measuring before it could be
// believed in either direction.
if (controlBroken.length) {
  problems.push(
    `A1 HARNESS BLIND — the load harness reported SUCCESS on a deliberately broken module.\n` +
      controlBroken.map((c) => `     ${c.runtime}: ${c.wronglyLoaded.join(", ")} loaded when it must not`).join("\n") +
      `\n     Every load result below is untrustworthy. Fix the harness before reading anything else.`,
  )
}

// A2 — THE RECORDED COUNT MUST BE REPRODUCIBLE OR RETRACTED. The survey claims
// `phaseA.runtime0270.failures: 20` of 55. A count with no list is a number
// someone typed: no artifact could reproduce it, so nothing ever checked it, and
// M63's entire scope is sized by it. A list can be produced now, so the number is
// either reproduced or retracted — and either way this gate says which, loudly.
const recorded = { total: 20, of: 55 }
if (stragglers.length !== recorded.total) {
  const treeGrew = wasmFiles.length - recorded.of
  problems.push(
    `A2 RECORDED COUNT NOT REPRODUCIBLE — the survey records phaseA.runtime0270.failures: ${recorded.total} of ${recorded.of}.\n` +
      `     measured today: ${stragglers.length} UPGRADE straggler(s) and ${p2.failed.length} total ${CANDIDATE} failure(s)\n` +
      `     (the ${preExisting.length} pre-existing: ${preExisting.join(", ") || "none"}), over ${wasmFiles.length} shipped wasms — ${treeGrew > 0 ? `${treeGrew} more than when it was recorded` : "the same count"}.\n` +
      `     A count nobody can reproduce is not a measurement. Restate the survey's 20 as this list, or\n` +
      `     retract it with a reason. M63 is sized by this number.`,
  )
}

// A2b — CALIBRATION AGAINST A KNOWN RECORDED ANSWER. The survey also records the
// pinned runtime's baseline: 53 of 55 loading, failing exactly elm + ql. If this
// harness does not reproduce THAT, then it does not have its calibration right and
// no other number it produces is worth reading. The tree has grown, so the ok-count
// is not compared — the two NAMED failures are, because names are the part that
// cannot drift by accident.
const recordedBaselineFailures = ["tree-sitter-elm.wasm", "tree-sitter-ql.wasm"]
const baselineAgrees =
  preExisting.length === recordedBaselineFailures.length &&
  recordedBaselineFailures.every((f) => preExisting.includes(f))
if (!baselineAgrees) {
  problems.push(
    `A2b HARNESS NOT CALIBRATED — the survey records the pinned runtime failing exactly\n` +
      `     ${recordedBaselineFailures.join(" + ")}; this harness finds ${preExisting.length}: ${preExisting.join(", ") || "(none)"}.\n` +
      `     A harness that cannot reproduce a previously recorded answer cannot be trusted with a new one.`,
  )
}

// A3 — THE CAUSE, COMPARED CORRECTLY. The recorded mechanism is that 0.27.0 calls
// getDylinkMetadata() and refuses a grammar wasm without the newer `dylink.0`
// section, which is why the plan is "rebuild, don't bump". That predicts
// {fails on the candidate runtime} == {shipped wasms lacking dylink.0} EXACTLY.
//
// The first version of this assertion compared CANDIDATE FAILURES against
// dylink-less wasms and called the 2-grammar gap a falsification. It was not: the
// gap is exactly `elm` and `ql`, which fail on the PINNED runtime too, so they
// never needed dylink.0 to work. The correspondence holds once the pre-existing
// failures are named rather than averaged away — and a gate that reports
// "cause falsified" when the cause is confirmed, because of an off-by-pre-existing,
// is worse than no gate, because it invites someone to "fix" a cause that is fine.
const a = new Set(p2.failed)
const b = new Set(lacksDylink0)
const onlyFails = p2.failed.filter((f) => !b.has(f))
const onlyLacks = lacksDylink0.filter((f) => !a.has(f))
const causeHolds = onlyFails.length === 0 && onlyLacks.length === 0
if (!causeHolds) {
  problems.push(
    `A3 CAUSE FALSIFIED — {0.27.0 load failures} != {wasms lacking dylink.0}.\n` +
      `     fails but carries dylink.0: ${onlyFails.join(", ") || "(none)"}\n` +
      `     lacks dylink.0 yet loads:   ${onlyLacks.join(", ") || "(none)"}\n` +
      `     The "rebuild, don't bump" plan rests on this cause. If it is false, rebuilding fixes nothing.`,
  )
} else if (preExisting.some((f) => !b.has(f))) {
  problems.push(
    `A3b CAUSE/EXCEPTION OVERLAP — a pre-existing failure carries dylink.0, so "pre-existing" and\n` +
      `     "dylink-less" are not independent sets and the straggler arithmetic would double-count: ${preExisting.filter((f) => !b.has(f)).join(", ")}`,
  )
}

// A4 — the baseline must hold, or every count above is noise. The survey records
// exactly two pre-existing failures on the pinned runtime (elm, ql). If the tree has
// moved, say so loudly: the straggler arithmetic is a DIFFERENCE against this
// baseline, and a moved baseline means the difference means something else.
if (preExisting.length !== 2 || !preExisting.includes("tree-sitter-elm.wasm") || !preExisting.includes("tree-sitter-ql.wasm")) {
  problems.push(
    `A4 BASELINE MOVED — the survey records the pinned runtime failing exactly elm + ql; today it fails ${preExisting.length}: ${preExisting.join(", ") || "(none)"}.\n` +
      `     Stragglers are computed as a DIFFERENCE against this baseline, so a moved baseline\n` +
      `     changes what the number means. Restate the recorded baseline before trusting any count.`,
  )
}

// A5 — an unparsable module cannot support any claim about it. The scan could not
// read it, so A3 is unproven for it and it must not be counted as agreeing.
// `unparsable` (the ARRAY), not `unparsed` (the COUNT). It was `unparsed.length`, which is
// `undefined` on a number, so the condition was permanently false and A5 NEVER FIRED — an
// assertion that reads as present in the file and is dead at runtime. Found by typechecking
// this file for the first time; the instrument's own control had been checked and this had
// not. An assertion that cannot fail is worse than no assertion, because it is counted.
if (unparsable.length) {
  problems.push(`A5 SCAN COVERAGE — ${unparsable.length} module(s) would not parse, so A3 is unproven for them: ${unparsable.join(", ")}`)
}

if (problems.length) {
  console.error(`\n${problems.join("\n\n")}\n`)
}

const artifact = {
  measuredAt: new Date().toISOString().slice(0, 10),
  purpose:
    "replace the recorded COUNT (phaseA.runtime0270.failures: 20) with a per-wasm LIST that any reader can reproduce, and check the recorded CAUSE against it",
  method: {
    profiles: profiles.map((p) => ({ label: p.label, role: p.role, core: p.core ?? "(package-bundled)" })),
    whyAMatrix:
      "the engine does not use the core its package bundles — src/ast/engine.ts calls init({ locateFile }) with the repo's own wasm/tree-sitter.wasm. 'Does 0.27.0 work?' has three answers depending on the core, and measuring one of them is how a count gets recorded and never reproduced. P2 is the migration's real shape: new runtime, existing pinned core.",
    loadIsForced:
      "Language.load() is LAZY and returns a Promise. The first version of this harness reported 61/61 ok for a tree containing a TRUNCATED wasm, a clobbered magic number and a scrambled payload, because it stopped at load(). Every load here is forced through setLanguage + parse. Without that, this file measures nothing.",
    control:
      "three deliberate corruptions of a working grammar must FAIL to load on every runtime, checked before any result is read. A harness that cannot detect failure cannot certify success — and this one could not, until the forcing was added.",
  },
  harnessControl: {
    mutations: SABOTAGE.map((s) => s.name),
    perRuntime: controlFindings,
    blind: controlBroken.length > 0,
  },
  calibration: {
    question: "does this harness reproduce a PREVIOUSLY RECORDED answer, not just a plausible new one?",
    recordedBaseline: "pinned runtime fails exactly tree-sitter-elm + tree-sitter-ql",
    measuredBaseline: preExisting,
    agrees: baselineAgrees,
  },
  runtimes: { pinned: PINNED, candidate: CANDIDATE, candidatePath: candArg ?? null },
  counts: {
    shippedGrammarWasms: wasmFiles.length,
    pinnedOk: p1.ok.length,
    candidateOk: p2.ok.length,
    candidateTotalFailures: p2.failed.length,
    upgradeStragglers: stragglers.length,
    preExistingFailures: preExisting.length,
    dylink0: withDylink0,
    dylinkLegacy: withLegacyDylink,
  },
  recorded: { phaseA_runtime0270_failures: 20, phaseA_total: 55, reproduced: stragglers.length === 20 },
  upgradeStragglers: stragglers,
  preExistingFailures: preExisting,
  preExistingNote:
    "fails on the PINNED runtime too, so it is a pre-existing condition and NOT an upgrade blocker. Counting these as stragglers would inflate the migration's scope with work that fixes nothing — and would misdescribe a broken grammar as a migration casualty.",
  fixedByAlsoUpgradingTheCore: onlyOnOwnCore,
  mechanism: {
    claim: "0.27.0 calls getDylinkMetadata() and refuses a grammar wasm without the emscripten dylink.0 custom section",
    prediction: "{0.27.0 load failures} == {shipped wasms lacking dylink.0}, exactly",
    holds: causeHolds,
    onlyFailsButHaveDylink: onlyFails,
    lackDylinkButLoad: onlyLacks,
    unparsable,
    note:
      "the 2-grammar gap between this and the STRAGGLER list is exactly the pre-existing failures. They lack dylink.0 AND fail on the pinned runtime, so they never needed the section to work. Comparing the candidate-failure set (not the straggler set) is what makes the correspondence exact.",
  },
  profiles: Object.fromEntries(
    profiles.map((p) => [
      p.label,
      { core: p.core ? path.relative(ROOT, p.core) : "(package-bundled)", ok: results[p.label].ok.length, failed: results[p.label].failed },
    ]),
  ),
  perWasm: Object.fromEntries(
    wasmFiles.map((f) => {
      const n = base(f)
      return [
        n,
        {
          pinned: p1.results[n],
          candidate: p2.results[n],
          candidateOwnCore: p3.results[n],
          dylink0: scan[n].dylink0,
          dylinkLegacy: scan[n].dylinkLegacy,
          customSections: scan[n].customSections,
          parsed: scan[n].parsed,
          straggler: stragglers.includes(n),
        },
      ]
    }),
  ),
  written: path.relative(ROOT, OUT),
}
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")
console.log(`\n  written to ${path.relative(ROOT, OUT)}`)
console.log(`  harness control: ${controlBroken.length ? "BLIND — a broken module loaded" : "sound — every deliberate corruption was rejected"}`)
console.log(`  calibration:    ${baselineAgrees ? "reproduces the recorded elm+ql baseline" : "DOES NOT reproduce the recorded baseline"}`)
console.log(`  cause (dylink.0): ${causeHolds ? "CONFIRMED, exactly — {0.27.0 failures} == {lacking dylink.0}" : "FALSIFIED"}`)
if (problems.length) {
  console.error(`  ${problems.length} assertion(s) failed — see above; exiting non-zero\n`)
  process.exit(1)
}
console.log("  all assertions passed")
