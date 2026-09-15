// script/m29/wave-execute.ts — M29.R2 (issue #537): wave-1 execution engine.
//
// Executes the R1 protocol's S4 (real index) and S5 (real bb_lsp server leg)
// for EXACTLY the owner-approved language set (validation/m29/results/
// wave-1-approval.json) — executing an unapproved language is a contract
// violation the verifier catches. Every leg runs against real machinery:
// the compiled indexer (dist/index.js) and the compiled server (dist/lsp/…)
// over stdio (M25 stdio transport, one-library rule).
//
// Evidence: validation/m29/results/wave-<lang>.json per language (S5 leg);
// the S6 in-editor leg is executed separately (nvim driver) and lands as
// wave-editor-<lang>.json, which the R1 runner honors for the I3 cap.
//
// CLI: npx tsx script/m29/wave-execute.ts [--languages a,b,c]

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import path from "node:path"
import { realpathSync } from "node:fs"
import { WAVE_LANGUAGES, ROOT } from "./wave-protocol.ts"
import { createStdioTransport, measureWarmP95, type FeatureMeasurement } from "../m25/feature-assertions.ts"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

interface Expectations {
  language: string
  hover: { symbol: string; contains: string[]; evidenceClassRequired: boolean }
  hoverLine: number
  definition: { symbol: string; minLocations: number }
  definitionLine: number
  references: { symbol: string; minCount: number }
  documentSymbols: string[]
  declaredAbsence: { symbol: string; note: string }
}

export interface WaveLegResult {
  language: string
  status: "verified" | "failed" | "blocked"
  reason?: string
  steps: Array<{ step: string; status: string; detail: string }>
  indexCounts: { files: number; symbols: number; relationships: number } | null
  measurements: FeatureMeasurement[]
  budgetViolations: string[]
  commit: string
  machine: { node: string; platform: string; arch: string }
  generatedAt: string
}

/** §3 warm budgets (ms, p95) — server-leg regime (contract §3 table). */
const WARM_BUDGETS: Record<string, number> = {
  hover: 50, definition: 50, references: 50,
  documentSymbol: 50, workspaceSymbol: 150, prepareCallHierarchy: 100,
}

function budgetViolationsOf(ms: FeatureMeasurement[]): string[] {
  return ms
    .filter((m) => WARM_BUDGETS[m.op] !== undefined && m.p95WarmMs >= WARM_BUDGETS[m.op])
    .map((m) => `${m.op}:${m.p95WarmMs.toFixed(1)}ms>=${WARM_BUDGETS[m.op]}ms`)
}

function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

/** Character offset of `symbol` on the 0-based hoverLine (1-based file line
 *  hoverLine+1). Derived from the pack itself — never guessed per language. */
export function hoverCharacter(packDir: string, ext: string, hoverLine: number, symbol: string): number | null {
  const lines = readFileSync(path.join(packDir, `main.${ext}`), "utf8").split("\n")
  const line = lines[hoverLine]
  if (line === undefined) return null
  const idx = line.indexOf(symbol)
  return idx === -1 ? null : idx
}

/** Pure guard: a language may execute a wave leg only if the owner-approved
 *  record names it. Exported so the verifier can prove the guard rejects. */
export function assertLanguageApproved(language: string, approval: { languages: string[] }): void {
  if (!approval.languages.includes(language)) {
    throw new Error(`language ${language} is not owner-approved (approval record governs execution)`)
  }
}

