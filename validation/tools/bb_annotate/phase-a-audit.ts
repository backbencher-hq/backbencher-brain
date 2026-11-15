// Phase A audit evidence for bb_annotate: runs the gate battery from the working
// tree, records each command with its exit code and output tail, folds in the
// real-MCP-door probes and the latency legs, and emits AUDIT.json.
//
// A gate that is blocked by the environment is recorded as `blocked` with the
// exact failing command — never as green.
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const LANE = path.resolve(import.meta.dirname)
const WRITE_ONLY = process.argv.includes("--write")

function run(command: string, args: string[], timeoutMs = 300_000): { exitCode: number; output: string; ms: number } {
  const started = performance.now()
  try {
    const output = execFileSync(command, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] })
    return { exitCode: 0, output: output.slice(-2000), ms: Math.round(performance.now() - started) }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string; message?: string }
    return {
      exitCode: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`.slice(-2000) || String(e.message ?? ""),
      ms: Math.round(performance.now() - started),
    }
  }
}

const gates: Array<{ id: string; claim: string; command: string[]; expectExit: number }> = [
  { id: "typecheck", claim: "the whole tree compiles", command: ["npx", "tsc", "--noEmit"], expectExit: 0 },
  { id: "m28-A1", claim: "annotation store: provenance, upsert, declared limits/absence, persistence", command: ["npx", "tsx", "script/m28/verify-annotation-store.ts"], expectExit: 0 },
  { id: "m28-A2", claim: "annotation UI: hover section + graph badge, author-labeled; in-editor leg", command: ["npx", "tsx", "script/m28/verify-annotation-ui.ts"], expectExit: 0 },
  { id: "m28-T1", claim: "MCP tools register/serve with the IDE components", command: ["npx", "tsx", "script/m28/verify-mcp-tools.ts"], expectExit: 0 },
  { id: "m28-U1", claim: "one fixture, two doors (union)", command: ["npx", "tsx", "script/m28/verify-union.ts"], expectExit: 0 },
  { id: "m28-V1", claim: "tool surface parity (generated MCP-SURFACE.md)", command: ["npx", "tsx", "script/m28/verify-mcp-surface.ts"], expectExit: 0 },
  { id: "m28-U2", claim: "surface parity under divergence/mutant battery", command: ["npx", "tsx", "script/m28/verify-surface-parity.ts"], expectExit: 0 },
  { id: "regex-policy", claim: "regex policy: no new uses; allowlist rows carry tests", command: ["npx", "tsx", "script/tools/verify-regex-policy.ts"], expectExit: 0 },
  { id: "docs-bb_annotate", claim: "generated bb_annotate page matches registry + curation", command: ["npx", "tsx", "script/verify-tool-docs.ts", "--only", "bb_annotate"], expectExit: 0 },
]

const gateResults: any[] = []
const blockedLegs: any[] = []
if (WRITE_ONLY === false || true) {
  for (const gate of gates) {
    const r = run(gate.command[0], gate.command.slice(1))
    const passed = r.exitCode === gate.expectExit
    // A2's in-editor leg: the gate itself is expected to be red here because the
    // editor binary is absent; it is recorded as blocked with its exact output.
    const blocked = !passed && gate.id === "m28-A2" && r.output.includes("nvim provisioned")
    gateResults.push({
      id: gate.id,
      claim: gate.claim,
      command: gate.command.join(" "),
      exitCode: r.exitCode,
      expectedExitCode: gate.expectExit,
      status: passed ? "pass" : blocked ? "blocked" : "fail",
      ms: r.ms,
      outputTail: r.output.trim().split("\n").slice(-6).join("\n"),
    })
    if (blocked) {
      blockedLegs.push({
        leg: "m28-A2 in-editor",
        reason: "headless Neovim is absent from this environment (.tools/nvim-linux-x86_64/bin/nvim); the A2 suite is designed to declare that leg red rather than skip it",
        command: gate.command.join(" "),
        output: r.output.trim().split("\n").slice(-3).join("\n"),
      })
    }
  }
}

// ── real-MCP-door probes (structure recorded by phase-a-probes.ts) ───────────
let probes: any = null
const probesPath = path.join(LANE, "PHASE-A-PROBES.json")
if (existsSync(probesPath)) probes = JSON.parse(readFileSync(probesPath, "utf8"))

const claims = probes?.phases?.editorTruth?.claimTruth ?? []
const mismatches = claims.filter((c: any) => c.agrees === false)
const writes = probes?.phases?.writes ?? []
const refusals = probes?.phases?.refusals ?? []
const reads = probes?.phases?.reads ?? []
const truth = probes?.phases?.editorTruth ?? {}

const doorEvidence = {
  doorMode: probes?.doorMode,
  tree: probes?.fixture?.tree,
  root: probes?.fixture?.root,
  toolsListed: probes?.phases?.door?.[0]?.ok ?? null,
  wireDescriptor: probes?.phases?.wireDescriptor ?? null,
  writes: writes.map((w: any) => ({ request: w.request, isError: w.isError, ms: w.ms })),
  refusals: refusals.map((r: any) => ({ label: r.label, isError: r.isError, text: r.text.split("\n")[0].slice(0, 220) })),
  reads: reads.map((r: any) => ({ request: r.request, isError: r.isError, declaredAbsent: r.parsed?.declaredAbsent ?? null, count: r.parsed?.count ?? null })),
  claimVsRender: claims,
  claimVsRenderMismatches: mismatches,
  hostileBodyForge: truth.hostileBodyForge ?? null,
  controlCharRender: truth.controlCharRender ?? null,
  readDoor: truth.readDoor ?? null,
  provenance: {
    rowAuthorClass: truth.provenance?.rowAuthorClass,
    rowToolIdentity: truth.provenance?.rowToolIdentity,
    replacedReported: truth.provenance?.replacedReported !== undefined,
    timeCreatedStable: truth.provenance?.timeCreatedStable,
    responseProvenance: truth.provenance?.responseProvenance,
  },
  unindexedProject: probes?.phases?.unindexedProject
    ? { isError: probes.phases.unindexedProject.isError, dbCreated: probes.phases.unindexedProject.dbCreated, ms: probes.phases.unindexedProject.ms, editor: probes.phases.unindexedProject.parsed?.surfacing?.editor ?? null }
    : null,
  boundary: probes?.boundary ?? null,
  rowCounts: truth.rowCounts ? { greetMainRows: truth.rowCounts.greetMainRows, mainRows: truth.rowCounts.mainRows } : null,
}

// ── latency + real corpus (recorded by latency.ts) ──────────────────────────
function readJson(name: string): any {
  const p = path.join(LANE, name)
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null
}
const latency = readJson("LATENCY.json")
const realCorpus = readJson("REAL-CORPUS.json")
const latencySummary = latency
  ? {
      protocol: latency.protocol,
      environment: latency.environment,
      tree: latency.tree,
      legs: Object.fromEntries(
        Object.entries(latency.legs ?? {}).map(([k, v]: any) => [k, {
          subject: v.subject,
          index: v.index && { files: v.index.files, symbols: v.index.symbols, relationships: v.index.relationships },
          warm: v.warm && { p50: v.warm.p50, p95: v.warm.p95, runs: v.warm.runs },
          coldMs: v.coldMs,
          readBackCount: v.readBackCount,
          qualifiedName: v.qualifiedName ? { p50: v.qualifiedName.warm?.p50, p95: v.qualifiedName.warm?.p95 } : null,
          sharedIndexUntouched: v.sharedIndexUntouched ?? null,
        }]),
      ),
      gateSummary: latency.gateSummary,
    }
  : null

// ── docs truth, regex, §9: measured against the files the tool owns ──────────
const campaignFiles = [
  "src/mcp/tools/bb_annotate/handler.ts",
  "src/mcp/tools/bb_annotate/descriptor.ts",
  "script/tool-docs/curation/bb_annotate.ts",
  "docs/tools/bb_annotate.md",
  "script/m28/verify-annotation-store.ts",
  "script/m28/verify-annotation-ui.ts",
]
const BANNED = [
  "M28.A1", "M28.A2", "M28.T1", "M48.P1", "M55.T5", "issue #626", "issue #627", "issue #624", "issue #696",
  "the Lead", "this lane", "the lane", "teammate", "the fleet", "owner-approved", "owner-decided",
  "MEASURED 2026", "defect fixed", "standing rule", "Generated with", "Co-Authored-By",
]
const section9: any[] = []
for (const file of campaignFiles) {
  const p = path.join(ROOT, file)
  if (!existsSync(p)) continue
  const lines = readFileSync(p, "utf8").split("\n")
  const hits: Array<{ line: number; term: string; text: string }> = []
  for (let i = 0; i < lines.length; i++) {
    for (const term of BANNED) {
      if (lines[i].includes(term)) hits.push({ line: i + 1, term, text: lines[i].trim().slice(0, 160) })
    }
  }
  section9.push({ file, hits })
}

const regexUses = (() => {
  const p = path.join(ROOT, "validation/tools/regex-baseline.json")
  if (!existsSync(p)) return null
  const baseline = JSON.parse(readFileSync(p, "utf8"))
  const rows = (baseline.entries ?? []).filter((e: any) => String(e.file).includes("bb_annotate"))
  const allowlistPath = path.join(ROOT, "validation/tools/regex-allowlist.json")
  const allowlist = existsSync(allowlistPath) ? readFileSync(allowlistPath, "utf8") : ""
  return {
    baselineRowsForTool: rows,
    allowlistedForTool: rows.filter((r: any) => allowlist.includes(r.file)),
    note: "the handler's control-character test is frozen baseline debt with no allowlist row; Phase B replaces it with a character-code scan",
  }
})()

const docsClaims = [
  {
    claim: "declared body limit is 2000 characters, counted in code points",
    verdict: "matches measured behaviour",
    evidence: "PHASE-A-PROBES boundary: 2000 chars accepted, 2001 refused; 2000 astral glyphs accepted, 2001 refused",
  },
  {
    claim: "toolIdentity declared limit is 200 characters; control characters/line breaks refused",
    verdict: "matches measured behaviour",
    evidence: "PHASE-A-PROBES boundary + refusals: toolIdentity 201 refused; newline and NUL refused through the real door",
  },
  {
    claim: "one note per author per (project, symbol, path), re-annotation updates in place and reports the replaced note",
    verdict: "matches measured behaviour",
    evidence: "PHASE-A-PROBES: same id, time_created stable, `replaced` carries the previous body; row count 1",
  },
  {
    claim: "`surfacing.editor` is the AND of nameMatched and pathMatched, so it reports whether an editor surface can show the note",
    verdict: "FALSE for one class of real input — see defect PA-2",
    evidence: "PHASE-A-PROBES claimTruth MISMATCH: greet/other.ts claimed editor:true, rendered false in the real hover",
  },
  {
    claim: "limitations list contains 'Annotation store semantics are owned by the M28 workstream'",
    verdict: "milestone narration with no measurable content; removed in Phase B",
    evidence: "docs/tools/bb_annotate.md:72 and curation source line",
  },
  {
    claim: "Performance: 'Constant-time store write'",
    verdict: "not measured; the write performs three indexed lookups plus a first-call read-write open, and the measured figures are in LATENCY.json",
    evidence: "LATENCY.json (T0/T1/REAL/T2)",
  },
  {
    claim: "requiresIndex:false — the tool works with no index",
    verdict: "matches measured behaviour, but the page does not say the first write creates the project annotation store",
    evidence: "PHASE-A-PROBES unindexedProject: stored:true, dbCreated:true, surfacing.editor:false",
  },
]

const audit: any = {
  schemaVersion: 1,
  tool: "bb_annotate",
  phase: "A (audit)",
  status: "partial",
  currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
  generatedAt: new Date().toISOString(),
  runtime: process.version,
  tree: probes?.fixture?.tree ?? (process.env.BB_HARNESS_ROOT ? "head-snapshot" : "working-tree"),
  verifierCommand: "npx tsx validation/tools/bb_annotate/phase-a-audit.ts",
  gateResults,
  passed: gateResults.filter((g) => g.status === "pass").length,
  failed: gateResults.filter((g) => g.status === "fail").length,
  blocked: gateResults.filter((g) => g.status === "blocked").length,
  negativeCases: [
    { name: "blocked A2 in-editor leg is red, not skipped", observed: blockedLegs.length > 0 ? "m28-A2 exit 1 with 'nvim provisioned' failure" : "not observed" },
    { name: "claims-vs-render mismatch found by the door harness", observed: mismatches.length > 0 ? `${mismatches.length} mismatch(es) recorded in PHASE-A-PROBES.json` : "none" },
  ],
  doorEvidence,
  latency: latencySummary,
  realCorpus,
  docsTruth: { claims: docsClaims },
  regex: regexUses,
  section9: { note: "campaign files scanned for the §9 banned vocabulary; hits are listed verbatim", files: section9 },
  blockedLegs,
  defects: [
    {
      id: "PA-1",
      severity: "high",
      title: "`surfacing.editor` can be true when the name and the path match DIFFERENT files, and the reply then promises a render that never happens",
      detail:
        "annotationReachability() measures name reachability (name/qualified_name anywhere in the project) and canonicalFilePath() measures path reachability (any indexed file). The handler ANDs the two booleans. A note on `greet` with path `other.ts` — where `other.ts` is indexed but does not declare `greet` — is reported editor:true with the statement \"renders in the editor hover section and graph badge\", while hover(main.ts:greet) and the bb/graph root both show nothing. Measured through the real MCP door.",
      evidence: "validation/tools/bb_annotate/PHASE-A-PROBES.json phases.editorTruth.claimTruth (mismatch row) + crossFilePathStatement",
      fix: "handler measures the JOINT predicate: when a path is given and resolves, at least one symbol carrying the name/qualified name must be declared in THAT file, or editor:false with a statement naming the file",
      status: "open (Phase B)",
    },
    {
      id: "PA-2",
      severity: "medium",
      title: "the tool's own gate suite never exercises the real MCP door",
      detail:
        "verify-annotation-store.ts calls createToolHandlers() directly, bypassing validateToolArguments, the per-mode index gate, and the wire error envelope. The real door answers differently for some inputs: a missing symbol is 'error: bb_annotate: missing required option: symbol', and an author_class/authorClass spoof is REFUSED as an unknown option, whereas the gate's direct call asserts a successful write with provenance 'agent'. The provenance conclusion is right; the wire contract it claims is not what the gate measured.",
      evidence: "PHASE-A-PROBES.json phases.refusals (labels 'missing symbol', 'author_class spoof') vs script/m28/verify-annotation-store.ts R2",
      fix: "Phase B adds a real `bb mcp` stdio session leg to A1 (success + refusals captured from the wire)",
      status: "open (Phase B)",
    },
    {
      id: "PA-3",
      severity: "medium",
      title: "A1's 'mutation suite' mutants are mostly not planted defects",
      detail:
        "M2/M3 are positive checks over strings (a manual SQL corruption and a literal slice); they re-assert the round trip rather than planting a defect in the tool and requiring the suite to notice. Only M1 mutates storage (a NULL author_class insert), which proves the schema trigger, not the handler. A handler regression that derived author_class from arguments, ignored the path in the location key, or always claimed reachability would not be caught by M2–M4.",
      evidence: "script/m28/verify-annotation-store.ts lines 144-202; mutant labels vs their bodies",
      fix: "Phase B plants real handler mutants beside the module (same mechanism as verify-mcp-tools.ts) and requires the suite to go red",
      status: "open (Phase B)",
    },
    {
      id: "PA-4",
      severity: "medium",
      title: "docs claims that are not true today (reachability AND-claim, 'constant-time', milestone narration, missing guide page)",
      detail:
        "docs/tools/bb_annotate.md and the curation source say editor is the AND of nameMatched/pathMatched (falsified by PA-1), call the write 'constant-time' (unmeasured), carry the limitation 'Annotation store semantics are owned by the M28 workstream' (§9 milestone narration, no measurable content), and do not state that the first write on an unindexed project creates that project's annotation store. The handler and curation headers point at a docs/BB_*.md guide page for annotations that does not exist.",
      evidence: "docs/tools/bb_annotate.md:54,72,82; curation lines; list of docs/BB_*.md contains no annotation guide",
      fix: "Phase B rewrites the curation text from measurements (LATENCY.json), adds the joint-reachability and unindexed-store statements, removes the milestone line, and fixes the headers (a guide page is outside this lane's write scope — requested from the Lead)",
      status: "open (Phase B)",
    },
    {
      id: "PA-5",
      severity: "low",
      title: "handler regex is frozen debt with no allowlist entry",
      detail: "The control-character check uses /[\\u0000-\\u001F\\u007F]/; a character-code scan is a direct non-regex formulation, so the use fails charter §7's 'genuinely unavoidable' test.",
      evidence: "validation/tools/regex-baseline.json (entry for src/mcp/tools/bb_annotate/handler.ts); regex policy PASS 14 allowlisted / 73 frozen / 0 new",
      fix: "Phase B replaces it with a code-point scan (regex debt decreases, no allowlist row added)",
      status: "open (Phase B)",
    },
    {
      id: "PA-6",
      severity: "low",
      title: "input bounds are declared for body and toolIdentity but not for symbol and path",
      detail: "symbol and path are stored row content with no declared limit and no refusal; body (2000) and toolIdentity (200) are bounded.",
      evidence: "handler parameter handling; descriptor inputSchema has no maximum for symbol/path",
      fix: "Phase B declares and enforces bounds, adds them to the schema/doc, and gates the boundary",
      status: "open (Phase B)",
    },
    {
      id: "PA-7",
      severity: "low",
      title: "§9 narration present in the tool's own files (milestones, issue numbers)",
      detail: "handler comments (M28.T1/#624, M48.P1/#696, M55.T5, M28.A1/#626), descriptor comment (M28.A1/#626), gate headers (M28.A1/#626, M28.A2/#627). Machine evidence fields such as `issue` are data, but the prose narrates the campaign.",
      evidence: "AUDIT section9 hits",
      fix: "Phase B removes narrative comments; machine evidence fields stay",
      status: "open (Phase B)",
    },
    {
      id: "PA-8",
      severity: "info",
      title: "source-door assembly was transiently broken by another lane (recorded, not a bb_annotate defect)",
      detail: "At audit start the working tree's src/mcp/tools/bb_visualize/handler.ts imported FRESHNESS_REMEDIATION_MANUAL_ONLY from ../shared, which does not export it, so EVERY `bb mcp` process died before serving tools. The door probes therefore ran against a `git archive HEAD` snapshot (recorded as tree: head-snapshot). The other lane fixed the import later in the audit.",
      evidence: "PHASE-A-PROBES.json doorMode + fixture.tree; server stderr captured earlier",
      fix: "no action for this lane; re-run the door probes against the working tree after the fix (done in the Phase B evidence)",
      status: "closed",
    },
    {
      id: "PA-9",
      severity: "info",
      title: "MCP-SURFACE.md annotation paragraph inherits A2's blocked leg and contains a doubled word from its generator",
      detail: "docs/m28/MCP-SURFACE.md is generated by script/m28/verify-mcp-surface.ts: the annotations paragraph prints A2's status (known-gap while the editor binary is absent) and the line 'The three new read tools reuse their IDE-side components (D-1) — verified verified via T1.json' duplicates `verified` whenever T1 is verified. Both are in Lead-owned files.",
      evidence: "docs/m28/MCP-SURFACE.md:35,37; script/m28/verify-mcp-surface.ts:119",
      fix: "requested from the Lead (generator text + regenerated doc)",
      status: "requested",
    },
    {
      id: "PA-10",
      severity: "info",
      title: "the tool store files and the editor renderer are Lead-owned and carry the same §9 narration",
      detail: "src/brain/annotation-store.ts and src/lsp/annotation_ui.ts start with M28.A1/A2 headers; src/lsp/hover.ts and src/lsp/graph_request.ts carry M28.A2 narration in the annotation reader paths. They are shared code (annotations pair) and outside this lane's write scope.",
      evidence: "file headers; AUDIT section9 covers only the files this lane owns",
      fix: "requested from the Lead",
      status: "requested",
    },
  ],
}

if (WRITE_ONLY) writeFileSync(path.join(LANE, "AUDIT.json"), JSON.stringify(audit, null, 2))
else writeFileSync(path.join(LANE, "AUDIT.json"), JSON.stringify(audit, null, 2))

console.log(JSON.stringify({
  status: audit.status,
  gates: gateResults.map((g) => `${g.status.toUpperCase()} ${g.id} (exit ${g.exitCode})`),
  door: { mode: doorEvidence.doorMode, writes: writes.length, refusals: refusals.length, mismatches: mismatches.length },
  latency: latencySummary ? Object.fromEntries(Object.entries(latencySummary.legs).map(([k, v]: any) => [k, { p50: v.warm?.p50, p95: v.warm?.p95, files: v.index?.files }])) : null,
  realCorpus: realCorpus ? realCorpus.corpora.map((c: any) => ({ corpus: c.corpus, files: c.index?.files, p50: c.warm?.p50, p95: c.warm?.p95, readBack: c.readBack?.count })) : null,
  defects: audit.defects.length,
  blocked: blockedLegs.map((b) => b.leg),
}, null, 2))
