// script/m24/verify-server.ts — M24.L1 verifier + mutation suite.
//
// Proves the LSP server (src/lsp/server.ts) honors its declared guarantees,
// and proves every gate here CAN FAIL by planting defects in a copy of the
// component and asserting a behavioural oracle observes each one.
//
// Guarantees under test (declared in src/lsp/server.ts header):
//   G1 lifecycle:  initialize → initialized → shutdown → exit honored;
//                  requests before initialize rejected (-32002); requests
//                  after shutdown rejected (-32600)
//   G2 derivation: capability keys derive from the LIVE handler set — a key
//                  appears only when every method it requires is registered
//   G3 transport:  Content-Length framing round-trips over real streams
//   G4 project:    root canonicalized with realpath(3) BEFORE the id is
//                  derived, so identity is sha1-of-realpath
//   G5 languages:  non-launch languages declared absent, never a crash
//   G6 coverage:   CAPABILITY_COVERAGE (src/lsp/server.ts) matches the wired
//                  server's registered handlers AND its advertisement, in both
//                  directions — no undeclared method, no phantom key
//   G7 constants:  advertised schema versions / debounce match the OWNER
//                  modules that enforce them, and the live bb/staleness answer
//                  has the shape the advertisement promises
//   G8 sync model: no textDocumentSync advertised (no did* handler exists);
//                  single-root declared as workspaceFolders.supported:false
//
// Run: npx tsx script/m24/verify-server.ts
// Evidence: validation/m24/results/L1.json (machine-emitted, sealed)
//
// HONESTY NOTES — three defects this file previously carried, all fixed here:
//  1. G4's oracle compared against the RAW mkdtemp path. On macOS tmpdir() is
//     `/var/folders/…`, a symlink to `/private/var/folders/…`, so the
//     component's realpath canonicalization was CORRECT and the oracle was
//     wrong: two permanent failures papered over as "known-gap". Fixed, and
//     the canonicalization fixture is now a symlink this gate creates itself,
//     so it is detectable on every platform instead of only where tmpdir
//     happens to be a symlink.
//  2. `negativeCases` was structurally incapable of being non-zero: the
//     `negative()` helper existed and was never called. Contract §8.3 makes a
//     missing negative case a failure, so this is now a real count of real
//     negative cases (G2/G6/G7/G8).
//  3. Every server mutant was reported as "caught (load failure)". Cause: the
//     mutant copy was written to validation/m24/ where server.ts's relative
//     imports (`./hover`, `../util/project-id`, …) resolve to files that do
//     not exist — only two imports were ever rewritten, and `../cli/index` is
//     no longer imported at all. So the module NEVER loaded, for every mutant,
//     regardless of the planted defect: the suite reported 10/10 caught while
//     observing nothing. Fixed: the mutant copy is written beside the original
//     in src/lsp/ so its imports resolve, a PRISTINE-LOAD CONTROL proves the
//     harness itself loads before any result is counted, and a mutant whose
//     oracle does not observe its own defect is reported as a load-failure
//     catch, which now fails the suite (contract §8.7, "the fixture that
//     cannot fail").

import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { PassThrough } from "node:stream"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"
import {
  BbLspServer,
  createServer,
  languageForPath,
  isLaunchLanguage,
  ErrorCodes,
  CAPABILITY_COVERAGE,
  capabilityKeyForMethod,
  STALENESS_SCHEMA_VERSION,
  wireFeatures,
} from "../../src/lsp/server"
// D-5 (gate-internal facts): the launch set is read from its OWNER module, never
// re-listed inline here and never taken second-hand through a re-export — this is
// the fact this gate checks against the owner-approved wave records below.
import { LAUNCH_LANGUAGES } from "../../src/lsp/launch_languages"
import { canFailFromChecks, writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"
// The ANCHOR-DRIFT class gate (script/m24/mutant-anchor-gate.ts). Shared with
// script/m24/verify-hover.ts so the class is gated by ONE implementation.
import {
  anchorDriftReport,
  anchorGateSelfTest,
  describeAmbiguousAnchors,
  describeAnchorDrift,
  type AnchoredMutation,
  type SourceReader,
} from "./mutant-anchor-gate.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const COMPONENT = join(ROOT, "src", "lsp", "server.ts")
const LANGUAGES_COMPONENT = join(ROOT, "src", "lsp", "launch_languages.ts")
/** The analyzer whose throw the seam's backstop arm recognises. Read by the
 *  drift gate so a reword there turns THIS gate red instead of silently
 *  degrading the seam. */
const ENGINE_COMPONENT = join(ROOT, "src", "ast", "engine.ts")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "L1.json")

let passed = 0
let failed = 0
const failures: string[] = []
let negativeCases = 0
/** Every check line as emitted, so the record's can-fail declaration is derived
 *  from the run itself rather than restated by hand (M61 D-4). */
const checkLog: string[] = []

function record(line: string): void {
  checkLog.push(line)
  console.log(`  ${line}`)
}

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++
    record(`ok: ${name}`)
  } else {
    failed++
    failures.push(name)
    record(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

/** A NEGATIVE case: an assertion that a specific wrong thing does NOT happen.
 *  Distinct from `check` because contract §8.3 counts these separately, and a
 *  verifier whose negatives are 0 has proved nothing about its own blindness. */
function negative(name: string, ok: boolean, detail = ""): void {
  negativeCases++
  check(name, ok, detail)
}

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "bblsp-l1-"))
}

/** realpath(3) of a path, with the lexical fallback the component itself uses.
 *  The ORACLE must apply the same transformation the component claims to
 *  apply — that is the entire difference between testing the claim and
 *  restating it. */
function canonicalOf(root: string): string {
  try {
    return realpathSync.native(root)
  } catch {
    return root
  }
}

function expectedProjectId(root: string): string {
  return createHash("sha1").update(canonicalOf(root)).digest("hex").substring(0, 40)
}

/** A workspace reached through a SYMLINK, plus the real directory it points
 *  at. Canonicalization is only observable where a path and its canonical form
 *  differ; relying on tmpdir() being a symlink made that platform luck. */
function tmpSymlinkedWorkspace(): { link: string; real: string; cleanup: () => void } {
  const real = tmpWorkspace()
  // The link lives beside the dir, never inside it, so a recursive watcher
  // cannot follow it into a loop.
  const link = join(real, "..", `bblsp-link-${process.pid}-${real.slice(-6)}`)
  try { rmSync(link, { force: true, recursive: true }) } catch {}
  symlinkSync(real, link, "dir")
  return { link, real, cleanup: () => rmSync(link, { recursive: true, force: true }) }
}

// --- G1: lifecycle ---------------------------------------------------------

async function testLifecycle(): Promise<void> {
  console.log("G1: lifecycle")
  const ws = tmpWorkspace()
  const server = createServer(ws)
  check("G1: initial state is uninitialized", server.state() === "uninitialized")

  // Request before initialize must be rejected with -32002.
  const early = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "textDocument/hover", params: {} })
  check(
    "G1: request before initialize rejected with -32002",
    !!early && (early as any).error?.code === ErrorCodes.ServerNotInitialized,
    JSON.stringify(early),
  )

  const init = await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "initialize",
    params: { capabilities: {} },
  })
  check("G1: initialize returns result", !!init && (init as any).result !== undefined, JSON.stringify(init))
  check("G1: initialize returns protocolVersion 3.18", (init as any)?.result?.protocolVersion === "3.18")
  check(
    "G1: initialize returns serverInfo bb_lsp",
    (init as any)?.result?.serverInfo?.name === "bb_lsp",
  )
  check("G1: state initialized after initialize", server.state() === "initialized")

  const initializedNote = await server.handleMessage({ jsonrpc: "2.0", method: "initialized" })
  check("G1: initialized notification yields no response", initializedNote === null)

  const shutdown = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "shutdown" })
  check("G1: shutdown returns null result", !!shutdown && (shutdown as any).result === null, JSON.stringify(shutdown))
  check("G1: state shutdown after shutdown", server.state() === "shutdown")

  const postShutdown = await server.handleMessage({ jsonrpc: "2.0", id: 4, method: "textDocument/hover", params: {} })
  check(
    "G1: request after shutdown rejected with -32600",
    !!postShutdown && (postShutdown as any).error?.code === ErrorCodes.InvalidRequest,
    JSON.stringify(postShutdown),
  )

  // Shutdown must be terminal: a SECOND shutdown is not answered as a fresh
  // shutdown. The state machine says "only exit is meaningful".
  const secondShutdown = await server.handleMessage({ jsonrpc: "2.0", id: 5, method: "shutdown" })
  negative(
    "G1 negative: a second shutdown is NOT silently accepted as a fresh shutdown",
    (secondShutdown as any)?.error?.code === ErrorCodes.InvalidRequest,
    JSON.stringify(secondShutdown),
  )

  const exit = await server.handleMessage({ jsonrpc: "2.0", method: "exit" })
  check("G1: exit notification yields no response", exit === null)
  rmSync(ws, { recursive: true, force: true })
}

// --- G2: capability derivation from the live handler set ---------------------

/** Keys whose truth depends on a registered handler. The `workspace` entry is
 *  a server CONSTANT (a declared limitation), so it is present with zero
 *  handlers by design — this is the split G6 re-checks on the real server. */
function handlerDerivedKeys(): string[] {
  return CAPABILITY_COVERAGE.filter((e) => e.kind === "handler").map((e) => e.key)
}

async function testCapabilities(): Promise<void> {
  console.log("G2: capabilities derive from handlers")
  const ws = tmpWorkspace()
  const server = createServer(ws)
  check(
    "G2: implementedMethods() is empty with no handlers registered",
    server.implementedMethods().length === 0,
    JSON.stringify(server.implementedMethods()),
  )
  negative(
    "G2 negative: no HANDLER-DERIVED capability appears with zero handlers registered",
    handlerDerivedKeys().every((k) => (server.capabilities() as any)[k] === undefined),
    JSON.stringify(Object.keys(server.capabilities())),
  )

  server.register("textDocument/hover", () => ({}))
  check("G2: hoverProvider advertised after hover registered", server.capabilities().hoverProvider === true)
  check("G2: definitionProvider not advertised", server.capabilities().definitionProvider === undefined)
  check(
    "G2: implementedMethods() reflects the live handler set",
    JSON.stringify(server.implementedMethods()) === JSON.stringify(["textDocument/hover"]),
    JSON.stringify(server.implementedMethods()),
  )

  server.register("textDocument/prepareCallHierarchy", () => ({}))
  check(
    "G2: callHierarchyProvider requires all three methods",
    server.capabilities().callHierarchyProvider === undefined,
  )
  server.register("callHierarchy/incomingCalls", () => ({}))
  negative(
    "G2 negative: a TWO-of-three call hierarchy advertises no callHierarchyProvider",
    server.capabilities().callHierarchyProvider === undefined,
  )
  server.register("callHierarchy/outgoingCalls", () => ({}))
  check(
    "G2: callHierarchyProvider advertised once all three methods are registered",
    server.capabilities().callHierarchyProvider === true,
  )

  const init = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  const caps = (init as any)?.result?.capabilities ?? {}
  const advertisedTrue = Object.keys(caps).filter((k) => caps[k] === true).length
  check(
    "G2: advertised capability count matches registered feature surface",
    advertisedTrue === 2,
    JSON.stringify(caps),
  )
  rmSync(ws, { recursive: true, force: true })
}

// --- G3: stdio transport framing --------------------------------------------