export async function executeWaveLeg(language: string): Promise<WaveLegResult> {
  const steps: Array<{ step: string; status: string; detail: string }> = []
  const commit = gitCommit()
  const machine = { node: process.version, platform: process.platform, arch: process.arch }
  const generatedAt = new Date().toISOString()
  const fail = (reason: string): WaveLegResult => ({
    language, status: "failed", reason, steps, indexCounts: null, measurements: [],
    budgetViolations: [], commit, machine, generatedAt,
  })

  const ext = WAVE_LANGUAGES[language]
  if (!ext) return fail(`language ${language} is not in the wave registry`)
  const packDir = path.join(ROOT, "script/m29/wave-fixtures", language)
  const expPath = path.join(packDir, "expectations.json")
  if (!existsSync(path.join(packDir, `main.${ext}`)) || !existsSync(expPath)) {
    return {
      language, status: "blocked",
      reason: `wave pack missing (need main.${ext} + expectations.json under ${path.relative(ROOT, packDir)})`,
      steps, indexCounts: null, measurements: [], budgetViolations: [], commit, machine, generatedAt,
    }
  }
  const expectations = parseSealedRecord(expPath) as Expectations
  const distIndex = path.join(ROOT, "dist", "index.js")
  const distServer = path.join(ROOT, "dist", "lsp", "server.js")
  if (!existsSync(distIndex) || !existsSync(distServer)) {
    return {
      language, status: "blocked", reason: "dist missing (run npm run build)",
      steps, indexCounts: null, measurements: [], budgetViolations: [], commit, machine, generatedAt,
    }
  }

  // --- S4: real index ---------------------------------------------------------
  const canonical = realpathSync.native(packDir)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  const dataDir = mkdtempSync(path.join(tmpdir(), `m29-wave-${language}-`))
  try {
    process.env.BB_DATA_DIR = dataDir
    const dist = (await import(distIndex)) as { indexProjectParallel: (pid: string, p: string, o: Record<string, unknown>) => Promise<unknown> }
    await dist.indexProjectParallel(projectId, canonical, {})
    const { BrainDatabase } = (await import(path.join(ROOT, "src", "brain", "database.ts"))) as {
      BrainDatabase: { getRawInstance: (pid: string) => Promise<{ prepare: (q: string) => { get: () => { c: number } } }> }
    }
    const db = await BrainDatabase.getRawInstance(projectId)
    const files = db.prepare("SELECT COUNT(*) c FROM brain_file").get().c
    const symbols = db.prepare("SELECT COUNT(*) c FROM brain_symbol").get().c
    const rels = db.prepare("SELECT COUNT(*) c FROM brain_relationship").get().c
    steps.push({ step: "S4-real-index", status: files > 0 && symbols > 0 ? "pass" : "fail", detail: `files=${files} symbols=${symbols} rels=${rels}` })
    if (files === 0 || symbols === 0) return fail("real indexing produced an empty index")
    const indexCounts = { files, symbols, relationships: rels }

    // --- S5: real bb_lsp server leg over stdio (M25 transport, one-library rule) ---
    const transport = createStdioTransport({ runtime: "node-dist", workspaceDir: packDir, dataDir })
    if (transport.serverBlockedReason) {
      return { language, status: "blocked", reason: transport.serverBlockedReason, steps, indexCounts, measurements: [], budgetViolations: [], commit, machine, generatedAt }
    }
    let ok = true
    const assert = (name: string, cond: boolean, detail = ""): void => {
      steps.push({ step: name, status: cond ? "pass" : "fail", detail })
      if (!cond) ok = false
    }
    try {
      await transport.ready()
      const init = await transport.request("initialize", { capabilities: {} })
      const caps = init?.result?.capabilities ?? {}
      assert("L1: capabilities advertised", caps.hoverProvider === true && caps.definitionProvider === true && caps.referencesProvider === true && caps.documentSymbolProvider === true, JSON.stringify(caps).slice(0, 150))
      transport.notify("initialized", {})

      const uri = `file://${path.join(packDir, `main.${ext}`)}`
      const sym = expectations.hover.symbol
      const hoverChar = hoverCharacter(packDir, ext, expectations.hoverLine, sym)
      assert("fixture: hover position derivable", hoverChar !== null, `symbol ${sym} not on line ${expectations.hoverLine + 1}`)
      const pos = { line: expectations.hoverLine, character: hoverChar ?? 0 }

      const hover = (await transport.request("textDocument/hover", { textDocument: { uri }, position: pos }))?.result
      const hoverText = typeof hover?.contents === "string" ? hover.contents : typeof hover?.contents?.value === "string" ? hover.contents.value : ""
      assert("L2: hover renders the symbol", hoverText.includes(sym) || hover?.data?.name === sym, hoverText.slice(0, 120))
      assert("L2: hover carries the evidence tier", hover?.data?.tier !== undefined || hoverText.includes("evidence:"), hoverText.slice(0, 120))

      const def = (await transport.request("textDocument/definition", { textDocument: { uri }, position: pos }))?.result
      const defLocs: any[] = Array.isArray(def) ? def : def ? [def] : []
      const defOk = def?.found === true || defLocs.some((d) => d?.range !== undefined || d?.line !== undefined || d?.location?.line !== undefined)
      assert("L3: definition resolves", defOk, JSON.stringify(def ?? null).slice(0, 150))

      const refs = (await transport.request("textDocument/references", { textDocument: { uri }, position: pos, context: { includeDeclaration: true } }))?.result
      const refList = Array.isArray(refs?.locations) ? refs.locations : Array.isArray(refs) ? refs : []
      assert("L3: references non-empty", refList.length >= (expectations.references.minCount ?? 1), `got ${refList.length}`)

      const docSym = (await transport.request("textDocument/documentSymbol", { textDocument: { uri } }))?.result
      const symList: any[] = Array.isArray(docSym) ? docSym : Array.isArray(docSym?.symbols) ? docSym.symbols : []
      assert("L4: documentSymbols include the class", expectations.documentSymbols.every((n) => symList.some((s: any) => s.name === n)), JSON.stringify(symList.map((s: any) => s.name)).slice(0, 150))

      const ws = (await transport.request("workspace/symbol", { query: sym }))?.result
      const wsList: any[] = Array.isArray(ws) ? ws : Array.isArray(ws?.symbols) ? ws.symbols : []
      assert("L4: workspace symbol finds it", wsList.some((s: any) => s.name === sym), JSON.stringify(wsList.slice(0, 3).map((s: any) => s.name)))

      const miss = (await transport.request("workspace/symbol", { query: expectations.declaredAbsence.symbol }))?.result
      const missList: any[] = Array.isArray(miss) ? miss : Array.isArray(miss?.symbols) ? miss.symbols : []
      assert("L4: absence is declared (empty, not fabricated)", missList.length === 0, JSON.stringify(missList).slice(0, 150))

      const prep = (await transport.request("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: pos }))?.result
      const item = prep?.item ?? (Array.isArray(prep) ? prep[0] : prep)
      assert("L5: call hierarchy prepares", item?.name === sym, JSON.stringify(prep ?? null).slice(0, 150))

      // Warm p95 latency (§3 budgets, server-leg regime).
      const measurements: FeatureMeasurement[] = []
      measurements.push(await measureWarmP95("hover", () => transport.request("textDocument/hover", { textDocument: { uri }, position: pos })))
      measurements.push(await measureWarmP95("definition", () => transport.request("textDocument/definition", { textDocument: { uri }, position: pos })))
      measurements.push(await measureWarmP95("references", () => transport.request("textDocument/references", { textDocument: { uri }, position: pos, context: { includeDeclaration: true } })))
      measurements.push(await measureWarmP95("documentSymbol", () => transport.request("textDocument/documentSymbol", { textDocument: { uri } })))
      measurements.push(await measureWarmP95("workspaceSymbol", () => transport.request("workspace/symbol", { query: sym })))
      measurements.push(await measureWarmP95("prepareCallHierarchy", () => transport.request("textDocument/prepareCallHierarchy", { textDocument: { uri }, position: pos })))
      const violations = budgetViolationsOf(measurements)
      assert("§3: warm p95 within budgets", violations.length === 0, violations.join("; "))

      await transport.request("shutdown", null)
      transport.notify("exit", {})

      const result: WaveLegResult = {
        language,
        status: ok ? "verified" : "failed",
        steps, indexCounts, measurements,
        budgetViolations: violations, commit, machine, generatedAt,
      }
      return result
    } catch (error) {
      return fail(`server leg error: ${String((error as Error).message).slice(0, 200)}`)
    } finally {
      await transport.dispose().catch(() => {})
    }
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
}

/** The wave-leg freshness rule, in ONE place (the library, not the gate —
 *  importing a gate executes it; M55 lesson). A leg's evidence is stale when
 *  any of these changed since the leg's commit:
 *    - the execution engine itself,
 *    - the language's OWN fixture pack,
 *    - the language's OWN analyzer (wave-2 rule, fixture-first): the analyzer
 *      produces the index the S5 leg serves, so a changed analyzer stales the
 *      leg — a cheap, declared re-run refreshes it. Never another language's
 *      pack or analyzer (per-language coupling is banned and mutant-gated).
 *    - the shared LSP surfaces the leg exercises.
 */
export function staleRelevantPaths(language: string): string[] {
  return [
    "script/m29/wave-execute.ts",
    `script/m29/wave-fixtures/${language}`,
    `src/ast/real-${language}-analyzer.ts`,
    "src/lsp/launch_languages.ts",
    "src/lsp/hover.ts",
    "src/lsp/navigation.ts",
    "src/lsp/symbols.ts",
    "src/lsp/server.ts",
  ]
}

/** Approved set discipline: read the approval recordS (wave 1 and wave 2 —
 *  every owner-approved wave joins the union; the union is the execution
 *  authority). `--languages` may narrow (execute a subset) but never extend. */
export function approvedLanguages(): string[] {
  const resultsDir = path.join(ROOT, "validation/m29/results")
  const approvalFiles = existsSync(resultsDir)
    ? readdirSync(resultsDir).filter((f) => /^wave-\d+-approval\.json$/.test(f)).sort()
    : []
  if (approvalFiles.length === 0) throw new Error("no wave approval record found (validation/m29/results/wave-N-approval.json)")
  const languages: string[] = []
  for (const f of approvalFiles) {
    const approval = JSON.parse(readFileSync(path.join(resultsDir, f), "utf8")) as { languages: string[] }
    for (const lang of approval.languages) if (!languages.includes(lang)) languages.push(lang)
  }
  const args = process.argv.slice(2)
  const idx = args.indexOf("--languages")
  if (idx !== -1) {
    const requested = args[idx + 1]!.split(",").map((s) => s.trim()).filter(Boolean)
    for (const lang of requested) assertLanguageApproved(lang, { languages })
    return requested
  }
  return languages
}

async function main(): Promise<void> {
  const languages = approvedLanguages()
  console.log(`wave-1 execution — owner-approved set: ${languages.join(", ")}`)
  mkdirSync(path.join(ROOT, "validation/m29/results"), { recursive: true })
  let allOk = true
  for (const language of languages) {
    const result = await executeWaveLeg(language)
    writeSealed(path.join(ROOT, "validation/m29/results", `wave-${language}.json`), result)
    const fails = result.steps.filter((s) => s.status === "fail")
    console.log(`  ${language.padEnd(11)} ${result.status.toUpperCase().padEnd(8)} ${result.steps.length} checks, ${fails.length} failed${result.reason ? ` — ${result.reason}` : ""}`)
    if (result.status !== "verified") allOk = false
  }
  process.exit(allOk ? 0 : 1)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  void main()
}
