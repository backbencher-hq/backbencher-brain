// script/m55/hover-coverage-fixture.ts — lane 6: the ONE fixture and the ONE
// analysis pair behind docs/HOVER-KNOWLEDGE-AUDIT.md.
//
// Extracted verbatim from script/m55/verify-hover-coverage.ts so that the gate
// and its red-team (script/m55/verify-hover-coverage-redteam.ts) drive the SAME
// fixture and the SAME `know()` / `rendered()` functions. That sharing is the
// whole point: a red-team that re-derives its own fixture proves nothing about
// the gate, because the gate's oracle and the red-team's oracle would be two
// implementations that could be wrong in the same direction.
//
// Nothing here is a test-only helper. `know()` is the INDEPENDENT knowledge
// oracle (its own SQL, never the hover's collector) and `rendered()` is the
// card parser. Both are the gate's measurement instruments; this module is
// where they live.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { openDatabase } from "../../src/storage/db.node.ts"
import { classifyStoredLine, deriveCallSiteAddress, isExactAddress, ADDRESS_NOTES } from "../../src/intelligence/graph/line-address.ts"
import { USAGE_SITE_FILTER_LABEL } from "../../src/lsp/relations.ts"

const ROOT = path.resolve(import.meta.dirname, "../..")

// --- The fixture -------------------------------------------------------------------
// Authored BEFORE the assertions that read it (the F7 rule). It is a REAL
// index: every row below is written through the same schema the analyzers
// write, and every file exists on disk at its indexed path, so the freshness
// and position owners read real bytes.
//
// The shape is chosen to make the ratio MEANINGFUL, not flattering: one
// symbol with 8 distinct stored relationship kinds on its two ends (the
// common real shape), one with a single call row (the minimum), one with no
// rows at all (declared absence), and one whose usage rows sit at a stored
// call-site line DIFFERENT from the referencing symbol's declaration — the
// case the audit has to detect.
export const FIXTURE_FILES: Record<string, string> = {
  "src/hub.ts": `// The knowledge-coverage fixture: one class whose methods carry
// several stored relationship kinds, and free functions whose call sites sit
// at lines OTHER than the caller's declaration.
export class Hub {
  private items: string[] = []

  add(item: string): void {
    this.items.push(item)
  }

  count(): number {
    return this.items.length
  }

  reset(): void {
    this.items = []
  }
}

export function notifyHub(hub: Hub, message: string): void {
  hub.add(message)
}

export function countHub(hub: Hub): number {
  return hub.count()
}

export function hotPath(): string {
  return "hot"
}

/** The busy fixture's own declaration: 30 stored callers point at it. */
export function busyHub(): string {
  return "busy"
}

export function silent(): void {
}
`,
  "src/app.ts": `import { Hub, notifyHub, countHub, hotPath } from "./hub"

export function run(): number {
  const hub = new Hub()
  notifyHub(hub, "hello")
  return countHub(hub)
}

export function runAgain(): number {
  const hub = new Hub()
  notifyHub(hub, "again")
  hub.reset()
  return countHub(hub)
}

export function c1(): string { return hotPath() }
export function c2(): string { return hotPath() }
export function c3(): string { return hotPath() }
export function c4(): string { return hotPath() }
export function c5(): string { return hotPath() }
`,
}

// The busy-shape constants. They live HERE, not in the gate, because
// `buildFixture` writes rows sized by them — a fixture whose sizing constants
// live in its consumer is a fixture two gates can disagree about.
export const BUSY_CALLER_FILES = 30
export const BUSY_CALLER_BODY_LINES = 400
export const BUSY_MANY_ROWS = 40
export const BUSY_HOT_CALLS = 40
export const BUSY_SYMBOL = "s-busy"

export interface Fx {
  files: Array<{ id: string; rel: string; abs: string }>
  symbols: Array<Record<string, unknown> & { id: string; name: string; rel: string }>
  rels: Array<{ id: string; source: string; target: string | null; external?: string; type: string; conf: number; line: number; cls?: string; enrich?: Record<string, unknown> }>
}

const HUB_LINES = FIXTURE_FILES["src/hub.ts"]!.split("\n")
const APP_LINES = FIXTURE_FILES["src/app.ts"]!.split("\n")

// The 1-based line of every declaration in the authored fixture, read off the
// fixture's OWN text — never hand-typed. The first version of this fixture
// hand-typed them and every symbol after the third was declared one line above
// its real line, so half the pins hovered the wrong symbol while the audit
// still reported numbers. Reading them from the source is the fix, and this is
// the one place that knows how.
export const HUB_DECL_LINES: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  for (const [i, line] of HUB_LINES.entries()) {
    const m = /^(?:export )?(?:class|function)\s+(\w+)|^  (?:private\s+)?(\w+)\s*[:(]/.exec(line)
    if (m === null) continue
    const name = m[1] ?? m[2]
    if (name !== undefined && out[name] === undefined) out[name] = i + 1
  }
  return out
})()
export const APP_DECL_LINES: Record<string, number> = (() => {
  const out: Record<string, number> = {}
  for (const [i, line] of APP_LINES.entries()) {
    const m = /^export function\s+(\w+)/.exec(line)
    if (m !== null && out[m[1]!] === undefined) out[m[1]!] = i + 1
  }
  return out
})()

/** The 1-based line of the Nth (1-based) occurrence of `needle` in `file` —
 *  read off the authored source, so a stored call-site line is a real call
 *  site and a reader can check it by opening the file. Throws rather than
 *  inventing a line: a fixture that cannot find its own needle measures
 *  nothing. */
