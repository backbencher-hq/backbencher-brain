// script/m53/r2-probe.mts — M53.R2 (issue #732): real-repo differential.
//
// Proves the LSP surfaces return declared-shape, non-regressed data when the
// index was written by the CURRENT co-agent indexer (post-M51/M52/M49):
//
//   1. fresh index of the demo repo via the real CLI (M51 guard receipt:
//      zero dangling-reference warnings, health checks pass)
//   2. the REAL dist server over stdio: hover (declared metadata),
//      definition, references, document symbols, bb/graph usages,
//      bb/impact member fallback (both constructors, file-disambiguated),
//      bb/staleness
//   3. differential vs the M44-era expectations: greeter class + greet
//      call sites present, both constructor roots resolve — a count BELOW
//      the M44-era floor is a regression; above is a declared improvement.
//
// Run: npx tsx script/m53/r2-probe.mts
// Evidence: validation/m53/results/R2.json (machine-emitted)

import { spawn } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")
const DEMO = "$HOME/bb-demo-hub"
const OUT = path.join(ROOT, "validation/m53/results/R2.json")
const BB = path.join(ROOT, "bin", "bb")
const SERVER = path.join(ROOT, "dist", "lsp", "server.js")

let checks = 0
let failed = 0
const canFail: string[] = []
function check(name: string, ok: boolean, detail = ""): boolean {
  checks++
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  return ok
}
// M61.V6 (#847): the differential's can-fail proof, LABELLED and RECORDED. The
// verifier lint's registry flagged this gate as proof-less because its
// "negative" was the differential itself — real, but not a planted defect any
// derivation could see.
function mutant(name: string, caught: boolean, detail = ""): void {
  canFail.push(`${caught ? "ok" : "FAIL"}: M: ${name}`)
  check(`M: ${name}`, caught, detail)
}

/** The differential's rule: a count BELOW its declared floor is a regression.
 *  Above the floor is a declared improvement, not a failure — the rule is a
 *  floor, never an equality. Pure, so the mutants below can exercise it. */
const regressionsOf = (d: Record<string, { now: number; floor: number }>): string[] =>
  Object.entries(d).filter(([, v]) => v.now < v.floor).map(([k]) => k)

// --- byte-accurate LSP client (Buffer framing; string decode corrupts
// multi-byte UTF-8 split across chunks — found the hard way at M25) --------
type Pending = { resolve: (v: any) => void; timer: NodeJS.Timeout }

function connect(workspace: string) {
  const child = spawn("node", [SERVER, "--dir", workspace], {
    env: { ...process.env, BB_DATA_DIR: path.join(process.env.HOME ?? "", ".bb") },
    stdio: ["pipe", "pipe", "ignore"],
  })
  let buf = Buffer.alloc(0)
  const pending = new Map<number, Pending>()
  let nextId = 1
  child.stdout.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      const head = buf.indexOf("\r\n\r\n")
      if (head < 0) return
      const header = buf.slice(0, head).toString("utf8")
      const m = /Content-Length:\s*(\d+)/.exec(header)
      if (!m) return
      const len = Number(m[1])
      if (buf.length < head + 4 + len) return
      const body = buf.slice(head + 4, head + 4 + len).toString("utf8")
      buf = buf.slice(head + 4 + len)
      try {
        const msg = JSON.parse(body)
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          const p = pending.get(msg.id)!
          clearTimeout(p.timer)
          pending.delete(msg.id)
          p.resolve(msg)
        }
      } catch {}
    }
  })
  const request = (method: string, params: unknown, timeoutMs = 20_000): Promise<any> =>
    new Promise((resolve) => {
      const id = nextId++
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, params })
      const timer = setTimeout(() => {
        pending.delete(id)
        resolve({ __timeout: true })
      }, timeoutMs)
      pending.set(id, { resolve, timer })
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
    })
  const notify = (method: string, params: unknown): void => {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
  const close = (): void => child.kill()
  return { request, notify, close }
}