async function testTransport(): Promise<void> {
  console.log("G3: stdio transport framing")
  const ws = tmpWorkspace()
  const server = createServer(ws)
  const clientOut = new PassThrough()
  const serverOut = new PassThrough()

  const chunks: Buffer[] = []
  serverOut.on("data", (c: Buffer) => chunks.push(c))

  const runPromise = server.run(clientOut, serverOut)

  const frame = (obj: unknown): Buffer => {
    const body = Buffer.from(JSON.stringify(obj), "utf8")
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body])
  }

  clientOut.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))
  clientOut.write(frame({ jsonrpc: "2.0", method: "initialized" }))
  clientOut.write(frame({ jsonrpc: "2.0", id: 2, method: "shutdown" }))
  clientOut.write(frame({ jsonrpc: "2.0", method: "exit" }))

  await Promise.race([runPromise, new Promise((r) => setTimeout(r, 5000))])
  check("G3: run() resolves after exit notification", server.state() === "shutdown" || server.events().some((e) => e.method === "exit"))

  const rawOut = Buffer.concat(chunks).toString("utf8")
  const headerOk = /^Content-Length: \d+\r\n\r\n/.test(rawOut)
  check("G3: responses use Content-Length framing", headerOk, rawOut.slice(0, 80))

  // A client that only learns what it receives by listening for it, which is
  // the whole point of the bb/absence carrier: over REAL streams, an absence
  // must produce both a framed response and framed notifications.
  const ws2 = tmpWorkspace()
  try {
    writeUnroutable(ws2)
    const s2 = new BbLspServer(ws2)
    wireFeatures(s2)
    const cin = new PassThrough()
    const sout = new PassThrough()
    const got: Buffer[] = []
    sout.on("data", (c: Buffer) => got.push(c))
    const run2 = s2.run(cin, sout)
    const mkFrame = (obj: unknown): Buffer => {
      const b = Buffer.from(JSON.stringify(obj), "utf8")
      return Buffer.concat([Buffer.from(`Content-Length: ${b.length}\r\n\r\n`, "utf8"), b])
    }
    cin.write(mkFrame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }))
    cin.write(mkFrame({ jsonrpc: "2.0", method: "initialized" }))
    cin.write(
      mkFrame({
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/references",
        params: { textDocument: { uri: "file://" + join(ws2, "notes.txt") }, position: { line: 0, character: 0 }, context: { includeDeclaration: false } },
      }),
    )
    await Promise.race([run2, new Promise((r) => setTimeout(r, 5000))])
    const wire = Buffer.concat(got)
    // Frame-walk over bytes (see the note above) and read the methods out.
    const methods: string[] = []
    let off = 0
    while (off < wire.length) {
      const he = wire.indexOf("\r\n\r\n", off, "utf8")
      if (he === -1) break
      const m2 = /Content-Length:\s*(\d+)/i.exec(wire.subarray(off, he).toString("utf8"))
      if (!m2) break
      const len2 = parseInt(m2[1], 10)
      const bs = he + 4
      if (wire.length < bs + len2) break
      try {
        methods.push((JSON.parse(wire.subarray(bs, bs + len2).toString("utf8")) as any)?.method ?? "(response)")
      } catch {
        methods.push("(unparseable)")
      }
      off = bs + len2
    }
    check(
      "G3: a declared absence is FRAMED on the wire, not merely queued (bb/absence + window/logMessage)",
      methods.includes("bb/absence") && methods.includes("window/logMessage"),
      `frames=${JSON.stringify(methods)}`,
    )
    check(
      "G3: the response is written BEFORE the notices that explain it (a client reading in order sees the answer first)",
      methods.indexOf("(response)") < methods.indexOf("bb/absence"),
      `frames=${JSON.stringify(methods)}`,
    )
  } finally {
    rmSync(ws2, { recursive: true, force: true })
  }

  // Frame-aware parsing over BYTES, not characters. Content-Length counts
  // bytes; slicing a decoded string counts UTF-16 code units, so any non-ASCII
  // payload (an em dash in a human-readable message) desynchronises the parse
  // and the harness reads garbage — which is exactly what happened once the
  // absence advertisement carried prose. The server frames correctly
  // (`Buffer.from(...)` then `body.length`); the harness must verify it the
  // same way rather than trusting a lossy round trip through a string.
  const bytes = Buffer.concat(chunks)
  const bodies: any[] = []
  let offset = 0
  while (offset < bytes.length) {
    const headerEnd = bytes.indexOf("\r\n\r\n", offset, "utf8")
    if (headerEnd === -1) break
    const headerText = bytes.subarray(offset, headerEnd).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(headerText)
    if (!m) break
    const len = parseInt(m[1], 10)
    const bodyStart = headerEnd + 4
    if (bytes.length < bodyStart + len) break
    try {
      bodies.push(JSON.parse(bytes.subarray(bodyStart, bodyStart + len).toString("utf8")))
    } catch {
      bodies.push(null)
    }
    offset = bodyStart + len
  }
  // A frame-by-frame walk also proves no stray bytes trail the last message:
  // leftover bytes would mean the server wrote something a client cannot parse.
  check(
    "G3: the byte stream is consumed exactly, with no trailing bytes after the last frame",
    offset === bytes.length,
    `consumed=${offset} total=${bytes.length}`,
  )
  const ids = bodies.filter(Boolean).map((b) => b.id)
  check(
    "G3: responses for both requests received in order",
    JSON.stringify(ids) === JSON.stringify([1, 2]),
    `${JSON.stringify(ids)} from ${bodies.length} frames`,
  )
  rmSync(ws, { recursive: true, force: true })
}

// --- G4: project resolution --------------------------------------------------

async function testProjectResolution(): Promise<void> {
  console.log("G4: project resolution")
  const ws = tmpWorkspace()
  const server = createServer(ws)
  check(
    "G4: root is canonicalized with realpath(3)",
    server.context.root === canonicalOf(ws),
    `${server.context.root} vs ${canonicalOf(ws)}`,
  )
  check(
    "G4: projectId matches sha1-of-realpath convention",
    server.context.projectId === expectedProjectId(ws),
    `${server.context.projectId} vs ${expectedProjectId(ws)}`,
  )
  check("G4: serverInfo name is bb_lsp", server.context.serverInfo.name === "bb_lsp")
  check(
    "G4: serverInfo version present",
    typeof server.context.serverInfo.version === "string" && server.context.serverInfo.version.length > 0,
  )

  // Platform-independent canonicalization: a path and a symlink to it are the
  // same workspace, so they must yield the SAME identity. Before this fixture
  // existed, "drop realpath canonicalization" was only detectable on platforms
  // whose tmpdir is itself a symlink (macOS) and undetectable elsewhere.
  const fx = tmpSymlinkedWorkspace()
  try {
    // Compare against the CANONICAL target, not the raw mkdtemp spelling: on
    // macOS the temp dir is itself reached through /var -> /private/var, so the
    // raw target is already a non-canonical spelling of the real directory.
    // Comparing against the raw spelling would make this oracle wrong for the
    // very reason the previous G4 oracle was wrong.
    const canonicalReal = canonicalOf(fx.real)
    check("G4: the symlink fixture really does differ from its canonical form", fx.link !== canonicalReal)
    const viaLink = createServer(fx.link)
    const viaReal = createServer(fx.real)
    check(
      "G4: root reached through a symlink is canonicalized to the real directory",
      viaLink.context.root === canonicalReal,
      `${viaLink.context.root} vs ${canonicalReal}`,
    )
    negative(
      "G4 negative: a symlinked path and the real path do NOT produce two different project ids",
      viaLink.context.projectId === viaReal.context.projectId,
      `${viaLink.context.projectId} vs ${viaReal.context.projectId}`,
    )
    check(
      "G4: projectId is sha1-of-realpath even when the caller passed a symlink",
      viaLink.context.projectId === expectedProjectId(fx.link),
      `${viaLink.context.projectId} vs ${expectedProjectId(fx.link)}`,
    )
  } finally {
    fx.cleanup()
    rmSync(fx.real, { recursive: true, force: true })
  }

  // A nonexistent root keeps deterministic lexical identity (the component's
  // documented fallback). Asserted so the fallback cannot silently change.
  const absent = join(ws, "does", "not", "exist")
  const fallback = createServer(absent)
  check(
    "G4: a nonexistent root falls back to deterministic lexical identity",
    fallback.context.root === absent && fallback.context.projectId === createHash("sha1").update(absent).digest("hex").substring(0, 40),
    fallback.context.root,
  )
  rmSync(ws, { recursive: true, force: true })
}

// --- G5: declared-absent languages -------------------------------------------

async function testLanguages(): Promise<void> {
  console.log("G5: declared-absent languages")
  check("G5: java is a launch language", isLaunchLanguage("java"))
  check("G5: typescript is a launch language", isLaunchLanguage("typescript"))
  check("G5: wave-1 languages joined (M29 approval record)", isLaunchLanguage("javascript") && isLaunchLanguage("python"))
  check("G5: cobol is NOT a launch language (declared absence keeps an oracle)", !isLaunchLanguage("cobol"))
  check("G5: null is not a launch language", !isLaunchLanguage(null))
  check("G5: languageForPath maps .kt to kotlin", languageForPath("src/Main.kt") === "kotlin")
  check("G5: languageForPath maps .py to python (M29 wave 1)", languageForPath("src/main.py") === "python")
  check("G5: languageForPath maps .js to javascript (M29 wave 1)", languageForPath("src/main.js") === "javascript")
  check(
    "G5: launch set matches the owner-approved wave records exactly (wave 1 + wave 2)",
    JSON.stringify([...LAUNCH_LANGUAGES].sort()) ===
      JSON.stringify(["c", "cpp", "go", "groovy", "java", "javascript", "kotlin", "python", "rust", "scala", "svelte", "typescript", "vue", "zig"]),
  )
  // Declared absence for an extension outside the map: null, never a guess.
  // A guess here would render as "no references found" for a file the server
  // simply cannot read (contract §11.7).
  check(
    "G5 negative: languageForPath does NOT invent a language for an extension outside the map",
    languageForPath("notes.cobol") === null,
    String(languageForPath("notes.cobol")),
  )
}

// --- G6: CAPABILITY_COVERAGE vs the wired server, both directions -----------

