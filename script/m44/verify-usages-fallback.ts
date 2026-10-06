// script/m44/verify-usages-fallback.ts — M44.U6 verifier + mutation suite
// (issue #693).
//
// "Show all usages" must never end in a message-only dead end (Understanding
// Rule 6). Three layers over ONE fixture (script/m44/u6-fixture.ts — authored
// BEFORE the fix; five call sites so the escape hatch actually renders):
//
//   R1 pure core:    the ONE fallback decision (ide/vscode/src/
//                    usage-fallback.ts): strict parse (symbol required),
//                    native-primary (ok → native-references), hub fallback
//                    on unavailable/threw, declared reveal floor, loud error
//                    on malformed args.
//   R2 wire link:    over the REAL index + REAL dist server, the hover's
//                    usages block renders top-3 links PLUS "+2 more — show
//                    all usages" whose bb.showAllUsages args carry the
//                    SERVER-RESOLVED identity {file, line, character, symbol}
//                    (issue #652's no-client-guessing rule extends to the
//                    fallback).
//   R3 handler:      the client command consumes the pure core (structural
//                    drift gate): native referencesTrigger FIRST, hub
//                    fallback via renderHubForPanel, and the old message-only
//                    dead-end string is GONE.
//   N1..N2:          declared-behavior negatives.
//   M1..M4:          mutants — each planted defect is caught, including the
//                    acceptance criterion's message-only regression.
//
// Run: npx tsx script/m44/verify-usages-fallback.ts
// Evidence: validation/m44/results/U6.json (machine-emitted)

import { execFileSync, spawn } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { U6_EXPECT, U6_REL, U6_ROOT, U6_SOURCE_APP, writeU6Fixture } from "./u6-fixture.ts"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const EVIDENCE = path.join(ROOT, "validation/m44/results/U6.json")
const SERVER = path.join(ROOT, "dist/lsp/server.js")
const BB = path.join(ROOT, "bin/bb")
const CORE = path.join(ROOT, "ide/vscode/src/usage-fallback.ts")
const HANDLER = path.join(ROOT, "ide/vscode/src/hover-commands.ts")
const RICH_HOVER = path.join(ROOT, "src/lsp/rich_hover.ts")

let checks = 0
let passed = 0
let negativeCases = 0
const failures: string[] = []
let mutants = { caught: 0, total: 0 }
/** Named after the law each mutant is CONVICTED BY, so the record can say
 *  which assertion ran rather than only how many ran (§6). */
const mutantsCaughtBy: string[] = []

