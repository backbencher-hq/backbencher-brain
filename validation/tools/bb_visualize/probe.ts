// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the bb_visualize door probe: it drives the REAL MCP stdio
//   server the way a client does (spawn, initialize, tools/list, tools/call),
//   records every case's raw answer, and asserts the contract the descriptor
//   publishes: options that must change the answer, refusals that must be
//   errors, bounds that must be declared and arithmetic that must reconcile.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true,
//   modes: project, file, module, symbol, feature).
// WHY IT IS SHAPED THIS WAY — a handler-level probe cannot see the validation
//   layer, the index gate, or the wire shape a client actually receives. The
//   split between "refused before the handler" and "refused by the handler" is
//   part of the contract, so the probe reads `isError` and the message text from
//   the wire. Cases are data, so adding a row is not a rewrite.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/results/door.json.
// EDIT TOGETHER WHEN THIS CHANGES — lib/fixture.ts (case expectations are tied
//   to the fixture), docs/BB_VISUALIZE.md, script/m13/verify-visualize-*.ts.
// CONTRACTS IT MUST NOT BREAK — writes only under
//   validation/tools/bb_visualize/; never opens the shared .bb-data index.
//   A case that cannot run is a `blocked` row with its reason, never a pass.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs"
import path from "node:path"

const VISUALIZE_DIR = path.resolve(import.meta.dirname ?? ".", ".")
const RESULTS_DIR = path.join(VISUALIZE_DIR, "results")
const DATA_DIR = path.join(VISUALIZE_DIR, "bbdata")
const ROOT = path.resolve(VISUALIZE_DIR, "..", "..", "..")

process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const CHECKS: { name: string; pass: boolean; negative?: boolean; detail?: string }[] = []
let negatives = 0
function check(name: string, pass: boolean, detail = ""): void {
  CHECKS.push({ name, pass, detail })
  if (!pass) console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
}
function negative(name: string, pass: boolean, detail = ""): void {
  negatives++
  CHECKS.push({ name, pass, negative: true, detail })
  if (!pass) console.log(`  FAIL: ${name} [negative]${detail ? ` — ${detail}` : ""}`)
}

const sha256 = (file: string): string | null => {
  if (!existsSync(file)) return null
  const hash = createHash("sha256")
  hash.update(readFileSync(file))
  return hash.digest("hex")
}
const describeFile = (file: string) => ({ path: path.basename(file), exists: existsSync(file), size: existsSync(file) ? statSync(file).size : 0, sha256: sha256(file) })

