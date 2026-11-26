#!/usr/bin/env node
// script/bench/verify-record.ts — assert that a run's evidence agrees with itself.
//
// WHY THIS EXISTS. A hand audit of the first three run records found FOURTEEN defects in six
// classes, all from one root cause: the record is written once and never reconciled against
// the schema, the grader or the report. Concretely, before this gate existed:
//
//   * `cost.tool_call_ms` was ALWAYS 0 -- a dead field nothing assigned, while the data sat
//     unread in the trace (98 calls, median 39 ms, max 42.8 s);
//   * `grade.score` in the RECORD contradicted `grade.json` (record said 0, grade said 1),
//     because grading wrote one and never updated the other;
//   * seven fields read `null` forever, which reads as "not applicable" when the truth is
//     "not implemented";
//   * `report.ts` labelled every run "fixture-project" / "javascript" from a hardcoded
//     literal, so it would have mislabelled the first TypeScript report.
//
// Fixing those one at a time is how a class of bug comes back next wave. This gate makes the
// whole class detectable: run it over a wave and it fails if the record, its grade and its
// trace disagree. It is deliberately strict about CONTRADICTION and lenient about ABSENCE --
// a missing optional field is fine, a field that lies is not.
//
// USAGE
//   verify-record.ts <run-dir> [<run-dir> ...]     check explicit runs
//   verify-record.ts --wave <work-root>            check every run under <work-root>/runs
//
// Exit 0 = every record is self-consistent. Exit 1 = at least one lies, and the run is not
// publishable until it is regenerated.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

export interface Finding {
  severity: "error" | "warn";
  code: string;
  detail: string;
}

interface AnyRecord {
  status?: string;
  invalid_reason?: string | null;
  runId?: string;
  project?: string;
  arm?: string;
  task_id?: string;
  embedding_arm?: string;
  cost?: {
    tokens_in?: number;
    tokens_cached?: number;
    tool_calls?: number;
    wall_s?: number;
    tool_call_ms?: number;
    tool_ms_max?: number;
  };
  discovery?: {
    static_prefix_tokens?: number | null;
    tokens_before_first_edit?: number | null;
    exposed?: boolean | null;
    conversion?: boolean | null;
  };
  bb_usage?: {
    calls?: number;
    by_tool?: Record<string, number>;
    refusals?: number;
  };
  arm_enforcement?: {
    bb_mcp_mounted?: boolean;
    bb_cli_shimmed?: boolean;
    bb_cli_invocations?: number;
    placebo_mode?: string | null;
  };
  grade?: { success?: boolean; score?: number; grade_path?: string | null };
  evidence?: {
    trace_path?: string | null;
    trace_lines?: number;
    trace_sha256?: string | null;
    session_path?: string | null;
  };
  submission?: { files_changed?: number; diff_path?: string | null };
  unrecorded?: string[];
}

/** The fields the schema promises. A record missing one is stale against the contract. */
const REQUIRED = [
  "schemaVersion",
  "wave",
  "runId",
  "task_id",
  "project",
  "arm",
  "status",
  "cost",
  "discovery",
  "grade",
  "evidence",
];