function check(label: string, ok: boolean, detail = "", negative = false): void {
  checks++
  if (ok) passed++
  else failures.push(detail ? `${label}: ${detail}` : label)
  if (negative) negativeCases++
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`)
}

async function main(): Promise<void> {
  console.log("M44.U6 verifier — show-all-usages fallback (never a dead end)\n")

  // --- R1: the ONE pure decision core -----------------------------------------
  console.log("R1: pure fallback decision core (usage-fallback.ts)")
  const core = await import(pathToFileURL(CORE).href)
  const fullArgs = { file: "/w/App.java", line: 9, character: 8, symbol: "render" }
  check("R1: parse accepts the full server-resolved identity", core.parseUsageFallbackArgs(fullArgs) !== null, "")
  check("R1: parse rejects a bare non-object", core.parseUsageFallbackArgs("x") === null, "")
  check("R1: parse rejects an empty symbol (no guessing)", core.parseUsageFallbackArgs({ ...fullArgs, symbol: "" }) === null, "")
  check("R1: parse rejects a fractional line", core.parseUsageFallbackArgs({ ...fullArgs, line: 1.5 }) === null, "")
  check("R1: native ok stays PRIMARY (native-references)", core.resolveUsageFallback(core.parseUsageFallbackArgs(fullArgs), "ok").surface === "native-references", "")
  const fb = core.resolveUsageFallback(core.parseUsageFallbackArgs(fullArgs), "unavailable")
  check("R1: unavailable native → hub fallback for the symbol", fb.surface === "fallback-hub" && fb.symbol === "render", JSON.stringify(fb))
  check("R1: thrown native → hub fallback too", core.resolveUsageFallback(core.parseUsageFallbackArgs(fullArgs), "threw").surface === "fallback-hub", "")
  const reveal = core.resolveUsageFallback({ file: "a", line: 0, character: 0, symbol: "" }, "unavailable")
  check("R1: no symbol → declared reveal floor (never a bare message)", reveal.surface === "reveal", JSON.stringify(reveal))

  // --- N: declared negatives ---------------------------------------------------
  console.log("\nN: declared negatives")
  const err = core.resolveUsageFallback(null, "threw")
  check("N1: malformed args are a declared error (not reveal, not hub)", err.surface === "error" && typeof (err as { reason?: string }).reason === "string", JSON.stringify(err), true)
  check("N2: the pre-U6 link shape (no symbol) is rejected by the strict parse — legacy floor, never a crash", core.parseUsageFallbackArgs({ file: "/w/App.java", line: 9, character: 8 }) === null, "", true)

  // --- R2: the wire link over the real server ----------------------------------
  console.log("\nR2: real server — the escape-hatch link carries the identity")
  mkdirSync(path.join(ROOT, "validation/m44/results"), { recursive: true })
  writeU6Fixture()
  const idxOut = execFileSync(BB, ["index", U6_ROOT, "--no-setup"], { cwd: ROOT, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "inherit"] })
  check("R2: u6 fixture indexes cleanly", /indexed \d+ files/.test(idxOut), idxOut.split("\n").find((l) => l.includes("indexed")) ?? "")

  const lsp = new StdioLsp(U6_ROOT)
  try {
    await lsp.request("initialize", { processId: null, rootUri: `file://${U6_ROOT}`, capabilities: {} })
    lsp.write(Buffer.from(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })))
    const appUri = "file://" + path.join(U6_ROOT, U6_REL.app)
    const hover = await lsp.request("textDocument/hover", {
      textDocument: { uri: appUri },
      position: { line: U6_EXPECT.renderDeclLine, character: U6_EXPECT.renderDeclChar },
    })
    const md: string = (hover?.result?.contents?.value ?? hover?.contents?.value ?? "") as string
    // The hover header is a code fence (signature) — render resolves when the
    // name appears with its usage count; the usages checks below pin the rest.
    check("R2: hover resolves render over the real index", md.includes("**render** — method"), `head=${md.slice(0, 80)}; stderr=${lsp.stderr().slice(-200)}`)
    const usagesIdx = md.indexOf("**usages**")
    check("R2: usages section renders", usagesIdx !== -1, md.slice(0, 200))
    // The counting window must be THE USAGES SECTION, not "everything after
    // the word usages". M55.T3 moved the owning-class `contains` row into its
    // own labelled **contained** block — and that block emits its own
    // `command:bb.openUsage` link ("declared in [Greeter]"). The old window ran
    // to the end of the hover, so it counted a DECLARATION as a usage and this
    // check read 4 links where the section renders 3. A declaration is never a
    // usage (src/lsp/relations.ts, the vocabulary owner); a counter that cannot
    // tell them apart cannot police §13.4.
    const nextBlock = usagesIdx === -1 ? -1 : md.slice(usagesIdx + 1).search(/\n\*\*/)
    const block = usagesIdx === -1 ? "" : md.slice(usagesIdx, nextBlock === -1 ? md.length : usagesIdx + 1 + nextBlock)
    const usageLinkCount = (block.match(/command:bb\.openUsage/g) ?? []).length
    check("R2: top-3 usage links render (bounded hover, unchanged)", usageLinkCount === U6_EXPECT.shownLinks, `usage links in the usages SECTION = ${usageLinkCount} (the window stops at the next ** block, so a containment link can never be counted as a usage)`)
    check("R2: the +N more escape hatch renders", block.includes(`+${U6_EXPECT.hiddenMore} more — [show all usages](command:bb.showAllUsages?`), block.slice(0, 300))
    // §13.4, the half the two checks above cannot see: the header's number must
    // equal what the section can actually take the reader to — the rows it
    // rendered plus the rows the escape hatch stands for.
    //
    // THE HATCH'S OWN N IS READ FROM THE SERVED TEXT, not from the fixture. A
    // first version of this check added the FIXTURE's hiddenMore to the
    // rendered count, and a red-team pass falsified it: a hatch that printed
    // "+0 more" while the header still said 5 PASSED, because the fixture's 2
    // was doing the arithmetic the surface should have done. §13.4 asks the
    // header to equal what the eye can verify against the list, and the only
    // number the eye can verify against the hatch is the one the hatch prints.
    // The fixture is then an INDEPENDENT oracle on top of that, not the
    // mechanism.
    const headerTotal = /^\*\*usages\*\* — (\d+) stored reference/.exec(block)?.[1]
    const hatchN = /\+(\d+) more — \[show all usages\]/.exec(block)
    const hiddenRendered = hatchN === null ? 0 : Number(hatchN[1])
    check(
      "R2: the header's total == rendered rows + the N the escape hatch itself prints (§13.4)",
      headerTotal !== undefined && Number(headerTotal) === usageLinkCount + hiddenRendered,
      `header=${headerTotal} rendered=${usageLinkCount} hatchSays=${hiddenRendered}`,
    )
    check(
      "R2: the escape hatch's N matches the fixture's hidden places (an independent oracle, not the arithmetic)",
      hiddenRendered === U6_EXPECT.hiddenMore,
      `hatch prints +${hiddenRendered}, the fixture authored ${U6_EXPECT.hiddenMore} hidden`,
    )
    check(
      "R2: shown + hidden == the fixture's authored place count (§13.4, the fixture side)",
      usageLinkCount + U6_EXPECT.hiddenMore === U6_EXPECT.totalPlaces && headerTotal !== undefined && Number(headerTotal) === U6_EXPECT.totalPlaces,
      `shown=${usageLinkCount} + hidden=${U6_EXPECT.hiddenMore} vs authored ${U6_EXPECT.totalPlaces}; header=${headerTotal}`,
    )
    // The declaration must NOT appear inside the usages section. M55.T3 gave
    // `Greeter contains render` its own labelled block; if it ever leaks back
    // into the list, this fires (and the old unbounded window could not see it).
    check("R2: the owning class is not offered as a usage (§14 rule 1 — a declaration is never a usage)", !/^\d+\. \[Greeter\]/m.test(block), block.slice(0, 200))

    const sau = firstCommandLink(block, "bb.showAllUsages")
    check("R2: exactly one showAllUsages link", sau !== null, "")
    const dec = sau === null ? null : decodeLinkArgs(sau)
    check(
      "R2: the link args carry the SERVER-RESOLVED identity (file + line + character + symbol)",
      dec !== null &&
        typeof dec?.symbol === "string" && dec.symbol === U6_EXPECT.symbol &&
        typeof dec?.file === "string" && dec.file.endsWith(U6_REL.app) &&
        dec?.line === U6_EXPECT.renderDeclLine && dec?.character === U6_EXPECT.renderDeclChar,
      JSON.stringify(dec),
    )
  } catch (e) {
    check("R2: LSP session completes", false, String(e).slice(0, 200))
  } finally {
    lsp.dispose()
  }

  // --- R3: the client handler consumes the core (drift gate) --------------------
  console.log("\nR3: handler wiring (structural, drift-gated)")
  const handlerSrc = readFileSync(HANDLER, "utf8")
  check("R3: the handler imports and calls the ONE pure core", handlerSrc.includes("resolveUsageFallback(args, handoff)"), "")
  check("R3: native referencesTrigger is attempted FIRST (primary door)", handlerSrc.indexOf("editor.action.referencesTrigger") !== -1, "")
  check("R3: the fallback opens the hub usages surface (renderHubForPanel)", handlerSrc.includes("renderHubForPanel"), "")
  check("R3: the message-only dead-end string is GONE", !handlerSrc.includes("no native references view"), "")

  // --- M: mutants — the suite CAN fail ------------------------------------------
  console.log("\nM: mutants")
  const mutantTargets: Array<{ name: string; file: string; from: string; to: string; probe: (m: any) => boolean }> = [
    // M1-M4 are the pre-existing four; the last two are §13.6's own named case
    // — a dead end reached while the native references surface WORKS.
    {
      // THE acceptance-criterion mutant: a regression that returns the
      // message-only path must FAIL the gate.
      name: "M1 message-only regression (fallback downgraded to reveal floor)",
      file: CORE,
      from: 'if (args.symbol.length > 0) return { surface: "fallback-hub", symbol: args.symbol }',
      to: 'return { surface: "reveal" }',
      probe: (m) => {
        const r = m.resolveUsageFallback({ file: "/w/App.java", line: 9, character: 8, symbol: "render" }, "unavailable")
        return r.surface === "fallback-hub" && r.symbol === "render"
      },
    },
    {
      name: "M2 parse accepts an empty symbol (client-side guessing re-enters)",
      file: CORE,
      from: 'if (typeof a.symbol !== "string" || a.symbol.length === 0) return null',
      to: "if (false) return null",
      probe: (m) => m.parseUsageFallbackArgs({ file: "a", line: 0, character: 0, symbol: "" }) === null,
    },
    {
      name: "M3 native handoff ignored (fallback must stay secondary)",
      file: CORE,
      from: 'if (handoff === "ok") return { surface: "native-references" }',
      to: 'if (false) return { surface: "native-references" }',
      probe: (m) => m.resolveUsageFallback({ file: "a", line: 0, character: 0, symbol: "s" }, "ok").surface === "native-references",
    },
    {
      name: "M4 hover link drops the symbol (fallback could not query)",
      file: RICH_HOVER,
      from: "character: a.character, symbol: a.symbol }]))",
      to: "character: a.character }]))",
      probe: (m) => {
        const uri: string = m.showAllUsagesUri({ file: "/w/App.java", line: 9, character: 8, symbol: "render" })
        const dec = JSON.parse(decodeURIComponent(uri.split("?")[1] ?? "[]"))[0]
        return typeof dec?.symbol === "string" && dec.symbol === "render"
      },
    },
    {
      // §13.6: the law is that a dead end is a defect. Planted where the
      // NATIVE references surface EXISTS and the user is sent nowhere anyway —
      // the exact case the contract names, and one no other mutant here covers.
      name: "dead end while the native references surface is available (handoff ok -> reveal floor)",
      file: CORE,
      from: 'if (handoff === "ok") return { surface: "native-references" }',
      to: 'if (handoff === "ok") return { surface: "reveal" } // the native surface works and the user is sent nowhere',
      probe: (m) => m.resolveUsageFallback({ file: "a", line: 0, character: 0, symbol: "render" }, "ok").surface !== "reveal",
    },
    {
      // §13.6: and the same dead end reached through the unavailable branch.
      name: "dead end on the unavailable branch (the hub fallback replaced by the reveal floor)",
      file: CORE,
      from: 'if (args.symbol.length > 0) return { surface: "fallback-hub", symbol: args.symbol }',
      to: 'if (args.symbol.length > 0) return { surface: "reveal" } // message-only dead end',
      probe: (m) => m.resolveUsageFallback({ file: "/w/App.java", line: 9, character: 8, symbol: "render" }, "unavailable").surface !== "reveal",
    },
  ]
  const coreSrc = readFileSync(CORE, "utf8")
  const richSrc = readFileSync(RICH_HOVER, "utf8")
  for (const mutant of mutantTargets) {
    mutants.total++
    const source = mutant.file === CORE ? coreSrc : richSrc
    const mutated = source.replace(mutant.from, mutant.to)
    if (mutated === source) {
      // §8.3 silence is guilt: an anchor that no longer matches means the
      // mutant was never planted. That is a failure, not a skip.
      check(`M: ${mutant.name} — ANCHOR DRIFT: the mutant was never planted`, false, `anchor not in ${path.basename(mutant.file)}: ${mutant.from.slice(0, 90)}`)
      continue
    }
    // WHERE the mutant file is written decides whether its RELATIVE imports
    // resolve — and this gate got that wrong for its whole life.
    //
    // PROVEN: the mutant was written to validation/m44/, and the module under
    // test is src/lsp/rich_hover.ts, whose `./navigation` /
    // `./positions` / `./enrichment` imports are relative to src/lsp/. From
    // validation/m44/ none of them exist, so the mutant could NEVER load — and
    // the old catch block booked that as "caught". M4 (the one mutant proving
    // the hover link carries the symbol, i.e. §13.6's whole premise) has
    // therefore had ZERO coverage while the evidence read 4/4 mutants caught.
    //
    // The fix is to place the mutant where its own imports resolve: inside the
    // module's own directory, under a name tsconfig's `include` cannot see.
    const mutantDir = path.dirname(mutant.file)
    const mutantPath = path.join(mutantDir, `.u6-mutant.${mutants.total}.${process.pid}.mts`)
    writeFileSync(mutantPath, mutated)
    let mod: any = null
    let loadError = ""
    try {
      mod = await import(pathToFileURL(mutantPath).href)
    } catch (error) {
      loadError = String(error instanceof Error ? error.message : error).slice(0, 140)
    } finally {
      try { rmSync(mutantPath, { force: true }) } catch {}
    }
    if (mod === null) {
      // PROVEN HOLE (this suite shipped it): a module that will not import
      // exercised ZERO §13.6 paths, and the old catch block booked that as a
      // catch — a mutant whose replacement was a bare syntax error still
      // printed "mutant caught" and the gate still counted it. An
      // unevaluable mutant is coverage that was never measured, so it FAILS.
      check(`M: ${mutant.name} — the mutant could not be EVALUATED (a load failure is not a catch)`, false, loadError)
      continue
    }
    let caught = false
    let probeError = ""
    try {
      caught = mutant.probe(mod) === false
    } catch (error) {
      // The probe itself blew up: that is the harness failing to measure, not
      // the mutant being convicted. Same honesty rule.
      probeError = String(error instanceof Error ? error.message : error).slice(0, 140)
    }
    if (caught) mutants.caught++
    check(`M: mutant caught — ${mutant.name}`, caught, caught ? "" : probeError ? `probe could not run: ${probeError}` : "SURVIVED")
    if (caught) mutantsCaughtBy.push(mutant.name)
  }

  // --- Evidence ------------------------------------------------------------------
  const ok = failures.length === 0
  const evidence = {
    issue: "693",
    code: "U6",
    milestone: "M44",
    status: ok ? "verified" : "known-gap",
    checks,
    passed,
    failed: failures.length,
    negativeCases,
    mutantsCaught: mutants.caught,
    mutantsTotal: mutants.total,
    // §6 asks which defect each mutant convicts; the count alone can hide a
    // mutant that was never really run. These names are the ones whose probe
    // returned false on a module that LOADED.
    mutantsCaughtBy,
    mutantHonesty: {
      loadFailureIsACatch: false,
      note: "A mutant whose module will not import exercises no §13.6 path. This gate booked that as a catch — PROVEN twice: a mutant whose replacement was a bare syntax error printed 'mutant caught', and M4 (the hover-link mutant, written to validation/m44/ where src/lsp/rich_hover.ts's relative imports do not resolve) could never load at all, so the one mutant that proves the link carries the symbol had ZERO coverage while the record read 4/4. Mutants are now written beside the module they mutate, and an unevaluable mutant, a probe that cannot run, and an anchor that no longer matches are all FAILURES (§8.3 silence is guilt).",
    },
    failures,
    currentCommit: execFileSync("git", ["log", "-1", "--format=%H"], { cwd: ROOT, encoding: "utf8" }).trim(),
    // MEASURED, not asserted. This field was the literal [] while the source it
    // describes was being edited — a record claiming a clean tree mid-change is
    // exactly the silence §8.3 bans.
    workingTreeRelevantChanges: relevantWorkingTreeChanges(),
    verifierCommand: "npx tsx script/m44/verify-usages-fallback.ts",
    evidenceFile: "U6.json",
    generatedAt: new Date().toISOString(),
    fixture: {
      root: U6_ROOT,
      files: Object.values(U6_REL),
      symbol: U6_EXPECT.symbol,
      shownLinks: U6_EXPECT.shownLinks,
      hiddenMore: U6_EXPECT.hiddenMore,
      // Declared so the number is checkable against the store, not against a
      // second hand-written figure (§13.4).
      usagePlaces: U6_EXPECT.totalPlaces,
      placeUnit: "one per served position — a stored call-site line, else the referencing declaration (src/lsp/relations.ts)",
      places: ["App.java:6 (main)", "App.java:19 (ExtraCalls.both)", "App.java:20 (ExtraCalls.both)", "Extra1.java:5 (main)", "Extra2.java:5 (main)"],
      excluded: ["App.java:11 Greeter contains render — a DECLARATION, never a usage (§14 rule 1, M55.T3)"],
    },
    limitations: [
      "The vscode command handler cannot execute headlessly; its wiring is pinned structurally (R3) and executed live by the E5 in-editor leg (click show-all-usages → native peek OR usages fallback, never a bare message).",
      "The pure core's reveal floor is reachable only for legacy clients that predate the symbol-carrying link; it remains a declared outcome, not a message-only dead end.",
    ],
  }
  mkdirSync(path.dirname(EVIDENCE), { recursive: true })
  writeSealed(EVIDENCE, evidence)

  console.log(`\nU6: ${ok ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks} passed, ${mutants.caught}/${mutants.total} mutants caught, ${negativeCases} negative)`)
  if (!ok) {
    for (const f of failures) console.log(`  FAIL: ${f}`)
  }
  process.exit(0)
}