function lineOf(file: "hub" | "app", needle: string, occurrence = 1): number {
  const lines = file === "hub" ? HUB_LINES : APP_LINES
  let seen = 0
  for (const [i, line] of lines.entries()) {
    if (line.includes(needle)) {
      seen++
      if (seen === occurrence) return i + 1
    }
  }
  throw new Error(`fixture: ${file} has no occurrence ${occurrence} of ${JSON.stringify(needle)}`)
}

/** 0-based index of `name` in `file`'s line `line1` (1-based). */
function colOf(file: "hub" | "app", line1: number, name: string): number {
  const lines = file === "hub" ? HUB_LINES : APP_LINES
  return Math.max(1, lines[line1 - 1]!.indexOf(name) + 1)
}

export function buildFixture(): Fx {
  const files: Fx["files"] = []
  const symbols: Fx["symbols"] = []
  const rels: Fx["rels"] = []

  const hubFile = { id: "f-hub", rel: "src/hub.ts", abs: "" }
  const appFile = { id: "f-app", rel: "src/app.ts", abs: "" }
  files.push(hubFile, appFile)

  // src/hub.ts line numbers (1-based, read from the authored text above):
  //   3 class Hub, 4 items, 5 add, 9 count, 13 reset, 18 notifyHub, 22 countHub
  // The hub symbols and their declaration lines, both read off the authored text.
  const hubSyms: Array<[string, string, string, string]> = [
    ["s-hub", "Hub", "class", "Hub"],
    ["s-items", "items", "property", "items"],
    ["s-add", "add", "method", "add"],
    ["s-count", "count", "method", "count"],
    ["s-reset", "reset", "method", "reset"],
    ["s-notify", "notifyHub", "function", "notifyHub"],
    ["s-countHub", "countHub", "function", "countHub"],
    ["s-hot", "hotPath", "function", "hotPath"],
    ["s-busy", "busyHub", "function", "busyHub"],
    ["s-silent", "silent", "function", "silent"],
  ]
  for (const [id, name, type, declName] of hubSyms) {
    const line = HUB_DECL_LINES[declName]!
    symbols.push({
      id, name, file: "hub", rel: "src/hub.ts",
      symbol_type: type,
      qualified_name: id === "s-hub" ? null : `Hub.${name}`,
      line_start: line, line_end: line,
      byte_start: colOf("hub", line, name), byte_end: colOf("hub", line, name) + name.length,
      owner_symbol_id: id === "s-hub" || id === "s-hot" || id === "s-silent" ? null : "s-hub",
      visibility: "public",
      return_type:
        id === "s-add" || id === "s-reset" || id === "s-notify" || id === "s-silent" ? "void"
          : id === "s-count" || id === "s-countHub" ? "number"
            : id === "s-hot" ? "string" : null,
      parameters: type === "method" || type === "function"
        ? JSON.stringify(
            id === "s-add" ? [{ name: "item", type: "string" }]
              : id === "s-notify" ? [{ name: "hub", type: "Hub" }, { name: "message", type: "string" }]
                : id === "s-countHub" ? [{ name: "hub", type: "Hub" }]
                  : [],
          )
        : null,
      file_id: "f-hub",
    })
  }
  // src/app.ts declarations (1-based), asserted against the authored text for the
  // same reason as the hub symbols above.
  for (const [id, name] of [
    ["s-run", "run"], ["s-runAgain", "runAgain"],
    ["s-c1", "c1"], ["s-c2", "c2"], ["s-c3", "c3"],
    ["s-c4", "c4"], ["s-c5", "c5"],
  ] as Array<[string, string]>) {
    const line = APP_DECL_LINES[name]!
    symbols.push({
      id, name, file: "app", rel: "src/app.ts",
      symbol_type: "function", qualified_name: null,
      line_start: line, line_end: line,
      byte_start: colOf("app", line, name), byte_end: colOf("app", line, name) + name.length,
      owner_symbol_id: null, visibility: "public",
      return_type: id === "s-run" || id === "s-runAgain" ? "number" : "string",
      parameters: "[]",
      file_id: "f-app",
    })
  }

  // src/app.ts stored rows. NOTE the `line` on every calls row: it is the
  // CALL SITE line, and for runAgain it is deliberately NOT the caller's
  // declaration line — that is the fact the R4 differential measures.
  //   run():        decl 4;  `new Hub()` 6; notifyHub 7; countHub 8
  //   runAgain():   decl 9;  `new Hub()` 11; notifyHub 12; reset 13; countHub 14
  const r = (id: string, source: string, target: string | null, type: string, conf: number, line: number, cls?: string, enrich?: Record<string, unknown>): Fx["rels"][number] =>
    ({ id, source, target, type, conf, line, cls, enrich })
  const at = lineOf
  rels.push(
    // Hub: 4 containment rows + 2 instantiation rows (6 rows, 2 distinct kinds)
    r("r-h1", "s-hub", "s-items", "contains", 1.0, at("hub", "items"), "structural"),
    r("r-h2", "s-hub", "s-add", "contains", 1.0, at("hub", "add"), "structural"),
    r("r-h3", "s-hub", "s-count", "contains", 1.0, at("hub", "count"), "structural"),
    r("r-h4", "s-hub", "s-reset", "contains", 1.0, at("hub", "reset"), "structural"),
    r("r-h5", "s-run", "s-hub", "instantiates", 0.95, at("app", "new Hub()"), "structural"),
    r("r-h6", "s-runAgain", "s-hub", "instantiates", 0.95, at("app", "new Hub()", 2), "structural"),
    // items: a `uses` row from count and one from reset — the LOWER-CONFIDENCE
    // kinds that carry no verb, so the connected summary cannot name them.
    r("r-i1", "s-count", "s-items", "uses", 0.8, at("hub", "this.items.length"), "usage_contextual"),
    r("r-i2", "s-reset", "s-items", "uses", 0.8, at("hub", "this.items = []"), "usage_contextual"),
    // add: called from both mains, one row EACH, at their real call-site lines
    r("r-a1", "s-run", "s-add", "calls", 1.0, at("app", "notifyHub(hub, \"hello\")"), "structural"),
    r("r-a2", "s-runAgain", "s-add", "calls", 1.0, at("app", "notifyHub(hub, \"again\")"), "structural"),
    // count: called from countHub (which is called from both mains)
    r("r-c1", "s-countHub", "s-count", "calls", 1.0, at("hub", "return hub.count()"), "structural"),
    // reset: one incoming call row, and one outgoing `references` row
    r("r-x1", "s-runAgain", "s-reset", "calls", 1.0, at("app", "hub.reset()"), "structural"),
    r("r-x2", "s-reset", "s-items", "references", 0.6, at("hub", "this.items = []"), null),
    // notifyHub: called from both mains at their call-site lines
    r("r-n1", "s-run", "s-notify", "calls", 1.0, at("app", "notifyHub(hub, \"hello\")"), "structural"),
    r("r-n2", "s-runAgain", "s-notify", "calls", 1.0, at("app", "notifyHub(hub, \"again\")"), "structural"),
    // countHub: called from both mains at their call-site lines
    r("r-q1", "s-run", "s-countHub", "calls", 1.0, at("app", "return countHub(hub)"), "structural"),
    r("r-q2", "s-runAgain", "s-countHub", "calls", 1.0, at("app", "return countHub(hub)"), "structural"),
    // app.ts imports hub.ts — a FILE-LEVEL row (no symbol endpoint), the kind
    // the hub puts in a labeled section and the hover does not name at all.
    { id: "r-f1", source: "s-run", target: null, type: "imports", conf: 1.0, line: 1, external: "./hub" },
    // An EXTERNAL target with no symbol row (the indexer's `ext:` shape).
    r("r-e1", "s-count", "ext:push", "calls", 0.4, at("hub", "return this.items.length"), null),
    // An ENRICHED row (the M40 pass's metadata, with the inferredAt marker the
    // enrichment owner requires) — the hover may render it, but only labeled.
    r("r-en1", "s-run", "s-notify", "calls", 1.0, at("app", "notifyHub(hub, \"hello\")"), "usage_contextual", {
      inferredAt: 1_700_000_000_000, role: "producer", pattern: "event_handler",
      layerFlow: "app→core", criticality: "high", frequency: "one_of_2",
    }),
    // hotPath: FIVE distinct stored call rows, each at its own caller's
    // call-site line, from five different referencing symbols. This is the
    // shape the MAX_USAGE_LINKS cap of 3 truncates — the audit has to be able
    // to SEE that truncation rather than report a clean 100%.
    r("r-k1", "s-c1", "s-hot", "calls", 1.0, at("app", "c1"), "structural"),
    r("r-k2", "s-c2", "s-hot", "calls", 1.0, at("app", "c2"), "structural"),
    r("r-k3", "s-c3", "s-hot", "calls", 1.0, at("app", "c3"), "structural"),
    r("r-k4", "s-c4", "s-hot", "calls", 1.0, at("app", "c4"), "structural"),
    r("r-k5", "s-c5", "s-hot", "calls", 0.8, at("app", "c5"), "structural"),
    // The BUSY symbol: BUSY_CALLER_FILES distinct FILES, one stored call row
    // each, all at a real call-site line. This is the shape whose hover cost
    // decides the §3 budget — every distinct file is read and mapped once.
    ...Array.from({ length: BUSY_CALLER_FILES }, (_v, i) => {
      const rel = `src/caller${i}.ts`
      // The caller files carry REALISTIC size (BUSY_CALLER_BODY_LINES lines of
      // ordinary TypeScript each, ~20 KB). The first version of this fixture
      // used three-line stubs and reported p95 = 13.6 ms — inside the budget —
      // while the same shape over a real index measured 242 ms. A fixture that
      // flatters the budget is the same defect as reporting a mean as a p95, so
      // the size is a declared property of the fixture, not an accident.
      const filler = Array.from({ length: BUSY_CALLER_BODY_LINES }, (_x, j) =>
        `  const local${j} = "${("x".repeat(24))}${j}" // a realistic line of ordinary source`,
      ).join("\n")
      FIXTURE_FILES[rel] = `import { busyHub } from "./hub"\n\nexport function caller${i}(): string {\n${filler}\n  return busyHub()\n}\n`
      const declLine = 3 + BUSY_CALLER_BODY_LINES + 1
      symbols.push({
        id: `s-bc${i}`, name: `caller${i}`, file: `caller${i}`, rel,
        symbol_type: "function", qualified_name: null,
        line_start: 3, line_end: declLine,
        byte_start: 17, byte_end: 17 + `caller${i}`.length,
        owner_symbol_id: null, visibility: "public", return_type: "string", parameters: "[]",
        file_id: `f-bc${i}`,
      })
      files.push({ id: `f-bc${i}`, rel, abs: "" })
      // The stored call site is the line the `return busyHub()` sits on, which
      // is NOT the caller's declaration line — the case §14 rule 3 is about.
      return r(`r-b${i}`, `s-bc${i}`, BUSY_SYMBOL, "calls", 1.0, declLine, "structural")
    }),
    // The SECOND busy shape, and the one the per-call location memo actually
    // decides: MANY stored rows into FEW files. A real utility is called from
    // many places inside the same module, so 30 rows point at one file — and a
    // collector that resolves one location per ROW reads and re-maps that file
    // 30 times for one hover. The first version of this fixture only had the
    // many-files shape, where every row is a distinct file and the memo
    // provably cannot help; measuring only that shape would have reported the
    // memo as worthless.
    ...(() => {
      const rel = "src/manyrows.ts"
      const body = Array.from({ length: BUSY_MANY_ROWS }, (_x, j) =>
        `  export function call${j}(): string {\n    return busyHub()\n  }`,
      ).join("\n")
      FIXTURE_FILES[rel] = `import { busyHub } from "./hub"\n\n${body}\n`
      files.push({ id: "f-mr", rel, abs: "" })
      const out: Fx["rels"] = []
      for (let j = 0; j < BUSY_MANY_ROWS; j++) {
        const name = `call${j}`
        const declLine = 3 + j * 3
        symbols.push({
          id: `s-mr${j}`, name, file: "manyrows", rel,
          symbol_type: "function", qualified_name: null,
          line_start: declLine, line_end: declLine + 2,
          byte_start: 17, byte_end: 17 + name.length,
          owner_symbol_id: null, visibility: "public", return_type: "string", parameters: "[]",
          file_id: "f-mr",
        })
        // The call site is the `return busyHub()` line — one below the
        // declaration, so every row's line differs from its own declaration.
        out.push(r(`r-mr${j}`, `s-mr${j}`, BUSY_SYMBOL, "calls", 1.0, declLine + 1, "structural"))
      }
      return out
    })(),
    // The THIRD busy shape, and the only one on which the per-call location memo
    // can pay: MANY stored rows from ONE referencing symbol in ONE file. That
    // is the shape a real index produces for a hot utility — `assert(...)`
    // called 40 times in one module is 40 stored rows whose other end is the
    // SAME symbol row, so all 40 resolve to the same (path, byte columns,
    // lines) tuple. A collector that resolves per ROW reads and re-maps that
    // one file forty times for a single hover; the memo resolves it once.
    //
    // Measured on a real index (this machine, backbencher-brain): a symbol with
    // 128 stored rows produced 73 DISTINCT location tuples, and per-call
    // memoization cut the collector from 560 ms to 356 ms on that hover.
    ...(() => {
      const rel = "src/hotcaller.ts"
      const calls = Array.from({ length: BUSY_HOT_CALLS }, (_x, j) => `  sink(busyHub(), "${("y".repeat(40))}${j}") // call ${j}`).join("\n")
      // The filler sits BETWEEN the declaration and the calls, so this file is
      // realistically sized (~400 lines). Without it the shape measured a
      // 47-line file read 40 times, which is fast enough to hide the cost the
      // memo exists to remove — a fixture too small to show the effect reports
      // the effect as worthless.
      const filler = Array.from({ length: BUSY_CALLER_BODY_LINES }, (_x, j) =>
        `  const pad${j} = "${("z".repeat(24))}${j}"`,
      ).join("\n")
      FIXTURE_FILES[rel] = `import { busyHub } from "./hub"\n\nfunction sink(v: string, w: string): void {\n  void v\n  void w\n}\n\nexport function hotCaller(): void {\n${filler}\n${calls}\n}\n`
      files.push({ id: "f-hc", rel, abs: "" })
      // The declaration and call lines are READ OFF the built source. Two
      // hand-typed versions of this were off (one blank line, one line of
      // padding), and the symptom was a hover at a position outside every
      // symbol — a budget measured on declared absence, which is why the
      // render assertion exists.
      const hcLines = FIXTURE_FILES[rel]!.split("\n")
      const declLine = hcLines.findIndex((l) => l.includes("export function hotCaller")) + 1
      const firstCall = hcLines.findIndex((l) => l.includes("// call 0")) + 1
      if (declLine < 1 || firstCall < 1) throw new Error("fixture: hotcaller declaration or first call line not found")
      symbols.push({
        id: "s-hc", name: "hotCaller", file: "hotcaller", rel,
        symbol_type: "function", qualified_name: null,
        line_start: declLine, line_end: firstCall + BUSY_HOT_CALLS,
        byte_start: 17, byte_end: 26,
        owner_symbol_id: null, visibility: "public", return_type: "void", parameters: "[]",
        file_id: "f-hc",
      })
      const out: Fx["rels"] = []
      for (let j = 0; j < BUSY_HOT_CALLS; j++) {
        out.push(r(`r-hc${j}`, "s-hc", BUSY_SYMBOL, "calls", 1.0, firstCall + j, "structural"))
      }
      return out
    })(),
  )
  // r-en1 duplicates r-n1's endpoints deliberately: two stored rows, one site.
  // The usage-site COUNT must dedup it; the enrichment story must survive.
  // r-en1 duplicates r-n1's endpoints deliberately: two stored rows, one site.
  // The usage-site COUNT must dedup it; the enrichment story must survive.
  return { files, symbols, rels }
}

