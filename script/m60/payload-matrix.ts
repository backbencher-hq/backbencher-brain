// script/m60/payload-matrix.ts — M60.P1: the payload-seam matrix.
//
// "Random sampling of a finite set never terminates; enumeration does."
// This gate enumerates the ENTIRE declared payload surface and every seam
// stage of it, so a payload field can no longer look like a "new phase" —
// it is a cell in a table this repo owns.
//
// Surface (parsed from src/ast/types.ts, never hand-copied):
//   UniversalSymbol       — 22 declared fields
//   UniversalRelationship — 11 declared fields
// Languages: the ONBOARDED languages, enumerated from
// `validation/m14/fixtures/*` at emit time (`onboardedLanguages()`), never a
// transcribed count. The count in this comment was 21 and the enumeration
// silently became 22 when xml got a fixture lane and an analyzer — a comment
// that disagrees with its own artifact is how a downstream gate came to
// hardcode 21 and go permanently red (found 2026-09-16).
// Seams: emit (analyzer) → store (persister) → query (readers) → tool (MCP).
//
// Every needle below was verified against the live tree on 2026-09-14
// (grep with line numbers recorded in this file's specs). A needle that no
// longer matches is a FATAL, not a silent "dead cell" — the matrix must
// distinguish "the payload is dead" from "the matrix rotted".
//
// Run: npx tsx script/m60/payload-matrix.ts  → validation/m60/results/P1.json
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/P1.json")
const TYPES_TS = path.join(ROOT, "src/ast/types.ts")
const FIXTURES = path.join(ROOT, "validation/m14/fixtures")

// --- per-seam file sets (query includes the security/graph readers the tools
// call into; tool is the MCP surface proper) ---------------------------------
const SEAM_FILES = {
  store: ["src/ast/parallel-indexer.ts", "src/brain/schema-ddl.ts"],
  query: [
    "src/brain/brain.sql.ts",
    "src/intelligence/graph/graph-engine.ts",
    "src/intelligence/documentation/doc-engine.ts",
    "src/intelligence/security/taint.ts",
  ],
  tool: ["src/mcp/tool-handlers.ts", "src/mcp/tool-registry.ts"],
}

// --- per-field seam specs (each needle verified 2026-09-14) -----------------
// emit:     regex the analyzer source must match for the language to count
//           as a producer (measured PER LANGUAGE).
// store:    the binding that carries the field into SQLite. `needle` is
//           matched in the store files; `via` documents where it lives.
// query:    a reader that selects/derives the stored column. `via` cites the
//           verified line. `carriedBySelectAll` = read via `SELECT s.*` rows
//           that typed consumers consume.
// tool:     the MCP surface naming the concept (optional — the verdict tier
//           reports a query-reachable field the tool layer never names).
type FieldSpec = {
  iface: "UniversalSymbol" | "UniversalRelationship"
  emit?: RegExp
  store: { needle: RegExp; via: string }
  query: { needle: RegExp; via: string; carriedBySelectAll?: boolean }
  tool?: { needle: RegExp }
  ruling?: string
  note?: string
  // #873 / M60.R6: for a field that CARRIES a line, the base it is counted from.
  // A field can be alive (produced, stored, read) and still name the wrong line —
  // which is exactly what a 0-based `metadata.line` next to a 1-based
  // `line_number` did, and on the cpp/hpp rows there is no second field to
  // disagree with it, so the wrong number was the row's ONLY line. Recorded here
  // so the matrix states the base per field; ENFORCED at the source by R6 in
  // verify-standing-rules.ts, which fails any writer that is not provably 1-based.
  lineBase?: string
}