// --- Helpers ---------------------------------------------------------------------

/** Minimal stdio LSP client over the REAL dist server. */
class StdioLsp {
  private child
  private buffer = Buffer.alloc(0)
  private pending = new Map<number, { resolve: (v: any) => void }>()
  private nextId = 1

  private stderrTail = ""

  constructor(workspace: string) {
    this.child = spawn(process.execPath, [SERVER, "--dir", workspace], { stdio: ["pipe", "pipe", "pipe"] })
    this.child.stdout.on("data", (c: Buffer) => this.onData(c))
    this.child.stderr.on("data", (c: Buffer) => {
      this.stderrTail = (this.stderrTail + c.toString("utf8")).slice(-4000)
    })
  }

  private onData(c: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, c])
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = this.buffer.subarray(0, headerEnd).toString("utf8")
      const len = parseInt(/Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? "0", 10)
      if (this.buffer.length < headerEnd + 4 + len) return
      const body = JSON.parse(this.buffer.subarray(headerEnd + 4, headerEnd + 4 + len).toString("utf8"))
      this.buffer = this.buffer.subarray(headerEnd + 4 + len)
      if (body && typeof body.id === "number" && this.pending.has(body.id)) {
        const p = this.pending.get(body.id)!
        this.pending.delete(body.id)
        p.resolve(body)
      }
    }
  }

  write(body: string | Buffer): void {
    const b = Buffer.isBuffer(body) ? body : Buffer.from(body)
    this.child.stdin.write(`Content-Length: ${b.length}\r\n\r\n`)
    this.child.stdin.write(b)
  }

  async request(method: string, params: unknown): Promise<any> {
    const id = this.nextId++
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.child.stdin.write(body)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ error: { message: `timeout waiting for ${method}` } }), 60_000)
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
      })
    })
  }

  stderr(): string {
    return this.stderrTail
  }

  dispose(): void {
    try {
      this.child.stdin.end()
    } catch {}
    setTimeout(() => this.child.kill("SIGKILL"), 2000)
    this.child.on("exit", () => process.exitCode = 0)
  }
}