export function verifyRun(runDir: string): Finding[] {
  const f: Finding[] = [];
  const err = (code: string, detail: string): void => {
    f.push({ severity: "error", code, detail });
  };
  const warn = (code: string, detail: string): void => {
    f.push({ severity: "warn", code, detail });
  };

  const recPath = path.join(runDir, "run-record.json");
  if (!existsSync(recPath)) {
    err("record-missing", "no run-record.json");
    return f;
  }
  let rec: AnyRecord & Record<string, unknown>;
  try {
    rec = JSON.parse(readFileSync(recPath, "utf8")) as typeof rec;
  } catch {
    err("record-unparseable", "run-record.json is not JSON");
    return f;
  }

  for (const k of REQUIRED) {
    if (!(k in rec))
      err(
        "required-field-missing",
        `schema requires "${k}" and the record omits it`,
      );
  }

  // ── 1. invalid runs must say WHY; valid runs must not ────────────────────────
  if (
    rec.status !== "valid" &&
    rec.status !== "invalid" &&
    rec.status !== "infra_error"
  ) {
    err(
      "status-invalid",
      `status "${String(rec.status)}" is not a known state`,
    );
  }
  if (
    rec.status !== "valid" &&
    (rec.invalid_reason === null ||
      rec.invalid_reason === undefined ||
      rec.invalid_reason === "")
  ) {
    err(
      "invalid-without-reason",
      `status "${String(rec.status)}" carries no invalid_reason; an unexplained exclusion is not publishable`,
    );
  }
  if (rec.status === "valid" && rec.invalid_reason) {
    warn(
      "valid-with-reason",
      `status is valid but invalid_reason is set ("${rec.invalid_reason}")`,
    );
  }

  // ── 2. the arm must be internally coherent ──────────────────────────────────
  const ae = rec.arm_enforcement ?? {};
  const hasBbArm = rec.arm === "C" || rec.arm === "D" || rec.arm === "E";
  if (hasBbArm && ae.bb_mcp_mounted !== true) {
    err(
      "arm-contradiction",
      `arm ${String(rec.arm)} requires the bb server mounted, but arm_enforcement says it is not`,
    );
  }
  if ((rec.arm === "A" || rec.arm === "B") && ae.bb_mcp_mounted === true) {
    err(
      "arm-contradiction",
      `arm ${String(rec.arm)} must NOT mount bb, but arm_enforcement says it does`,
    );
  }
  // THE SKILLS LEAK: skills come from a GLOBAL agents home, so a non-D arm that reports any
  // installed skills is measuring a treated control. Arm D must have them (that is its
  // independent variable) and every other arm must have none.
  const skillsInstalled = (ae as { skills_installed?: number })
    .skills_installed;
  if (typeof skillsInstalled === "number") {
    if (rec.arm === "D" && skillsInstalled === 0) {
      err(
        "skills-missing",
        "arm D installs the published bb skills by definition, but reports 0; D would be a duplicate of C",
      );
    }
    if (rec.arm !== "D" && rec.arm !== undefined && skillsInstalled > 0) {
      err(
        "skills-leak",
        `arm ${String(rec.arm)} must not have bb skills, but reports ${skillsInstalled}; the control was treated`,
      );
    }
  }
  if (rec.arm === "E" && ae.placebo_mode !== "argument-randomised") {
    err(
      "placebo-not-recorded",
      "arm E must record placebo_mode; an unlabelled placebo is arm C wearing a label",
    );
  }
  if (rec.arm !== "E" && ae.placebo_mode) {
    err(
      "placebo-on-real-arm",
      `arm ${String(rec.arm)} records a placebo_mode; a real arm must not be scrambled`,
    );
  }
  // A no-bb arm that invoked the CLI is the measured bb-leak. It must never be scored.
  if (
    (rec.arm === "A" || rec.arm === "B") &&
    (ae.bb_cli_invocations ?? 0) > 0
  ) {
    err(
      "bb-leak",
      `arm ${String(rec.arm)} invoked the bb CLI ${ae.bb_cli_invocations} time(s) but is valid; the control arm was not a control`,
    );
  }

  // ── 3. the grade in the record must agree with grade.json ───────────────────
  const gradePath = path.join(runDir, "grade.json");
  if (existsSync(gradePath)) {
    const g = JSON.parse(readFileSync(gradePath, "utf8")) as {
      success?: boolean;
      score?: number;
      reason?: string;
    };
    const rg = rec.grade ?? {};
    if (rg.score !== g.score) {
      err(
        "grade-mismatch",
        `record says score=${String(rg.score)} but grade.json says ${String(g.score)}; the record contradicts its own evidence`,
      );
    }
    if (rg.success !== g.success) {
      err(
        "grade-mismatch",
        `record says success=${String(rg.success)} but grade.json says ${String(g.success)}`,
      );
    }
    if (!rg.grade_path) {
      err(
        "grade-path-missing",
        "the record does not point at grade.json, so nothing links the score to its evidence",
      );
    }
    // A graded run must not still carry the pre-grading placeholder.
    if (
      rec.status === "valid" &&
      rg.score === 0 &&
      g.score === 0 &&
      g.reason === undefined
    ) {
      warn(
        "grade-placeholder",
        "grade block looks like the pre-grading placeholder",
      );
    }
  } else if (rec.status === "valid") {
    err(
      "grade-missing",
      "a valid run has no grade.json; it cannot be scored and must not be published as a result",
    );
  }

  // ── 4. evidence must be present, hashed and INSIDE the run directory ────────
  const ev = rec.evidence ?? {};
  if (!ev.trace_path) {
    // EVIDENCE IS REQUIRED FOR A VALID RUN ONLY.
    //
    // An invalidated run is the instrument refusing to score something: it may have died
    // before a trace existed. Demanding a transcript from a run we already rejected inverts
    // the point of rejecting it -- and it made the first real wave report 13 "errors" that
    // were all correctly handled. The requirement that matters is the converse: anything
    // SCORED must be citable.
    if (rec.status === "valid") {
      err(
        "trace-missing",
        "a valid run has no trace_path; a scored run without its transcript is not evidence",
      );
    }
  } else {
    if (ev.trace_path.includes("..")) {
      err(
        "trace-escapes",
        `trace_path "${ev.trace_path}" escapes the run directory; the citation would 404 after the wave is cleaned`,
      );
    }
    if (!ev.trace_sha256) err("trace-unhashed", "trace has no sha256");
    const tp = path.join(runDir, ev.trace_path);
    if (!existsSync(tp)) {
      err(
        "trace-absent",
        `trace_path points at "${ev.trace_path}" which does not exist`,
      );
    } else if ((ev.trace_lines ?? 0) === 0) {
      err("trace-empty", "trace is present but has zero lines");
    }
  }
  if (ev.session_path && ev.session_path.includes("..")) {
    err(
      "session-escapes",
      `session_path "${ev.session_path}" escapes the run directory`,
    );
  }

  // ── 5. cost arithmetic must not contradict itself ───────────────────────────
  const c = rec.cost ?? {};
  if ((c.tokens_cached ?? 0) > (c.tokens_in ?? 0)) {
    err(
      "cost-impossible",
      `tokens_cached (${c.tokens_cached}) exceeds tokens_in (${c.tokens_in}); cached input is part of input`,
    );
  }
  if ((c.tool_calls ?? 0) > 0 && (c.tool_call_ms ?? 0) === 0) {
    // This exact defect shipped: the field existed, always read 0, and the data was in the
    // trace. Treat it as a WARNING rather than an error because a legitimately sub-millisecond
    // total is possible in principle -- but it is almost always the dead-field bug returning.
    warn(
      "tool-ms-dead",
      `${c.tool_calls} tool calls but tool_call_ms is 0; the field was dead once before, check it is assigned`,
    );
  }
  // bb_usage must agree with the tool inventory it reports.
  const calls = rec.bb_usage?.calls ?? 0;
  const byTool = rec.bb_usage?.by_tool ?? {};
  const counted = Object.entries(byTool)
    .filter(([k]) => k.startsWith("mcp__bb__"))
    .reduce((a, [, v]) => a + v, 0);
  if (calls > 0 && counted !== calls) {
    err(
      "bb-usage-mismatch",
      `bb_usage.calls=${calls} but by_tool counts ${counted} mcp__bb__ call(s)`,
    );
  }

  // ── 6. discovery must not claim a conversion it could not have measured ─────
  const d = rec.discovery ?? {};
  if (d.conversion === true && d.exposed !== true) {
    err(
      "conversion-without-exposure",
      "conversion is true but the agent was never exposed to the golden file; conversion is undefined without a showing",
    );
  }
  if (
    d.tokens_before_first_edit !== null &&
    d.tokens_before_first_edit !== undefined &&
    (d.static_prefix_tokens ?? 0) > 0
  ) {
    if (
      (d.tokens_before_first_edit as number) <
      (d.static_prefix_tokens as number)
    ) {
      warn(
        "discovery-below-prefix",
        "tokens_before_first_edit is below the arm's static prefix, which is impossible if the prefix is the first step",
      );
    }
  }

  // ── 7. silence about a gap is a lie of omission ─────────────────────────────
  if (rec.status === "valid" && !Array.isArray(rec.unrecorded)) {
    warn(
      "unrecorded-undeclared",
      "the record does not declare which expected fields it did not measure",
    );
  }

  // ── 8. a fixture run must not be mixed into a language report ──────────────
  if (typeof rec.project === "string" && rec.project.length === 0) {
    err(
      "project-empty",
      "record names an empty project; report.ts cannot map it to a language",
    );
  }

  return f;
}