const INDEXER = "src/ast/parallel-indexer.ts"
const SPECS: Record<string, FieldSpec> = {
  // ---- UniversalSymbol (22) ----
  name: {
    iface: "UniversalSymbol",
    emit: /\bname\s*:/,
    store: { needle: /symbol\.name/, via: `${INDEXER}:2180 (INSERT brain_symbol col 4)` },
    query: { needle: /s\.name/, via: "doc-engine.ts:171, graph-engine.ts:299" },
    tool: { needle: /symbol|name/ },
  },
  kind: {
    iface: "UniversalSymbol",
    emit: /\bkind\s*:/,
    store: { needle: /symbol\.type \|\| symbol\.kind/, via: `${INDEXER}:2078 -> symbol_type` },
    query: { needle: /symbol_type/, via: "graph-engine.ts:299, doc-engine.ts:171 (s.*)" },
    tool: { needle: /symbol_type|kind/ },
  },
  range: {
    iface: "UniversalSymbol",
    emit: /\brange\s*:/,
    store: { needle: /symbol\.range\?\.startLine/, via: `${INDEXER}:2085-2099 -> line_start/line_end/byte_start/byte_end` },
    query: { needle: /line_start/, via: "doc-engine.ts:171,175 (ORDER BY s.line_start)" },
    tool: { needle: /line/ },
    lineBase: "1-based (R6) — line_start/line_end are 1-based; the M59 oracle checks them against the source text",
  },
  scope: {
    iface: "UniversalSymbol",
    emit: /\bscope\s*:/,
    store: { needle: /symbol\.scope \|\| null,/, via: "#837 FIXED: bound at INDEXER insertSymbol (scope_kind column) — the DDL + typed schema existed for years while the INSERT omitted them; bound 2026-09-14 by the M60.P1 enumeration, verified live (kotlin/dart scope rows non-null through the real pipeline, script/m14/tmp/scope837-verify.ts)" },
    query: { needle: /scope_kind/, via: "brain.sql.ts typed schema (data now exists to read)" },
    note: "Was BLOCKED (the only store-drop the enumeration found); the #837 binding landed the same day. The rot-check now REQUIRES the binding to exist — removing it re-fails the matrix.",
  },
  visibility: {
    iface: "UniversalSymbol",
    emit: /\bvisibility\s*:/,
    store: { needle: /symbol\.visibility/, via: `${INDEXER}:2191` },
    query: { needle: /visibility/, via: "brain.sql.ts schema; doc-engine.ts:171 (s.*)" },
    tool: { needle: /visibility/ },
  },
  isStatic: {
    iface: "UniversalSymbol",
    emit: /\bisStatic\s*:/,
    store: { needle: /symbol\.isStatic/, via: `${INDEXER}:2206 -> is_static` },
    query: { needle: /is_static/, via: "brain.sql.ts schema; carried by doc-engine.ts:171 SELECT s.*" },
    queryCarried: true,
  } as FieldSpec,
  isAsync: {
    iface: "UniversalSymbol",
    emit: /\bisAsync\s*:/,
    store: { needle: /symbol\.isAsync/, via: `${INDEXER}:2205 -> is_async` },
    query: { needle: /is_async/, via: "brain.sql.ts schema; carried by doc-engine.ts:171 SELECT s.*" },
  },
  isAbstract: {
    iface: "UniversalSymbol",
    emit: /\bisAbstract\s*:/,
    store: { needle: /symbol\.isAbstract/, via: `${INDEXER}:2207 -> is_abstract` },
    query: { needle: /is_abstract/, via: "brain.sql.ts schema; carried by doc-engine.ts:171 SELECT s.*" },
  },
  parameters: {
    iface: "UniversalSymbol",
    emit: /\bparameters\s*:/,
    store: { needle: /symbol\.parameters/, via: `${INDEXER}:2192 -> parameters (json)` },
    query: { needle: /parameters/, via: "doc-engine.ts:171 (s.*)" },
    tool: { needle: /parameters/ },
  },
  returnType: {
    iface: "UniversalSymbol",
    emit: /\breturnType\s*:/,
    store: { needle: /symbol\.returnType/, via: `${INDEXER}:2193 -> return_type` },
    query: { needle: /return_type/, via: "doc-engine.ts:203 (`returns ${symbol.return_type}`)" },
    tool: { needle: /returnType|return_type/ },
  },
  decorators: {
    iface: "UniversalSymbol",
    emit: /\bdecorators\s*:/,
    store: { needle: /symbol\.decorators/, via: `${INDEXER}:2200-2202 (annotations fallback when metadata absent)` },
    query: { needle: /annotations/, via: "doc-engine.ts:171 (s.*) + graph-engine annotation joins" },
  },
  genericParameters: {
    iface: "UniversalSymbol",
    emit: /\bgenericParameters\s*:/,
    store: { needle: /symbol\.genericParameters/, via: `${INDEXER}:2208 -> generic_parameters (json)` },
    query: { needle: /generic_parameters/, via: "brain.sql.ts schema; carried by doc-engine.ts:171 SELECT s.*" },
  },
  comments: {
    iface: "UniversalSymbol",
    emit: /\bcomments\s*:/,
    store: { needle: /symbol\.comments/, via: "NO binding — no comments column and no INSERT reference (the ruled doc channel is symbol.docstring, M35 pre-work, bound at 2220)" },
    query: { needle: /docstring/, via: "doc-engine.ts:171,175 (s.* includes docstring; lexical LIKE match at 175)" },
    ruling: "M60 plan §3 PoC + M35 pre-work: docstring is the ruled doc channel; comments has no store channel by design. The residual risk is recorded, not hidden: producers that fill only comments (10 languages) lose their doc payload at emit.",
  },
  qualified_calls: {
    iface: "UniversalSymbol",
    emit: /\bqualified_calls\s*:/,
    store: { needle: /symbol\.qualifiedCalls/, via: `${INDEXER}:2194 -> qualified_calls (json)` },
    query: { needle: /qualified_calls/, via: "brain.sql.ts:89 schema; carried by doc-engine.ts:171 SELECT s.*" },
  },
  apiContractPath: {
    iface: "UniversalSymbol",
    emit: /\bapiContractPath\s*:/,
    store: { needle: /symbol\.apiContractPath/, via: `${INDEXER}:2195 -> api_contract_path` },
    query: { needle: /api_contract_path/, via: "graph/doc query layers (verified 2 files)" },
  },
  ownerName: {
    iface: "UniversalSymbol",
    emit: /\bownerName\s*:/,
    store: { needle: /symbol\.ownerName/, via: `${INDEXER}:2097,2115 -> owner_symbol_id (resolved to a row id)` },
    query: { needle: /owner_symbol_id/, via: "graph-engine.ts:148 owner-cascade + schema FK" },
  },
  ownerKind: {
    iface: "UniversalSymbol",
    emit: /\bownerKind\s*:/,
    store: { needle: /ownerKind/, via: "NO binding — derivable from the owner row's symbol_type via owner_symbol_id" },
    query: { needle: /symbol_type/, via: "derivable via owner join (graph-engine.ts:148)" },
    ruling: "Store drops it as redundant: the owner row already carries symbol_type, and graph-engine's owner-cascade reads it from there. Ruled-dead (derivable).",
  },
  taintSources: {
    iface: "UniversalSymbol",
    emit: /\btaintSources\s*:/,
    store: { needle: /symbol\.taintSources/, via: `${INDEXER}:2266-2268 -> brain_taint_flow (insertTaintSource)` },
    query: { needle: /brain_taint_flow/, via: "taint.ts:94 (analyzeTaintFlows SELECT)" },
    tool: { needle: /bb_security/ },
    note: "Alive end-to-end for the languages that emit taints (typescript only) — per-language cells carry the real signal.",
  },
  taintSinks: {
    iface: "UniversalSymbol",
    emit: /\btaintSinks\s*:/,
    store: { needle: /symbol\.taintSinks/, via: `${INDEXER}:2266-2268 -> brain_taint_flow` },
    query: { needle: /brain_taint_flow/, via: "taint.ts:94" },
    tool: { needle: /bb_security/ },
  },
  gravityScore: {
    iface: "UniversalSymbol",
    emit: /\bgravityScore\s*:/,
    store: { needle: /symbol\.gravityScore/, via: `${INDEXER}:2196 -> gravity_score (store computes complexity×visibility fallback)` },
    query: { needle: /gravity_score/, via: "doc-engine.ts:175,182 (ORDER BY s.gravity_score DESC)" },
    ruling: "M60 plan §3 PoC: no analyzer produces gravityScore; the store fallback (complexity × visibility) is the de-facto contract and doc-engine ranks on it. Ruled-dead as an analyzer payload.",
  },
  layer: {
    iface: "UniversalSymbol",
    emit: /\blayer\s*:/,
    store: { needle: /symbol\.layer \|\| fileLayer/, via: `${INDEXER}:2197 -> layer (file-level fallback)` },
    query: { needle: /layer/, via: "analysis layers (verified 2 query files)" },
    ruling: "No analyzer emits a per-symbol layer; the store's file-level fallback (symbol.layer || fileLayer) is the de-facto contract, cited from the binding itself. Ruled-dead as an analyzer payload.",
  },
  metadata: {
    iface: "UniversalSymbol",
    emit: /\bmetadata\s*:/,
    store: {
      needle: /symbol\.metadata/,
      via: `${INDEXER}:2198-2200 -> annotations (json), PLUS #612: the ONE metadata key the store phase itself reads gets a column of its own — \`metadata.isDeclaration\` is narrowed to \`is_declaration\` at the worker seam (pool-worker.ts, which for SYMBOLS used to drop the whole metadata object, exactly as it had for docstring/#35 and scope_kind/#837) and bound at the INSERT; name resolution orders by it so a definition wins over a declaration`,
    },
    query: {
      needle: /annotations|is_declaration/,
      via: "doc-engine.ts:171 (s.*) + tool surface annotations; is_declaration is read by the store-phase resolver (parallel-indexer.ts resolveTargetStmt)",
    },
    tool: { needle: /annotations/ },
    note:
      "#612 widened this field's STORE claim without changing its shape: `annotations` is still the metadata JSON column and is still NULL at runtime for analyzer symbols (the worker drops the object), but `metadata.isDeclaration` now has a dedicated column and a reader. The runtime-absent annotations channel is recorded here rather than hidden — it is the same seam class as docstring (M35) and scope_kind (#837), and it is why three lanes' fixture pins for the declaration fact had to go through the worker payload instead of annotations.",
    // The LINE-VALUED keys inside this field are the ones #873 was about:
    // `metadata.line` on a relationship (only typescript and cpp write it at
    // all — 10 writers, census in reviews/m59-873-one-line-base.md) and the web
    // family's `decoratorLine`/`decoratorLines`. R6 requires every one of them to
    // be provably 1-based, so the base is a property of this field's line keys,
    // not a suggestion. The field itself being `alive` never implied this: the
    // defect existed on rows that were alive at every seam stage.
    lineBase: "1-based (R6) — `metadata.line`, `decoratorLine`/`decoratorLines`; only typescript and cpp write a `line` mirror, and null is the ruled absence state",
  },

  // ---- UniversalRelationship (11) ----
  source: {
    iface: "UniversalRelationship",
    emit: /\bsource\s*:/,
    store: { needle: /rel\.source \|\| rel\.sourceId \|\| rel\.fromSymbol \|\| rel\.from/, via: `${INDEXER}:2429 -> source_symbol_id/source_external` },
    query: { needle: /source_symbol_id/, via: "graph-engine.ts:150+ JOINs" },
  },
  target: {
    iface: "UniversalRelationship",
    emit: /\btarget\s*:/,
    store: { needle: /rel\.target/, via: `${INDEXER}:2430s (targetName -> target_symbol_id/target_external)` },
    query: { needle: /target_symbol_id/, via: "graph-engine.ts:150+ JOINs" },
  },
  from: {
    iface: "UniversalRelationship",
    emit: /\bfrom\s*:/,
    store: { needle: /rel\.fromSymbol \|\| rel\.from/, via: `${INDEXER}:2061,2429 — READ as an input alias, never persisted under its own name` },
    query: { needle: /edge\.from|from: symbolId|from: node\.id/, via: "graph-engine.ts:171,258 (edge objects built from symbol ids)" },
    ruling: "M60 plan §3 PoC: alias read by consumers, never produced. The graph layer rebuilds from/to from stored ids — the persisted shape is source/target. Ruled-dead.",
  },
  to: {
    iface: "UniversalRelationship",
    emit: /\bto\s*:/,
    store: { needle: /rel\.toSymbol \|\| rel\.to/, via: `${INDEXER}:2062 + pool-worker.ts:370 — READ as an input alias` },
    query: { needle: /to: node\.id|to: symbolId/, via: "graph-engine.ts:171,259" },
    ruling: "M60 plan §3 PoC: alias-read, never produced. Ruled-dead.",
  },
  fromSymbol: {
    iface: "UniversalRelationship",
    emit: /\bfromSymbol\s*:/,
    store: { needle: /rel\.fromSymbol/, via: `${INDEXER}:2061,2429 alias read` },
    query: { needle: /source_symbol_id/, via: "graph-engine.ts:150+" },
    ruling: "Alias-read, never produced; same contract as `from`. Ruled-dead.",
  },
  toSymbol: {
    iface: "UniversalRelationship",
    emit: /\btoSymbol\s*:/,
    store: { needle: /rel\.toSymbol/, via: `${INDEXER}:2062 + pool-worker.ts:370 alias read` },
    query: { needle: /target_symbol_id/, via: "graph-engine.ts:150+" },
    ruling: "Alias-read, never produced; same contract as `to`. Ruled-dead.",
  },
  type: {
    iface: "UniversalRelationship",
    emit: /\btype\s*:/,
    store: { needle: /rel\.type \|\| rel\.relationshipType/, via: `${INDEXER}:2431 -> relationship_type` },
    query: { needle: /relationship_type/, via: "graph-engine.ts:150,213" },
    tool: { needle: /relationship/ },
  },
  relationshipType: {
    iface: "UniversalRelationship",
    emit: /\brelationshipType\s*:/,
    store: { needle: /rel\.type \|\| rel\.relationshipType/, via: `${INDEXER}:2431 (alias accepted)` },
    query: { needle: /relationshipType/, via: "graph-engine.ts:258,266 (edge objects)" },
    tool: { needle: /relationship/ },
  },
  confidence: {
    iface: "UniversalRelationship",
    emit: /\bconfidence\s*:/,
    store: { needle: /rel\.confidence \|\| 1\.0/, via: `${INDEXER}:2567 -> confidence` },
    query: { needle: /confidence/, via: "graph-engine.ts:150 (5 query files verified)" },
    tool: { needle: /confidence/ },
  },
  line_number: {
    iface: "UniversalRelationship",
    emit: /\bline_number\s*:/,
    store: { needle: /typeof rel\.line_number === "number" && rel\.line_number > 0 \? rel\.line_number : null/, via: `${INDEXER}:2570-2573 -> line_number` },
    query: { needle: /r\.line_number AS lineNumber/, via: "graph-engine.ts:150,213" },
    tool: { needle: /callSite|line/ },
    // The ruling states the POLICY; the measured producer set is appended in
    // main(), where `emitByLang` exists (a template here would reference a local
    // that is not in scope, and did — caught by tsc). The previous text was a
    // transcription ("Producers: scala, xml (+1) ... The 18 other languages")
    // that had drifted from its own artifact to the point of contradicting it:
    // the measured emit set is nine languages, and all four JVM and all four web
    // languages are in it — the M59.A7 claim this matrix exists to corroborate.
    // A ruling that misstates its own data is worse than no ruling.
    ruling: "M59.O2 — call-site line or NULL, never a fabricated 0.",
    rulingNamesProducers: true,
    lineBase: "1-based (R6) — the call site, checkable against the source; NULL means the site is not attributable, never 0",
  },
  // relationship.metadata handled under symbol.metadata share (same seam).
}

