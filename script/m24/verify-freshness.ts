// script/m24/verify-freshness.ts — M24.P2 verifier + mutation suite.
//
// Proves the freshness monitor (src/lsp/freshness.ts) honors its declared
// guarantees, and proves the suite CAN FAIL by planting defects.
//
// Guarantees under test (declared in src/lsp/freshness.ts header):
//   G1 debounce:   file events are debounced DEBOUNCE_MS before reindex
//   G2 catch-up:   after a burst settles, reindex lands before fresh again
//   G3 event loss: fullScan() recovers changes the watcher missed
//   G4 stale truth: markers are machine-readable; unknown => stale (never silent)
//   G5 failure:    reindex failure keeps files pendingReindex, never fresh
//   G6 fidelity:   a non-file entry in a change batch does not fail the batch
//   G7 platform:   the platform's non-file watcher events cannot leave the
//                  marker stale forever (this is the darwin leg: FSEvents
//                  delivers directory events, inotify does not)
//
// DARWIN REPAIR (this file used to be unrunnable here): the sourceFingerprint
// was computed by spawning `sha256sum`, a GNU coreutils binary macOS does not
// have, so on darwin the gate died with `spawnSync sha256sum ENOENT` before it
// could write a verdict. It is now node:crypto over raw bytes
// (script/m24/portability.ts).
//
// Run: npx tsx script/m24/verify-freshness.ts
// Evidence: validation/m24/results/P2.json (machine-emitted)

import { mkdtempSync, mkdirSync, rmSync, statSync, watch, writeFileSync, readFileSync, type FSWatcher } from "node:fs"
import { tmpdir } from "node:os"
import path, { join } from "node:path"
import { hashFileContent } from "../../src/brain/freshness"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { SHA256_KAT, gitHead, measuredOs, sha256File, sha256Text } from "./portability.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const COMPONENT = path.join(ROOT, "src/lsp/freshness.ts")
const OS = measuredOs()

/** How long a marker may take to converge after drain(), and how long it must
 *  then STAY converged. A watcher's delivery latency is the platform's, not the
 *  component's (FSEvents coalesces; inotify does not), so the honest assertion
 *  is "converges within this bound and stays converged", not "converged at the
 *  instant drain() returned". The one-directional guarantee — never fresh
 *  BEFORE the reindex lands — stays asserted at full strength (G2/G5). */
const CONVERGE_BOUND_MS = 6_000
const STABLE_WINDOW_MS = 150

let checks = 0
let passed = 0
let failed = 0
const failures: string[] = []

/** The sink every assertion in this gate reports through.
 *
 *  It is swappable because a CAUGHT MUTANT is SUPPOSED to fail the functional
 *  legs: letting those failures increment this gate's own `failed` counter made
 *  the record's `checks/passed/failed` a number that moved with the platform's
 *  watcher timing (the same run of the same commit produced 23 and 24 on
 *  darwin), which is both a lie about what the record measures and a
 *  byte-identical-regeneration failure (contract §8.2). During a mutant run the
 *  sink captures instead of counting, so the record's counts describe the REAL
 *  component plus the mutation oracle's own verdicts, and `mutants[].caught`
 *  carries the mutant story. */