export async function seed(dir: string): Promise<{ raw: any; projectId: string }> {
  const { BrainDatabase } = (await import(path.join(ROOT, "src", "brain", "database.ts"))) as {
    BrainDatabase: { getRawInstance(projectId: string): Promise<any> }
  }
  const { createHash } = await import("node:crypto")
  const { hashFileContent } = (await import(path.join(ROOT, "src", "brain", "freshness.ts"))) as { hashFileContent(c: string): string }
  const projectId = createHash("sha1").update(dir).digest("hex").substring(0, 40)
  process.env.BB_DATA_DIR = path.join(dir, ".bb-data")
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fx = buildFixture()
  const insFile = raw.prepare(
    "INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash) VALUES (?,?,?,?,?,?)",
  )
  for (const f of fx.files) {
    // The file MUST exist on disk at its indexed path: the hover reads it for
    // freshness hashing and for position resolution, so a fixture with rows but
    // no bytes on disk would measure the read failure, not the surface.
    const abs = path.join(dir, f.rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    const body = FIXTURE_FILES[f.rel]
    if (body === undefined) throw new Error(`fixture: no authored source for ${f.rel}`)
    writeFileSync(abs, body)
    insFile.run(f.id, projectId, abs, f.rel, "typescript", hashFileContent(body))
    f.abs = abs
  }
  const insSym = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type, line_start, line_end,
       byte_start, byte_end, owner_symbol_id, visibility, return_type, parameters, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const s of fx.symbols) {
    insSym.run(s.id, projectId, s.file_id, s.name, s.qualified_name ?? null, s.symbol_type, s.line_start, s.line_end,
      s.byte_start, s.byte_end, s.owner_symbol_id ?? null, s.visibility ?? null, s.return_type ?? null, s.parameters ?? null, 5)
  }
  const insRel = raw.prepare(
    `INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, target_external,
       relationship_type, confidence, line_number, is_cross_file, metadata)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const r of fx.rels) {
    const meta: Record<string, unknown> = {}
    if (r.cls !== undefined) meta["evidenceClass"] = r.cls
    if (r.enrich !== undefined) Object.assign(meta, r.enrich)
    // The indexer's shape for an `ext:` target: NO symbol row, so
    // target_symbol_id is NULL and the name rides in target_external. Writing
    // the name into the FK column instead would be a store-contract violation
    // (foreign_keys is ON), and a fixture that lies about the shape it measures
    // measures nothing.
    const external = r.external ?? (r.target !== null && r.target.startsWith("ext:") ? r.target : null)
    insRel.run(
      r.id, projectId, r.source, external === null ? r.target : null, external,
      r.type, r.conf, r.line, 1,
      Object.keys(meta).length > 0 ? JSON.stringify(meta) : null,
    )
  }
  return { raw, projectId }
}

// --- R1: what the index KNOWS ---------------------------------------------------------
export interface KnownFacts {
  symbolId: string
  name: string
  /** stored relationship rows touching this symbol, either end */
  rows: Array<{ id: string; kind: string; direction: "incoming" | "outgoing"; otherId: string | null; otherExternal: string | null; line: number | null; confidence: number }>
  incomingKinds: string[]
  outgoingKinds: string[]
  /** usage sites under the declared vocabulary (relations.ts) */
  usageSiteRows: number
  usageSiteDistinctLocations: number
  /** rows whose stored call-site line differs from the source symbol's declaration */
  callSiteRows: number
  callSiteRowsDiffering: number
  /** exact (call-site) addresses the address owner recognizes */
  exactAddresses: number
  /** rows with no symbol endpoint on the far side (external / file-level) */
  externalRows: number
  /** rows carrying an enrichment record (the inferredAt marker) */
  enrichedRows: number
  annotationCount: number
  crossLanguageRows: number
  containmentParent: string | null
  columnsPresent: string[]
}

export function know(raw: any, dir: string, symbolId: string): KnownFacts {
  const idToName = new Map<string, string>()
  for (const r of raw.prepare("SELECT id, name FROM brain_symbol").all() as any[]) idToName.set(r.id, r.name)

  const rows = (raw.prepare(
    `SELECT r.id, r.relationship_type, r.source_symbol_id, r.target_symbol_id, r.target_external,
            r.line_number, r.confidence, ss.name AS src_name, ss.line_start AS src_decl
     FROM brain_relationship r
     LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
     WHERE r.source_symbol_id = ? OR r.target_symbol_id = ?`,
  ).all(symbolId, symbolId) as any[]).map((r) => {
    const incoming = r.target_symbol_id === symbolId && r.source_symbol_id !== symbolId
    return {
      id: r.id,
      kind: r.relationship_type,
      direction: (incoming ? "incoming" : "outgoing") as "incoming" | "outgoing",
      otherId: incoming ? r.source_symbol_id : r.target_symbol_id,
      otherExternal: incoming ? null : r.target_external,
      line: r.line_number ?? null,
      confidence: r.confidence,
      srcDecl: r.src_decl ?? null,
      srcName: r.src_name ?? null,
    }
  })

  const incoming = rows.filter((r) => r.direction === "incoming")
  const outgoing = rows.filter((r) => r.direction === "outgoing")

  // Usage sites: the DECLARED vocabulary (relations.ts), applied here from the
  // raw rows rather than by importing the owner's predicate — the oracle must
  // not share an implementation with the thing it measures.
  const DECL = new Set(["contains", "exports"])
  const usageRows = incoming.filter((r) => !DECL.has(r.kind.trim().toLowerCase()))
  const locKey = (r: (typeof usageRows)[number]): string => {
    if (r.otherId === null) return `ext:${r.otherExternal ?? "?"}:${r.line}`
    const o = raw.prepare("SELECT s.line_start AS ls, s.byte_start AS bs, f.path AS p FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.id=?").get(r.otherId) as any
    return `${o?.p ?? r.otherId}:${o?.ls ?? "?"}:${o?.bs ?? "?"}`
  }
  const distinct = new Set(usageRows.map(locKey))

  // The address owner's own classification of every stored line — the ONE owner.
  let callSiteRows = 0
  let callSiteRowsDiffering = 0
  let exactAddresses = 0
  for (const r of incoming) {
    const state = classifyStoredLine(r.line)
    if (state === "real") callSiteRows++
    const addr = deriveCallSiteAddress({ storedLine: r.line, file: "", callerDeclaration: { line: r.srcDecl } })
    if (isExactAddress(addr)) exactAddresses++
    if (r.srcDecl !== null && r.line !== null && r.line > 0 && r.line !== r.srcDecl) callSiteRowsDiffering++
  }

  const sym = raw.prepare("SELECT * FROM brain_symbol WHERE id = ?").get(symbolId) as any
  const parent = sym?.owner_symbol_id ?? null
  const parentName = parent === null ? null : (idToName.get(parent) ?? null)

  const annotations = raw.prepare("SELECT COUNT(*) AS c FROM brain_annotation WHERE symbol_name = ?").get(sym?.name) as any
  const xlang = raw.prepare("SELECT COUNT(*) AS c FROM brain_relationship WHERE (source_symbol_id = ? OR target_symbol_id = ?) AND is_cross_language = 1").get(symbolId, symbolId) as any

  const COLUMNS = ["return_type", "parameters", "visibility", "owner_symbol_id", "line_start", "byte_start", "gravity_score", "qualified_name"]
  const present = COLUMNS.filter((c) => sym?.[c] !== null && sym?.[c] !== undefined)

  void dir
  return {
    symbolId,
    name: sym?.name ?? "?",
    rows: rows.map(({ srcDecl: _d, srcName: _n, ...rest }) => rest),
    incomingKinds: [...new Set(incoming.map((r) => r.kind))].sort(),
    outgoingKinds: [...new Set(outgoing.map((r) => r.kind))].sort(),
    usageSiteRows: usageRows.length,
    usageSiteDistinctLocations: distinct.size,
    callSiteRows,
    callSiteRowsDiffering,
    exactAddresses,
    externalRows: rows.filter((r) => r.otherId === null).length,
    enrichedRows: rows.filter((r) => {
      const m = raw.prepare("SELECT metadata FROM brain_relationship WHERE id = ?").get(r.id) as any
      if (typeof m?.metadata !== "string") return false
      try { return typeof (JSON.parse(m.metadata) as any).inferredAt === "number" } catch { return false }
    }).length,
    annotationCount: Number(annotations?.c ?? 0),
    crossLanguageRows: Number(xlang?.c ?? 0),
    containmentParent: parentName,
    columnsPresent: present,
  }
}

// --- R2: what the hover RENDERS -------------------------------------------------------
export interface RenderedLink {
  /** the label the card shows for the row */
  label: string
  /** the index-stored file the link's command args carry (LSP command args) */
  file: string
  /** LSP 0-based line the link's command args carry */
  line: number
  /** which SECTION of the card the link sits in */
  section: "connected" | "usages" | "containment" | "other"
  /** the verb under which the link renders; "" when the section groups rows
   *  without one (the usages list is a list of sites, not verb groups) */
  verb: string
}

export interface RenderedSectionHeader {
  /** the header's own name, e.g. "usages", "contained", "connected" */
  name: string
  /** the number the header states; null when the header states none */
  count: number | null
  /** the rendered rows beneath the header */
  rows: RenderedLink[]
  /** the "+N more" remainder the header declares for a capped list */
  rest: number
}

export interface RenderedFacts {
  symbol: string
  card: string
  /** names the card links to (parsed out of the command links) */
  linkedNames: string[]
  /** the card's own claim of a usage count */
  claimedUsageCount: number | null
  /** the usages section's rendered rows */
  renderedUsageRows: string[]
  /** every rendered link, with its section, verb and index-stored target. This
   *  is the STRUCTURAL read the per-kind coverage metric is taken from: a row
   *  counts as rendered-with-a-verb only when a link carrying THAT row's stored
   *  target is found under a verb, which no word-frequency scan can establish. */
  links: RenderedLink[]
  /** the parsed per-section headers, each with its own stated count */
  sections: RenderedSectionHeader[]
  /** the evidence tiers the card states, verbatim off the `evidence:` line */
  renderedTiers: string[]
  /** relationship kinds the card NAMES in prose — RETAINED ONLY as the
   *  flattering metric it is, kept beside the structural one so the two can be
   *  compared. Never used to score coverage. */
  namedKinds: string[]
  /** does the card carry the enrichment label at all */
  mentionsEnrichment: boolean
  /** does the card name an external target */
  mentionsExternal: boolean
  /** does the card name the file-level import */
  mentionsFileLevel: boolean
  /** does the card name the owning declaration */
  mentionsOwner: boolean
  /** the call-site lines the card's links target (LSP 0-based) */
  linkedLines: number[]
  /** links whose target IS the stored call-site line (LSP 0-based) */
  callSiteLines: number[]
  /** links whose target is a referencing symbol's DECLARATION line */
  declarationLines: number[]
  callSiteLinkCount: number
  declarationLinkCount: number
}

// The legacy word-frequency list, kept deliberately. The audit once scored
// coverage by grepping the card for these English words, which is how
// `references` scored on seven cards (the header says "N stored references")
// while `contains` — the second-most-stored kind — scored ZERO because it had no
// prose word. It is retained beside the structural metric so the gap between
// them stays visible; it is never the score.
const PROSE_KINDS = ["calls", "call", "instantiates", "implements", "overrides", "extends", "inherits", "uses", "references", "imports", "exports", "contains"]

/** Decode one `bb.openUsage` command link's args into its stored target. */
function decodeLink(raw: string): { file: string; line: number } | null {
  try {
    const decoded = JSON.parse(decodeURIComponent(raw))
    const args = (Array.isArray(decoded) ? decoded[0] : decoded) as any
    if (args === null || typeof args !== "object") return null
    return { file: String(args.file ?? ""), line: Number(args.line) }
  } catch {
    return null
  }
}

const LINK_RE = /\[([^\]]*)\]\(command:bb\.openUsage\?([^)]+)\)/g

/** Every rendered relationship link, in card order, with its section, its verb
 *  and the index-stored target its command args carry.
 *
 *  Section attribution is by POSITION in the card, never by a word match: the
 *  card is a sequence of `**header**` blocks, and a link belongs to the block
 *  whose header precedes it. A section whose header never appears contributes no
 *  links, which is what makes a MISSING section measurable (0 links, 0 rows)
 *  rather than invisible. */
function parseLinks(card: string): RenderedLink[] {
  // Where each section starts. Headers are the `**name**` tokens at the start of
  // a line; `**usages** — N stored references` and `**contained** — declares…`
  // both match, and the first token is the section name.
  const headers: Array<{ name: string; at: number }> = []
  for (const m of card.matchAll(/^\*\*([a-z]+)\*\*/gm)) headers.push({ name: m[1]!, at: m.index })
  const sectionAt = (index: number): RenderedLink["section"] => {
    let name = ""
    for (const h of headers) if (h.at <= index) name = h.name
    if (name === "usages") return "usages"
    if (name === "contained" || name === "contains") return "containment"
    if (name === "connected") return "connected"
    return "other"
  }
  // The verb of a connected/containment link is the text that LEADS ITS GROUP.
  // A group is `verb link, link, …` and a group boundary is a `;` (the connected
  // summary joins groups with "; ") or a line break (the containment section puts
  // each direction on its own line). So the verb is the text between the group's
  // start and the group's FIRST link.
  //
  // Reading to the previous link's `)` instead was the first draft's bug and it
  // was silent: in `called by [a](…), [b](…)` it gave `[b]` the verb "" and every
  // row after the first in a group scored as an unlabelled gap. Reading to the
  // line start was the second bug: it swallowed the previous group's whole link
  // text, so a row's "verb" came back as `called by [c1](command:…)` and matched
  // no declared verb — a metric that reported 0% on a card that labelled every
  // row correctly. Both were invisible because the metric was reporting a gap
  // either way; a gap number that cannot distinguish these two states is not a
  // measurement.
  //
  // For the usages list the row's own numbering leads instead, so the verb is ""
  // — that list is sites, not verb groups, and saying so keeps the per-kind
  // metric honest about which section actually labels a row.
  const groupVerb = (index: number, section: RenderedLink["section"]): string => {
    if (section === "usages" || section === "other") return ""
    const lineStart = card.lastIndexOf("\n", index) + 1
    const before = card.slice(lineStart, index)
    // The group begins after the nearest preceding group separator, which is
    // the LATER of a `;` and the line start. The `**header**` token is consumed
    // by the strip below.
    const groupStart = lineStart + Math.max(0, before.lastIndexOf(";") + 1)
    const lead = card.slice(groupStart, index)
    // The verb is the lead text up to the group's first link; anything from a
    // `[` onward belongs to a link, not to the label.
    const firstLink = lead.indexOf("[")
    const text = (firstLink === -1 ? lead : lead.slice(0, firstLink))
      // Drop the section's own `**header**` token. It must be dropped WHOLE:
      // replacing one `**` left `connected**: called by`, which matches no
      // declared verb and so reported 0% coverage on a card that labelled every
      // row correctly — a metric whose failure mode looks exactly like the
      // defect it hunts.
      .replace(/^\s*\*\*[^*]*\*\*/, " ")
      // The leading separators a header or a list puts before a verb: markdown
      // asterisks, spaces, a colon, an em dash, a comma, a hyphen. Listed as
      // literals rather than a range — `—,` reads as a RANGE in a character
      // class and throws "Range out of order", which is how this parser failed
      // to load at all before the class was written out.
      .replace(/^[\s*:,\-\u2014\u2013]+/, "")
      .trim()
    return text
  }
  const out: RenderedLink[] = []
  for (const m of card.matchAll(LINK_RE)) {
    const target = decodeLink(m[2]!)
    if (target === null) continue
    const index = m.index ?? 0
    const section = sectionAt(index)
    out.push({ label: m[1]!, file: target.file, line: target.line, section, verb: groupVerb(index, section) })
  }
  return out
}

/** The per-section headers with their stated counts and the rows beneath them.
 *  §13.4 is checked against THIS structure: the header's own number against the
 *  rows the eye can see under it. */
function parseSections(links: RenderedLink[], card: string): RenderedSectionHeader[] {
  // The section NAMES to look for. `contains` is NOT among them: it is a
  // relationship KIND (the word `contains` appears in a containment row's verb
  // and in the header's "declaration containment" clause), not a section name.
  // Listing it produced a second, phantom copy of the containment section with
  // its own count and the same rows, so the header-vs-list law was applied twice
  // to the same numbers — and a mutant leg that mutated "the first counted
  // section" could land on either copy.
  const names = ["connected", "usages", "contained"]
  return names.map((name) => {
    const inSection = links.filter((l) => (name === "contained" ? l.section === "containment" : l.section === name))
    // The count a header STATES — and ONLY a count it actually states.
    //
    // `**connected**:` states no total: it is `verb links; verb links` with a
    // per-verb `+N` overflow. Reading "the first digit on the header's line" as
    // its count is how this parser reported `header=5` for a header that says no
    // number, which manufactured seven D2 failures on correct cards. A header
    // with no number in it has count null, and a null count is out of the
    // header-vs-list law's scope (§13.4 is about a number that disagrees with a
    // list, not about a line that states none).
    let count: number | null = null
    if (name === "usages") {
      // `**usages** — N stored reference(s) (…): the number immediately follows
      // the dash, so it is read positionally rather than as "any digit". The
      // `m` flag matters: the header is one line of a multi-line card.
      const m = /^\*\*usages\*\*\s*[—\-:]\s*(\d+)\s+stored reference/m.exec(card)
      if (m !== null) count = Number(m[1])
    } else if (name === "contained") {
      // The containment header names two counts — members declared, owners
      // declared in — so the section's stated total is their sum.
      const m2 = /declares (\d+) member[s]?, declared in (\d+)/.exec(card)
      if (m2 !== null) count = Number(m2[1]) + Number(m2[2])
    }
    // The declared rest. It is a line of its OWN beneath the rows (`+2 more —
    // [show all usages]`), not a clause of the header, so it is read from the
    // section's body. The first draft searched the header line only, found
    // nothing, and reported `header=5 but rows+rest=3` for a symbol whose header
    // and list agreed exactly — a D2 failure raised by the measuring instrument,
    // not by the surface. An instrument that manufactures failures is as
    // dishonest as one that hides them.
    let rest = 0
    const headerAt = card.search(new RegExp(`^\\*\\*${name}\\*\\*`, "m"))
    if (headerAt !== -1) {
      const body = card.slice(headerAt)
      const nextHeader = body.slice(1).search(/^\*\*[a-z]+\*\*/m)
      const sectionBody = nextHeader === -1 ? body : body.slice(0, nextHeader + 1)
      const restMatch = /^\+(\d+) more/m.exec(sectionBody)
      if (restMatch !== null) rest = Number(restMatch[1])
    }
    return { name, count, rows: inSection, rest }
  }).filter((s) => s.count !== null || s.rows.length > 0 || s.rest > 0)
}