/** Build the REAL server the extension launches: every feature wired. */
async function wiredCaps(): Promise<{ caps: Record<string, unknown>; methods: string[] }> {
  const ws = tmpWorkspace()
  try {
    const server = new BbLspServer(ws)
    wireFeatures(server)
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    return { caps: server.capabilities(), methods: server.implementedMethods() }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

async function testCoverage(): Promise<void> {
  console.log("G6: capability coverage is exhaustive in both directions")
  const { caps, methods } = await wiredCaps()
  const keys = Object.keys(caps)

  // Direction 1: every REGISTERED method has a coverage entry. This is the
  // check the old IMPLEMENTED_METHODS comment claimed existed and did not.
  const uncovered = methods.filter((m) => capabilityKeyForMethod(m) === undefined)
  check(
    "G6: every registered handler has a CAPABILITY_COVERAGE entry",
    uncovered.length === 0,
    `uncovered: ${JSON.stringify(uncovered)}`,
  )

  // Direction 2: every ADVERTISED key is declared in the table. A phantom key
  // is a claim about a capability this gate cannot account for.
  const declared = new Set(CAPABILITY_COVERAGE.map((e) => e.key))
  const phantom = keys.filter((k) => !declared.has(k))
  check("G6: every advertised key is declared in CAPABILITY_COVERAGE", phantom.length === 0, `phantom: ${JSON.stringify(phantom)}`)

  // The absence carrier is part of the same reachability law, so it is gated
  // here as well as in G11: "the channel exists" and "the channel is
  // advertised" are different claims, and a client needs BOTH to listen.
  check(
    "G6: the absence carrier is advertised (a channel that exists but is unadvertised is unreachable)",
    (caps as any).absenceProvider !== undefined,
    `keys=${JSON.stringify(keys)}`,
  )
  negative(
    "G6 negative: the absence carrier is NOT advertised as an inbound request key",
    !keys.includes("bb/absence"),
    `keys=${JSON.stringify(keys)}`,
  )

  const declaredMethodsHere = new Set(CAPABILITY_COVERAGE.flatMap((e) => e.methods))

  // Direction 3: per-entry agreement. For each entry, register exactly its
  // methods and assert the key appears with exactly the declared payload;
  // then remove one method and assert the key disappears. This is what makes
  // the table and the if-chain in capabilities() unable to drift apart.
  const ws = tmpWorkspace()
  try {
    for (const entry of CAPABILITY_COVERAGE) {
      const probe = new BbLspServer(ws)
      for (const m of entry.methods) probe.register(m, () => ({}))
      const got = (probe.capabilities() as any)[entry.key]
      const want = entry.value ? entry.value() : undefined
      check(
        `G6: table entry ${entry.key} matches what capabilities() emits`,
        JSON.stringify(got) === JSON.stringify(want),
        `emitted ${JSON.stringify(got)} vs declared ${JSON.stringify(want)}`,
      )
      if (entry.kind === "handler" && entry.methods.length > 0) {
        // Drop the LAST required method: a key that needs several methods must
        // vanish when one is missing, and must not be advertised partially.
        const partial = new BbLspServer(ws)
        for (const m of entry.methods.slice(0, -1)) partial.register(m, () => ({}))
        negative(
          `G6 negative: ${entry.key} is NOT advertised when one required method is missing`,
          (partial.capabilities() as any)[entry.key] === undefined,
          `advertised ${JSON.stringify((partial.capabilities() as any)[entry.key])} with ${JSON.stringify(entry.methods.slice(0, -1))}`,
        )
      }
    }
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }

  // Direction 4: the reachability half of the original defect — on the REAL
  // wired server, bb/staleness and bb/impact must be discoverable in the
  // initialize result. Before this, both were registered and invisible.
  check(
    "G6: bb/staleness is advertised on the wired server (was registered but blind)",
    (caps as any).stalenessProvider !== undefined,
    JSON.stringify(keys),
  )
  check("G6: bb/impact is advertised on the wired server (was registered but blind)", (caps as any).impactProvider !== undefined, JSON.stringify(keys))
  // The other half of direction 1: every DECLARED method is actually served.
  // A table entry for a method no handler implements is a phantom promise in
  // the other direction — it would look like coverage while the client got
  // MethodNotFound. Expressed as a set law rather than a hardcoded count, so
  // a lane that legitimately adds a handler is not failed by an integer.
  const declaredNotServed = [...declaredMethodsHere].filter((m) => !methods.includes(m))
  check(
    "G6: every CAPABILITY_COVERAGE method is actually registered on the wired server",
    declaredNotServed.length === 0,
    `declared but unserved: ${JSON.stringify(declaredNotServed)}`,
  )

  // Declared absence, not silence: an unknown method answers MethodNotFound
  // rather than a fabricated result. Contract §8.3 / §11.7.
  const ws2 = tmpWorkspace()
  try {
    const server = new BbLspServer(ws2)
    wireFeatures(server)
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const unknown = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/definitely-not-a-method", params: {} })
    negative(
      "G6 negative: an unknown method answers MethodNotFound, never a fabricated result",
      (unknown as any)?.error?.code === ErrorCodes.MethodNotFound && (unknown as any).result === undefined,
      JSON.stringify(unknown),
    )
  } finally {
    rmSync(ws2, { recursive: true, force: true })
  }
}

// --- G7: advertised constants vs the modules that enforce them --------------

async function testAdvertisedConstants(): Promise<void> {
  console.log("G7: advertised constants match their owner modules")
  const { caps } = await wiredCaps()
  // Owner modules are imported dynamically: the server itself loads them with
  // `await import(...)` to keep the graph engine out of its startup module
  // graph (contract §7.3), and the gate reads them the same way.
  const graph = await import("../../src/lsp/graph_request")
  const impact = await import("../../src/lsp/impact_request")
  const freshness = await import("../../src/lsp/freshness")

  check(
    "G7: advertised graphProvider.schemaVersion === GRAPH_SCHEMA_VERSION",
    (caps as any).graphProvider?.schemaVersion === graph.GRAPH_SCHEMA_VERSION,
    `${(caps as any).graphProvider?.schemaVersion} vs ${graph.GRAPH_SCHEMA_VERSION}`,
  )
  check(
    "G7: advertised impactProvider.schemaVersion === IMPACT_SCHEMA_VERSION",
    (caps as any).impactProvider?.schemaVersion === impact.IMPACT_SCHEMA_VERSION,
    `${(caps as any).impactProvider?.schemaVersion} vs ${impact.IMPACT_SCHEMA_VERSION}`,
  )
  check(
    "G7: advertised stalenessProvider.syncModel.debounceMs === DEBOUNCE_MS",
    (caps as any).stalenessProvider?.syncModel?.debounceMs === freshness.DEBOUNCE_MS,
    `${(caps as any).stalenessProvider?.syncModel?.debounceMs} vs ${freshness.DEBOUNCE_MS}`,
  )
  check(
    "G7: the staleness status union advertised equals the StaleMarker status union",
    JSON.stringify((caps as any).stalenessProvider?.marker?.status) ===
      JSON.stringify(["fresh", "stale", "missing", "unknown"]),
    JSON.stringify((caps as any).stalenessProvider?.marker?.status),
  )

  // The live handler must answer the shape the advertisement promises. If the
  // handler stops producing one of these fields, the advertisement is a lie
  // and this fails.
  const ws = tmpWorkspace()
  try {
    const server = new BbLspServer(ws)
    wireFeatures(server)
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const adv = (server.capabilities() as any).stalenessProvider
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "bb/staleness",
      params: { uri: "file://" + join(ws, "not-indexed.ts") },
    })
    const marker = (res as any)?.result
    check(
      "G7: the live bb/staleness answer carries exactly the advertised marker fields",
      !!marker &&
        Object.keys(marker).sort().join(",") === Object.keys(adv.marker).sort().join(",") &&
        marker.stale === true &&
        typeof marker.status === "string" &&
        (adv.marker.status as string[]).includes(marker.status) &&
        typeof marker.pendingReindex === "boolean",
      JSON.stringify(marker),
    )
    negative(
      "G7 negative: an unindexed file is NOT reported as fresh (silence is guilt, §4.3)",
      marker?.stale !== false,
      JSON.stringify(marker),
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
  check("G7: STALENESS_SCHEMA_VERSION is a positive integer", Number.isInteger(STALENESS_SCHEMA_VERSION) && STALENESS_SCHEMA_VERSION > 0)
}

// --- G8: declared sync + workspace model ------------------------------------

async function testSyncModel(): Promise<void> {
  console.log("G8: declared sync and workspace model")
  const { caps, methods } = await wiredCaps()

  // The sync model is filesystem-side. Advertising `textDocumentSync` would
  // tell a client to send did* notifications this server does not handle — a
  // capability we do not implement, which contract §2 calls a gate failure.
  negative(
    "G8 negative: textDocumentSync is NOT advertised (no did* handler exists)",
    (caps as any).textDocumentSync === undefined,
    JSON.stringify((caps as any).textDocumentSync),
  )
  const didMethods = methods.filter((m) => /^textDocument\/did/.test(m))
  check(
    "G8: the absence of textDocumentSyncAdvertisement is truthful (no did* handler is registered)",
    didMethods.length === 0,
    JSON.stringify(didMethods),
  )
  check(
    "G8: the advertised sync model declares client-side document sync as off",
    (caps as any).stalenessProvider?.syncModel?.clientDocumentSync === false,
    JSON.stringify((caps as any).stalenessProvider?.syncModel),
  )

  // Single-root is a declared limitation (contract §11.6) and must be
  // discoverable on the wire, not inferred from a request that never answers.
  const folders = (caps as any).workspace?.workspaceFolders
  negative(
    "G8 negative: workspaceFolders.supported is NOT claimed true (single-root only, §11.6)",
    folders?.supported === false,
    JSON.stringify(folders),
  )
  check(
    "G8: changeNotifications is declared off (the server registers no workspace/did* handler)",
    folders?.changeNotifications === false,
    JSON.stringify(folders),
  )
  // `workspace` is a declaration, not a handler-derived fact: present with zero
  // handlers too. If that ever changes, it becomes a handler entry by law.
  const bare = createServer(tmpWorkspace())
  const bareEntry = CAPABILITY_COVERAGE.find((e) => e.key === "workspace")
  check("G8: the workspace capability is declared static, not handler-derived", bareEntry?.kind === "static")
  check(
    "G8: the declared workspace capability is present even with zero handlers",
    (bare.capabilities() as any).workspace !== undefined,
    JSON.stringify(Object.keys(bare.capabilities())),
  )
  rmSync(bare.context.root, { recursive: true, force: true })
}

// --- G9/G10/G11: declared absence at the wire seam ----------------------------
//
// Contract §11.7: "for any file outside the launch-language set, the server
// responds with declared-absent semantics … and the absence is verifiable by a
// negative test. Silent empty results that look like 'no references found' are
// a violation."
//
// The components now COMPUTE an absence reason (hover's provenance.limitations,
// navigation's evidenceTier, document_highlight's evidenceTier). At the moment
// of this wave the WIRE threw it away at four sites, and in one case replaced a
// declared absence with -32603. The checks below are written BEFORE the fix
// (contract §11 F7: gate BEFORE fix) and are therefore RED at the commit this
// wave started from.

/** The server→client notifications produced by the last handleMessage call.
 *  Read defensively (`typeof ... === "function"`) so the check can exist before
 *  the channel does: pre-fix it reads as "no notifications", which FAILS,
 *  rather than throwing — the honest RED. */
function notificationsOf(server: any): any[] {
  return typeof server?.notifications === "function" ? server.notifications() : []
}
function absenceNotices(server: any): any[] {
  return notificationsOf(server).filter((n) => n?.method === "bb/absence")
}
function logNotices(server: any): any[] {
  return notificationsOf(server).filter((n) => n?.method === "window/logMessage")
}

/** A workspace with one REAL indexed symbol, so the success path can be told
 *  apart from the absence path. Without a real fixture, "no absence notice" on
 *  the success path would be vacuously true (the absence check would fail too,
 *  for the wrong reason). */
async function indexedWorkspace(): Promise<{ ws: string; projectId: string; dataDir: string; restore: () => void }> {
  // The file must hold a symbol with a real CALLER so references is non-empty
  // on the success path. A self-edge does not count: navigation resolves
  // references through brain_relationship, so an earlier fixture that made
  // `main` call itself produced `[]` and the success-path precondition failed —
  // which would have made "no absence notice" true for the wrong reason.
  const ws = tmpWorkspace()
  const dataDir = tmpWorkspace()
  // "function main(): void {}\nmain()\n" — `main` is indexed at line 0, and a
  // caller edge exists so references is non-empty on the success path.
  writeFileSync(
    join(ws, "main.ts"),
    "function main(): void {}\nfunction caller(): void {\n  main();\n}\n",
  )
  const projectId = createHash("sha1").update(canonicalOf(ws)).digest("hex").substring(0, 40)
  mkdirSync(join(dataDir, "projects", projectId), { recursive: true })
  const prevDataDir = process.env.BB_DATA_DIR
  process.env.BB_DATA_DIR = dataDir
  const { BrainDatabase } = await import("../../src/brain/database")
  const db = await BrainDatabase.getRawInstance(projectId)
  db.prepare(
    `INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)`,
  ).run("l1-file", projectId, join(ws, "main.ts"), "main.ts", "typescript", "l1-hash")
  const sym = db.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, symbol_type, line_start, line_end, byte_start, byte_end, gravity_score) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  // `main` at 1-based line 1, `caller` at 1-based line 2. navigation maps the
  // 0-based LSP position onto these 1-based index lines itself.
  sym.run("l1-main", projectId, "l1-file", "main", "function", 1, 1, 1, 3, 5)
  sym.run("l1-caller", projectId, "l1-file", "caller", "function", 2, 4, 26, 28, 3)
  const rel = db.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence, metadata) VALUES (?,?,?,?,?,?,?)`,
  )
  // caller → main, so `main` HAS a reference. A self-edge would not resolve.
  rel.run("l1-rel", projectId, "l1-caller", "l1-main", "calls", 0.9, JSON.stringify({ evidenceClass: "structural" }))
  return {
    ws,
    projectId,
    dataDir,
    restore: () => {
      if (prevDataDir === undefined) delete process.env.BB_DATA_DIR
      else process.env.BB_DATA_DIR = prevDataDir
      try { rmSync(ws, { recursive: true, force: true }) } catch {}
      try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
    },
  }
}

/** A file outside the routed extension set, inside a workspace. */
function writeUnroutable(ws: string, name = "notes.txt"): string {
  writeFileSync(join(ws, name), "hello\n")
  return join(ws, name)
}

const READ_METHODS: Array<{ method: string; params: (uri: string) => any; honestAbsence: (result: unknown) => boolean }> = [
  {
    method: "textDocument/hover",
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 } }),
    honestAbsence: (r) => r === null || r === undefined,
  },
  {
    method: "textDocument/definition",
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 } }),
    honestAbsence: (r) => r === null || r === undefined,
  },
  {
    method: "textDocument/documentHighlight",
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 } }),
    honestAbsence: (r) => r === null || r === undefined,
  },
  {
    method: "textDocument/references",
    params: (uri) => ({ textDocument: { uri }, position: { line: 0, character: 0 }, context: { includeDeclaration: false } }),
    // references returns Location[]; a declared absence is the empty list.
    // It is ALSO reached through the seam, which answers `null` — both are
    // honest ("nothing to list"), and LSP 3.18 permits `Location[] | null` for
    // references. The point of this lane is not which empty shape is chosen
    // but that the reason reaches the client either way.
    honestAbsence: (r) => (Array.isArray(r) && r.length === 0) || r === null || r === undefined,
  },
]

async function testDeclaredAbsenceCarrier(): Promise<void> {
  console.log("G9: declared absence reaches the client")
  const ws = tmpWorkspace()
  try {
    writeUnroutable(ws)
    const server = new BbLspServer(ws)
    wireFeatures(server)
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })

    for (const spec of READ_METHODS) {
      const uri = "file://" + join(ws, "notes.txt")
      const res: any = await server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: spec.method,
        params: spec.params(uri),
      })
      // 1. The standard result stays the honest LSP shape (never a fabricated
      //    field added to a standard result — Lane 4's protocol constraint).
      check(
        `G9: ${spec.method} answers the standard honest-absence shape on an unroutable file`,
        spec.honestAbsence(res?.result),
        JSON.stringify(res ?? null).slice(0, 160),
      )
      // 2. The reason is NOT discarded: it reaches the client out of band.
      const notices = absenceNotices(server)
      check(
        `G9: ${spec.method} emits a bb/absence notice naming the method`,
        notices.some((n) => n?.params?.method === spec.method),
        `notices=${JSON.stringify(notices ?? null).slice(0, 200)}`,
      )
    }

    // The reason must be the SPECIFIC one, not a generic null.
    const hoverServer = new BbLspServer(ws)
    wireFeatures(hoverServer)
    await hoverServer.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    await hoverServer.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: { textDocument: { uri: "file://" + join(ws, "notes.txt") }, position: { line: 0, character: 0 } },
    })
    const notice = absenceNotices(hoverServer)[0]?.params
    // Detail strings are built from real state; `?? null` keeps a missing notice
    // rendering as "null" in the FAIL line rather than crashing the run (a
    // crashed verifier reports no verdict at all — worse than a failure).
    const noticeText = JSON.stringify(notice ?? null).slice(0, 200)
    check(
      "G9: the notice reason is the specific one (language_not_launched), not a generic null",
      notice?.reason === "language_not_launched",
      noticeText,
    )
    check(
      "G9: the notice labels the language exactly as the single owner resolves it (null when unrouted, never invented)",
      Object.prototype.hasOwnProperty.call(notice ?? {}, "language") &&
        notice?.language === languageForPath(join(ws, "notes.txt")),
      `${JSON.stringify(notice ?? null).slice(0, 160)} | expected=${JSON.stringify(languageForPath(join(ws, "notes.txt")))}`,
    )
    check(
      "G9: the notice states the index was NOT searched (never-searched ≠ searched-and-empty)",
      notice?.searchedIndex === false,
      JSON.stringify(notice ?? null).slice(0, 200),
    )
    check(
      "G9: the notice carries a non-empty human-readable detail",
      typeof notice?.detail === "string" && notice.detail.length > 0,
      JSON.stringify(notice ?? null).slice(0, 200),
    )

    // The protocol's own diagnostic channel, so a client that does not know
    // bb/absence is still told by a standard mechanism.
    const logs = logNotices(hoverServer)
    check(
      "G9: window/logMessage is also emitted (the protocol's own channel)",
      logs.some((n) => typeof n?.params?.message === "string" && n.params.message.includes("language_not_launched")),
      `logs=${JSON.stringify(logs ?? null).slice(0, 200)}`,
    )
    check(
      "G9: the logMessage type is Info (a declared absence is not a fault)",
      logs.every((n) => n?.params?.type === 3),
      JSON.stringify(logs.map((n) => n?.params?.type)),
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }

  // The success path must stay SILENT. This check is only meaningful because
  // the next one proves the success path really answered — without it, "no
  // notice" would be true for the wrong reason (a tautological check).
  const fx = await indexedWorkspace()
  try {
    const server = new BbLspServer(fx.ws)
    wireFeatures(server)
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const uri = "file://" + join(fx.ws, "main.ts")
    const hoverRes: any = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: { textDocument: { uri }, position: { line: 0, character: 9 } },
    })
    check(
      "G9: PRECONDITION — hover on an indexed symbol really answers content (else the next check is vacuous)",
      hoverRes?.result !== null && hoverRes?.result !== undefined && hoverRes?.result?.contents !== undefined,
      JSON.stringify(hoverRes ?? null).slice(0, 160),
    )
    negative(
      "G9 negative: a SERVED request emits no absence notice and no logMessage (no logging on the success path)",
      absenceNotices(server).length === 0 && logNotices(server).length === 0,
      `absence=${JSON.stringify(absenceNotices(server)).slice(0, 120)} logs=${JSON.stringify(logNotices(server)).slice(0, 120)}`,
    )
    const refsRes: any = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/references",
      params: { textDocument: { uri }, position: { line: 0, character: 9 }, context: { includeDeclaration: false } },
    })
    check(
      "G9: PRECONDITION — references on an indexed symbol really answers a non-empty list (else the next check is vacuous)",
      Array.isArray(refsRes?.result) && refsRes.result.length > 0,
      JSON.stringify(refsRes ?? null).slice(0, 160),
    )
    negative(
      "G9 negative: a references request that FOUND references emits no absence notice (a found result is not an absence)",
      absenceNotices(server).filter((n) => n?.params?.method === "textDocument/references").length === 0,
      JSON.stringify(absenceNotices(server)).slice(0, 160),
    )
  } finally {
    fx.restore()
  }
}

/** The conflation that made a reason unusable: "we do not serve your language"
 *  and "we looked and found nothing" both arrive as an empty result. */
async function testAbsenceReasonIsNotConflated(): Promise<void> {
  console.log("G9b: never-searched is not searched-and-empty")
  const ws = tmpWorkspace()
  try {
    writeUnroutable(ws)
    // An unroutable file, and a ROUTABLE file that simply is not indexed. Both
    // answer an empty result; only the reason tells them apart.
    writeFileSync(join(ws, "orphan.ts"), "const x = 1\n")

    // Each request is measured on a FRESH server: the notice queue is per
    // request (the dispatch resets it), so reusing one server made the second
    // read the first request's notice and the comparison came out vacuous.
    const unroutableServer = new BbLspServer(ws)
    wireFeatures(unroutableServer)
    await unroutableServer.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    await unroutableServer.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/definition",
      params: { textDocument: { uri: "file://" + join(ws, "notes.txt") }, position: { line: 0, character: 0 } },
    })
    const unroutable = absenceNotices(unroutableServer).find((n) => n?.params?.method === "textDocument/definition")?.params
    check(
      "G9b: an unroutable file reports reason=language_not_launched, searchedIndex=false",
      unroutable?.reason === "language_not_launched" && unroutable?.searchedIndex === false,
      JSON.stringify(unroutable ?? null).slice(0, 200),
    )

    const indexedServer = new BbLspServer(ws)
    wireFeatures(indexedServer)
    await indexedServer.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    await indexedServer.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/definition",
      params: { textDocument: { uri: "file://" + join(ws, "orphan.ts") }, position: { line: 0, character: 0 } },
    })
    const notIndexed = absenceNotices(indexedServer).find((n) => n?.params?.method === "textDocument/definition")?.params
    check(
      "G9b: PRECONDITION — both requests produced a notice (else the comparison below is vacuous)",
      unroutable !== undefined && notIndexed !== undefined,
      `unroutable=${unroutable === undefined} notIndexed=${notIndexed === undefined}`,
    )
    check(
      "G9b: a routable-but-unindexed file reports reason=not_indexed, searchedIndex=true",
      notIndexed?.reason === "not_indexed" && notIndexed?.searchedIndex === true,
      JSON.stringify(notIndexed ?? null).slice(0, 200),
    )
    negative(
      "G9b negative: the two absences are NOT reported with the same reason (the conflation this lane exists to remove)",
      unroutable?.reason !== notIndexed?.reason,
      `both=${JSON.stringify(unroutable?.reason)}/${JSON.stringify(notIndexed?.reason)}`,
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

/**
 * The STRUCTURAL seam. The question this group answers is not "did the fix work"
 * but "where is the boundary between a component that CANNOT ANSWER (declared
 * absence) and a component that is BROKEN (internal error)", and the boundary
 * has to be defensible in both directions:
 *   - too narrow  → a handler that cannot answer leaks -32603 (lane 2's defect)
 *   - too broad   → a genuine bug is reported as "nothing here", which is the
 *                  same dishonesty with a friendlier face
 * Both directions are gated, and the broad one is the one that protects the
 * gate itself: if a blanket catch ever turns every fault into declared absence,
 * these checks fail and the suite cannot silently degrade.
 */
async function testDispatchSeamBoundary(): Promise<void> {
  console.log("G10: the declared-absence / internal-error boundary")

  // --- Direction 1 (narrow enough): a component that CANNOT answer. ----------
  const ws = tmpWorkspace()
  try {
    writeUnroutable(ws)
    const server = new BbLspServer(ws)
    wireFeatures(server)
    await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const res: any = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/documentHighlight",
      params: { textDocument: { uri: "file://" + join(ws, "notes.txt") }, position: { line: 0, character: 0 } },
    })
    negative(
      "G10 negative: an unroutable file does NOT reach the client as -32603 (lane 2's defect class)",
      res?.error?.code !== ErrorCodes.InternalError,
      JSON.stringify(res ?? null).slice(0, 200),
    )
    check(
      "G10: an unroutable file is answered as declared absence with a reason",
      absenceNotices(server).some((n) => n?.params?.method === "textDocument/documentHighlight"),
      JSON.stringify(absenceNotices(server)).slice(0, 200),
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }

  const bare = tmpWorkspace()
  try {
    const { PositionError } = await import("../../src/lsp/positions")

    // --- Direction 2 (broad enough): a component that IS broken stays loud. --
    const faulted = new BbLspServer(bare)
    faulted.register("bb/test-fault", () => {
      throw new TypeError("simulated component fault: this is a BUG, not an absence")
    })
    await faulted.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const faultRes: any = await faulted.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/test-fault" })
    check(
      "G10: a genuine unexpected fault is STILL -32603 (the seam must not swallow real bugs)",
      faultRes?.error?.code === ErrorCodes.InternalError,
      JSON.stringify(faultRes ?? null).slice(0, 200),
    )
    check(
      "G10: a genuine fault is NOT dressed up as a declared absence",
      absenceNotices(faulted).filter((n) => n?.params?.method === "bb/test-fault").length === 0,
      JSON.stringify(absenceNotices(faulted)).slice(0, 200),
    )
    check(
      "G10: a genuine fault names the client-actionable prefix, never a bare stack shape",
      typeof faultRes?.error?.message === "string" && !faultRes.error.message.includes("at Object."),
      JSON.stringify(faultRes?.error?.message).slice(0, 160),
    )

    // --- Direction 3: a DECLARED input error stays the client's to fix. -----
    const bad = new BbLspServer(bare)
    wireFeatures(bad)
    await bad.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const ch: any = await bad.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/prepareCallHierarchy",
      params: { textDocument: { uri: "" }, position: { line: 0, character: 0 } },
    })
    check(
      "G10: a DeclaredParamsError is still InvalidParams (M55.T2 unchanged)",
      ch?.error?.code === ErrorCodes.InvalidParams,
      JSON.stringify(ch ?? null).slice(0, 200),
    )

    // --- Direction 4: an out-of-range position is declared absence (§13.10). -
    const oor = new BbLspServer(bare)
    // Registered absentable, exactly as every real read handler is: the
    // PositionError branch is part of the opt-in seam, so the fixture must
    // opt in too (a non-opted-in handler keeps -32603, and that is asserted
    // separately below).
    oor.register("bb/test-position", () => {
      throw new PositionError("line 99 out of range (0..3)")
    }, { absentable: true })
    await oor.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const oorRes: any = await oor.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/test-position" })
    check(
      "G10: an out-of-range position is declared absence, NOT a wire error (§13.10)",
      oorRes?.error === undefined && oorRes?.result === null,
      JSON.stringify(oorRes ?? null).slice(0, 200),
    )
    check(
      "G10: the out-of-range absence names reason=unresolvable_location",
      absenceNotices(oor).some((n) => n?.params?.reason === "unresolvable_location"),
      JSON.stringify(absenceNotices(oor)).slice(0, 200),
    )

    // --- Direction 5: the seam is not a blanket catch. ----------------------
    // It must not fire for requests that carry no document at all: a fault in
    // one of those is a fault, and treating it as "nothing here" would be the
    // over-broad dishonesty.
    const plain = new BbLspServer(bare)
    plain.register("bb/test-nodoc-fault", () => {
      throw new RangeError("boom")
    })
    await plain.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const plainRes: any = await plain.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/test-nodoc-fault" })
    check(
      "G10: a fault on a request with no document is still -32603 (the seam is not a blanket catch)",
      plainRes?.error?.code === ErrorCodes.InternalError,
      JSON.stringify(plainRes ?? null).slice(0, 200),
    )

    // --- Direction 6: the absent channel is one-way. -----------------------
    const oneWay = new BbLspServer(bare)
    await oneWay.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
    const inbound: any = await oneWay.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/absence", params: {} })
    check(
      "G10: bb/absence is server→client only; an inbound request is MethodNotFound, never a fabricated record",
      inbound?.error?.code === ErrorCodes.MethodNotFound && inbound?.result === undefined,
      JSON.stringify(inbound ?? null).slice(0, 200),
    )
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
}

/** The absence channel is an advertised capability, under the same exhaustive
 *  table law as every other key (contract §2, and this file's wave-1 rule). */
async function testAbsenceCapabilityAdvertised(): Promise<void> {
  console.log("G11: the absence channel is advertised")
  const ws = tmpWorkspace()
  try {
    const server = new BbLspServer(ws)
    wireFeatures(server)
    const caps = server.capabilities()
    const advertised = (caps as any).absenceProvider
    const carried = (serverAbsenceModule() as any).ABSENCE_SCHEMA_VERSION
    check(
      "G11: the absence channel is advertised with a schemaVersion a client can gate on",
      advertised !== undefined && Number.isInteger(advertised?.schemaVersion) && advertised?.schemaVersion > 0,
      JSON.stringify(advertised ?? null).slice(0, 200),
    )
    check(
      "G11: the advertisement names both carriers, so a client knows where to listen",
      advertised?.carriers !== undefined,
      JSON.stringify(advertised ?? null).slice(0, 200),
    )
    // The advertisement must match the constant the notification actually
    // carries — a client that gates on 1 and receives 2 is worse than a client
    // that was never told.
    // The strongest form of the drift check: the version ON THE WIRE must equal the
  // module's exported constant. Comparing the advertisement against a
  // second copy of the constant read from the same module proved nothing — it
  // passed with the notice hardcoding a literal, because both sides then read
  // the same unchanged constant. Only reading the value the client actually
  // receives can fail. Found by the mutant that survived the weaker check.
    const ws3 = tmpWorkspace()
    try {
      writeUnroutable(ws3)
      const live = new BbLspServer(ws3)
      wireFeatures(live)
      await live.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      await live.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/definition",
        params: { textDocument: { uri: "file://" + join(ws3, "notes.txt") }, position: { line: 0, character: 0 } },
      })
      const onTheWire = absenceNotices(live)[0]?.params?.schemaVersion
      check(
        "G11: the schemaVersion the CLIENT receives equals the module's exported constant",
        onTheWire === carried && onTheWire === advertised?.schemaVersion,
        `onTheWire=${JSON.stringify(onTheWire)} constant=${JSON.stringify(carried)} advertised=${JSON.stringify(advertised?.schemaVersion)}`,
      )
    } finally {
      rmSync(ws3, { recursive: true, force: true })
    }
    negative(
      "G11 negative: bb/absence is NOT an inbound request handler (advertisement must not imply a callable method)",
      !server.implementedMethods().includes("bb/absence"),
      JSON.stringify(server.implementedMethods()),
    )
  } finally {
    rmSync(ws, { recursive: true, force: true })
  }
}

/** The server module's own absence constants, read by NAME so this file
 *  compiles against a server that does not export them yet (the gate is
 *  written before the fix, contract §11 F7). Pre-fix this reads `{}` and the
 *  comparison fails honestly. */
function serverAbsenceModule(): Record<string, unknown> {
  return serverAbsenceExports as Record<string, unknown>
}
/** `any` on purpose: the point of the check is that the export EXISTS and
 *  matches, so the type system cannot be allowed to vouch for it. */
const serverAbsenceExports: any = await import("../../src/lsp/server")

// --- Mutation suite (proves every gate above CAN FAIL) -----------------------

/**
 * `oracle` is REQUIRED — there is no default, because a mutant with no oracle
 * can only ever be "caught" by failing to load, which proves the mutant broke
 * and not that an assertion observed the defect (contract §8.7). It returns
 * true when the oracle OBSERVED this mutant's defect.
 */
type Mutant = {
  name: string
  from: string
  to: string
  /**
   * An optional SECOND edit in the same target file, applied after the first.
   *
   * It exists for one measured reason, recorded at its only use site: some
   * guards are enforced at TWO places in this file, so removing one leaves the
   * behaviour unchanged and the mutant "survives" while measuring nothing. When
   * the DEFECT being named is "the guard is not enforced anywhere", the honest
   * mutation removes it from everywhere. A single-site mutant for a two-site
   * guard is not a stricter test — it is an unobservable one, and §8.3 counts
   * unobservable as failed, not as passed.
   */
  alsoFrom?: string
  alsoTo?: string
  target?: "server" | "launch-languages"
  oracle: (mod: any) => Promise<boolean>
}

/** A frame-bearing conversation against a fresh server. */
async function withServer<T>(mod: any, body: (server: any) => Promise<T>): Promise<T> {
  const ws = mkdtempSync(join(tmpdir(), "bblsp-mut-"))
  try {
    return await body(new mod.BbLspServer(ws))
  } finally {
    try { rmSync(ws, { recursive: true, force: true }) } catch {}
  }
}

async function initialized(mod: any, server: any): Promise<void> {
  await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
}

/** Coverage read the same way the G6 checks read it, so a mutant that breaks
 *  the table is observed by the same law that observes it in the real run. */
async function mutantHasUncoveredMethod(mod: any): Promise<boolean> {
  return withServer(mod, async (server) => {
    mod.wireFeatures(server)
    await initialized(mod, server)
    const methods: string[] = server.implementedMethods()
    const table: any[] = mod.CAPABILITY_COVERAGE
    const uncovered = methods.filter((m) => !table.some((e) => e.methods.includes(m)))
    return uncovered.length > 0
  })
}

const MUTANTS: Mutant[] = [
  {
    name: "lifecycle: accept requests before initialize",
    from: 'if (this.lifecycleState === "uninitialized" && method !== "initialize" && method !== "exit")',
    to: 'if (false && this.lifecycleState === "uninitialized" && method !== "initialize" && method !== "exit")',
    // Observed by G1's own assertion (the early request must carry -32002):
    // with the guard gone the request falls through to feature dispatch, which
    // answers MethodNotFound (-32601) instead of ServerNotInitialized. The
    // oracle mirrors the gate's assertion exactly — an oracle that checked
    // something else would be the §8.7 tautological check in a new coat.
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const early = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "textDocument/hover", params: {} })
        return (early as any)?.error?.code !== -32002
      }),
  },
  {
    name: "lifecycle: wrong error code pre-init",
    from: "ServerNotInitialized: -32002",
    to: "ServerNotInitialized: -32600",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const early = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "textDocument/hover", params: {} })
        return (early as any)?.error?.code !== -32002
      }),
  },
  {
    // Proves G1's second-shutdown NEGATIVE case can fail: with the post-shutdown
    // guard gone, a repeated shutdown is answered as a fresh shutdown and the
    // terminal state machine silently becomes re-enterable.
    name: "lifecycle: no rejection after shutdown (state machine re-enterable)",
    from: 'if (this.lifecycleState === "shutdown" && method !== "exit") {',
    to: 'if (false && this.lifecycleState === "shutdown" && method !== "exit") {',
    oracle: (mod) =>
      withServer(mod, async (server) => {
        await initialized(mod, server)
        await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "shutdown" })
        const again = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "shutdown" })
        return (again as any)?.error?.code !== -32600
      }),
  },
  {
    // Proves G5's declared-absence negative can fail: an extension outside the
    // map must answer null, never a launch language that would render as
    // "nothing found" for a file the server cannot read (§11.7).
    name: "languages: invent a launch language for an unmapped extension",
    target: "launch-languages",
    from: "return map[ext] ?? null",
    to: 'return map[ext] ?? "java"',
    oracle: async (mod) => mod.languageForPath("notes.cobol") !== null,
  },
  {
    name: "capabilities: advertise hover unconditionally",
    from: 'if (this.handlers.has("textDocument/hover")) caps.hoverProvider = true',
    to: "caps.hoverProvider = true",
    oracle: (mod) =>
      withServer(mod, async (server) => (server.capabilities().hoverProvider === true ? true : false)),
  },
  {
    name: "capabilities: callHierarchy advertised without outgoing",
    from: 'this.handlers.has("callHierarchy/outgoingCalls")\n    ) {',
    to: "true\n    ) {",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        server.register("textDocument/prepareCallHierarchy", () => ({}))
        server.register("callHierarchy/incomingCalls", () => ({}))
        return server.capabilities().callHierarchyProvider !== undefined
      }),
  },
  {
    name: "project: drop realpath canonicalization",
    from: "canonical = realpathSync.native(resolved)",
    to: "canonical = resolved",
    // Observed by G4: a symlinked root keeps the link, so root and projectId
    // are both wrong. Detectable on every platform (the gate builds its own
    // symlink), not only where tmpdir happens to be one.
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const real = mkdtempSync(join(tmpdir(), "bblsp-symlink-target-"))
        const link = join(real, "..", `bblsp-symlink-${process.pid}-${real.slice(-6)}`)
        symlinkSync(real, link, "dir")
        try {
          const s2 = new mod.BbLspServer(link)
          return s2.context.root !== real
        } finally {
          try { rmSync(link, { recursive: true, force: true }) } catch {}
          try { rmSync(real, { recursive: true, force: true }) } catch {}
        }
      }),
  },
  {
    name: "languages: treat every language as launch language",
    // M29.R2: isLaunchLanguage lives in the single-owner module now — the
    // mutant plants there (its own oracle: the break is cobol treated as
    // launch).
    target: "launch-languages",
    from: "return language !== null && (LAUNCH_LANGUAGES as readonly string[]).includes(language)",
    to: "return true",
    oracle: async (mod) => mod.isLaunchLanguage("cobol") === true,
  },
  {
    name: "lifecycle: shutdown does not set state",
    from: 'this.record("in", "shutdown")\n      this.lifecycleState = "shutdown"',
    to: 'this.record("in", "shutdown")',
    oracle: (mod) =>
      withServer(mod, async (server) => {
        await initialized(mod, server)
        await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "shutdown" })
        return server.state() !== "shutdown"
      }),
  },
  {
    name: "transport: wrong framing separator",
    from: 'output.write(`Content-Length: ${body.length}\\r\\n\\r\\n`)',
    to: 'output.write(`Content-Length: ${body.length}\\n\\n`)',
    // Observed by G3: a real request still produces output, but the header
    // terminator is no longer CRLFCRLF — the exact corruption that makes a
    // stock client die with "Header must provide a Content-Length property".
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const clientOut = new PassThrough()
        const serverOut = new PassThrough()
        const chunks: Buffer[] = []
        serverOut.on("data", (c: Buffer) => chunks.push(c))
        const runPromise = server.run(clientOut, serverOut)
        const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), "utf8")
        clientOut.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "utf8"), body]))
        clientOut.end()
        await Promise.race([runPromise, new Promise((r) => setTimeout(r, 3000))])
        const raw = Buffer.concat(chunks).toString("utf8")
        return !/^Content-Length: \d+\r\n\r\n/.test(raw)
      }),
  },
  {
    name: "initialize: omit protocolVersion",
    from: 'protocolVersion: "3.18",',
    to: "",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const init = await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
        return (init as any)?.result?.protocolVersion !== "3.18"
      }),
  },
  {
    // M53 live-session defect (2026-09-12): the hover handler leaked the
    // component envelope ({contents: null, provenance}) onto the wire. The
    // stock client converter throws on contents:null ("reading 'kind'") and
    // VS Code logs "provider FAILED" — the declared-absence contract rendered
    // as a crash. The wire law: hover answers a PROTOCOL Hover (null when
    // absent; contents+range+data when present), like every other read
    // method. The oracle hovers a position with nothing indexed: the mutant
    // leaks the envelope (contents !== undefined), the honest server answers
    // plain null.
    name: "hover: leak the component envelope onto the wire",
    from: "if (r.contents === null || r.range === null || r.data === null) {",
    to: "if (false) {",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        const res = await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/hover",
          params: { textDocument: { uri: "file://" + join(server.context.root, "nothing.ts") }, position: { line: 0, character: 0 } },
        })
        const err = (res as any)?.error
        const result = (res as any)?.result
        // Wire law: absence is `result: null` — never an envelope object, and
        // never an ERROR response either. The mutant leaks the envelope, which
        // then crashes on `r.range.start` and surfaces as InternalError
        // (-32603) — "the declared-absence contract rendered as a crash", the
        // exact M53 failure. Both are defects, so both are detected.
        // Any error response for an ABSENT symbol is a defect: absence is
        // `result: null`, never an error. (The mutant leaks the envelope, which
        // then crashes on `r.range.start` and surfaces as InternalError
        // -32603 — "the declared-absence contract rendered as a crash", the
        // exact M53 failure. A leaked envelope with a non-null range would show
        // up as a non-null result instead.)
        if (err !== undefined) return true
        return result !== null
      }),
  },
  // --- The advertisement-reachability defects this gate now pins -------------
  {
    name: "advertisement: bb/staleness reachable only blind (key removed)",
    from: 'if (this.handlers.has("bb/staleness")) caps.stalenessProvider = stalenessProviderPayload()',
    to: "if (false) caps.stalenessProvider = stalenessProviderPayload()",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        return server.capabilities().stalenessProvider === undefined
      }),
  },
  {
    name: "advertisement: bb/impact reachable only blind (key removed)",
    from: 'if (this.handlers.has("bb/impact")) caps.impactProvider = impactProviderPayload()',
    to: "if (false) caps.impactProvider = impactProviderPayload()",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        return server.capabilities().impactProvider === undefined
      }),
  },
  {
    // Reverse direction of G6: a key advertised with nothing serving it. Also
    // the complement stance (§7.1 bans completion) advertised as a phantom.
    name: "advertisement: phantom capability key with no handler",
    from: "caps.workspace = workspaceProviderPayload()",
    to: "caps.workspace = workspaceProviderPayload(); caps.completionProvider = true",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        const caps = server.capabilities()
        const declared = new Set(mod.CAPABILITY_COVERAGE.map((e: any) => e.key))
        return Object.keys(caps).some((k) => !declared.has(k))
      }),
  },
  {
    name: "advertisement: claim multi-root workspace-folder support we do not have",
    from: "return { workspaceFolders: { supported: false, changeNotifications: false } }",
    to: "return { workspaceFolders: { supported: true, changeNotifications: false } }",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const folders = (server.capabilities() as any).workspace?.workspaceFolders
        return folders?.supported === true
      }),
  },
  {
    name: "advertisement: textDocumentSync with no did* handler behind it",
    from: "caps.workspace = workspaceProviderPayload()",
    to: "caps.workspace = workspaceProviderPayload(); caps.textDocumentSync = 1",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        return (server.capabilities() as any).textDocumentSync !== undefined
      }),
  },
  {
    // Table drift: the entry survives but claims the wrong method, so the real
    // bb/impact handler becomes "uncovered" — exactly the defect class the
    // deleted IMPLEMENTED_METHODS comment claimed was impossible.
    name: "coverage: bb/impact entry claims the wrong method",
    from: 'methods: ["bb/impact"],',
    to: 'methods: ["bb/impact-wrong-name"],',
    oracle: mutantHasUncoveredMethod,
  },
  {
    name: "coverage: bb/staleness entry claims the wrong method",
    from: 'methods: ["bb/staleness"],',
    to: 'methods: ["bb/stale"],',
    oracle: mutantHasUncoveredMethod,
  },
  {
    // The phantom-promise direction: a table entry for a method NO handler
    // serves. Coverage looks fine on paper while the client gets
    // MethodNotFound from the wire.
    name: "coverage: table declares a method no handler serves",
    from: 'key: "documentSymbolProvider", methods: ["textDocument/documentSymbol"], kind: "handler", value: () => true },',
    to: 'key: "documentSymbolProvider", methods: ["textDocument/documentSymbol", "textDocument/documentColor"], kind: "handler", value: () => true },',
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        const methods: string[] = server.implementedMethods()
        const table: any[] = mod.CAPABILITY_COVERAGE
        const promised = new Set(table.flatMap((e) => e.methods))
        return [...promised].some((m) => !methods.includes(m))
      }),
  },
  {
    // Proves G6's third direction (the table and the emission site agree) can
    // fail. This is the drift the deleted comment claimed was impossible: two
    // structures, same key, different payload.
    name: "coverage: table declares a payload capabilities() does not emit",
    from: 'key: "impactProvider",\n    methods: ["bb/impact"],\n    kind: "handler",\n    value: impactProviderPayload,',
    to: 'key: "impactProvider",\n    methods: ["bb/impact"],\n    kind: "handler",\n    value: () => ({ schemaVersion: 42 }),',
    oracle: (mod) =>
      withServer(mod, async (server) => {
        const entry = mod.CAPABILITY_COVERAGE.find((e: any) => e.key === "impactProvider")
        // The comparison must run on a server that HAS the handler: with it
        // absent, this mutant is indistinguishable from "key not advertised".
        server.register("bb/impact", () => ({}))
        const emitted = server.capabilities().impactProvider
        return JSON.stringify(emitted) !== JSON.stringify(entry.value())
      }),
  },
  {
    // Proves G7's debounce assertion can fail: the advertised sync model must
    // carry the owner's DEBOUNCE_MS, not a plausible-looking number.
    name: "advertisement: debounce drifts from DEBOUNCE_MS",
    from: "debounceMs: 300,",
    to: "debounceMs: 1000,",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        return (server.capabilities() as any).stalenessProvider?.syncModel?.debounceMs !== 300
      }),
  },
  // --- The declared-absence carrier (G9/G9b/G10/G11). Each of these plants the
  // --- defect the corresponding check exists to catch, INCLUDING the two that
  // --- prove the carrier can itself fail (the log dropped, the reason stripped)
  // --- and the one that proves the seam is not a blanket catch.
  {
    // The carrier stops carrying. G9 observes: no notice, silence again.
    name: "absence: the reason is discarded again (the original defect, re-planted)",
    from: "if (error instanceof DeclaredParamsError) {",
    to: "if (error instanceof DeclaredParamsError || true) {",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/definition",
          params: { textDocument: { uri: "file://" + join(server.context.root, "nothing.ts") }, position: { line: 0, character: 0 } },
        })
        // Observed the way G9 observes it: no bb/absence notice reached the client.
        return typeof server.notifications === "function" && server.notifications().filter((n: any) => n.method === "bb/absence").length === 0
      }),
  },
  {
    // The notice arrives but the REASON is gone — the worst outcome, because a
    // client sees "something was declared" with nothing to declare. G9's
    // specific-reason checks are what observe this.
    // Anchored in the hover handler, the one place that computes the reason from
  // `provenance.limitations` — so the oracle hovers. Stripping the reason here
  // leaves a notice that announces an absence while declaring nothing, which
  // is worse than no notice at all.
  name: "absence: the notice is emitted but the reason field is stripped",
    from: 'reason: notLaunched ? "language_not_launched" : "not_indexed",',
    to: 'reason: undefined as any,',
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/hover",
          params: { textDocument: { uri: "file://" + join(server.context.root, "nothing.ts") }, position: { line: 0, character: 0 } },
        })
        const notices = server.notifications().filter((n: any) => n.method === "bb/absence")
        // Observed as G9 observes it: a notice exists but carries no reason.
        return notices.length > 0 && notices.some((n: any) => n.params?.reason === undefined)
      }),
  },
  {
    // The human line is dropped, leaving only the machine channel. G9 checks
    // window/logMessage independently, so losing it fails the gate.
    name: "absence: the window/logMessage carrier is dropped",
    from: 'this.notify("window/logMessage", {',
    to: "if (false) this.notify(\"window/logMessage\", {",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/definition",
          params: { textDocument: { uri: "file://" + join(server.context.root, "nothing.ts") }, position: { line: 0, character: 0 } },
        })
        return typeof server.notifications === "function" && server.notifications().filter((n: any) => n.method === "window/logMessage").length === 0
      }),
  },
  {
    // searchedIndex is what separates "never searched" from "searched, nothing
    // there" — the exact conflation G9b exists to remove. Drop it and the two
    // cases become indistinguishable to a client again.
    name: "absence: searchedIndex flipped, re-conflating never-searched with searched-and-empty",
    from: "    searchedIndex: !notLaunched,\n    totalCount: null,\n  }\n}",
    to: "    searchedIndex: true,\n    totalCount: null,\n  }\n}",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        // An unroutable file is the case where searchedIndex must be FALSE, so
        // the fixture creates one (the guard classifies by the launch set, not
        // by the file's existence, but a real file keeps this honest).
        writeFileSync(join(server.context.root, "notes.txt"), "hello\n")
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/definition",
          params: { textDocument: { uri: "file://" + join(server.context.root, "notes.txt") }, position: { line: 0, character: 0 } },
        })
        const unroutable = server.notifications()
          .filter((n: any) => n.method === "bb/absence")
          .find((n: any) => n.params?.reason === "language_not_launched")?.params
        return unroutable?.searchedIndex === true
      }),
  },
  {
    // The DANGEROUS one: a blanket catch. Every fault becomes declared absence,
    // so a genuinely broken server renders as "nothing here" — the same
    // dishonesty with a friendlier face. G10's "still -32603" checks observe it.
    name: "seam: blanket catch turns a genuine fault into declared absence",
    // Planted as the REAL blanket-catch defect: the internal-error FALLBACK answers
    // declared absence instead of -32603. Widening the type check instead would
    // make `error.absence` undefined and throw inside the catch, so the mutant
    // would be "caught" only by a load failure — which this suite deliberately
    // does not count as a catch.
    from:
      "this.record(\"out\", method, ErrorCodes.InternalError)\n        return this.errorResponse(message.id, ErrorCodes.InternalError, error?.message ?? String(error))",
    to:
      "this.emitAbsence({ method, reason: \"not_indexed\", language: null, detail: \"something went wrong\", evidenceTier: null, searchedIndex: true, totalCount: null })\n        this.record(\"out\", method)\n        return { jsonrpc: JSONRPC, id: message.id, result: null }",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        server.register("bb/test-fault", () => {
          throw new TypeError("simulated component fault")
        }, { absentable: true })
        await initialized(mod, server)
        const res: any = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/test-fault" })
        // Observed as G10 observes it: the fault is no longer loud.
        return res?.error?.code !== -32603
      }),
  },
  {
    // WHY THIS MUTANT WAS REPLANTED, and the finding behind it.
    //
    // The previous version of this entry removed the seam's message match and
    // drove `textDocument/documentHighlight` at a `.txt` file, expecting
    // -32603. It SURVIVED on the merged tree, and the reason is a real
    // finding rather than a broken anchor (the anchor was present; the
    // mutation applied; the oracle simply could not observe the defect):
    //
    //   document_highlight.ts catches `parseForSafety` ITSELF and returns
    //   declared absence, so ASTEngine never throws `Unsupported file type` on
    //   that path any more. The component fixed the defect at its own call
    //   site, the seam's message arm became unreachable through this handler,
    //   and there was nothing left for the mutant to remove. A mutant that
    //   cannot fail is worse than no mutant — it reports coverage.
    //
    // What the seam's message arm is FOR, now that it is stated as a fact:
    // it is the BACKSTOP for a handler that forgets its own guard. Both real
    // handlers guard themselves today, so nothing reaches it — but nothing
    // stops a THIRD handler from forgetting, and the arm is what stops that
    // user's -32603. The mutant therefore drives a handler that reproduces
    // lane 2's ORIGINAL defect shape (an unguarded parse inside an absentable
    // handler), which is the class the arm exists to catch.
    //
    // The stimulus is the REAL engine error, obtained by asking the engine
    // itself, not a hand-written string. An oracle that constructed its own
    // `new Error("Unsupported file type")` would pass even if the engine
    // reworded — the §8.7 tautological check, in a new coat.
    name: "seam: the unroutable-file backstop is removed (an unguarded handler's parse fault leaks -32603)",
    from: 'error.message.startsWith(ASTENGINE_UNROUTABLE_PREFIX)',
    to: "false",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        // The pre-lane-2 shape: a handler that calls the parse WITHOUT a guard.
        server.register(
          "bb/test-unguarded-parse",
          async (params: any) => {
            const { parseForSafety } = await import("../../src/ast/safety-primitives")
            const filePath = params?.textDocument?.path ?? ""
            const content = readFileSync(filePath, "utf8")
            const safety = await parseForSafety(filePath, content)
            return safety.occurrences.length
          },
          { absentable: true },
        )
        await initialized(mod, server)
        writeFileSync(join(server.context.root, "notes.txt"), "hello\n")
        const res: any = await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "bb/test-unguarded-parse",
          params: { textDocument: { uri: "file://" + join(server.context.root, "notes.txt"), path: join(server.context.root, "notes.txt") } },
        })
        // The defect is observed: the engine's own "Unsupported file type"
        // reached the client as an internal error.
        return res?.error?.code === ErrorCodes.InternalError
      }),
  },
  {
    // The TYPED arm, which is the one every new handler is meant to use, gets
    // its own mutant. Without it the typed path could be deleted and only the
    // message arm would keep the suite green — the class "the seam recognises
    // unroutability by type" would be reported by no assertion at all.
    //
    // The stimulus is the declared TYPE raised by a handler, which is exactly
    // how a future component is meant to signal, so this mutant fails if the
    // `error instanceof DocumentUnroutable` test is dropped or narrowed.
    //
    // MEASURED, and it is why this mutant plants TWO edits: the typed signal
    // is recognised in TWO places — the registration wrapper
    // (`asDocumentUnroutable`, which converts it to a DeclaredAbsenceThrow) and
    // the dispatch catch (which answers it directly). Removing only ONE of the
    // two changes nothing observable, because the other still answers the
    // request with declared absence. A mutant that plants one edit and watches
    // the wire not change is not a caught mutant; it is a measurement of the
    // seam's redundancy. The DEFECT this names is "the typed signal is not
    // recognised anywhere", so the mutation removes it from both sites, which
    // is the only shape in which the defect exists.
    name: "seam: the typed unroutable signal is ignored (a handler raising DocumentUnroutable leaks -32603)",
    from: "if (error instanceof DocumentUnroutable) return error",
    to: "if (error instanceof TypeError) return error",
    // The second site, applied after the first. See the comment above: the
    // defect requires removing the recognition from BOTH.
    alsoFrom: "if (absentable && error instanceof DocumentUnroutable) {",
    alsoTo: "if (absentable && error instanceof TypeError) {",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        server.register(
          "bb/test-typed-unroutable",
          () => {
            // Built from the MUTANT MODULE's own class, so `instanceof` in the
            // seam resolves against the same constructor. A class imported
            // from the pristine module would make `instanceof` false and the
            // oracle would be measuring nothing.
            throw new mod.DocumentUnroutable("this file type is outside the routed set")
          },
          { absentable: true },
        )
        await initialized(mod, server)
        const res: any = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/test-typed-unroutable", params: {} })
        return res?.error?.code === ErrorCodes.InternalError
      }),
  },
  {
    // Logging on the SUCCESS path: the channel that always talks is a channel
    // the user learns to ignore. G9's negative check observes it.
    name: "absence: a served request also emits a notice (noise on the success path)",
    from: "const result = await handler(message.params)\n        this.record(\"out\", method)",
    to: "const result = await handler(message.params)\n        this.notify(\"bb/absence\", { schemaVersion: 1, method, reason: \"not_indexed\", language: null, detail: \"noise\", evidenceTier: null, searchedIndex: true, totalCount: null })\n        this.record(\"out\", method)",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        server.register("bb/test-served", () => ({ ok: true }))
        await initialized(mod, server)
        await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "bb/test-served" })
        return server.notifications().filter((n: any) => n.method === "bb/absence").length > 0
      }),
  },
  {
    // The advertised channel vanishes while the notices keep flowing: a client
    // has no way to learn the carrier exists. G11 observes.
    name: "absence: the channel is emitted but never advertised",
    from: "caps.absenceProvider = absenceProviderPayload()",
    to: "void absenceProviderPayload()",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        return server.capabilities().absenceProvider === undefined
      }),
  },
  {
    // The advertised version drifts from the emitted one: a client that gates
    // on 1 and receives 2 is worse off than a client that was never told.
    // A first attempt at this mutant replaced the constant reference with a
  // literal `1` — and SURVIVED, because at the current constant the literal
  // and the constant are equal, so the mutant changed nothing observable. That
  // is a tautological mutant and the suite was right to refuse it: the defect
  // is the STALENESS of a hardcoded literal, so the literal must differ from
  // the constant for the defect to exist at all.
  name: "absence: the notice hardcodes a version literal that no longer tracks the constant",
    from: "this.notify(ABSENCE_METHOD, { schemaVersion: ABSENCE_SCHEMA_VERSION, ...absence })",
    to: "this.notify(ABSENCE_METHOD, { schemaVersion: 999, ...absence })",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        await initialized(mod, server)
        writeFileSync(join(server.context.root, "notes.txt"), "hello\n")
        await server.handleMessage({
          jsonrpc: "2.0",
          id: 2,
          method: "textDocument/definition",
          params: { textDocument: { uri: "file://" + join(server.context.root, "notes.txt") }, position: { line: 0, character: 0 } },
        })
        // Observed as G11 observes it: the notice's own version no longer comes
        // from the constant the advertisement is built from.
        const carried = server.notifications().find((n: any) => n.method === "bb/absence")?.params?.schemaVersion
        const declared = mod.ABSENCE_SCHEMA_VERSION
        return carried !== declared
      }),
  },
  {
    // The advertised number must track the module that ENFORCES it.
    name: "advertisement: staleness schema version drifts from its owner constant",
    from: "export const STALENESS_SCHEMA_VERSION = 1",
    to: "export const STALENESS_SCHEMA_VERSION = 7",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        const advertised = (server.capabilities() as any).stalenessProvider?.schemaVersion
        return advertised !== 1
      }),
  },
  {
    name: "advertisement: impact schema version drifts from IMPACT_SCHEMA_VERSION",
    from: "  return { schemaVersion: 1 }\n}\n\n/** The declared-absence channel advertisement",
    to: "  return { schemaVersion: 99 }\n}\n\n/** The declared-absence channel advertisement",
    oracle: (mod) =>
      withServer(mod, async (server) => {
        mod.wireFeatures(server)
        return (server.capabilities() as any).impactProvider?.schemaVersion !== 1
      }),
  },
]

/** Load a component copy planted beside its original, so the copy's relative
 *  imports resolve exactly as the original's do. Returns the module. */
async function loadCopyBesideOriginal(target: "server" | "launch-languages", source: string): Promise<any> {
  const dir = join(ROOT, "src", "lsp")
  const copy = join(dir, `${target === "server" ? "server" : "launch_languages"}.mutant.${process.pid}.${copySeq++}.ts`)
  writeFileSync(copy, source)
  try {
    return await import(copy)
  } finally {
    try { rmSync(copy, { force: true }) } catch {}
  }
}
let copySeq = 0

/** The source text of the file a mutant claims to mutate, resolved from the
 *  mutant's own `target`. A mutant that names no target mutates server.ts. */
const mutantTargetReader: SourceReader = (mutant) => {
  const target = (mutant as unknown as { target?: string }).target
  return readFileSync(target === "launch-languages" ? LANGUAGES_COMPONENT : COMPONENT, "utf8")
}

/**
 * G-UNROUTABLE-TYPED — the seam recognises unroutability by TYPE, and the one
 * foreign-message arm it keeps is drift-gated.
 *
 * The defect this gates, in the order it actually happened here:
 *
 *   1. The seam recognised unroutability only by matching
 *      `ASTEngine.parseTree`'s message text. That is a string literal in
 *      another module, and nothing checked that the two stayed in step. The
 *      gate's own limitations entry DESCRIBED the coupling — which is a
 *      comment, and a gate that reads a comment cannot fail (the same mistake
 *      as the anchor that matches nothing, one layer up).
 *   2. The mutation that was supposed to catch it could not, because the
 *      handler it drove had fixed the defect at its own call site and the seam's
 *      arm was no longer reachable through it. So the suite reported a coverage
 *      number for a class nothing observed.
 *
 * So this asserts the thing that can actually break, as a structural fact:
 *   (a) `server.ts` classifies unroutability through ONE named function
 *       (`asDocumentUnroutable`) whose TYPED arm tests the declared class —
 *       proven by planting a `TypeError` test in place of it and requiring the
 *       assertion to fire;
 *   (b) the foreign-message arm is a NAMED constant, not an inline literal,
 *       and that constant still prefixes the message `ASTEngine.parseTree`
 *       actually throws in src/ast/engine.ts — proven by planting a reworded
 *       engine and requiring the assertion to fire.
 *
 * Both self-tests are the F7 rule: the assertion is mutation-tested, so a green
 * here means "this class is gated", not "nothing was checked".
 */
function testUnroutableTypedSignal(): void {
  console.log("\nG-unroutable: the seam classifies unroutability by TYPE, and its message arm is drift-gated")
  const serverSource = readFileSync(COMPONENT, "utf8")

  // (a) The typed arm exists and is what the classifier tests first.
  const TYPED_ARM = "if (error instanceof DocumentUnroutable) return error"
  check(
    "G-unroutable: the seam's classifier recognises the declared DocumentUnroutable TYPE (not only a message)",
    serverSource.includes(TYPED_ARM),
    `the typed arm is absent from ${COMPONENT} — the seam recognises unroutability by string alone again`,
  )
  // Self-test: narrow the typed arm to a different class and the assertion must
  // fire. Without this the check above is a grep that cannot fail.
  {
    const planted = serverSource.replace(TYPED_ARM, "if (error instanceof TypeError) return error")
    const fired = !planted.includes(TYPED_ARM)
    check(
      "G-unroutable/SELFTEST: narrowing the typed arm to another class is detected (the assertion can fail)",
      fired && planted !== serverSource,
      "the planted narrowing did not change the source, so the assertion cannot observe it",
    )
  }

  // (b) The message arm is a named constant, and it matches the engine's throw.
  const PREFIX_DECL = 'const ASTENGINE_UNROUTABLE_PREFIX = "Unsupported file type"'
  check(
    "G-unroutable: the foreign-message arm is ONE named constant, not a literal buried in the classifier",
    serverSource.includes(PREFIX_DECL),
    `${PREFIX_DECL} is absent from ${COMPONENT}`,
  )
  const engineSource = readFileSync(ENGINE_COMPONENT, "utf8")
  const prefix = /const ASTENGINE_UNROUTABLE_PREFIX = "([^"]+)"/.exec(serverSource)?.[1] ?? null
  /** Every place engine.ts throws the unroutable message. There is more than
   *  one (parseTree AND parseFile), so this counts rather than takes the first:
   *  a reword applied to one site and not the other is exactly the drift this
   *  gate exists to catch, and a `.replace()` that touches only the first
   *  occurrence would hide it. */
  const engineThrowSites = (src: string): number => src.split(`throw new Error(\`${prefix ?? ""}`).length - 1
  const sites = engineThrowSites(engineSource)
  check(
    "G-unroutable: the seam's message arm still matches the message ASTEngine.parseTree actually throws",
    prefix !== null && sites > 0,
    `server prefix=${JSON.stringify(prefix)} engine throw sites=${sites} — the backstop no longer recognises the engine's own error`,
  )
  check(
    "G-unroutable/CONTROL: the engine's unroutable throw site was actually FOUND (a gate matching nothing is not a gate)",
    sites > 0 && engineSource.includes("Unsupported file type"),
    `found ${sites} throw site(s) in ${ENGINE_COMPONENT}`,
  )
  // Self-test: reword EVERY throw site into a copy and the assertion must fire.
  // This is the leg that makes the coupling gate a gate. `split/join` rather
  // than `.replace()`, because a single-site reword left the other site intact
  // and the assertion kept passing — a self-test that cannot fail.
  {
    const rewordedEngine = engineSource.split("Unsupported file type").join("Cannot route this artifact")
    const plantedSites = engineThrowSites(rewordedEngine)
    const fired = plantedSites === 0
    check(
      "G-unroutable/SELFTEST: rewording EVERY engine throw site into a copy is detected (the drift gate can fail)",
      fired && rewordedEngine !== engineSource && plantedSites < sites,
      `after rewording, ${plantedSites} of ${sites} throw site(s) still match — the planted drift was not observed`,
    )
  }
}

