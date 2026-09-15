// script/m61/staleness-probe.mts — M61.V1 diagnostic (not a gate): reproduce
// the fork leg's 1/88 live-staleness failure headlessly, through the HOUSE
// transport (script/m55/lsp-wire.ts StdioLsp) — the exact contract L1 drives
// at HEAD. Edit -> stale -> reindex -> fresh, with markers at each step.
//
// Run: npx tsx script/m61/staleness-probe.mts

import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { StdioLsp, ensureServerBuilt } from "../m55/lsp-wire.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const ws = mkdtempSync(path.join(os.tmpdir(), "stal-probe-"))
const dataDir = mkdtempSync(path.join(os.tmpdir(), "stal-probe-data-"))
const mainPath = path.join(ws, "main.ts")
const V1 = `export function greet(): string { return "hi" }\nconst x = greet()\n`
writeFileSync(mainPath, V1)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const nowMs = () => Date.now()

const lsp = new StdioLsp(ws, {
  ...process.env,
  BB_DATA_DIR: dataDir,
} as Record<string, string | undefined>)

try {
  ensureServerBuilt()
  await lsp.initialize(ws)
  const uri = "file://" + mainPath
  await lsp.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: "typescript", version: 1, text: V1 },
  })
  await sleep(3000)

  // The server's project id = sha1 of the realpath STRING (e5-inner.js convention).
  const projectId = createHash("sha1").update(realpathSync(ws)).digest("hex")
  const brainDb = path.join(dataDir, "projects", projectId, "brain.db")
  console.log("db exists after open:", existsSync(brainDb))

  const fresh0 = await lsp.request("bb/staleness", { uri }, 15000)
  console.log("initial marker:", JSON.stringify(fresh0.result ?? fresh0))

  writeFileSync(mainPath, V1 + "const y = greet()\n")
  let sawStale = null
  const staleDeadline = nowMs() + 15000
  while (nowMs() < staleDeadline) {
    const m = await lsp.request("bb/staleness", { uri }, 15000)
    sawStale = m.result
    if (sawStale?.stale === true) break
    await sleep(400)
  }
  console.log("after-edit marker:", JSON.stringify(sawStale))

  let sawFresh = null
  const freshDeadline = nowMs() + 45000
  while (nowMs() < freshDeadline) {
    const m = await lsp.request("bb/staleness", { uri }, 15000)
    sawFresh = m.result
    if (sawFresh?.stale === false && sawFresh?.status === "fresh") break
    await sleep(700)
  }
  console.log("final marker:", JSON.stringify(sawFresh))
  console.log(sawFresh?.stale === false && sawFresh?.status === "fresh" ? "PROBE: FRESH (loop works headlessly)" : "PROBE: STUCK-STALE (reproduced)")
} finally {
  await lsp.dispose()
  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
}