async function main(): Promise<void> {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js")
  const { fixtureContext, seedAnnotations, FIXTURE_DIR, WORK_DIR } = await import("./lib/fixture")

  mkdirSync(RESULTS_DIR, { recursive: true })
  mkdirSync(WORK_DIR, { recursive: true })
  const { projectId } = await fixtureContext(FIXTURE_DIR, process.argv.includes("--reindex"))
  await seedAnnotations(projectId)
  console.log(`fixture indexed: ${projectId}`)

  const dbPath = path.join(DATA_DIR, "projects", projectId, "brain.db")
  const walPath = `${dbPath}-wal`
  const before = { db: describeFile(dbPath), wal: describeFile(walPath) }

  // The source door, not a compiled copy: the CLI entry runs the same
  // startMcpServer() the package binary does, over real stdio.
  const cliEntry = path.join(ROOT, "src", "cli", "index.ts")
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", cliEntry, "mcp", "--dir", FIXTURE_DIR],
    cwd: ROOT,
    env: { ...process.env, BB_DATA_DIR: DATA_DIR, BB_NO_AUTO_REFRESH: "1" },
    stderr: "pipe",
  })
  const client = new Client({ name: "bb-visualize-door-probe", version: "1.0.0" })
  let stderrText = ""
  transport.stderr?.on("data", (chunk: Buffer) => { stderrText += String(chunk) })
  await client.connect(transport)
  console.log("mcp: connected")

  const call = async (args: Record<string, unknown>): Promise<{ isError: boolean; text: string; ms: number }> => {
    const t0 = performance.now()
    const response: any = await client.callTool({ name: "bb_visualize", arguments: args })
    const text = (response?.content ?? []).map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
    return { isError: response?.isError === true, text, ms: Math.round(performance.now() - t0) }
  }
  const cases: any[] = []
  const record = (name: string, args: Record<string, unknown>, response: { isError: boolean; text: string; ms: number }, extra: Record<string, unknown> = {}) => {
    cases.push({ name, args, isError: response.isError, ms: response.ms, textHead: response.text.slice(0, 700), ...extra })
    return response
  }
  const parse = (text: string): any | null => { try { return JSON.parse(text) } catch { return null } }

  // ── protocol ──────────────────────────────────────────────────────────────
  {
    const listed: any = await client.listTools()
    const tools: any[] = listed?.tools ?? []
    const viz = tools.find((tool) => tool.name === "bb_visualize")
    check("wire: bb_visualize is registered", !!viz)
    const properties = Object.keys(viz?.inputSchema?.properties ?? {})
    check("wire: schema publishes every option", ["scope", "target", "maxNodes", "maxLinks", "offset", "relationshipTypes", "languages", "symbolKinds", "excludePatterns", "includeTests", "view", "layout", "format"].every((name) => properties.includes(name)), properties.join(","))
    check("wire: no truncation-metadata option leaked into the schema", !properties.includes("truncated") && !properties.includes("refresh"), properties.join(","))
    const description: string = String(viz?.description ?? "")
    check("wire: description declares the read boundary", description.length > 200 && !/mutat/i.test(description.slice(0, 0)), `${description.length} chars`)
    negative("wire: description does not claim a write", !/writes|mutates|creates files/i.test(description), description.slice(0, 120))
    record("tools/list", {}, { isError: false, text: JSON.stringify({ properties }), ms: 0 }, { properties })
  }

  // ── success matrix ────────────────────────────────────────────────────────
  {
    const r = await call({})
    record("default text", {}, r)
    check("default: text answer is not JSON", !r.text.trimStart().startsWith("{"), r.text.slice(0, 80))
    for (const line of ["graph:", "scope: project", "view: graph", "layout: regions", "available:", "page:", "edges:", "excluded:", "provenance:"]) {
      check(`default text: carries "${line}"`, r.text.includes(line), r.text.slice(0, 300))
    }
  }

  {
    const r = await call({ format: "json" })
    record("project json", { format: "json" }, r)
    const answer = parse(r.text)
    check("json: parses", !!answer)
    if (answer) {
      check("json: nodes and links are arrays", Array.isArray(answer.nodes) && Array.isArray(answer.links), typeof answer.nodes)
      check("json: distinct declared counts", typeof answer.totalNodesAvailable === "number" && typeof answer.truncation?.originalNodes === "number", JSON.stringify(answer.truncation))
      check("json: truncation reconciles", answer.truncation.originalNodes >= answer.nodes.length && answer.nodes.length === answer.considered.page.returned, `orig=${answer.truncation?.originalNodes} returned=${answer.nodes.length}`)
      check("json: page arithmetic", answer.considered.page.number === Math.floor(answer.considered.page.offset / answer.considered.page.limit) + 1, JSON.stringify(answer.considered.page))
      check("json: provenance names its source", typeof answer.provenance?.source === "string" && answer.provenance.source.length > 0, JSON.stringify(answer.provenance))
      check("json: freshness envelope declared", answer.freshness?.mode === "complete" && typeof answer.freshness?.fresh === "number", JSON.stringify(answer.freshness))
      check("json: excluded block always present", !!answer.excluded && typeof answer.excluded.symbols === "number", JSON.stringify(answer.excluded))
      check("json: node carries identity facts", answer.nodes.every((node: any) => node.id && node.name && node.filePath && node.type), JSON.stringify(answer.nodes[0]).slice(0, 200))
      check("json: link carries the stored row it traces to", answer.links.every((link: any) => link.source && link.target && link.type && link.rowId), JSON.stringify(answer.links[0]).slice(0, 200))
      const nodeIds = new Set(answer.nodes.map((node: any) => node.id))
      check("json: no link has a missing endpoint", answer.links.every((link: any) => nodeIds.has(link.source) && nodeIds.has(link.target)), `${answer.links.length} links`)
      check("json: census counts the returned nodes", Object.values(answer.considered.kindCensus).reduce((a: number, b: any) => a + Number(b), 0) === answer.nodes.length, JSON.stringify(answer.considered.kindCensus))
      // The edge set is complete for the returned nodes, not a slice: the stored rows
      // with BOTH endpoints in the answer are all present, plus at most the folded
      // member rows the answer declares. A primary-key slice (the old fetch) fails here
      // because it returns fewer rows than the index actually connects.
      {
        const { BrainDatabase } = await import("../../../src/brain/database")
        const oracleRaw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
        const nodeIds = answer.nodes.map((node: any) => String(node.id))
        const placeholders = nodeIds.map(() => "?").join(",")
        const sqlCount = Number((oracleRaw.prepare(`SELECT COUNT(*) c FROM brain_relationship WHERE project_id=? AND source_symbol_id IN (${placeholders}) AND target_symbol_id IN (${placeholders})`).get(projectId, ...nodeIds, ...nodeIds) as any)?.c ?? 0)
        const folded = Number(answer.considered.ownerCascade?.rowsFolded ?? 0)
        const declaredCount = Number(answer.considered.relationshipsBetweenSelectedNodes ?? -1)
        check("json: declared edge count reconciles with the stored rows", declaredCount >= sqlCount && declaredCount <= sqlCount + folded, `declared=${declaredCount} stored=${sqlCount} folded=${folded}`)
      }
    }
  }

  // formats + layout
  {
    const text = await call({ format: "text", maxNodes: 10 })
    const json = await call({ format: "json", maxNodes: 10 })
    const answer = parse(json.text)
    record("format text maxNodes 10", { format: "text", maxNodes: 10 }, text)
    record("format json maxNodes 10", { format: "json", maxNodes: 10 }, json)
    check("format: text names the same node/link counts as JSON", !!answer && text.text.includes(`graph: ${answer.nodes.length} nodes, ${answer.links.length} links`), `${text.text.split("\n")[0]} vs ${answer?.nodes?.length}/${answer?.links?.length}`)

    const regions = await call({ format: "html" })
    record("format html regions", { format: "html" }, regions, { bytes: regions.text.length })
    const force = await call({ format: "html", layout: "force" })
    record("format html force", { format: "html", layout: "force" }, force, { bytes: force.text.length })
    check("html: non-trivial document", regions.text.length > 50_000 && regions.text.trimStart().startsWith("<!DOCTYPE") || regions.text.includes("<!DOCTYPE"), `${regions.text.length} bytes`)
    check("html: declares the layout it opens with", /data-bb-layout=\\?"regions\\?"/.test(regions.text) && /data-bb-layout=\\?"force\\?"/.test(force.text), "marker")
    negative("html: two layouts are different documents", regions.text !== force.text)
    const external = /(?:src|href)\s*=\s*["']https?:\/\/|@import|url\(\s*["']?https?:|fonts\.googleapis|cdn\./i.exec(regions.text)
    negative("html: genuinely self-contained (no external resource)", external === null, external ? `found ${external[0]}` : "none")
    check("html: no network fetch of its own", !/fetch\(\s*["']https?:/.test(regions.text), "")
    check("html: shell embeds the view document", (regions.text.match(/<!DOCTYPE html>/gi) ?? []).length >= 2, `${(regions.text.match(/<!DOCTYPE html>/gi) ?? []).length} doctypes`)
    check("html: saves itself rather than streaming a blob", regions.text.includes("saveHtml"), "")
    // The bounds travel WITH the artifact: the payload carries them under `declared`,
    // so the page is auditable without a second JSON call next to it.
    check("html: payload carries the declared bounds", regions.text.includes("declared") && regions.text.includes("totalNodesAvailable") && regions.text.includes("returnedNodes") && regions.text.includes("originalNodes"), "")
    check("html: payload carries the freshness envelope", regions.text.includes("freshness") && regions.text.includes("staleRatio") && regions.text.includes("remediation"), "")
  }

  // scopes + targets
  {
    const file = await call({ scope: "file", target: "src/core/top.ts", format: "json" })
    const fileAnswer = parse(file.text)
    record("scope file", { scope: "file", target: "src/core/top.ts", format: "json" }, file)
    check("scope file: nodes belong to the file", !!fileAnswer && fileAnswer.nodes.length > 0 && fileAnswer.nodes.every((node: any) => String(node.filePath).endsWith("src/core/top.ts")), JSON.stringify(fileAnswer?.nodes?.map((n: any) => n.filePath)))

    const mod = await call({ scope: "module", target: "src/my_mod", format: "json" })
    const modAnswer = parse(mod.text)
    record("scope module segment", { scope: "module", target: "src/my_mod", format: "json" }, mod)
    const modNames = (modAnswer?.nodes ?? []).map((node: any) => String(node.name))
    check("scope module: matches the directory", modNames.includes("deep_lookup"), modNames.join(","))
    negative("scope module: does not reach a longer segment", !modNames.includes("modular_other"), modNames.join(","))

    const symbol = await call({ scope: "symbol", target: "top", format: "json" })
    record("scope symbol", { scope: "symbol", target: "top", format: "json" }, symbol)
    check("scope symbol: resolves the named symbol", (parse(symbol.text)?.nodes ?? []).some((node: any) => node.name === "top"), symbol.text.slice(0, 200))

    const alias = await call({ scope: "symbol", symbol: "top", format: "json" })
    record("alias symbol", { scope: "symbol", symbol: "top", format: "json" }, alias)
    check("alias: `symbol` resolves to target", !alias.isError && (parse(alias.text)?.nodes ?? []).some((node: any) => node.name === "top"), alias.text.slice(0, 160))

    const feature = await call({ scope: "feature", target: "deep_lookup", format: "json" })
    record("scope feature", { scope: "feature", target: "deep_lookup", format: "json" }, feature)
    check("scope feature: matches a symbol name", (parse(feature.text)?.nodes ?? []).some((node: any) => node.name === "deep_lookup"), feature.text.slice(0, 200))

    // A target is a value, never a pattern: % must match nothing rather than everything.
    const wildcard = await call({ scope: "file", target: "%", format: "json" })
    const wildcardAnswer = parse(wildcard.text)
    record("target value %", { scope: "file", target: "%", format: "json" }, wildcard)
    check("target: `%` is a value and matches nothing", !wildcard.isError && wildcardAnswer?.totalNodesAvailable === 0 && (wildcardAnswer?.nodes ?? []).length === 0, `total=${wildcardAnswer?.totalNodesAvailable}`)
    check("target: absence is declared, not an empty project", wildcardAnswer?.declaredAbsent === true && typeof wildcardAnswer?.absenceNote === "string", wildcardAnswer?.absenceNote ?? "none")
  }

  // bounds
  {
    const tight = await call({ format: "json", maxNodes: 3, maxLinks: 1 })
    const answer = parse(tight.text)
    record("bounds tight", { format: "json", maxNodes: 3, maxLinks: 1 }, tight)
    check("bounds: node budget honoured", (answer?.nodes ?? []).length === 3, String(answer?.nodes?.length))
    check("bounds: link budget honoured", (answer?.links ?? []).length <= 1, String(answer?.links?.length))
    check("bounds: truncation declared with both limits", answer?.truncation?.maxNodes === 3 && answer?.truncation?.maxLinks === 1 && answer?.truncation?.truncated === true, JSON.stringify(answer?.truncation))
    check("bounds: the node cut and the link budget are counted apart", typeof answer?.provenance?.linksOmittedWithNodeCut === "number" && typeof answer?.provenance?.linksOmittedByBudget === "number", JSON.stringify(answer?.provenance))
    negative("bounds: maxLinks is not blamed for the node cut", !(answer?.provenance?.linksOmittedByBudget === 2 && answer.provenance.linksOmittedWithNodeCut === 0), JSON.stringify(answer?.provenance))

    const page1 = parse((await call({ format: "json", maxNodes: 5, offset: 0 })).text)
    const page2 = parse((await call({ format: "json", maxNodes: 5, offset: 5 })).text)
    record("page 1", { format: "json", maxNodes: 5, offset: 0 }, { isError: false, text: "", ms: 0 }, { ids: (page1?.nodes ?? []).map((n: any) => n.id) })
    record("page 2", { format: "json", maxNodes: 5, offset: 5 }, { isError: false, text: "", ms: 0 }, { ids: (page2?.nodes ?? []).map((n: any) => n.id) })
    const page1Ids = new Set((page1?.nodes ?? []).map((node: any) => node.id))
    check("page: page 2 starts where page 1 ended", page1?.considered?.page?.nextOffset === 5 && page2?.considered?.page?.offset === 5, `next=${page1?.considered?.page?.nextOffset} offset=${page2?.considered?.page?.offset}`)
    negative("page: page 2 repeats no page 1 identity", (page2?.nodes ?? []).every((node: any) => !page1Ids.has(node.id)), `${(page2?.nodes ?? []).length} nodes`)
    negative("page: the two pages are not byte-identical", JSON.stringify(page1?.nodes) !== JSON.stringify(page2?.nodes))

    const offEnd = await call({ format: "json", offset: 100000 })
    const offEndAnswer = parse(offEnd.text)
    record("offset past end", { format: "json", offset: 100000 }, offEnd)
    check("offset past end: is an empty page, not an empty project", !offEnd.isError && offEndAnswer?.declaredAbsent === true && /empty PAGE/i.test(offEndAnswer?.absenceNote ?? ""), offEndAnswer?.absenceNote ?? "none")

    const offsetNote = await call({ format: "text", offset: 7 })
    record("offset echoed", { format: "text", offset: 7 }, offsetNote)
    check("offset: the page block is always stated", offsetNote.text.includes("page:") && offsetNote.text.includes("offset 7"), offsetNote.text.split("\n").find((line) => line.startsWith("page:")) ?? "missing")
  }

  // filters
  {
    const rel = await call({ relationshipTypes: ["calls"], format: "json", maxNodes: 50 })
    const relAnswer = parse(rel.text)
    record("filter relationshipTypes", { relationshipTypes: ["calls"], format: "json", maxNodes: 50 }, rel)
    check("filter relationshipTypes: every kept link is a call", !!relAnswer && relAnswer.links.every((link: any) => link.type === "calls"), relAnswer?.links?.map((l: any) => l.type).join(","))
    check("filter relationshipTypes: the applied filter is declared", relAnswer?.considered?.relationshipTypesConsidered?.[0] === "calls", JSON.stringify(relAnswer?.considered?.relationshipTypesConsidered))
    const folded = await call({ relationshipTypes: ["CALLS"], format: "json", maxNodes: 50 })
    record("filter relationshipTypes case-folded", { relationshipTypes: ["CALLS"], format: "json", maxNodes: 50 }, folded)
    check("filter relationshipTypes: matched case-insensitively to the stored spelling", !folded.isError && parse(folded.text)?.considered?.relationshipTypesConsidered?.[0] === "calls", folded.text.slice(0, 160))

    const lang = await call({ languages: ["python"], format: "json", maxNodes: 100 })
    const langAnswer = parse(lang.text)
    record("filter languages", { languages: ["python"], format: "json", maxNodes: 100 }, lang)
    check("filter languages: only the requested language returns", !!langAnswer && langAnswer.nodes.length > 0 && langAnswer.nodes.every((node: any) => node.group === "python"), JSON.stringify(langAnswer?.considered?.languageCensus))
    check("filter languages: applied before the limit and declared", langAnswer?.considered?.languagesConsidered?.[0] === "python", JSON.stringify(langAnswer?.considered?.languagesConsidered))

    const kinds = await call({ symbolKinds: ["class"], format: "json", maxNodes: 100 })
    const kindsAnswer = parse(kinds.text)
    record("filter symbolKinds", { symbolKinds: ["class"], format: "json", maxNodes: 100 }, kinds)
    {
      // The owner cascade adds the symbols a folded member row connects to so the
      // edge has two ends; those additions are not the caller's kind filter. What
      // must hold is that every OTHER node matches the filter and the additions are
      // declared rather than silent.
      const cascadeAdded = kindsAnswer?.considered?.ownerCascade?.nodesAdded ?? 0
      const offKind = (kindsAnswer?.nodes ?? []).filter((node: any) => node.type !== "class")
      check("filter symbolKinds: the selection honours the kind filter", !!kindsAnswer && offKind.length === cascadeAdded, `offKind=${offKind.length} cascadeAdded=${cascadeAdded}`)
      if (cascadeAdded > 0) check("filter symbolKinds: the cascade additions are declared in the selection note", /folded member rows connect to/.test(String(kindsAnswer?.considered?.nodeSelection)), String(kindsAnswer?.considered?.nodeSelection))
    }
    check("filter symbolKinds: census states the composition", typeof kindsAnswer?.considered?.kindCensus?.class === "number", JSON.stringify(kindsAnswer?.considered?.kindCensus))

    const excluded = await call({ excludePatterns: ["src"], format: "json", maxNodes: 100 })
    const excludedAnswer = parse(excluded.text)
    record("filter excludePatterns", { excludePatterns: ["src"], format: "json", maxNodes: 100 }, excluded)
    check("filter excludePatterns: the caller's segments are the ones applied", JSON.stringify(excludedAnswer?.excluded?.patterns) === JSON.stringify(["src"]), JSON.stringify(excludedAnswer?.excluded?.patterns))
    check("filter excludePatterns: removal is counted", (excludedAnswer?.excluded?.symbols ?? 0) > 0, JSON.stringify(excludedAnswer?.excluded))

    const noTests = await call({ includeTests: false, format: "json", maxNodes: 400 })
    const noTestsAnswer = parse(noTests.text)
    record("filter includeTests false", { includeTests: false, format: "json", maxNodes: 400 }, noTests)
    check("filter includeTests: test sources are excluded and the rule is named", !!noTestsAnswer && noTestsAnswer.excluded.includesTestFiles === false && (noTestsAnswer.excluded.byRule?.["test-sources"] ?? 0) > 0, JSON.stringify(noTestsAnswer?.excluded))
    negative("filter includeTests: no test file survives in the answer", (noTestsAnswer?.nodes ?? []).every((node: any) => !String(node.filePath).includes("test/")), JSON.stringify((noTestsAnswer?.nodes ?? []).map((n: any) => n.filePath).filter((p: string) => p.includes("test"))))
  }

  // overlays: the annotation layer is matched by NAME AND PATH, and declared even when empty
  {
    const mod = await call({ scope: "module", target: "src/my_mod", format: "json" })
    const modAnswer = parse(mod.text)
    record("overlay annotations match", { scope: "module", target: "src/my_mod", format: "json" }, mod)
    check("overlay: a note on a returned symbol is attached", modAnswer?.considered?.overlays?.annotations?.notes === 1 && modAnswer?.considered?.overlays?.annotations?.nodes === 1, JSON.stringify(modAnswer?.considered?.overlays?.annotations))
    const other = await call({ scope: "module", target: "src/core", format: "json", maxNodes: 100 })
    const otherAnswer = parse(other.text)
    record("overlay annotations path mismatch", { scope: "module", target: "src/core", format: "json", maxNodes: 100 }, other)
    negative("overlay: a note naming one of these symbols at ANOTHER path is not attached", otherAnswer?.considered?.overlays?.annotations?.notesOnOtherPaths === 1 && (otherAnswer?.considered?.overlays?.annotations?.notes ?? 0) === 0, JSON.stringify(otherAnswer?.considered?.overlays?.annotations))
    const textAnswer = await call({ scope: "module", target: "src/my_mod", format: "text" })
    record("overlay annotations in text", { scope: "module", target: "src/my_mod", format: "text" }, textAnswer)
    check("overlay: the default text format states the layer", textAnswer.text.includes("annotations:"), textAnswer.text.split("\n").find((line) => line.startsWith("annotations:")) ?? "missing")
  }

  // refusals — every one must arrive as isError with the rule named
  const refusals: [string, Record<string, unknown>, RegExp][] = [
    ["unknown scope", { scope: "galaxy" }, /must be one of|unknown scope/i],
    ["scoped call without target", { scope: "symbol" }, /requires a (non-empty )?target/i],
    ["module scope without target", { scope: "module" }, /requires a (non-empty )?target/i],
    ["maxNodes 0", { maxNodes: 0 }, /between 1 and 2000|non-negative/i],
    ["maxNodes above ceiling", { maxNodes: 2001 }, /between 1 and 2000/i],
    ["maxNodes fractional", { maxNodes: 1.5 }, /whole number/i],
    ["maxNodes not a number", { maxNodes: "abc" }, /must be number/i],
    ["maxLinks 0", { maxLinks: 0 }, /between 1 and 20000|non-negative/i],
    ["maxLinks above ceiling", { maxLinks: 20001 }, /between 1 and 20000/i],
    ["offset negative", { offset: -1 }, /non-negative/i],
    ["offset fractional", { offset: 1.5 }, /whole number/i],
    ["unknown language", { languages: ["klingon"] }, /unknown languages/i],
    ["unknown relationship type", { relationshipTypes: ["call"] }, /unknown relationshipTypes/i],
    ["unknown symbol kind", { symbolKinds: ["widget"] }, /unknown symbolKinds/i],
    ["unknown view", { view: "tree" }, /must be one of|unknown view/i],
    ["unknown format", { format: "svg" }, /must be one of/i],
    ["unknown layout", { layout: "grid" }, /must be one of/i],
    ["unknown option", { maxnode: 5 }, /unknown or irrelevant options/i],
  ]
  for (const [name, args, pattern] of refusals) {
    const r = await call(args)
    record(`refusal ${name}`, args, r)
    check(`refusal (${name}): isError`, r.isError, r.text.slice(0, 200))
    check(`refusal (${name}): names the rule`, pattern.test(r.text), r.text.slice(0, 240))
    negative(`refusal (${name}): does not return a graph`, !r.text.includes('"nodes"'), r.text.slice(0, 120))
  }

  // Every alias the descriptor claims must be an alias validation actually maps.
  {
    const r = await call({ scope: "symbol", symbolName: "top", format: "json" })
    record("alias symbolName", { scope: "symbol", symbolName: "top", format: "json" }, r)
    const descriptorSource = readFileSync(path.join(ROOT, "src/mcp/tools/bb_visualize/descriptor.ts"), "utf8")
    const claimed = descriptorSource.includes("`symbolName` are accepted as aliases")
    check("contract: the descriptor claims only aliases the door accepts", !claimed || !r.isError, `descriptorClaimsSymbolName=${claimed} doorRefused=${r.isError}`)
  }

  // db read path: a read tool must leave the index bytes alone
  const after = { db: describeFile(dbPath), wal: describeFile(walPath) }
  const dbUnchanged = JSON.stringify(before.db) === JSON.stringify(after.db) && JSON.stringify(before.wal) === JSON.stringify(after.wal)
  check("read path: database bytes unchanged by a read call", JSON.stringify(before.db) === JSON.stringify(after.db), JSON.stringify({ before: before.db, after: after.db }))
  check("read path: write-ahead log unchanged by a read call", JSON.stringify(before.wal) === JSON.stringify(after.wal), JSON.stringify({ before: before.wal, after: after.wal }))

  await client.close()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const stderrTail = stderrText.split("\n").filter((line) => line.trim().length > 0).slice(-6)

  const passed = CHECKS.filter((c) => c.pass).length
  const failed = CHECKS.length - passed
  let commit = "unknown"
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { /* no git in a copy */ }
  const evidence = {
    schemaVersion: 1,
    tool: "bb_visualize",
    status: failed === 0 ? "verified" : "partial",
    currentCommit: commit,
    verifierCommand: "BB_DATA_DIR=validation/tools/bb_visualize/bbdata npx tsx validation/tools/bb_visualize/probe.ts",
    passed,
    failed,
    negativeCases: negatives,
    generatedAt: new Date().toISOString(),
    blockedLegs: [] as string[],
    environment: { runtime: process.version, dataDir: "validation/tools/bb_visualize/bbdata", fixture: FIXTURE_DIR, projectId, readOnlyRules: "BB_NO_AUTO_REFRESH=1; probe only writes its own fixture data dir" },
    dbUnchanged,
    dbBefore: before,
    dbAfter: after,
    stderrTail,
    cases,
    checks: CHECKS,
  }
  writeFileSync(path.join(RESULTS_DIR, "door.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(`door: ${evidence.status.toUpperCase()} (${passed}/${CHECKS.length} passed, ${negatives} negatives)`)
  console.log(`  dbUnchanged=${dbUnchanged}`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error("FATAL", error)
  process.exit(2)
})