export function rendered(card: string, data: any, callSiteLines0: readonly number[] = [], declarationLines0: readonly number[] = []): RenderedFacts {
  const links = parseLinks(card)
  const linked = links.map((l) => l.file)
  const linkedLines = links.map((l) => l.line)
  const renderedUsageRows = card.includes("**usages**")
    ? card.slice(card.indexOf("**usages**")).split("\n").filter((l) => /^\d+\. \[/.test(l))
    : []
  const claimed = /(\d+) usage/.exec(card)
  const kinds: string[] = []
  for (const k of PROSE_KINDS) if (new RegExp(`\\b${k}\\b`).test(card)) kinds.push(k)
  // The tiers the card states, read off the `evidence:` line and nothing else.
  // The line `evidence: none (no indexed relationships)` is a DECLARED ABSENCE
  // in prose, not a tier — reading it as one is how a symbol with zero stored
  // rows looked like it rendered a tier the index never justified. It is
  // returned as an empty list, which is what it means.
  const evidenceLine = /^evidence: (.+)$/m.exec(card)
  const renderedTiers =
    evidenceLine === null || /^none\b/.test(evidenceLine[1]!.trim())
      ? []
      : evidenceLine[1]!.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
  // Each emitted link is classified by the address owner's own verdict for the
  // row it names, so the two counts in the table are read off the RENDER, not
  // recomputed from the implementation.
  let callSiteLinkCount = 0
  let declarationLinkCount = 0
  for (const l of linkedLines) {
    if (callSiteLines0.includes(l)) callSiteLinkCount++
    else if (declarationLines0.includes(l)) declarationLinkCount++
  }
  void data
  return {
    symbol: String(data?.name ?? "?"),
    card,
    linkedNames: linked,
    claimedUsageCount: claimed ? Number(claimed[1]) : null,
    renderedUsageRows,
    links,
    sections: parseSections(links, card),
    renderedTiers,
    namedKinds: kinds,
    mentionsEnrichment: /enriched by index/.test(card),
    mentionsExternal: /\bext:|external/i.test(card),
    mentionsFileLevel: /module|file-level/i.test(card),
    mentionsOwner: /declared in|contained|owner/i.test(card),
    linkedLines,
    callSiteLines: [...callSiteLines0],
    declarationLines: [...declarationLines0],
    callSiteLinkCount,
    declarationLinkCount,
  }
}

// --- Run --------------------------------------------------------------------------------
/**
 * §3 budget, measured as a p95 and recorded (§3: never a mean, never a single
 * sample). The fixture carries a BUSY symbol on purpose: the cost that decides
 * whether a hover lands inside 50 ms is the number of distinct FILES its
 * relationship rows point into, because every one of them is read and mapped.
 * A gate that measured a two-row fixture would report a comfortable number for
 * a surface that misses the budget on every real symbol with callers — which
 * is the failure the owner's report describes.
 *
 * The budget result is emitted as evidence either way. §3: "A budget miss is a
 * failed gate, not a footnote", so the check below is a real assertion against
 * the declared 50 ms and it goes red when the budget is missed. That is the
 * intent; the value is not to be tuned until it passes.
 */