// ── cli ───────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let dirs: string[] = [];
  const waveIdx = args.indexOf("--wave");
  if (waveIdx >= 0) {
    const root = path.resolve(args[waveIdx + 1] ?? "");
    const runsDir = path.join(root, "runs");
    if (!existsSync(runsDir)) {
      console.error(
        `verify-record: no runs directory at ${path.relative(REPO_ROOT, runsDir)}`,
      );
      process.exit(2);
    }
    dirs = readdirSync(runsDir)
      .map((d) => path.join(runsDir, d))
      .filter((d) => statSync(d).isDirectory());
  } else {
    dirs = args.map((a) => path.resolve(a));
  }
  if (dirs.length === 0) {
    console.error(
      "verify-record: usage: verify-record.ts <run-dir>... | --wave <work-root>",
    );
    process.exit(2);
  }

  let errors = 0;
  let warns = 0;
  for (const d of dirs) {
    const findings = verifyRun(d);
    const name = path.basename(d);
    const es = findings.filter((x) => x.severity === "error");
    const ws = findings.filter((x) => x.severity === "warn");
    errors += es.length;
    warns += ws.length;
    if (es.length === 0 && ws.length === 0) {
      console.log(`ok:   ${name}`);
      continue;
    }
    console.log(`${es.length > 0 ? "FAIL" : "warn"}: ${name}`);
    for (const x of es) console.log(`   error [${x.code}] ${x.detail}`);
    for (const x of ws) console.log(`   warn  [${x.code}] ${x.detail}`);
  }
  console.log(
    `\n${dirs.length} record(s): ${errors} error(s), ${warns} warning(s)`,
  );
  process.exit(errors > 0 ? 1 : 0);
}