/**
 * G-ANCHOR-DRIFT — the CLASS gate, ahead of every mutation result.
 *
 * The defect it exists for is not hypothetical. On the merged LSP tree two
 * mutants in this milestone's sibling verifier had already died this way, and
 * the ones this gate was written for died the same way: the mutant's `from`
 * text no longer existed in the file it claimed to mutate, the replacement
 * matched nothing, the mutant never ran, and the suite reported SURVIVED.
 * A surviving mutant reports coverage it does not have — worse than no mutant,
 * because the number in the evidence says the class is gated.
 *
 * Three legs, all load-bearing:
 *   1. the gate's own self-test (it must be able to flag a stale anchor);
 *   2. the REAL MUTANTS list — any drift here is a loud FAIL, never a skip;
 *   3. a PLANTED stale anchor injected into a copy of the REAL list, asserted
 *      to be caught. Leg 3 is the one that matters: legs 1 and 2 can both pass
 *      on a gate that is wired up but never consulted for a planted fault.
 */
function testAnchorDriftGate(): void {
  console.log("\nAnchor-drift gate: a mutant whose anchor is absent must FAIL loudly")

  for (const leg of anchorGateSelfTest()) check(`M-anchor-drift/${leg.label}`, leg.ok, leg.detail)

  // Each mutant's edits become anchored mutations for the drift gate, and each
  // one CARRIES its own mutant's `target` — so a second edit is resolved
  // against the same file as its first, and a mutant that targets
  // launch_languages.ts is never checked against server.ts. Resolving every
  // edit against the file its OWN mutant names is the whole point of the gate;
  // an earlier draft dropped the target here and reported drift for two
  // working mutants, which is the false-positive direction that gets a gate
  // ignored. A stale SECOND anchor is exactly the silent unobservability this
  // gate exists to prevent, so the second edit is gated as its own entry.
  const anchoredList: Array<AnchoredMutation & { target?: string }> = MUTANTS.flatMap((m) => {
    const first = { name: m.name, from: m.from, to: m.to, target: m.target }
    return m.alsoFrom !== undefined
      ? [first, { name: `${m.name} [second edit]`, from: m.alsoFrom, to: m.alsoTo ?? "", target: m.target }]
      : [first]
  })
  const real = anchorDriftReport(anchoredList, mutantTargetReader)
  check(
    "M-anchor-drift: every mutant's anchor text is present in the file it claims to mutate, and every replacement changes the file",
    real.drift.length === 0,
    describeAnchorDrift(real.drift),
  )
  // Stated, not silent: an anchor that occurs more than once plants at the
  // FIRST occurrence, which is not necessarily the site the mutant names. It
  // does not fail the suite (several mutants here legitimately share a
  // prefix) and it is recorded so it cannot be forgotten.
  console.log(`  note: shared anchors (advisory, not a failure): ${describeAmbiguousAnchors(real.ambiguous) || "none"}`)

  // The planted stale anchor: `from` is text this file has never contained, so
  // the mutant cannot run — the exact defect that produced both survivors.
  const plantedName = "PLANTED: a stale anchor that matches nothing"
  const planted = anchorDriftReport(
    [
      ...anchoredList,
      { name: plantedName, from: "  } catch (unroutable) {\n    throw unroutable\n  }", to: "  } catch (unroutable) {" },
    ],
    mutantTargetReader,
  ).drift
  const caughtPlanted = planted.some((d) => d.name === plantedName && d.kind === "anchor-absent")
  check(
    "M-anchor-drift: a PLANTED stale anchor in this suite's own mutant list is caught (the gate is consulted, not merely present)",
    caughtPlanted && planted.length === real.drift.length + 1,
    `planted findings=${JSON.stringify(planted.map((d) => `${d.name}:${d.kind}`))} real findings=${real.drift.length}`,
  )
}