// Fields declared on BOTH interfaces (metadata) share one spec.
function ifacesFor(field: string, symbolFields: string[], relFields: string[]): string {
  const both = symbolFields.includes(field) && relFields.includes(field)
  return both ? "UniversalSymbol+UniversalRelationship" : relFields.includes(field) ? "UniversalRelationship" : "UniversalSymbol"
}

function fail(msg: string): never {
  console.error(`FATAL: ${msg}`)
  process.exit(2)
}

function extractInterfaceFields(src: string, iface: string): string[] {
  const start = src.indexOf(`export interface ${iface} `)
  if (start === -1) fail(`interface ${iface} not found in src/ast/types.ts`)
  const bodyStart = src.indexOf("{", start)
  let depth = 1, i = bodyStart + 1
  while (depth > 0 && i < src.length) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") depth--
    i++
  }
  const body = src.slice(bodyStart + 1, i - 1)
  const fields: string[] = []
  for (const line of body.split("\n")) {
    const m = line.match(/^\s{2}(\w+)(\?)?:/)
    if (m) fields.push(m[1])
  }
  if (fields.length === 0) fail(`no fields parsed from ${iface}`)
  return fields
}

function onboardedLanguages(): string[] {
  if (!existsSync(FIXTURES)) fail("validation/m14/fixtures missing — cannot enumerate onboarded languages")
  return readdirSync(FIXTURES).sort()
}

