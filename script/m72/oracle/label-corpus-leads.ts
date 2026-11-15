// ─────────────────────────────────────────────────────────────────────────────
// M72 Phase 2b, step 1 — adjudicate the recorded real-corpus bb_security leads.
//
// WHAT THIS FILE IS — the oracle labeller for the Phase-2a real corpus. It does
//   three things and nothing else:
//     1. reads EVERY `brain_security_flow` row back out of the per-corpus SQLite
//        databases recorded in validation/tools/bb_security/REAL-CORPUS.json
//        (read-only opens; the labeller never writes to a corpus DB), resolving
//        `file_id -> brain_file.relative_path` and decoding the `evidence` JSON
//        for the matched source/sink text and byte offsets;
//     2. fails loudly — a declared error, never a silent skip — when a corpus DB
//        is missing or unreadable, when the flow table is absent, or when the
//        total number of leads is not the recorded Phase-2a count (9);
//     3. attaches an ANALYST ADJUDICATION to each lead (`vulnerable` | `safe` |
//        `unreachable` | `unknown`) with a one-line reason and the quoted code,
//        and writes validation/m72/oracle/labels.json with exactly one entry per
//        DB row (asserted both ways).
//
// WHAT THIS FILE IS NOT — it does not compute a precision rate. Precision needs a
//   labelled SAFE-code denominator (how many leads a clean corpus produced, and
//   how many non-leads were correct); Phase 2b has none, so a "correctness count"
//   over 9 adjudicated leads is the only honest number this step can emit. It also
//   does not re-run the engine, does not write to any corpus DB, and does not add a
//   gate script (script/m72 gate files belong to gates-matrix).
//
// THE ADJUDICATION IS A HUMAN-READ JUDGEMENT, NOT A TOOL OUTPUT — the labels live
//   in the `ADJUDICATIONS` table below, keyed by the STABLE row id, so a label can
//   never drift onto a different lead: an id that stops matching a DB row is a
//   hard error, and a DB row with no adjudication is a hard error.
//
// WHERE ITS EVIDENCE LIVES — validation/m72/oracle/labels.json (this script's own
//   output), validation/tools/bb_security/REAL-CORPUS.json (the recorded counts and
//   per-corpus dbPath/path), docs/m72-security-rebuild/PHASE-2B.md (the write-up).
// EDIT TOGETHER WHEN THIS CHANGES — docs/m72-security-rebuild/PHASE-2B.md,
//   src/intelligence/security/rebuild/{engine,store}.ts (row/evidence shape).
// CONTRACTS IT MUST NOT BREAK — every lead is read from the DB, never hard-coded;
//   the count must equal EXPECTED_LEAD_COUNT or the script exits non-zero; the
//   labels.json entries correspond 1:1 to the DB rows; no precision percentage is
//   ever printed.
//
// COMMAND: npx tsx script/m72/oracle/label-corpus-leads.ts
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const CORPUS_JSON = join(REPO_ROOT, "validation/tools/bb_security/REAL-CORPUS.json")
const OUT_LABELS = join(REPO_ROOT, "validation/m72/oracle/labels.json")

/** The Phase-2a recorded lead total. A different count is a declared failure. */
const EXPECTED_LEAD_COUNT = 9

/** The four adjudication classes. Exactly one per lead. */
export type Verdict = "vulnerable" | "safe" | "unreachable" | "unknown"