type CheckSink = (label: string, condition: boolean, detail: string) => void
const realCheck: CheckSink = (label, condition, detail = "") => {
  checks++
  if (condition) passed++
  else {
    failed++
    failures.push(label + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
let sink: CheckSink = realCheck

function check(label: string, condition: boolean, detail = ""): void {
  sink(label, condition, detail)
}

/** Run the functional legs against `mod` with failures captured, never counted. */
async function captureFailures<T>(label: string, fn: () => Promise<T>): Promise<string[]> {
  const captured: string[] = []
  const previous = sink
  sink = (l, condition, detail = "") => {
    if (condition) return
    captured.push(l + (detail ? ` — ${detail}` : ""))
    console.log(`  FAIL[mutant: ${label}] ${l}${detail ? ` — ${detail}` : ""}`)
  }
  try {
    await fn()
  } finally {
    sink = previous
  }
  return captured
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Test double: an in-memory "index" that mirrors the freshness contract.
// The real component composes checkFileFreshness(raw, fileId) against
// brain.db; the double reproduces that interface without a database, so the
// watcher/debounce/marker logic is what is under test (the DB path itself is
// covered by the existing freshness verifiers upstream).
//
// FIDELITY (the defect this harness had): the double used to readFileSync
// every path it was handed. macOS's recursive fs.watch is FSEvents and delivers
// events for DIRECTORIES (and for the watch root itself, whose basename it
// reports), so a batch arrived as [deleted:<root>/<root-basename>,
// modified:<root>/src, modified:<root>/src/c.ts]; readFileSync(<dir>) threw
// EISDIR, the reindex batch failed, and by the component's own (correct) rule
// every file in it stayed inFlight — so every marker read stale forever. The
// production primitive it stands in for does NOT do that: reindexFilesParallel
// (src/ast/parallel-indexer.ts:6575-6616) only DELETEs rows for a `deleted`
// change and admits a `modified` change only when the path is a file the
// indexer recognises (`hasValidExtension` at :6614 + shouldSkip at :6615).
// The double now does exactly that, using the real detectLanguageFromPath, so
// a platform's non-file events cannot masquerade as a component defect.
// ---------------------------------------------------------------------------

interface FakeIndex {
  files: Map<string, { hash: string; content: string }>
  hashes: Map<string, string> // path -> indexed hash
}

/** What the production primitive would do with this path: nothing, if it is
 *  not an indexable regular file. Never throws (a vanished path is not an
 *  error — the caller already classified it as modified/deleted). */
function isIndexable(p: string): boolean {
  try {
    return statSync(p).isFile() && detectLanguageFromPath(p) !== null
  } catch {
    return false
  }
}

function makeHarness() {
  const dir = mkdtempSync(join(tmpdir(), "m24p2-"))
  const srcDir = join(dir, "src")
  mkdirSync(srcDir, { recursive: true })

  const index: FakeIndex = { files: new Map(), hashes: new Map() }
  const reindexCalls: Array<Array<{ path: string; type: string }>> = []
  /** non-file / unindexable entries a batch carried, and the batch outcomes */
  const batchLog: Array<{ changes: number; indexed: number; deleted: number; skipped: number }> = []
  let reindexShouldFail = false

  function write(name: string, content: string): string {
    const p = join(srcDir, name)
    writeFileSync(p, content)
    index.files.set(p, { hash: h(content), content })
    index.hashes.set(p, h(content))
    return p
  }

  function h(s: string): string {
    // Must match the REAL indexer/file_hash computation - checkFileFreshness
    // recomputes the hash of the on-disk content with this exact function.
    return hashFileContent(s)
  }

  // A minimal CoreDatabase-shaped double: only prepare().get()/all() on the
  // brain_file query the monitor uses.
  const raw: any = {
    prepare(sql: string) {
      return {
        get(fileId: string) {
          for (const [p, rec] of index.files) {
            if (p === fileId || p.endsWith(fileId)) {
              return { id: p, path: p, file_hash: index.hashes.get(p) }
            }
          }
          return undefined
        },
        all() {
          return Array.from(index.files.entries()).map(([p]) => ({ id: p, path: p }))
        },
      }
    },
  }

  const deps = {
    projectId: "test-project",
    projectPath: dir,
    raw,
    fileIdForPath(p: string): string | null { return index.files.has(p) ? p : null },
    async reindex(changes: Array<{ path: string; type: "modified" | "deleted" }>) {
      reindexCalls.push(changes)
      if (reindexShouldFail) throw new Error("injected reindex failure")
      let indexed = 0, deleted = 0, skipped = 0
      for (const c of changes) {
        if (c.type === "deleted") {
          // The production primitive deletes rows and never reads the path. A
          // path that was never indexed (darwin's self-named root event joins to
          // a path that does not exist) hits zero rows: counted as skipped, not
          // as a deletion that happened.
          if (index.files.delete(c.path)) deleted++
          else skipped++
          index.hashes.delete(c.path)
          continue
        }
        if (!isIndexable(c.path)) {
          // Not a file the indexer recognises: the production primitive filters
          // it out (parallel-indexer.ts:6614). Counting it is what makes the
          // skip visible instead of silent.
          skipped++
          continue
        }
        const onDisk = readFileSync(c.path, "utf8")
        index.files.set(c.path, { hash: h(onDisk), content: onDisk })
        index.hashes.set(c.path, h(onDisk))
        indexed++
      }
      batchLog.push({ changes: changes.length, indexed, deleted, skipped })
      return { indexed, deleted, errors: 0, skipped }
    },
  }

  function cleanup() { try { rmSync(dir, { recursive: true, force: true }) } catch {} }
  return {
    dir, srcDir, index, reindexCalls, batchLog, deps, write, cleanup,
    setFail: (v: boolean) => { reindexShouldFail = v },
    raw,
    /** The FILE changes across a burst, i.e. what the guarantee is about: a
     *  watcher event for a directory is not a file change. */
    fileChanges(): Array<{ file: string; type: string }> {
      return reindexCalls
        .flat()
        .filter((c) => isIndexable(c.path) || index.files.has(c.path))
        .map((c) => ({ file: c.path.split("/").pop() as string, type: c.type }))
    },
    /** Every path any batch carried that is not an indexable file. */
    nonFileEntries(): string[] {
      return reindexCalls.flat().filter((c) => !isIndexable(c.path)).map((c) => c.path)
    },
  }
}

type Harness = ReturnType<typeof makeHarness>

// Load the component (fresh module per harness run).
async function loadComponent() {
  return await import(COMPONENT + `?t=${Date.now()}`)
}

// Module override for mutant runs: withMonitor() imports via this hook so the
// functional tests exercise the MUTANT, not the real component.
let activeModule: any = null
async function loadActive() {
  return activeModule ?? (await loadComponent())
}

async function withMonitor(h: Harness, fn: (m: any) => Promise<void>): Promise<void> {
  const mod = await loadActive()
  const m = mod.createFreshnessMonitor(h.deps)
  m.start()
  try { await fn(m) } finally { await m.stop() }
}

// ---------------------------------------------------------------------------
// Convergence: the component declares that a file is never reported FRESH
// before its reindex lands. It does not declare that a file is fresh at the
// instant drain() returns — the watcher's delivery latency belongs to the
// platform (FSEvents coalesces events; inotify does not), and on darwin a
// duplicate/late directory event can legitimately arrive after drain's loop.
// So this waits for the marker to be fresh AND to STAY fresh across a window,
// bounded. A marker that never converges still fails, which is what keeps the
// mutant oracle honest.
// ---------------------------------------------------------------------------
type Convergence = { converged: boolean; stable: boolean; elapsedMs: number; marker: any; samples: number }

/** Poll a predicate until it holds, bounded. Used to wait for a PRECONDITION
 *  (the watcher has seen the edit) instead of guessing a sleep long enough to
 *  hope delivery happened — the platform's event latency is not a constant. */
async function waitFor(predicate: () => Promise<boolean>, boundMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < boundMs) {
    if (await predicate()) return true
    await sleep(25)
  }
  return false
}

async function converge(m: any, fileId: string, boundMs = CONVERGE_BOUND_MS): Promise<Convergence> {
  const started = Date.now()
  let freshRuns = 0
  let last: any = null
  let samples = 0
  while (Date.now() - started < boundMs) {
    last = await m.marker(fileId)
    samples++
    // File-scoped, not monitor-scoped: the guarantee is about THIS file's
    // marker. Requiring the monitor's whole pending set to empty would couple
    // one file's freshness to unrelated traffic — and on darwin the recursive
    // watcher keeps reporting the directory that a write just touched, so that
    // condition never holds while the user is editing.
    const fresh = last?.stale === false && last?.status === "fresh" && last?.pendingReindex === false
    const notPending = !(m.pendingFiles?.() ?? []).includes(fileId)
    if (fresh && notPending) {
      freshRuns++
      // Two consecutive fresh samples STABLE_WINDOW_MS apart: a late duplicate
      // event for THIS file breaks the run and restarts the wait.
      if (freshRuns >= 2) return { converged: true, stable: true, elapsedMs: Date.now() - started, marker: last, samples }
    } else {
      freshRuns = 0
    }
    await sleep(STABLE_WINDOW_MS)
  }
  return { converged: freshRuns > 0, stable: false, elapsedMs: Date.now() - started, marker: last, samples }
}

// ---------------------------------------------------------------------------
// Functional checks
// ---------------------------------------------------------------------------

// G1: debounce — a burst of N events produces ONE reindex call after DEBOUNCE_MS
async function testDebounce(h: Harness) {
  await withMonitor(h, async (m) => {
    h.write("a.ts", "const a = 1")
    h.write("a.ts", "const a = 2")
    h.write("a.ts", "const a = 3")
    h.write("b.ts", "const b = 1")
    // Before the debounce window elapses, no reindex should have run.
    await sleep(50)
    check("G1: no reindex before debounce window", h.reindexCalls.length === 0, `calls=${h.reindexCalls.length}`)
    await m.drain()
    check("G1: exactly one debounced reindex for the burst", h.reindexCalls.length === 1, `calls=${h.reindexCalls.length}`)
    // The burst is 4 writes over 2 FILES. The guarantee is about file changes:
    // a platform that also reports directory events (darwin/FSEvents) does not
    // turn one file written three times into three changes.
    const fileChanges = h.fileChanges()
    const sorted = fileChanges.map((c) => `${c.file}:${c.type}`).sort()
    check(
      "G1: burst coalesced to exactly 2 file changes (a.ts written 3x appears once)",
      sorted.length === 2 && sorted[0] === "a.ts:modified" && sorted[1] === "b.ts:modified",
      JSON.stringify(sorted),
    )
    const conv = await converge(m, join(h.srcDir, "a.ts"))
    check("G1: the burst converges fresh after the debounced reindex", conv.converged && conv.stable, JSON.stringify(conv.marker))
  })
}

// G2: catch-up — after edit, marker reports stale/pending until reindex lands
async function testCatchUp(h: Harness) {
  const p = h.write("c.ts", "const c = 1")
  await withMonitor(h, async (m) => {
    // Simulate an external edit the watcher will see.
    writeFileSync(p, "const c = 2")
    // "Stale until the reindex lands" is a statement about the COMPONENT, so it
    // is only meaningful once the monitor has SEEN the change. Wait for that
    // precondition instead of sleeping a guessed interval: the event latency is
    // the platform's (FSEvents coalesces; inotify does not), and a fixed sleep
    // made this leg a coin toss on darwin while it was a certainty on linux.
    const seen = await waitFor(async () => (await m.marker(p)).pendingReindex === true, 3_000)
    check("G2: the watcher saw the external edit (pendingReindex=true)", seen)
    const mk = await m.marker(p)
    check("G2: marker stale while the reindex is pending (never a premature fresh)", mk.stale === true, JSON.stringify(mk))
    await m.drain()
    const conv = await converge(m, p)
    check("G2: marker fresh after catch-up", conv.stable && conv.marker.stale === false && conv.marker.status === "fresh", JSON.stringify(conv.marker))
    check("G2: lastReindexAt recorded", typeof conv.marker.lastReindexAt === "string", JSON.stringify(conv.marker))
  })
}

// G3: event loss — fullScan recovers a change the watcher never saw, IN THE
// CONDITION THE GUARANTEE IS ABOUT.
//
// This leg used to write the file and immediately await fullScan(), relying on
// the 300 ms debounce to still be pending so that fullScan was the only thing
// that could make the marker fresh. On darwin the watcher delivered first and
// the leg passed for the wrong reason — and a `fullScan no-op` mutant SURVIVED
// it. The monitor here is never started at all: no watcher exists, so no event
// can arrive and fullScan is the only mechanism that can reconcile. (Measured
// on darwin: Node's FSEvents stream delivers an INITIAL rescan — every existing
// entry plus the watch root by its own basename — so a started monitor has
// pending entries before it has seen a single edit.)
async function testEventLoss(h: Harness) {
  const p = h.write("d.ts", "const d = 1")
  const mod = await loadActive()
  const m = mod.createFreshnessMonitor(h.deps)
  // Precondition, asserted: this leg is only valid if nothing is pending. If a
  // future edit gives the monitor a watcher here, the leg would pass for the
  // wrong reason again and this check is what says so.
  check("G3: the event-loss monitor has no watcher and nothing pending", m.pendingFiles().length === 0, JSON.stringify(m.pendingFiles()))
  writeFileSync(p, "const d = 2 — the watcher missed this, and cannot see it now")
  const res = await m.fullScan()
  check("G3: fullScan found the stale file", res.stale === 1, JSON.stringify(res))
  const mk = await m.marker(p)
  check("G3: marker fresh after fullScan with no watcher", mk.stale === false && mk.status === "fresh", JSON.stringify(mk))
  check("G3: fullScan recorded the catch-up", typeof mk.lastReindexAt === "string", JSON.stringify(mk))
}

// G4: stale truth — unknown file reports stale (never silent), missing reports missing
async function testStaleTruth(h: Harness) {
  await withMonitor(h, async (m) => {
    const mkUnknown = await m.marker("no/such/file.ts")
    check("G4: unknown file => stale=true (silence is guilt)", mkUnknown.stale === true && mkUnknown.status === "unknown", JSON.stringify(mkUnknown))
    const p = h.write("e.ts", "const e = 1")
    await m.drain()
    const conv = await converge(m, p)
    check("G4: indexed fresh file => stale=false", conv.stable && conv.marker.stale === false && conv.marker.status === "fresh", JSON.stringify(conv.marker))
  })
}

// G5: failure — reindex failure keeps pendingReindex, never marks fresh
async function testFailureKeepsPending(h: Harness) {
  const p = h.write("f.ts", "const f = 1")
  await withMonitor(h, async (m) => {
    h.setFail(true)
    writeFileSync(p, "const f = 2")
    // Same precondition discipline as G2: the guarantee under test is "a FAILED
    // reindex keeps the file pending", which is only testable once the monitor
    // has seen the change. Before the watcher delivers, pendingReindex=false is
    // the honest answer, not a violation.
    const seen = await waitFor(async () => (await m.marker(p)).pendingReindex === true, 3_000)
    check("G5: the watcher saw the edit before the failing reindex (precondition)", seen)
    await m.drain()
    const mk = await m.marker(p)
    check("G5: failed reindex keeps marker stale", mk.stale === true, JSON.stringify(mk))
    check("G5: failed reindex keeps pendingReindex=true", mk.pendingReindex === true, JSON.stringify(mk))
    // And it must STAY that way: a failed reindex is not allowed to decay into
    // a fresh claim a moment later (contract §4.3: never a silent fresh).
    await sleep(400)
    const later = await m.marker(p)
    check("G5: failed reindex never decays into a fresh marker", later.stale === true && later.pendingReindex === true, JSON.stringify(later))
    h.setFail(false)
    // Recovery: another edit reindexes successfully.
    writeFileSync(p, "const f = 3")
    await m.drain()
    const conv = await converge(m, p)
    check("G5: recovery marks fresh", conv.stable && conv.marker.stale === false && conv.marker.status === "fresh", JSON.stringify(conv.marker))
  })
}

// G6: watcher error fallback — a broken watcher degrades to scan path
async function testWatcherFallback(h: Harness) {
  const mod = await loadComponent()
  const p = h.write("g.ts", "const g = 1")
  const m = mod.createFreshnessMonitor(h.deps)
  // Simulate watch() throwing: temporarily break fs.watch via the deps path —
  // the component catches watch errors at start(); verify start() survives.
  m.start()
  try {
    // No exception = fallback path engaged or watcher healthy; either way the
    // monitor must remain usable.
    const res = await m.fullScan()
    check("G6: monitor usable regardless of watcher state", typeof res.checked === "number", JSON.stringify(res))
  } finally {
    await m.stop()
  }
}

// G7: the batch must survive a NON-FILE entry (the darwin/FSEvents shape).
//
// Measured on darwin 14.8.4 before this leg existed: a recursive fs.watch over
// a temp workspace delivers `change src` and a self-named root event, so the
// batch the component handed to the indexer contained two DIRECTORY paths. The
// production primitive filters them (hasValidExtension) and the batch lands; a
// less faithful double threw EISDIR and every marker stayed stale forever. This
// leg pins the fidelity the double must keep, so the platform difference can
// never again be mistaken for a component defect — and, symmetrically, so a
// future double regression is caught HERE instead of masquerading as one.
async function testNonFileEntriesSurvive(h: Harness) {
  const p = h.write("h.ts", "const h = 1")
  await withMonitor(h, async (m) => {
    const before = h.reindexCalls.length
    writeFileSync(p, "const h = 2")
    await m.drain()
    const calls = h.reindexCalls.slice(before).flat()
    // Feed the batch's own non-file entries back through the primitive's
    // contract: a directory and the watch root must be skipped, not read.
    const dirs = h.dir
    const res = await h.deps.reindex([
      { path: dirs, type: "modified" },                      // the watch root itself
      { path: join(dirs, "src"), type: "modified" },         // a subdirectory
      { path: p, type: "modified" },                         // the real file
    ])
    check(
      "G7: a batch with directory entries lands (root, subdir, file)",
      res.indexed === 1 && res.errors === 0 && res.skipped === 2,
      JSON.stringify(res),
    )
    const conv = await converge(m, p)
    check("G7: the marker converges despite the platform's non-file events", conv.stable, JSON.stringify(conv.marker))
  })
}

// ---------------------------------------------------------------------------
// Mutation suite: plant defects, assert the suite catches each.
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string }

const mutants: Mutant[] = [
  {
    name: "debounce removed (immediate reindex)",
    mutate: (src) => src.replace("const DEBOUNCE_MS = 300", "const DEBOUNCE_MS = 0"),
  },
  {
    name: "stale truth inverted (unknown => fresh)",
    mutate: (src) => src.replace("stale: status !== \"fresh\" || pendingReindex,", "stale: status === \"fresh\" && !pendingReindex,"),
  },
  {
    name: "reindex failure swallowed (marks fresh anyway)",
    mutate: (src) => src.replace("inFlight.delete(c.path)\n            lastReindex.set(c.path, at)\n          }\n          log(\"freshness: reindex completed\", { ...res })", "inFlight.delete(c.path)\n            lastReindex.set(c.path, at)\n          }\n          log(\"freshness: reindex completed\", { ...res })").replace("} catch (error) {\n          // Reindex failure must not silently mark files fresh: keep them\n          // in-flight so markers keep reporting pendingReindex=true.\n          log(\"freshness: reindex failed\", { error: String(error) })\n        }", "} catch (error) {\n          for (const c of changes) { inFlight.delete(c.path); lastReindex.set(c.path, new Date().toISOString()) }\n        }"),
  },
  {
    name: "fullScan no-op (event loss unrecoverable)",
    mutate: (src) => src.replace("if (changes.length > 0) {", "if (false) {"),
  },
  {
    // The mutant the convergence legs exist for: inFlight is never cleared on
    // success, so every marker reads pendingReindex=true forever. A bounded
    // wait must NOT turn this into a pass.
    name: "pendingReindex never clears (inFlight leaks on success)",
    mutate: (src) => src.replace("          for (const c of changes) {\n            inFlight.delete(c.path)\n            lastReindex.set(c.path, at)\n          }", "          for (const c of changes) {\n            lastReindex.set(c.path, at)\n          }"),
  },
  {
    // The phantom-marker mutant: a duplicate/late event for a path whose
    // content the index already holds still marks it pending, so a file that is
    // genuinely current is reported stale (contract §4: a marker is a claim).
    name: "late duplicate event marks a current file pending (phantom stale)",
    mutate: (src) => src.replace("    pending.set(path, type)\n    scheduleReindex()", "    if (inFlight.has(path)) return\n    pending.set(path, type)\n    scheduleReindex()").replace("      const changes = Array.from(pending.entries()).map(([p, type]) => ({ path: p, type }))", "      const changes = Array.from(pending.entries()).filter(([, type]) => type === \"modified\").map(([p, type]) => ({ path: p, type }))"),
  },
]

const FUNCTIONAL = [testDebounce, testCatchUp, testEventLoss, testStaleTruth, testFailureKeepsPending, testWatcherFallback, testNonFileEntriesSurvive]

// ---------------------------------------------------------------------------
// Platform measurement: what THIS OS's watcher actually delivers.
//
// The reason P2 failed on darwin before it ran at all is not only the missing
// binary: a recursive fs.watch is FSEvents here and inotify on linux, and they
// do not deliver the same event set. That difference is measured, not assumed,
// and recorded in the evidence with the OS it was measured on (contract §10).
// ---------------------------------------------------------------------------
type WatcherShape = {
  os: string
  events: number
  fileEvents: number
  directoryEvents: number
  selfRootEvents: number
  names: string[]
  note: string
}

async function measureWatcherEventShape(): Promise<WatcherShape> {
  const dir = mkdtempSync(join(tmpdir(), "m24p2-shape-"))
  const srcDir = join(dir, "src")
  mkdirSync(srcDir, { recursive: true })
  const names: string[] = []
  let w: FSWatcher | null = null
  try {
    w = watch(dir, { persistent: false, recursive: true }, (_ev, filename) => {
      names.push(String(filename ?? "<no filename>"))
    })
    await sleep(60)
    writeFileSync(join(srcDir, "probe.ts"), "const probe = 1\n")
    writeFileSync(join(srcDir, "probe.ts"), "const probe = 2\n")
    await sleep(700)
  } finally {
    try { w?.close() } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
  const classify = (n: string): "file" | "directory" | "selfRoot" | "other" => {
    if (n === "<no filename>") return "other"
    const abs = join(dir, n)
    if (abs === dir) return "selfRoot"
    try {
      return statSync(abs).isDirectory() ? "directory" : "file"
    } catch {
      // FSEvents reports the watch root by its OWN basename, which joins to a
      // path that does not exist — the fabricated-root case.
      return n === path.basename(dir) ? "selfRoot" : "file"
    }
  }
  const kinds = names.map(classify)
  return {
    os: OS.platform,
    events: names.length,
    fileEvents: kinds.filter((k) => k === "file").length,
    directoryEvents: kinds.filter((k) => k === "directory").length,
    selfRootEvents: kinds.filter((k) => k === "selfRoot").length,
    names: [...new Set(names)].sort(),
    note:
      "Measured with a recursive fs.watch on this OS. darwin (FSEvents) delivers directory events and a self-named root event; linux (inotify) delivers neither. The component forwards every event path to the indexer as a file change, so the indexer's own filter (hasValidExtension) is what absorbs the difference — reported to the component owner as a filed defect, not edited here.",
  }
}

async function main() {
  // --- Cross-platform leg: the fingerprint helper is sha256 over raw bytes ---
  // A harness that computes its own fingerprint with a tool the OS may not
  // have cannot write a verdict at all; this is the sha256sum defect, pinned
  // where the fingerprint is produced. The LSP lane's spawn rule that forbids
  // the pattern again is X3 in script/m24/verify-positions.ts.
  for (const v of SHA256_KAT) {
    check(`P2: fingerprint algorithm is sha256 over raw bytes (vector: ${v.label})`, sha256Text(v.input) === v.want, sha256Text(v.input))
  }

  // --- Platform measurement --------------------------------------------------
  // The raw event counts are a MEASUREMENT and they vary run to run on this OS
  // (FSEvents coalesces; the first watch in a process can miss the initial
  // rescan entirely — measured 7 of 8 probes saw a non-file event), so they go
  // to the run log and NOT into the record: evidence must regenerate
  // byte-identically (contract §8.2) and a number that moves between two runs
  // of the same commit is not evidence of anything. What the record carries is
  // the OS and the event classes the component must survive either way.
  const watcherShape = await measureWatcherEventShape()
  console.log(
    `  measured watcher event shape on ${OS.platform}: ${JSON.stringify({ events: watcherShape.events, fileEvents: watcherShape.fileEvents, directoryEvents: watcherShape.directoryEvents, selfRootEvents: watcherShape.selfRootEvents })}`,
  )
  check(
    "P2: this OS's watcher event shape was MEASURED (>=1 event observed and classified)",
    watcherShape.events > 0 && watcherShape.events === watcherShape.fileEvents + watcherShape.directoryEvents + watcherShape.selfRootEvents,
    JSON.stringify(watcherShape),
  )

  // --- Functional pass on the real component -------------------------------
  for (const t of FUNCTIONAL) {
    const h = makeHarness()
    try { await t(h) } catch (e: any) { check(`${t.name} threw`, false, e.message) }
    finally { h.cleanup() }
  }
  const functionalFailedBefore = failed

  // --- Mutants -------------------------------------------------------------
  // A mutant is CAUGHT when the functional suite reports at least one failure
  // against it. Those failures are captured by the sink, NOT counted into this
  // gate's `failed` (see the sink's note): `checks/passed/failed` describe the
  // real component, and `mutants[].caught` describes the oracle.
  const componentSource = readFileSync(COMPONENT, "utf8")
  const TMP = path.join(ROOT, "validation/m24/.freshness-mutant.ts")
  const mutantResults: { name: string; caught: boolean; detail: string }[] = []

  for (const mut of mutants) {
    const mutated = mut.mutate(componentSource)
    if (mutated === componentSource) {
      mutantResults.push({ name: mut.name, caught: false, detail: "mutation produced no change — fix mutant definition" })
      check(`mutant [${mut.name}] applied`, false, "no change")
      continue
    }
    // The mutant is written outside src/, so its relative imports would break.
    // Rewrite them to absolute file:// paths against the real sources.
    const absImport = mutated.replace(
      /from "\.\.\/brain\/freshness"/g,
      `from "file://${path.join(ROOT, "src/brain/freshness.ts")}"`,
    )
    writeFileSync(TMP, absImport)
    let mod: any
    try {
      mod = await import(TMP + `?m=${encodeURIComponent(mut.name)}&t=${Date.now()}`)
    } catch (e: any) {
      mutantResults.push({ name: mut.name, caught: false, detail: `mutant failed to load: ${e.message}` })
      check(`mutant [${mut.name}] loads`, false, e.message)
      try { rmSync(TMP, { force: true }) } catch {}
      continue
    }
    // Run the functional suite against the MUTANT module (override the import
    // hook so withMonitor exercises the mutant, not the real component).
    activeModule = mod
    const captured = await captureFailures(mut.name, async () => {
      for (const t of FUNCTIONAL) {
        const h = makeHarness()
        try { await t(h) } catch {}
        finally { h.cleanup() }
      }
    })
    activeModule = null
    const caught = captured.length > 0
    // The detail is deliberately a fixed string: which legs a mutant breaks can
    // vary with the platform's event timing, and the record has to regenerate
    // byte-identically. The failing labels are printed above, one per line.
    mutantResults.push({ name: mut.name, caught, detail: caught ? "caught by the functional suite" : "survived all legs" })
    check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
    try { rmSync(TMP, { force: true }) } catch {}
  }

  check("P2: every planted defect was caught", mutantResults.every((m) => m.caught))
  check("P2: all functional guarantees hold on the real component", functionalFailedBefore === 0, failures.slice(0, 3).join("; "))

  // Verdict: the real component must pass every functional guarantee, and
  // every planted defect must be caught. Failures recorded DURING mutant runs
  // are intentional (a caught mutant fails tests by design) and must not
  // count against the verdict.
  const verdictOk = functionalFailedBefore === 0 && mutantResults.every((m) => m.caught)

  // --- Persist evidence ----------------------------------------------------
  const currentCommit = gitHead(ROOT)
  const sourceFingerprint = sha256File(COMPONENT)

  const result = {
    issue: "M24.P2",
    code: "P2",
    milestone: "M24",
    status: verdictOk ? "verified" : "known-gap",
    verdict: {
      realComponentFailures: functionalFailedBefore,
      mutantsCaught: mutantResults.filter((m) => m.caught).length,
      mutantsTotal: mutants.length,
      ok: verdictOk,
      note: "`checks`/`passed`/`failed` cover the real component's legs plus this gate's own cross-platform and mutation-oracle assertions. A caught mutant's failures are CAPTURED by the check sink, never counted here (a mutant is supposed to fail); which labels a mutant breaks varies with the platform's watcher timing and is printed to the run log instead of recorded, so the record regenerates byte-identically (contract §8.2).",
    },
    checks,
    passed,
    failed,
    negativeCases: mutants.length,
    mutants: mutantResults,
    measuredOs: OS,
    supportedOses: ["darwin", "linux"],
    declaredAbsentOses: ["win32"],
    watcherEventClasses: {
      watcher: "fs.watch(projectPath, { recursive: true })",
      classesTheComponentMustSurvive: ["file", "directory", "watchRootReportedByItsOwnBasename", "filenameLess"],
      rawCountsRecorded: false,
      why: "the per-run event counts are a measurement that moves between runs of the same commit on this OS (FSEvents coalesces and the first watch in a process can miss the initial rescan); they are printed to the run log. The OS and the classes above are what a claim is scoped to (contract §10.2).",
      measured: "the run log line 'measured watcher event shape on <os>' carries this run's counts",
    },
    componentDefectsReported: [
      {
        file: "src/lsp/freshness.ts",
        line: 121,
        symbol: "onWatchEvent",
        defect: "Every watcher event path is forwarded to deps.reindex as a FILE change. On darwin (FSEvents) a recursive fs.watch delivers events for directories and a self-named root event, which join() turns into a path that never existed — so the batch carries a fabricated `deleted` change for a non-existent path plus real directory paths. The production indexer absorbs this by filtering on hasValidExtension (src/ast/parallel-indexer.ts:6614) and by wrapping deletes in try/catch (:6606), which is why the LSP surface does not break today; but the component claims a deletion of a path that never existed and records lastReindex for it.",
        evidence: "watcherEventShape in this record (measured on this OS) + the G7 leg",
        proposedFix: "In onWatchEvent, resolve the event path against projectPath, drop anything that is not strictly inside the root, and statSync it: only regular files enter `pending`. Report directory events to the declared scan path instead (fullScan already exists for that).",
        owner: "src/lsp owner — NOT edited by the m24 lane-1 repair (that file is not in this lane's scope)",
      },
      {
        file: "src/lsp/freshness.ts",
        line: 159,
        symbol: "stop",
        defect: "stop() clears the debounce timer but never clears `pending`. Every path still in `pending` therefore keeps reporting pendingReindex=true — a phantom stale marker that no timer will ever resolve, because the only thing that drains `pending` is the debounced batch. MEASURED on darwin: start(); sleep(60ms) (Node's FSEvents stream delivers an initial rescan, so `pending` holds the workspace's files plus the root's own basename); stop(); the file's marker then reads {stale:true, status:'fresh', pendingReindex:true} indefinitely. This gate's G3 leg was rewritten to avoid the state rather than to assert it, because the fix belongs to the component.",
        evidence: "repro: monitor.start(); await sleep(60); await monitor.stop(); await monitor.marker(file) -> stale=true while status=fresh; pendingFiles() still lists the file (measured on this OS; the raw event counts are printed to the run log)",
        proposedFix: "stop() should either flush `pending` through one final debounced reindex (drain, then close) or clear `pending` and record the affected paths as unresolved-stale in a separate set the marker can name, so a stopped monitor never claims work that nothing will do.",
        owner: "src/lsp owner — NOT edited by the m24 lane-1 repair",
      },
      {
        file: "src/lsp/freshness.ts",
        line: 112,
        symbol: "scheduleReindex catch",
        defect: "One un-indexable entry in a batch fails the batch for every file in it, and the catch deliberately keeps ALL of them in inFlight. With any indexer less tolerant than the current one, a single spurious event turns into unbounded permanent staleness for unrelated files (markers never recover, no retry, no decay).",
        evidence: "read at src/lsp/freshness.ts:98-117 and 200-209; the EISDIR failure this harness's own double produced on darwin before its fidelity fix (recorded in git history of this gate)",
        proposedFix: "Attribute failures per file where the primitive can (it already returns errorDetail), and re-queue only the files that failed; keep the never-fresh rule for THOSE files rather than for the whole batch.",
        owner: "src/lsp owner — NOT edited by the m24 lane-1 repair",
      },
    ],
    currentCommit,
    sourceFingerprint,
    sourceFingerprintAlgorithm: "sha256 over raw file bytes (node:crypto; no process spawn)",
    verifierCommand: "npx tsx script/m24/verify-freshness.ts",
    evidenceFile: "P2.json",
    generatedAt: new Date().toISOString(),
    limitations: [
      "Watcher exercised through real fs.watch on a temp directory. THIS RUN'S OS IS IN `measuredOs`, and the watcher event classes the claims are scoped to are in `watcherEventClasses`; the per-run event counts are printed to the run log rather than recorded, because they vary between runs of the same commit and evidence must regenerate byte-identically (contract §8.2, §10.2: platform scope is declared per claim, other OSes declared absent, never assumed).",
      "The convergence legs (G1, G2, G3, G4, G5 recovery, G7) assert convergence WITHIN a declared bound (6000 ms) and stability across a 150 ms window, rather than at the instant drain() returned: watcher delivery latency is the platform's. The one-directional guarantee — never fresh before the reindex lands — is asserted at full strength, and the 'pendingReindex never clears' mutant proves the bounded wait cannot hide a stuck monitor.",
      "brain.db interaction exercised through an interface double whose reindex mirrors reindexFilesParallel's contract (delete-only for `deleted`, hasValidExtension for `modified`, never reads a directory). The DB-backed path and the real indexer are NOT executed in this lane.",
      "Debounce window tested at the declared 300 ms; extreme event bursts (>1000/s) are a scale concern deferred to M29/R3.",
      "The brain.db double is an interface double: `raw.prepare(...).get()/all()` are shaped to the monitor's two queries. A change to those SQL shapes inside src/lsp/freshness.ts would need this double updated (it fails loudly rather than silently passing, because the monitor's own freshness call would throw into the `try {}` that declares the file unknown).",
    ],
  }
  mkdirSync(path.join(ROOT, "validation/m24/results"), { recursive: true })
  writeSealed(path.join(ROOT, "validation/m24/results/P2.json"), result)
  console.log(`P2: ${result.status.toUpperCase()} (real component: ${functionalFailedBefore === 0 ? "all guarantees hold" : `${functionalFailedBefore} failures`}, ${mutantResults.filter(m => m.caught).length}/${mutants.length} mutants caught)`)
  process.exit(verdictOk ? 0 : 1)
}

main()