// Position helper: 1-based line/char needle search → LSP 0-based.
function posOf(fileRel: string, needle: string, occurrence = 1): { line: number; character: number } {
  const lines = readFileSync(path.join(DEMO, fileRel), "utf8").split("\n")
  let seen = 0
  for (let i = 0; i < lines.length; i++) {
    let idx = lines[i].indexOf(needle)
    while (idx >= 0) {
      seen++
      if (seen === occurrence) return { line: i, character: idx }
      idx = lines[i].indexOf(needle, idx + 1)
    }
  }
  throw new Error(`needle ${needle} not found in ${fileRel}`)
}
const uriOf = (fileRel: string): string => "file://" + path.join(DEMO, fileRel)

async function main(): Promise<void> {
  console.log("=== M53.R2 real-repo differential ===\n")

  // --- 1. fresh index with the CURRENT co-agent indexer --------------------
  const { execFileSync } = await import("node:child_process")
  let indexOut = ""
  try {
    indexOut = execFileSync("node", [BB, "index", "--force", "."], { cwd: DEMO, encoding: "utf8", env: { ...process.env, HOME: process.env.HOME }, timeout: 120_000 })
  } catch (e) {
    indexOut = (e as Error).message
  }
  const idx = indexOut.match(/indexed (\d+) files, (\d+) symbols, (\d+) relationships/)
  const m51Clean = !/dangling|orphan/i.test(indexOut) && /Index health: 100%/.test(indexOut)
  check("R2.1: fresh index succeeds (co-agent indexer)", !!idx, idx ? `${idx[1]} files, ${idx[2]} symbols, ${idx[3]} relationships` : "parse failed")
  check("R2.2: M51 guard clean (no dangling/orphan, health 100%)", m51Clean, "")

  // --- 2. the real server over stdio ---------------------------------------
  const lsp = connect(DEMO)
  const init = await lsp.request("initialize", { capabilities: {}, rootUri: "file://" + DEMO })
  check("R2.3: server initializes and advertises capabilities", !!init?.result?.capabilities, "")
  lsp.notify("initialized", {})

  // hover on the greet DECLARATION (greeter.ts) — declared metadata must ride
  const hp = posOf("src/greeter.ts", "greet(")
  const hover = await lsp.request("textDocument/hover", { textDocument: { uri: uriOf("src/greeter.ts") }, position: hp })
  const hmd: string = hover?.result?.contents?.value ?? ""
  check("R2.4: hover returns rich content for greet", hmd.includes("greet"), `${hmd.length} chars`)
  check("R2.5: hover carries declared evidence tier", /evidence|tier/i.test(hmd), "")

  // definition from a usage site (app.ts) resolves to the declaration —
  // cursor INSIDE the greet identifier (needle starts at the dot)
  const dp = posOf("src/app.ts", ".greet(")
  dp.character += 1
  const def = await lsp.request("textDocument/definition", { textDocument: { uri: uriOf("src/app.ts") }, position: dp })
  const defUri: string | undefined = Array.isArray(def?.result) ? def.result[0]?.uri : def?.result?.uri
  check("R2.6: definition from usage lands on greeter.ts", typeof defUri === "string" && defUri.endsWith("src/greeter.ts"), defUri ?? "none")

  // references to greet across the repo (M44-era floor: 2 call sites)
  const rp = posOf("src/greeter.ts", "greet(")
  const refs = await lsp.request("textDocument/references", { textDocument: { uri: uriOf("src/greeter.ts") }, position: rp, context: { includeDeclaration: false } })
  const refCount = Array.isArray(refs?.result) ? refs.result.length : 0
  check("R2.7: references non-regressed (>= 2)", refCount >= 2, `${refCount} references`)

  // document symbols (hierarchical — methods live under the class)
  const syms = await lsp.request("textDocument/documentSymbol", { textDocument: { uri: uriOf("src/greeter.ts") } })
  const flat: string[] = []
  const walk = (nodes: any[]): void => {
    for (const s of nodes ?? []) {
      if (s?.name) flat.push(s.name)
      if (Array.isArray(s?.children)) walk(s.children)
      if (Array.isArray(s?.range) === false && s?.selectionRange) {
        /* DocumentSymbol children handled above */
      }
    }
  }
  walk(syms?.result ?? [])
  check("R2.8: document symbols include Greeter and greet", flat.some((n) => n === "Greeter") && flat.some((n) => n === "greet"), flat.join(","))

  // bb/graph usages (schema v2, the hub's grouped profile: root + callers)
  const graph = await lsp.request("bb/graph", { schemaVersion: 2, symbol: "greet", mode: "usages" })
  const groups = graph?.result?.callers ?? []
  const groupRows = Array.isArray(groups) ? groups.reduce((a: number, g: any) => a + (g?.rows?.length ?? g?.occurrences?.length ?? 0), 0) : 0
  const counts = graph?.result?.counts
  check("R2.9: bb/graph usages non-empty (grouped shape)", groupRows >= 1 || (counts?.callerRows ?? 0) >= 1, `${groups.length} groups / ${groupRows} rows / counts=${JSON.stringify(counts ?? null)}`)

  // bb/impact member fallback — BOTH constructors, file-disambiguated (U5)
  const imp1 = await lsp.request("bb/impact", { schemaVersion: 1, symbol: "constructor", file: path.join(DEMO, "src/greeter.ts") })
  check("R2.10: impact roots Greeter's constructor through its owner", imp1?.result?.root?.name === "Greeter" && imp1?.result?.resolution?.through === "owning-declaration", JSON.stringify(imp1?.result?.root?.name ?? imp1?.error ?? null))
  const imp2 = await lsp.request("bb/impact", { schemaVersion: 1, symbol: "constructor", file: path.join(DEMO, "src/store.ts") })
  check("R2.11: impact roots Store's constructor through its owner", imp2?.result?.root?.name === "Store", JSON.stringify(imp2?.result?.root?.name ?? imp2?.error ?? null))

  // bb/staleness on an indexed file — fresh, never fabricated-missing
  const stale = await lsp.request("bb/staleness", { uri: uriOf("src/greeter.ts") })
  check("R2.12: staleness returns a declared marker (not missing)", stale?.result && stale.result.status !== "missing", JSON.stringify(stale?.result ?? null))

  lsp.close()

  // --- 3. differential vs M44-era floors ------------------------------------
  const floors = { files: 8, symbols: 30, relationships: 85, refCount: 2, impactRoots: 2 }
  const diff = {
    files: { now: idx ? Number(idx[1]) : 0, floor: floors.files },
    symbols: { now: idx ? Number(idx[2]) : 0, floor: floors.symbols },
    relationships: { now: idx ? Number(idx[3]) : 0, floor: floors.relationships },
    references: { now: refCount, floor: floors.refCount },
    impactRoots: { now: (imp1?.result?.root ? 1 : 0) + (imp2?.result?.root ? 1 : 0), floor: floors.impactRoots },
  }
  const regressed = regressionsOf(diff)
  check("R2.13: differential — nothing below the M44-era floor", regressed.length === 0, regressed.length === 0 ? "all floors met or exceeded" : `regressed: ${regressed.join(",")}`)

  // The can-fail proof of the differential rule (M61.V6 / #847).
  mutant("differential blind to a below-floor count", regressionsOf({ symbols: { now: 3, floor: 30 } }).length === 1)
  mutant("differential flags a declared improvement (above-floor counted as regression)", regressionsOf({ symbols: { now: 300, floor: 30 } }).length === 0)

  // --- evidence --------------------------------------------------------------
  mkdirSync(path.dirname(OUT), { recursive: true }) // kept: dir may be fresh
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const evidence = {
    // M61.V4: the record names its own gate and output. Without this the R2
    // record was an orphan — evidence no gate claimed (the verifier lint's G2).
    verifierCommand: "npx tsx script/m53/r2-probe.mts",
    evidenceFile: "R2.json",
    status: failed === 0 ? "verified" : "failed",
    head,
    repo: DEMO,
    index: { files: diff.files.now, symbols: diff.symbols.now, relationships: diff.relationships.now, m51GuardClean: m51Clean },
    differential: diff,
    checks,
    failed,
    mutantsCaught: canFail.filter((c) => c.startsWith("ok")).length,
    mutantsTotal: canFail.length,
    checksList: canFail,
    generatedAt: new Date().toISOString(),
  }
  // M61.V1: one write path — the record is sealed at write (found unsealed by
  // the V2 adoption audit, which is exactly what it exists for).
  writeSealed(OUT, evidence)
  console.log(`\nR2: ${failed === 0 ? "VERIFIED" : "FAILED"} (${checks - failed}/${checks} passed)`)
  if (failed > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error("R2: crashed —", e)
  process.exitCode = 1
})