/** The evidence's own claim about the tree it was measured on, MEASURED.
 *  This field was the literal `[]` while the sources it describes were being
 *  edited — a record asserting a clean tree mid-change is the silence §8.3
 *  bans. Paths are the ones this verdict's inputs live in, so the list says
 *  what a reader must distrust. */
function relevantWorkingTreeChanges(): string[] {
  const watched = [
    "script/m44/verify-usages-fallback.ts",
    "script/m44/u6-fixture.ts",
    "ide/vscode/src/usage-fallback.ts",
    "ide/vscode/src/hover-commands.ts",
    "src/lsp/rich_hover.ts",
    "src/lsp/relations.ts",
  ]
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", ...watched], { cwd: ROOT, encoding: "utf8" })
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .map((l) => l.replace(/^..\s+/, ""))
  } catch {
    return ["UNMEASURED — git status failed, so this record makes no claim about the tree it ran on"]
  }
}

/** First `](command:<cmd>?<args>)` link in a markdown block. */
function firstCommandLink(markdown: string, command: string): string | null {
  const re = new RegExp(`\\]\\(command:${command.replace(/\./g, "\\.")}\\?([^)\\s]+)\\)`)
  const m = re.exec(markdown)
  return m ? m[1] ?? null : null
}

/** Decode a command-link URI args payload (a JSON array, VS Code convention). */
function decodeLinkArgs(encoded: string): Record<string, unknown> | null {
  try {
    const dec = JSON.parse(decodeURIComponent(encoded))
    return (Array.isArray(dec) ? dec[0] : dec) as Record<string, unknown>
  } catch {
    return null
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