function analyzerPathFor(lang: string): string {
  // objc's file keeps the hyphen the fixture dir drops.
  return `src/ast/real-${lang === "objc" ? "objective-c" : lang}-analyzer.ts`
}

function main() {
  const typesSrc = readFileSync(TYPES_TS, "utf8")
  const symbolFields = extractInterfaceFields(typesSrc, "UniversalSymbol")
  const relFields = extractInterfaceFields(typesSrc, "UniversalRelationship")
  const declared = [...new Set([...symbolFields, ...relFields])]
  const langs = onboardedLanguages()

  // Every declared field MUST have a spec — a missing spec is fatal, so the
  // matrix cannot silently shrink when the interfaces grow.
  for (const f of declared) {
    if (!SPECS[f]) fail(`field '${f}' has no seam spec — extend SPECS, never skip`)
  }
  // Every spec MUST still correspond to a declared field — rotting specs fail.
  for (const f of Object.keys(SPECS)) {
    if (!declared.includes(f)) fail(`spec '${f}' no longer matches any declared field — update the matrix`)
  }

  const storeSrc = SEAM_FILES.store.map((r) => readFileSync(path.join(ROOT, r), "utf8")).join("\n")
  const querySrc = SEAM_FILES.query.map((r) => readFileSync(path.join(ROOT, r), "utf8")).join("\n")
  const toolSrc = SEAM_FILES.tool.map((r) => readFileSync(path.join(ROOT, r), "utf8")).join("\n")

  // Needle sanity, two directions: a field whose binding is expected to exist
  // must still match; a field recorded as UNBOUND must still NOT match — the
  // moment it does match, someone bound it and the matrix must be re-verified
  // (that is a win, but silence would leave the old verdict in place).
  for (const [field, spec] of Object.entries(SPECS)) {
    const unbound = spec.store.via.includes("NO binding")
    const matched = spec.store.needle.test(storeSrc)
    if (unbound && matched) fail(`store binding for '${field}' now EXISTS but the matrix records it unbound — re-verify ${spec.store.via}`)
    if (!unbound && !matched) fail(`store needle for '${field}' no longer matches — re-verify ${spec.store.via}`)
    if (!spec.query.needle.test(querySrc)) fail(`query needle for '${field}' no longer matches — re-verify ${spec.query.via}`)
  }

  const relMetadataShared = SPECS["metadata"]

  const fieldRows: Array<Record<string, unknown>> = []
  const emitCells: Array<{ field: string; iface: string; lang: string; alive: boolean }> = []

  for (const field of declared) {
    const spec = SPECS[field]
    const emitRe = spec.emit
    const emitByLang: Record<string, boolean> = {}
    for (const lang of langs) {
      if (!emitRe) { emitByLang[lang] = false; continue }
      const analyzerPath = analyzerPathFor(lang)
      const p = path.join(ROOT, analyzerPath)
      emitByLang[lang] = emitRe.test(readFileSync(p, "utf8"))
    }
    for (const lang of langs) {
      emitCells.push({ field, iface: spec.iface, lang, alive: emitByLang[lang] })
    }
    const emitCount = Object.values(emitByLang).filter(Boolean).length
    const storeOk = !spec.drops && spec.store.needle.test(storeSrc) && !spec.store.via.includes("NO binding")
    const queryOk = spec.query.needle.test(querySrc)
    const toolOk = spec.tool ? spec.tool.needle.test(toolSrc) : false

    let verdict: string
    if (emitCount === 0) {
      verdict = spec.ruling ? "ruled-dead (no producer; ruling recorded)" : "BLOCKED (producer-missing; no ruling)"
    } else if (!storeOk) {
      verdict = spec.ruling ? "ruled-dead (no store channel; ruling recorded)" : "BLOCKED (store drops it; no ruling)"
    } else if (!queryOk) {
      verdict = spec.ruling ? "ruled-dead (query never reads it; ruling recorded)" : "BLOCKED (query never reads it; no ruling)"
    } else if (emitCount < langs.length) {
      verdict = `alive (partial: ${emitCount}/${langs.length} languages emit)`
    } else {
      verdict = toolOk ? "alive" : "alive (query-reachable; MCP surface does not name it)"
    }

    fieldRows.push({
      field,
      iface: ifacesFor(field, symbolFields, relFields),
      storeBinding: spec.store.via,
      queryReader: spec.query.via,
      emitByLangCount: emitCount,
      emitByLang,
      storeOk,
      queryOk,
      toolOk,
      verdict,
      lineBase: spec.lineBase ?? null,
      ruling: spec.ruling
        ? (spec as any).rulingNamesProducers
          ? `${spec.ruling} Producers (${emitCount} of ${langs.length}): ${Object.entries(emitByLang).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)"}. The remaining ${langs.length - emitCount} carry NULL by ruling, which is the ruled ALIVE shape.`
          : spec.ruling
        : null,
      note: spec.note ?? null,
    })
  }

  // Undeclared store bindings: the persister reads fields the interfaces do
  // not declare (reachable only via the index signature). Verified live.
  const undeclared: Array<{ binding: string; note: string }> = []
  for (const [binding, note] of [
    ["symbol.docstring", "bound at " + INDEXER + ":2220 (M35 pre-work) — docstring is NOT on UniversalSymbol; only java/python/r emit it"],
    ["symbol.complexity", "bound at " + INDEXER + ":2195 (complexity column) — complexity is on FileMetadata, NOT on UniversalSymbol"],
    [
      "symbol.isDeclaration",
      "#612: bound at " + INDEXER + " (is_declaration column) — isDeclaration is a WORKER-PAYLOAD field, narrowed from `metadata.isDeclaration` at the pool-worker seam and therefore NOT on UniversalSymbol either (see the `metadata` spec's store.via). Producers: c (since the HC1 review) + cpp/rust/zig (#612). Reader: the store-phase resolver (resolveTargetStmt), which orders definitions ahead of declarations.",
    ],
  ] as const) {
    if (storeSrc.includes(binding) && !declared.includes(binding.replace("symbol.", ""))) {
      undeclared.push({ binding, note })
    }
  }

  const aliveFields = fieldRows.filter((r) => String(r.verdict).startsWith("alive"))
  const ruledDead = fieldRows.filter((r) => String(r.verdict).startsWith("ruled-dead"))
  const blocked = fieldRows.filter((r) => String(r.verdict).startsWith("BLOCKED"))
  const partialFields = fieldRows.filter((r) => String(r.verdict).startsWith("alive (partial"))

  // EVIDENCE FRAME (added 2026-09-21 after a measured defect): this artifact's
  // `emit` column is read straight out of the working tree's analyzer sources, so
  // a run in a tree holding UNCOMMITTED analyzer work records a claim about code
  // that does not exist in the repository. That is not hypothetical — the
  // 2026-09-19 artifact recorded `line_number` alive for erlang, and no commit
  // ever contained that emission (`git log -S line_number --
  // src/ast/real-erlang-analyzer.ts` is empty), so erlang's row replaced a real
  // emission with a phantom one and the language-completion matrix read it as a
  // pass. The frame below makes that state impossible to hide: the commit the
  // numbers describe, and whether the measured sources were clean at the moment
  // of measurement.
  const gitOut = (args: string[]): string => {
    try {
      return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim()
    } catch {
      return ""
    }
  }
  const commit = gitOut(["rev-parse", "HEAD"]) || null
  const measuredSources = ["src/ast/types.ts", "src/ast/indexer.ts", ...langs.map((l) => analyzerPathFor(l))]
  const dirtySources = gitOut(["status", "--porcelain", "--", ...measuredSources])
    .split("\n")
    .filter(Boolean)

  const result = {
    gate: "M60.P1",
    title: `Payload-seam matrix — ${symbolFields.length + relFields.length} declared fields × ${langs.length} onboarded languages × 4 seam stages`,
    at: new Date().toISOString(),
    commit,
    measuredSources: {
      clean: dirtySources.length === 0,
      dirty: dirtySources,
      rule: "emit is measured by reading the working tree, so a dirty measured source means this artifact describes a state that is not in any commit; a frame whose sources were dirty is a probe, not milestone evidence",
    },
    method: "fields parsed from src/ast/types.ts; every needle verified against the live tree (fatal on mismatch, so the matrix cannot rot silently); emit measured per-language against src/ast/real-<lang>-analyzer.ts; store against parallel-indexer/schema-ddl; query against brain.sql/graph-engine/doc-engine/taint; tool against the MCP surface.",
    surface: {
      declaredFieldCount: symbolFields.length + relFields.length,
      uniqueFields: declared.length,
      symbolFields: symbolFields.length,
      relationshipFields: relFields.length,
      languages: langs,
      emitCellCount: (symbolFields.length + relFields.length) * langs.length,
    },
    undeclaredStoreBindings: undeclared,
    totals: {
      fields: fieldRows.length,
      alive: aliveFields.map((r) => r.field),
      alivePartial: partialFields.map((r) => `${r.field} (${(r as any).emitByLangCount}/${langs.length})`),
      ruledDead: ruledDead.map((r) => r.field),
      blocked: blocked.map((r) => r.field),
      emitCellsAlive: emitCells.filter((c) => c.alive).length,
      emitCellsDead: emitCells.filter((c) => !c.alive).length,
    },
    fields: fieldRows,
    emitCells,
    foldNote: "Fold into M49 at X1: the jvm/web closure claims are true only with this matrix green; today's non-alive fields are recorded here as the remainder, not re-derived per milestone.",
  }

  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")
  console.log(`P1: ${symbolFields.length + relFields.length} declared fields (${declared.length} unique) × ${langs.length} languages = ${emitCells.length} emit cells (${result.totals.emitCellsAlive} alive)`)
  console.log(`  alive:  ${result.totals.alive.join(", ") || "(none)"}`)
  console.log(`  partial: ${result.totals.alivePartial.join(", ") || "(none)"}`)
  console.log(`  ruled-dead: ${result.totals.ruledDead.join(", ") || "(none)"}`)
  console.log(`  BLOCKED: ${result.totals.blocked.join(", ") || "(none)"}${result.totals.blocked.length ? " — R2 forbids family closure while any cell is BLOCKED" : ""}`)
  for (const u of undeclared) console.log(`  UNDECLARED store binding: ${u.binding}`)
  console.log(`  → ${path.relative(ROOT, OUT)}`)
}

// Entry guarded (C923 sweep): an unguarded call makes every future IMPORT of this instrument
// run a full matrix and rewrite its committed artifact from whatever tree is checked out —
// measured live on the sibling target-spelling-census.ts. `import.meta.main` is this repo's
// entry-point idiom (script/m13/verify-evidence.ts, src/cli/index.ts).
if (import.meta.main) main()