/** One adjudication, keyed by the stable `brain_security_flow.id`. */
interface Adjudication {
  label: Verdict
  /** One line. Says what the code does, not what the tool guessed. */
  reason: string
  /** Source line(s) quoted from the corpus checkout, verbatim. */
  quotedSource: string
  /** Sink line(s) quoted from the corpus checkout, verbatim. */
  quotedSink: string
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ADJUDICATIONS — one entry per DB row, keyed by the row's stable id.
//
// Each was decided by reading the surrounding function in the corpus checkout
// (REAL-CORPUS.json `corpora[].path`) rather than from the lead's own text. The
// `unknown` entries say exactly which question the source alone cannot answer.
// ─────────────────────────────────────────────────────────────────────────────
const ADJUDICATIONS: Record<string, Adjudication> = {
  // ── ansible ────────────────────────────────────────────────────────────────
  "sec:418eaa3dcfd89d995461fa793ab956788b166705:418eaa3dcfd89d995461fa793ab956788b166705:module_utils/csharp/Ansible.Basic.cs:csharp.sink.file-path:143:160": {
    label: "unknown",
    reason:
      "GetParams does read a caller-supplied path with no validation, but whether args[0] is attacker-influenced cannot be decided from the source alone: the value comes from the PowerShell module invocation, and the controller-side code that populates args[0] for a C# module util (exec_wrapper/module_wrapper + the args-file mechanism) is outside this checkout's indexed flow, so the provenance of the path is unproven.",
    quotedSource: "public static IDictionary GetParams(string[] args)\n{\n    if (args.Length > 0)\n    {\n        string inputJson = File.ReadAllText(args[0]);",
    quotedSink: "string inputJson = File.ReadAllText(args[0]);",
  },
  "sec:418eaa3dcfd89d995461fa793ab956788b166705:418eaa3dcfd89d995461fa793ab956788b166705:modules/async_wrapper.py:python.path.fs_mutation:4220:4234": {
    label: "unreachable",
    reason:
      "shutil.rmtree(os.path.dirname(wrapped_module)) is the wrapper's own temp-directory cleanup, and wrapped_module = sys.argv[4] is the controller-built remote module path (plugins/action/__init__.py builds async_cmd from the tmpdir it created); it is not playbook/user data, and the delete is the documented cleanup path, not an attacker-chosen target.",
    quotedSource:
      "wrapped_module = sys.argv[4]\n...\n                        if not preserve_tmp:\n                            shutil.rmtree(os.path.dirname(wrapped_module), True)",
    quotedSink: "shutil.rmtree(os.path.dirname(wrapped_module), True)",
  },
  "sec:418eaa3dcfd89d995461fa793ab956788b166705:418eaa3dcfd89d995461fa793ab956788b166705:modules/async_wrapper.py:python.path.fs_mutation:4442:4456": {
    label: "unreachable",
    reason:
      "The same wrapper temp-directory cleanup as the timeout branch, reached only when the child module finishes: the path is the controller-created tmpdir, not remote input, so there is no attacker-influenced path here.",
    quotedSource:
      "                notice(\"Done in kid B.\")\n                if not preserve_tmp:\n                    shutil.rmtree(os.path.dirname(wrapped_module), True)",
    quotedSink: "shutil.rmtree(os.path.dirname(wrapped_module), True)",
  },

  // ── sqlite ─────────────────────────────────────────────────────────────────
  "sec:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:test1.c:c.sink.path_open:803:809": {
    label: "unreachable",
    reason:
      "test_io_trace's argv comes from the in-process Tcl test driver (registered as \"sqlite3IoTrace\" in test1.c's command table and compiled only into testfixture), so the filename is supplied by the test script running the suite, not by external input; it is test-harness code, not shipped product code.",
    quotedSource:
      "static int SQLITE_TCLAPI test_io_trace(\n  void *NotUsed,\n  Tcl_Interp *interp,    /* The TCL interpreter that invoked this command */\n  int argc,              /* Number of arguments */\n  char **argv            /* Text of each argument */\n){",
    quotedSink: "iotrace_file = fopen(argv[1], \"w\");",
  },
  "sec:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:test1.c:c.sink.sql_exec:618:631": {
    label: "vulnerable",
    reason:
      "test_exec_printf takes argv[2] as a printf FORMAT string and hands it to sqlite3_mprintf together with argv[3], then passes the result straight to sqlite3_exec with no escaping — a format string supplied by the caller is both a format-string bug and SQL injection in that string.",
    quotedSource:
      "  if( getDbPointer(interp, argv[1], &db) ) return TCL_ERROR;\n  Tcl_DStringInit(&str);\n  zSql = sqlite3_mprintf(argv[2], argv[3]);",
    quotedSink: "rc = sqlite3_exec(db, zSql, exec_printf_cb, &str, &zErr);",
  },
  "sec:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:test1.c:c.sink.sql_exec:811:824": {
    label: "vulnerable",
    reason:
      "test_exec copies argv[2] into zSql with sqlite3_mprintf(\"%s\", argv[2]) and then executes it verbatim; the %XX hex-decoding loop rewrites bytes but never escapes or parameterizes, so the caller's string reaches sqlite3_exec as SQL.",
    quotedSource:
      "  zSql = sqlite3_mprintf(\"%s\", argv[2]);\n  for(i=j=0; zSql[i];){\n    if( zSql[i]=='%' ){\n      zSql[j++] = (testHexToInt(zSql[i+1])<<4) + testHexToInt(zSql[i+2]);\n      i += 3;\n    }else{\n      zSql[j++] = zSql[i++];\n    }\n  }\n  zSql[j] = 0;",
    quotedSink: "rc = sqlite3_exec(db, zSql, exec_printf_cb, &str, &zErr);",
  },
  "sec:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:test1.c:c.sink.sql_exec:485:498": {
    label: "vulnerable",
    reason:
      "test_exec_nr passes argv[2] to sqlite3_exec with no escape, no mprintf and no prepare/bind at all — the exact shape of a SQL-injection sink, reached whenever the Tcl test command is invoked.",
    quotedSource: "  if( getDbPointer(interp, argv[1], &db) ) return TCL_ERROR;\n  rc = sqlite3_exec(db, argv[2], 0, 0, &zErr);",
    quotedSink: "rc = sqlite3_exec(db, argv[2], 0, 0, &zErr);",
  },
  "sec:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:test1.c:c.sink.sql_exec:151:164": {
    label: "vulnerable",
    reason:
      "sqlite3ExecFunc is a SQL-function implementation: its argument is a database VALUE supplied by the SQL statement itself, and it feeds sqlite3_value_text(argv[0]) straight into sqlite3_exec, so SQL text can be executed from inside a query.",
    quotedSource:
      "static void sqlite3ExecFunc(\n  sqlite3_context *context, \n  int argc,  \n  sqlite3_value **argv\n){\n  struct dstr x;\n  memset(&x, 0, sizeof(x));\n  (void)sqlite3_exec((sqlite3*)sqlite3_user_data(context),\n      (char*)sqlite3_value_text(argv[0]),",
    quotedSink: "      (char*)sqlite3_value_text(argv[0]),",
  },
  "sec:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:7194d3412d9ea1564fffb3ac3b270fd53ecb075b:test8.c:c.sink.sql_exec:1012:1025": {
    label: "safe",
    reason:
      "echoCreate builds the logging-table DDL as sqlite3_mprintf(\"CREATE TABLE %Q(logmsg)\", pVtab->zLogName): %Q is mprintf's SQL-quote conversion, so the module argument argv[4] is escaped into a quoted literal/identifier before the statement is executed.",
    quotedSource:
      "    pVtab->zLogName = sqlite3_mprintf(\"%s\", argv[4]);\n    zSql = sqlite3_mprintf(\"CREATE TABLE %Q(logmsg)\", pVtab->zLogName);",
    quotedSink: "rc = sqlite3_exec(db, zSql, 0, 0, 0);",
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// DB reading — every lead comes from the corpus DB, never from this file.
// ─────────────────────────────────────────────────────────────────────────────
interface LeadRow {
  id: string
  corpus: string
  dbPath: string
  corpusPath: string
  file: string
  sourceLine: number | null
  sinkLine: number | null
  ruleId: string
  vulnerability: string
  severity: string
  state: string
  evidence: any
  /** Matched source token text, from the evidence JSON. */
  sourceText: string | null
  /** Matched sink token text, from the evidence JSON. */
  sinkText: string | null
  argumentText: string | null
}

interface CorpusSpec {
  name: string
  path: string
  dbPath: string
  recordedTotal: number
}

/** Read the corpus inventory: per-corpus checkout path, dbPath, recorded counts. */
function readCorpusSpecs(): CorpusSpec[] {
  if (!existsSync(CORPUS_JSON)) {
    throw new Error(`[oracle] corpus inventory not found: ${CORPUS_JSON}`)
  }
  const doc = JSON.parse(readFileSync(CORPUS_JSON, "utf8"))
  const corpora = doc?.corpora
  if (!Array.isArray(corpora) || corpora.length === 0) {
    throw new Error(`[oracle] ${CORPUS_JSON} has no corpora[] array`)
  }
  return corpora.map((c: any) => {
    const name = c?.name
    const path = c?.path
    const dbPath = c?.census?.dbPath
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`[oracle] a corpora[] entry has no name: ${JSON.stringify(c).slice(0, 200)}`)
    }
    if (typeof path !== "string" || !existsSync(path)) {
      throw new Error(`[oracle] ${name}: corpus checkout path missing or unreadable: ${String(path)}`)
    }
    if (typeof dbPath !== "string") {
      throw new Error(`[oracle] ${name}: corpora[].census.dbPath is absent`)
    }
    const recordedTotal = Number(c?.census?.counts?.securityFlows?.total)
    return {
      name,
      path,
      dbPath,
      recordedTotal: Number.isFinite(recordedTotal) ? recordedTotal : 0,
    }
  })
}

/** Every lead in one corpus DB, with its file path resolved and evidence decoded. */
function readLeads(spec: CorpusSpec): LeadRow[] {
  if (!existsSync(spec.dbPath)) {
    throw new Error(`[oracle] ${spec.name}: corpus DB not found: ${spec.dbPath}`)
  }
  let db: Database.Database
  try {
    // readonly: the labeller never mutates corpus evidence.
    db = new Database(spec.dbPath, { readonly: true, fileMustExist: true })
  } catch (err) {
    throw new Error(`[oracle] ${spec.name}: corpus DB unreadable at ${spec.dbPath}: ${(err as Error).message}`)
  }
  try {
    const hasFlow = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='brain_security_flow'")
      .get() as { ok: number } | undefined
    if (!hasFlow) {
      throw new Error(
        `[oracle] ${spec.name}: brain_security_flow table is absent from ${spec.dbPath} ` +
          `(Phase-1 store not initialized for this corpus)`,
      )
    }
    const hasFile = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='brain_file'")
      .get() as { ok: number } | undefined
    if (!hasFile) {
      throw new Error(`[oracle] ${spec.name}: brain_file table is absent from ${spec.dbPath}`)
    }

    const paths = new Map<string, string>()
    for (const r of db.prepare("SELECT id, relative_path FROM brain_file").all() as any[]) {
      paths.set(String(r.id), String(r.relative_path))
    }

    const rows = db
      .prepare(
        `SELECT id, file_id, vulnerability_type, severity, state, tier, rule_id,
                source_line, sink_line, evidence
           FROM brain_security_flow
          ORDER BY file_id, source_line, sink_line, id`,
      )
      .all() as any[]

    return rows.map((r) => {
      const file = paths.get(String(r.file_id))
      if (!file) {
        throw new Error(`[oracle] ${spec.name}: lead ${r.id} names an unknown file_id ${r.file_id}`)
      }
      let evidence: any
      try {
        evidence = JSON.parse(String(r.evidence))
      } catch (err) {
        throw new Error(`[oracle] ${spec.name}: lead ${r.id} has unparseable evidence: ${(err as Error).message}`)
      }
      return {
        id: String(r.id),
        corpus: spec.name,
        dbPath: spec.dbPath,
        corpusPath: spec.path,
        file,
        sourceLine: r.source_line === null ? null : Number(r.source_line),
        sinkLine: r.sink_line === null ? null : Number(r.sink_line),
        ruleId: String(r.rule_id),
        vulnerability: String(r.vulnerability_type),
        severity: String(r.severity),
        state: String(r.state),
        evidence,
        sourceText: evidence?.source?.text ?? null,
        sinkText: evidence?.sink?.text ?? null,
        argumentText: typeof evidence?.argumentText === "string" ? evidence.argumentText : null,
      }
    })
  } finally {
    db.close()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
function fail(message: string): never {
  console.error(`[oracle] ERROR: ${message}`)
  process.exit(1)
}

function main(): void {
  const specs = readCorpusSpecs()
  const leads: LeadRow[] = []
  for (const spec of specs) {
    const found = readLeads(spec)
    if (found.length !== spec.recordedTotal) {
      fail(
        `${spec.name}: DB holds ${found.length} leads but REAL-CORPUS.json recorded ${spec.recordedTotal} ` +
          `(${spec.dbPath}) — the evidence is stale or the corpus was re-indexed; re-run Phase 2a`,
      )
    }
    leads.push(...found)
  }

  if (leads.length !== EXPECTED_LEAD_COUNT) {
    fail(`read ${leads.length} leads from the corpus DBs, expected ${EXPECTED_LEAD_COUNT} (Phase-2a recorded count)`)
  }

  // ── print the leads as recovered from the DB (not from this file) ──────────
  console.log("M72 Phase 2b — lead recovery from the recorded corpus databases")
  console.log(`corpus inventory: ${CORPUS_JSON}`)
  console.log(`leads read: ${leads.length} (expected ${EXPECTED_LEAD_COUNT})`)
  console.log("")
  for (const lead of leads) {
    const where = lead.sourceLine === lead.sinkLine
      ? `${lead.sourceLine}`
      : `${lead.sourceLine} -> ${lead.sinkLine}`
    console.log(
      `${lead.corpus} | ${lead.file}:${where} | ${lead.ruleId} | ${lead.vulnerability}/${lead.severity} | ` +
        `${JSON.stringify(lead.sourceText)} -> ${JSON.stringify(lead.sinkText)}` +
        (lead.argumentText ? ` | arg=${lead.argumentText}` : ""),
    )
  }
  console.log("")

  // ── adjudicate ────────────────────────────────────────────────────────────
  const missing = leads.filter((l) => !ADJUDICATIONS[l.id])
  if (missing.length > 0) {
    fail(
      `no adjudication for ${missing.length} lead(s): ${missing.map((l) => l.id).join(", ")}`,
    )
  }
  const knownIds = new Set(leads.map((l) => l.id))
  const stale = Object.keys(ADJUDICATIONS).filter((id) => !knownIds.has(id))
  if (stale.length > 0) {
    fail(
      `adjudications exist for ${stale.length} id(s) that are not DB rows: ${stale.join(", ")} ` +
        `(a label must never be reusable for a different lead)`,
    )
  }

  const labelledAt = new Date().toISOString()
  const entries = leads.map((lead) => {
    const adj = ADJUDICATIONS[lead.id]
    return {
      corpus: lead.corpus,
      file: lead.file,
      sourceLine: lead.sourceLine,
      sinkLine: lead.sinkLine,
      ruleId: lead.ruleId,
      vulnerability: lead.vulnerability,
      label: adj.label,
      reason: adj.reason,
      quotedSource: adj.quotedSource,
      quotedSink: adj.quotedSink,
      labelledAt,
      // Provenance: the exact DB row this entry corresponds to, so the 1:1
      // correspondence is auditable without re-reading the corpus DBs.
      leadId: lead.id,
      leadDbPath: lead.dbPath,
      leadState: lead.state,
      leadSeverity: lead.severity,
    }
  })

  // ── 1:1 assertions, both directions ───────────────────────────────────────
  if (entries.length !== leads.length) {
    fail(`labels.json would hold ${entries.length} entries for ${leads.length} DB rows`)
  }
  if (new Set(entries.map((e) => e.leadId)).size !== entries.length) {
    fail("labels.json would contain a duplicate leadId — the correspondence is not 1:1")
  }
  for (const entry of entries) {
    if (!knownIds.has(entry.leadId)) fail(`label entry names a lead that is not a DB row: ${entry.leadId}`)
    if (!["vulnerable", "safe", "unreachable", "unknown"].includes(entry.label)) {
      fail(`lead ${entry.leadId} has an out-of-vocabulary label: ${String(entry.label)}`)
    }
    if (!entry.reason.trim()) fail(`lead ${entry.leadId} has an empty reason`)
    if (!entry.quotedSource.trim() || !entry.quotedSink.trim()) {
      fail(`lead ${entry.leadId} is missing a quoted source or sink line`)
    }
    if (entry.label === "unknown" && !/missing|cannot|unknown|not decidable|need/i.test(entry.reason)) {
      fail(`lead ${entry.leadId} is labelled unknown but its reason does not say what is missing`)
    }
  }

  // ── counts ────────────────────────────────────────────────────────────────
  const byLabel: Record<Verdict, number> = { vulnerable: 0, safe: 0, unreachable: 0, unknown: 0 }
  const byCorpus = new Map<string, Record<Verdict, number>>()
  for (const entry of entries) {
    byLabel[entry.label as Verdict] += 1
    const bucket = byCorpus.get(entry.corpus) ?? { vulnerable: 0, safe: 0, unreachable: 0, unknown: 0 }
    bucket[entry.label as Verdict] += 1
    byCorpus.set(entry.corpus, bucket)
  }

  mkdirSync(dirname(OUT_LABELS), { recursive: true })
  writeFileSync(
    OUT_LABELS,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        tool: "bb_security",
        kind: "m72-phase2b-oracle-labels",
        generatedAt: labelledAt,
        corpusInventory: CORPUS_JSON,
        corpusRoot: JSON.parse(readFileSync(CORPUS_JSON, "utf8"))?.corpusRoot ?? null,
        expectedLeadCount: EXPECTED_LEAD_COUNT,
        leadCount: entries.length,
        counts: { byLabel, byCorpus: Object.fromEntries(byCorpus) },
        notAPrecisionRate:
          "These are adjudicated leads only. There is no labelled safe-code denominator, " +
          "so no precision (or recall) figure can be derived from this file.",
        entries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  )

  // ── report ────────────────────────────────────────────────────────────────
  console.log("ADJUDICATION")
  for (const entry of entries) {
    const where = entry.sourceLine === entry.sinkLine
      ? `${entry.sourceLine}`
      : `${entry.sourceLine} -> ${entry.sinkLine}`
    console.log(`${entry.corpus} | ${entry.file}:${where} | ${entry.ruleId} | ${entry.label}`)
    console.log(`    reason: ${entry.reason}`)
  }
  console.log("")
  console.log(
    `${entries.length} leads, ${byLabel.vulnerable} vulnerable, ${byLabel.safe} safe, ` +
      `${byLabel.unreachable} unreachable, ${byLabel.unknown} unknown`,
  )
  for (const [corpus, bucket] of [...byCorpus.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(
      `  ${corpus}: ${bucket.vulnerable + bucket.safe + bucket.unreachable + bucket.unknown} leads ` +
        `(${bucket.vulnerable} vulnerable, ${bucket.safe} safe, ${bucket.unreachable} unreachable, ${bucket.unknown} unknown)`,
    )
  }
  console.log("")
  console.log("NOT a precision rate: no labelled safe-code denominator exists yet.")
  console.log(`wrote ${OUT_LABELS}`)
}

main()