async function runMutants(): Promise<{ caught: number; loadFailures: number; anchorsMissing: string[] }> {
  console.log("Mutation suite: planting defects into a copy of the component")

  // PRISTINE-LOAD CONTROL. Before any result is counted, an UNMUTATED copy must
  // load from the same location. Without it, "caught (load failure)" cannot be
  // attributed to the mutation — which is exactly how the previous version of
  // this suite reported 10/10 caught while observing nothing.
  const pristineSource = readFileSync(COMPONENT, "utf8")
  let pristineLoads = true
  try {
    await loadCopyBesideOriginal("server", pristineSource)
  } catch (error) {
    pristineLoads = false
    console.log(`  CONTROL FAILED: an unmutated copy does not load — every result below is meaningless: ${String((error as Error)?.message).slice(0, 200)}`)
  }
  check(
    "M: control — an unmutated copy of the component loads from the mutant location",
    pristineLoads,
    "the mutation suite cannot attribute anything if its own fixture does not load",
  )

  let caught = 0
  let loadFailures = 0
  const anchorsMissing: string[] = []

  for (const mutant of MUTANTS) {
    const source =
      mutant.target === "launch-languages" ? readFileSync(LANGUAGES_COMPONENT, "utf8") : readFileSync(COMPONENT, "utf8")
    // The anchor-drift gate (M-anchor-drift above) has already asserted that
    // every anchor is present. This re-checks it at the point of use, so a
    // mutant can never be skipped without the suite recording a failure — the
    // §8.3 rule applied locally as well as globally. Both edits are checked,
    // not just the first: a missing SECOND anchor would leave the guard half
    // removed and the mutant would "survive" for the wrong reason.
    const missing =
      !source.includes(mutant.from) ||
      (mutant.alsoFrom !== undefined && !source.includes(mutant.alsoFrom))
    if (missing) {
      // Contract §8.3: a skipped mutant is a failed mutant. Counted, never
      // silently dropped.
      anchorsMissing.push(mutant.name)
      record(
        `FAIL: M: ${mutant.name} — anchor not found in source${mutant.alsoFrom !== undefined && !source.includes(mutant.alsoFrom) ? " (second edit)" : ""}`,
      )
      continue
    }
    let mutantSource = source.replace(mutant.from, mutant.to)
    if (mutant.alsoFrom !== undefined) mutantSource = mutantSource.replace(mutant.alsoFrom, mutant.alsoTo!)
    let observed = false
    let loadFailed = false
    try {
      const mod = await loadCopyBesideOriginal(mutant.target ?? "server", mutantSource)
      observed = await mutant.oracle(mod)
    } catch (error) {
      // Attributable to the mutation ONLY because the pristine control above
      // loaded from the same place. Still a weak catch: it proves the mutant
      // broke, not that an assertion saw the defect, so it is counted
      // separately and fails the suite.
      loadFailed = true
      loadFailures++
      console.log(`  caught (load failure — NOT an observed defect): ${mutant.name}: ${String((error as Error)?.message).split("\n")[0].slice(0, 160)}`)
    }
    if (loadFailed) {
      record(`ok: M: ${mutant.name} — caught only by load failure (weak)`)
      continue
    }
    if (observed) {
      caught++
      console.log(`  caught: ${mutant.name}`)
      record(`ok: M: ${mutant.name}`)
    } else {
      console.log(`  SURVIVED: ${mutant.name}`)
      record(`FAIL: M: ${mutant.name} — SURVIVED: no assertion observed this defect`)
    }
  }
  return { caught, loadFailures, anchorsMissing }
}

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("M24.L1 verifier — bb_lsp server, lifecycle, advertisement, transport\n")

  await testLifecycle()
  await testCapabilities()
  await testTransport()
  await testProjectResolution()
  await testLanguages()
  await testCoverage()
  await testAdvertisedConstants()
  await testSyncModel()
  await testDeclaredAbsenceCarrier()
  await testAbsenceReasonIsNotConflated()
  await testDispatchSeamBoundary()
  await testAbsenceCapabilityAdvertised()
  testUnroutableTypedSignal()
  testAnchorDriftGate()

  const { caught, loadFailures, anchorsMissing } = await runMutants()

  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(readFileSync(COMPONENT)).digest("hex")
  const declaredMethods = new Set(CAPABILITY_COVERAGE.flatMap((e) => e.methods))
  // Contract §8.3: silence is guilt. A suite with no observed mutant catches,
  // a suite with only load-failure catches, and a suite whose anchors went
  // missing all report a failure rather than a quiet pass.
  const mutantsCaught = caught
  const mutantsTotal = MUTANTS.length
  const ok =
    failed === 0 &&
    mutantsCaught === mutantsTotal &&
    loadFailures === 0 &&
    anchorsMissing.length === 0 &&
    negativeCases > 0
  const status = ok ? "verified" : "known-gap"

  const evidence = {
    issue: "490",
    code: "L1",
    status,
    currentCommit,
    ...fingerprintFields(["m24.L1"], ROOT),
    verifierCommand: "npx tsx script/m24/verify-server.ts",
    evidenceFile: "L1.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    claimLevel: "I1 (protocol-passed) — reference-client harness, real streams, planted mutants. NOT I2: no index-conformance or position-mapping assertion is made here, and NOT I3: no named editor run is part of this evidence.",
    declaredAbsence: {
      carriers: ["bb/absence (versioned, server→client notification)", "window/logMessage (the protocol's own channel)"],
      reasons: ["language_not_launched", "not_indexed", "unresolvable_location", "unsupported_language"],
      note: "LSP 3.18 mandates Location|null for definition and Location[] for references, so there is NO field on those results a reason could ride. The standard result shapes are UNCHANGED; the reason travels out of band. An empty standard result on these methods must not be read as 'nothing found'.",
      componentContractRead: "navigation.ts exposes evidenceTier at this commit, NOT Lane 4's richer absence record (that commit 04d56ab75 is not an ancestor of this branch — see limitations). The reason is derived from the launch set through its single owner, and the vocabulary matches what Lane 4 publishes, so the seam is correct today and still correct when that field lands.",
    },
    os: `${process.platform} ${process.arch} (${process.version})`,
    canFail: canFailFromChecks(checkLog),
    advertisement: {
      capabilityKeys: CAPABILITY_COVERAGE.map((e) => e.key),
      declaredMethods: [...declaredMethods].sort(),
      note: "bb/staleness and bb/impact carry non-standard capability keys (LSP 3.18 has no impactProvider). They ride top-level keys exactly as bb/graph already did via graphProvider, each carrying the schemaVersion the handler ENFORCES, so a client can detect a mismatch before sending one. A client that ignores unknown capability keys can still call them; discoverability is the point, not enforcement.",
    },
    verdict: {
      realComponentFailures: failed,
      mutantsCaught,
      mutantsTotal,
      mutantsCaughtByLoadFailureOnly: loadFailures,
      mutantsWithMissingAnchor: anchorsMissing,
      negativeCases,
      ok,
      note: "`failed` counts real functional failures only; mutant runs are reported separately via the verdict block. A mutant caught ONLY by a load failure is reported but does NOT satisfy the suite.",
    },
    reviewers: {
      separationOfDuties: "NOT satisfied for this change: the author of the component change wrote the only gate covering it (contract §8.6 requires cross-review where feasible). Owner spot-check (§8.5) is the closure authority.",
      crossReview: "requested from script/m26/verify-graph-transport.ts owner: its M5 mutant anchors on the literal graphProvider line in src/lsp/server.ts, which is why that line was preserved rather than replaced by a table lookup.",
      wave2: "This wave's author also wrote the checks covering it. Three defects were found by the wave's own gates on its own code and are recorded rather than hidden: (1) the G11 schemaVersion check compared two reads of the same constant and could not fail — a mutant survived it and the check was rewritten to read the value the client receives; (2) a blanket-catch mutant was first planted as a syntactically broken rewrite and was 'caught' only by load failure, which the suite correctly refused to count, and was replanted as a behaviour change; (3) G3's frame parser decoded the stream to a string and mis-parsed as soon as the advertisement carried a non-ASCII em dash, which the byte-level rewrite fixed.",
    },
    limitations: [
      "single-root workspaces only (multi-root is a filed decision for later waves); declared on the wire as workspace.workspaceFolders.supported = false",
      "no completion, no diagnostics, no rename (complement stance, §7.1)",
      "no textDocumentSync is advertised, because no textDocument/did* handler exists; the declared sync model is filesystem-side (recursive fs.watch, 300 ms debounce, incremental reindex, scan-on-read fallback) and no latency figure is advertised because this gate measures none",
      "stdio framing is byte-stream based with Content-Length parsing",
      "bb/staleness and bb/impact use non-standard capability keys; a client that ignores unknown keys cannot discover them from the initialize result",
      "the mutation suite plants into src/lsp/ and deletes the copy in a finally block; a crash mid-run can leave a server.mutant.<pid>.<n>.ts file behind (git status shows untracked files)",
      "G7 exercises bb/staleness on an UNINDEXED workspace only; the marker shape for a fresh/stale indexed file is freshness.ts's contract, gated by script/m25, not here",
      "NOT VERIFIED: that any editor renders the bb/absence notice. The channel is proven to be emitted and framed on the wire (G3, G9); nothing here proves a client displays it. Claiming a rendered badge would be a §1/I3 claim this evidence does not support",
      "NOT VERIFIED: absence notices for bb/graph, bb/impact, and bb/staleness. Those transports own their own loud `bb/…`-prefixed errors by design (the versioning mechanism) and are not registered absentable; their error text already names the reason",
      "navigation.ts does not yet expose Lane 4's `absence: {reason, language, detail, searchedIndex, totalCount}` record at this commit (04d56ab75 is not an ancestor of lsp/3), so the reason is derived from `evidenceTier` plus the launch set. When that field lands, navigationAbsence() should read it directly; the vocabulary and searchedIndex semantics already match",
      "the DocumentUnroutable type is handled at the seam but NO component raises it at this commit: document_highlight.ts and hover.ts each guard their own parseForSafety call and return declared absence (tier unsupported_language / null), so the seam's typed arm has no in-tree producer. It is the path a future handler is meant to use, and it is gated by its own mutant ('seam: the typed unroutable signal is ignored'), which raises the type from a handler and observes the seam mis-handling it when the type test is removed",
      "the seam ALSO keeps a message-prefix arm for ASTEngine's 'Unsupported file type' throw. It is the backstop for a handler whose own guard is missing: it cannot be typed, because a plain Error from a dependency carries no type to test. Both real handlers guard themselves today, so no in-tree path reaches this arm — it is coverage for a handler that does not exist yet, and that is stated rather than counted as coverage of a live path. The coupling to src/ast/engine.ts is drift-gated by G-unroutable: the prefix is one named constant (ASTENGINE_UNROUTABLE_PREFIX) and the gate fails when engine.ts's throw stops matching it, with the reword planted into a copy to prove the gate can fail",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(
    `\nL1: ${status.toUpperCase()} (${passed}/${passed + failed} passed, ${mutantsCaught}/${mutantsTotal} mutants caught [${loadFailures} by load failure only], ${negativeCases} negative)`,
  )
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

main().catch((error) => {
  console.error("verifier crashed:", error)
  process.exit(1)
})