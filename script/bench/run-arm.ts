#!/usr/bin/env node
// script/bench/run-arm.ts — execute ONE task in ONE arm and write a complete run record.
//
// WHAT THIS IS. The runner is the only place an arm's conditions are applied, so it is
// the only place a violation can be caught. It does six things in a fixed order, and the
// order is the safety:
//
//   1. build the arm's disposable DSH home (bb server present only for C/D, bb CLI shimmed
//      for A/B)                                            -> lib/profile.ts
//   2. copy the pinned project into a fresh workspace       (never mutate the pin)
//   3. index (arms C/D only -- A/B have no bb at all)
//   4. PROBE TURN: assert the arm is the arm               <- closes the silent no-tools hole
//   5. run the task, stamping arrival times on the NDJSON  -> lib/trace.ts
//   6. write run-record.json + trace.ndjson + patch + checksums
//
// WHY THE PROBE. A C arm whose `mcp-bb` row fails to load COMPLETES, and the agent
// answers confidently with no bb tools. That run looks exactly like "bb does not help".
// The probe is one cheap turn whose only job is to make that impossible to score.
//
// WHAT IT REFUSES TO DO. It will not record a run that cannot be published: a missing
// trace, an unrecorded embedder, a successful bb invocation in a no-bb arm, or a
// keyword-fallback semantic answer in a C2 run are all `invalid` with a named reason,
// never a quietly-scored zero.

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  cpSync,
  readdirSync,
  statSync,
  appendFileSync,
} from "node:fs";
import path from "node:path";
import { npmInstall } from "./lib/npm.ts";
import { createHash } from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  buildProfile,
  runEnv,
  ARM_SPECS,
  ARMS,
  type Arm,
} from "./lib/profile.ts";
import { exec, streamStamped } from "./lib/exec.ts";
import {
  readTrace,
  summarize,
  discoveryTax,
  tokenTotals,
  exposureOf,
} from "./lib/trace.ts";
import { scrubFile } from "./lib/scrub.ts";
import { materializeTask } from "./lib/materialize.ts";
import { digestOf } from "./manual-block.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

/**
 * Where agent workspaces live. Deliberately NOT under REPO_ROOT.
 *
 * The first wave put workspaces inside `benchmarks/.work/`, so an agent could walk up to the
 * task's own `golden/*.patch`; 11 of 17 valid runs read the answer key and scored 1.0.
 * A separate root means there is no relative path from the workspace to the benchmark.
 * `BENCH_WORKSPACES` is overridable for CI, and defaults to a sibling of the checkout.
 */
const BENCH_WORKSPACES =
  process.env.BENCH_WORKSPACES ??
  path.resolve(
    REPO_ROOT,
    "..",
    `.bench-workspaces-${path.basename(REPO_ROOT)}`,
  );

// ── args ───────────────────────────────────────────────────────────────────────
interface Args {
  task: string;
  arm: Arm;
  wave: string;
  embeddingArm: "C0" | "C1" | "C2";
  rep: number;
  provider: string;
  model: string;
  concurrency: number;
  fixture: boolean;
  probeOnly: boolean;
  keepWork: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const task = get("task");
  const arm = get("arm") as Arm | undefined;
  if (!task) throw new Error("--task <path to task.json> is required");
  if (!arm || !ARMS.includes(arm))
    throw new Error(`--arm must be one of ${ARMS.join(",")}`);
  return {
    task: path.resolve(task),
    arm,
    wave: get("wave") ?? "W0",
    embeddingArm: (get("embedding-arm") as "C0" | "C1" | "C2") ?? "C0",
    rep: Number(get("rep") ?? 1),
    provider: get("provider") ?? "freepi",
    model: get("model") ?? "deepseek-v4.1-flash",
    concurrency: Number(get("concurrency") ?? 1),
    fixture: argv.includes("--fixture"),
    probeOnly: argv.includes("--probe-only"),
    keepWork: argv.includes("--keep-work"),
  };
}

// ── small helpers ──────────────────────────────────────────────────────────────
const sha256 = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");

function copyDir(from: string, to: string): void {
  cpSync(from, to, { recursive: true });
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === ".git" || name === "node_modules") continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

/** Peak RSS of a child process, from /proc if it outlived the wait. Best-effort by
 *  design: `null` is honest, an invented number is not. */
function peakRssMbOfSelf(): number | null {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const m = /VmHWM:\s+(\d+)\s+kB/.exec(status);
    return m ? Math.round(Number(m[1]) / 1024) : null;
  } catch {
    return null;
  }
}

interface TaskDef {
  id: string;
  track: string;
  project: string;
  origin?: {
    kind: string;
    base_revision: string | null;
    fix_revision: string | null;
  };
  prompt: string;
  golden: { files: string[]; patch: string; needle: string | null };
  budget: { max_steps: number; max_tokens: number; max_wall_s: number };
  grade: { must_pass: string[]; must_not_break: string[] };
}

interface ProjectDef {
  id: string;
  source: string;
  test: string[];
  languages_indexed: string[];
}

// ── main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const spec = ARM_SPECS[a.arm];

  const taskDir = path.dirname(a.task);
  const task = JSON.parse(readFileSync(a.task, "utf8")) as TaskDef;
  const fixtureRoot = path.resolve(taskDir, "..");
  // `fixtureRoot` is the directory holding project.json + tasks/ + prompts/ in BOTH layouts:
  // script/bench/fixtures/ and benchmarks/<language>/<projectN>/. An earlier version walked
  // one level up for the non-fixture case and read the LANGUAGE directory instead.
  const projectFile = path.join(fixtureRoot, "project.json");
  if (!existsSync(projectFile))
    throw new Error(`no project.json at ${projectFile}`);
  const project = JSON.parse(readFileSync(projectFile, "utf8")) as ProjectDef;
  // `source` exists ONLY for the committed fixture. A pinned project is materialised from a
  // clone at run time, so there is no committed tree to copy -- and an earlier version that
  // assumed one threw "path must be of type string" on the first real repository.
  const projectSrc = project.source
    ? path.isAbsolute(project.source)
      ? project.source
      : path.resolve(REPO_ROOT, project.source)
    : null;

  const runId = `${a.wave}-${task.id}-arm${a.arm}-${a.embeddingArm}-r${a.rep}`;
  const benchmarkRoot = path.join(REPO_ROOT, "benchmarks");
  const waveRoot = path.join(REPO_ROOT, "benchmarks", ".work", a.wave);
  const runDir = path.join(waveRoot, "runs", runId);
  // Where the agent actually works. OUTSIDE the repo checkout, so `../..` from the workspace
  // cannot reach the benchmark's own files. See the comment at `workDir` below.
  const workRoot = path.join(BENCH_WORKSPACES, runId);
  rmSync(runDir, { recursive: true, force: true });
  rmSync(workRoot, { recursive: true, force: true });
  mkdirSync(workRoot, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  // THE WORKSPACE MUST NOT BE INSIDE THE REPO.
  //
  // It used to be `benchmarks/.work/<wave>/runs/<id>/workspace`, i.e. nested inside the
  // checkout that holds the tasks, the golden patches and the prompts. An agent working in
  // that directory can reach its own ANSWER KEY with `cat ../../../typescript/project1/
  // golden/<id>.patch`, and 11 of 17 valid runs in the first wave did exactly that -- then
  // scored 1.0. The measurements were void: they measured "can the agent find the patch",
  // which it can, not "can it fix the bug".
  //
  // The fix is isolation by LOCATION, not by instruction: the workspace now lives in a
  // sibling directory that contains nothing but this run. The prompt cannot be trusted to
  // enforce this, and a hidden path is not a boundary.
  const workDir = path.join(workRoot, "workspace");
  // Created empty here and populated in step 1b. The profile build needs a directory path to
  // register the bb server against; a nonexistent path would make arm C's server target a
  // directory that bb then creates, which is not the workspace and would mis-index.
  mkdirSync(workDir, { recursive: true });

  const record: Record<string, unknown> = {
    schemaVersion: 1,
    wave: a.wave,
    runId,
    task_id: task.id,
    // The project this run belongs to. report.ts maps it to a language via the manifest and
    // REFUSES to guess; without this field every report fell back to a hardcoded literal.
    project: task.project,
    arm: a.arm,
    embedding_arm: a.embeddingArm,
    repetition: a.rep,
    status: "valid",
    invalid_reason: null,
    // Only values we can actually establish. A key that is always null reads as "not
    // applicable" when the truth is "not implemented", which is the failure mode the ledger
    // exists to prevent -- so unknown fields are OMITTED and named in `unrecorded` below.
    model: { provider: a.provider, model: a.model, temperature: 0 },
    harness: { kind: "dsh-headless" },
    bb: {
      version: null,
      index_health: null,
      index_health_verbatim: null,
      embedding_config:
        a.embeddingArm === "C0" ? "local-word-vectors-v3:50" : null,
      embedding_warmup: false,
    },
    arm_enforcement: {
      bb_mcp_mounted: spec.bbMcp,
      placebo_mode: spec.placebo ? "argument-randomised" : null,
      placebo_injected: null,
      bb_cli_shimmed: false,
      bb_cli_invocations: 0,
      absolute_path_invocations: 0,
    },
    // Peak RSS of the CHILD index process is not obtainable portably here, and the runner's
    // own figure is not the index's. Recording only what is measured; the gap is named in
    // `unrecorded` so a reader is never told a null means "not applicable".
    memory: {
      ram_total_gb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      ram_available_gb_at_start:
        Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
      peak_rss_index_mb: null,
    },
    concurrency: a.concurrency,
    cost: {
      wall_s: 0,
      tokens_in: 0,
      tokens_out: 0,
      tool_calls: 0,
      tool_call_bytes: 0,
      tool_call_ms: 0,
    },
    discovery: {
      // Populated after the measured turn. Tokens are primary; ms is arrival (upper bound).
      static_prefix_tokens: null,
      tokens_before_first_edit: null,
      tokens_before_first_edit_complete: false,
      first_edit_step: null,
      first_edit_ms: null,
      measured_on: "tokens-primary; ms is runner-arrival (upper bound)",
      exposed: null,
      exposed_at_step: null,
      exposed_at_ms: null,
      exposed_by_tool: null,
      edited_golden: null,
      conversion: null,
    },
    bb_usage: {
      calls: 0,
      by_tool: {},
      refusals: 0,
      fallback_answers: 0,
      fallback_rate: 0,
    },
    submission: {
      diff_path: null,
      files_changed: 0,
      lines_added: 0,
      lines_removed: 0,
    },
    grade: { grade_path: null, success: false, score: 0 },
    evidence: null,
    timing: { source: "runner-arrival", resolution_ms: 1 },
    // Fields a reader might expect and which this harness does NOT measure. Declared so an
    // absent key cannot be misread as a null measurement.
    unrecorded: [
      "harness.version",
      "harness.commit",
      "model.context_window",
      "model.quantization",
      "memory.peak_rss_agent_mb",
      "memory.peak_rss_index_child_mb",
      "bb.embedding_endpoint",
      "bb_setup_show_verbatim",
      "index_build_ms",
      "index_symbol_count",
    ],
  };

  const finish = (status: string, reason: string | null): void => {
    record.status = status;
    record.invalid_reason = reason;
    // PRINT THE VERDICT, always -- not only on success.
    //
    // `finish` used to write the record silently and only the valid path logged a line. So an
    // invalid run produced NO output, run-wave saw "no status line", and 13 of 30 cells in the
    // first real wave were reported as harness failures when they were correctly invalidated
    // runs (2 fetched the upstream fix with curl, 3 crashed, 3 found the bb server unmounted).
    // A driver cannot tell "produced no verdict" from "the process died" without this.
    const line =
      status === "valid"
        ? `valid: ${record.runId}`
        : `${status}: ${record.runId}`;
    console.log(
      `${line}  status=${status}${reason ? `  reason=${reason}` : ""}`,
    );
    writeFileSync(
      path.join(runDir, "run-record.json"),
      JSON.stringify(record, null, 2) + "\n",
    );
  };

  // ── 1. the arm's home ────────────────────────────────────────────────────────
  const profile = buildProfile({
    waveRoot,
    arm: a.arm,
    projectDir: workDir,
    provider: a.provider,
    model: a.model,
  });
  // Skills are a GLOBAL DSH resource (~/.agents/skills) that used to leak into every arm.
  // Recording the count makes the leak detectable: arms A/B/C/E must show 0, D must show the
  // real published set. Set here because the record literal is built before the profile.
  (record.arm_enforcement as Record<string, unknown>).skills_installed =
    profile.skillsInstalled;
  (record.arm_enforcement as Record<string, unknown>).bb_cli_shimmed =
    profile.cliShimmed;
  (record.arm_enforcement as Record<string, unknown>).bb_mcp_mounted =
    profile.bbMcpMounted;

  const dshBin = process.env.BENCH_DSH_BIN ?? "dsh";
  const bbDir = path.join(waveRoot, "bbdata");
  const env = runEnv(profile, {
    BB_DATA_DIR: bbDir,
    ...(a.embeddingArm === "C0" ? { BB_EMBEDDING_DISABLED: "1" } : {}),
  });

  // ── 1b. workspace: copy a fixture, or materialise a pin at the task's fix^ ────
  // A FIXTURE project is a committed text tree and is copied. A PINNED project is
  // materialised from a cache clone -- `benchmarks/` never holds a cloned repository
  // (SCHEMA.md 1). This happens AFTER the profile because a failure here must be recorded
  // against an existing run record, and BEFORE indexing because bb indexes what the agent sees.
  const isPinned =
    typeof (project as unknown as { remote?: string }).remote === "string";
  if (isPinned) {
    const pin = project as unknown as { remote: string; revision: string };
    const mat = materializeTask({
      cacheDir: path.join(benchmarkRoot, ".work", "cache"),
      project: { id: project.id, remote: pin.remote, revision: pin.revision },
      task: {
        origin: {
          base_revision: task.origin?.base_revision ?? null,
          fix_revision: task.origin?.fix_revision ?? null,
        },
        golden: task.golden,
      },
      // The fix's test files come from the task's own golden file list, so a task cannot
      // name tests its fix commit does not touch.
      testFiles: task.golden.files.filter((f) =>
        /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$/i.test(
          f,
        ),
      ),
      dest: workDir,
    });
    (record as Record<string, unknown>).revision = {
      base: mat.baseSha,
      pinned: mat.pinnedSha,
    };
    const inst = npmInstall(workDir);
    if (!inst.ok) {
      finish("infra_error", `npm install failed: ${inst.detail}`);
      return;
    }
  } else {
    if (projectSrc === null) {
      finish(
        "infra_error",
        "project has neither a `source` tree nor a `remote` pin",
      );
      return;
    }
    copyDir(projectSrc, workDir);
  }

  // PRISTINE SNAPSHOT. The submission diff must be against the tree the agent STARTED from,
  // not against a committed fixture. For a pinned project the start tree is materialised at
  // run time, so there is nothing on disk to diff against afterwards -- copying it here is
  // the only way to know what the agent actually changed. node_modules is excluded because
  // it is environment, not submission.
  const pristineDir = path.join(runDir, "pristine");
  cpSync(workDir, pristineDir, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${path.sep}node_modules`) &&
      !src.includes(`${path.sep}.git`),
  });

  // ── 2/3. index (only arms with bb) ──────────────────────────────────────────
  if (spec.bbMcp) {
    const idx = await exec(
      process.env.BENCH_BB_BIN ?? path.join(REPO_ROOT, "bin", "bb"),
      ["index", ".", "--no-setup"],
      {
        cwd: workDir,
        env,
        timeoutMs: 10 * 60 * 1000,
      },
    );
    (record.memory as Record<string, unknown>).peak_rss_index_mb =
      peakRssMbOfSelf();
    if (idx.code !== 0) {
      finish(
        "invalid",
        `index-failed: ${idx.stderr.split("\n").slice(-3).join(" ").slice(0, 400)}`,
      );
      return;
    }
    // bb version + verbatim health, for the publication header.
    const ver = await exec(
      process.env.BENCH_BB_BIN ?? path.join(REPO_ROOT, "bin", "bb"),
      ["--version"],
      { cwd: workDir, env, timeoutMs: 60_000 },
    );
    (record.bb as Record<string, unknown>).version = ver.stdout.trim() || null;
    const health = await exec(
      process.env.BENCH_BB_BIN ?? path.join(REPO_ROOT, "bin", "bb"),
      ["health"],
      { cwd: workDir, env, timeoutMs: 120_000 },
    );
    const hv = (health.stdout || "").trim();
    (record.bb as Record<string, unknown>).index_health_verbatim =
      hv.slice(0, 4000) || null;
    const healthy =
      /freshness:/.test(hv) && !/MODEL_MISMATCH|Model mismatch/i.test(hv);
    (record.bb as Record<string, unknown>).index_health = healthy
      ? "green"
      : "degraded";
  }

  // ── 4. the probe turn: is the arm the arm? ──────────────────────────────────
  // Task-relative paths (prompt, golden patch) resolve against the FIXTURE/PROJECT root,
  // which is where they live: tasks/ and prompts/ are siblings in every project slot.
  const promptPath = path.join(fixtureRoot, task.prompt);
  const taskPrompt = readFileSync(promptPath, "utf8");

  // THE MANUAL BLOCK. Arms B, C, D and E prepend the frozen bb manual; arm A does not.
  //
  // It is READ FROM THE COMMITTED FILE and hashed, not regenerated at wave time: a run must
  // use the block that was pre-registered, and a generator run here would let the block
  // change between waves without the digest moving. `manual-block.ts check` is the gate that
  // keeps the committed file honest against the current tool surface.
  const MANUAL_PATH = path.join(
    REPO_ROOT,
    "benchmarks",
    "spec",
    "manual-block.md",
  );
  let manualText: string | null = null;
  if (spec.manualBlock) {
    if (!existsSync(MANUAL_PATH)) {
      finish(
        "infra_error",
        `the arm needs the manual block but ${path.relative(REPO_ROOT, MANUAL_PATH)} is missing; run script/bench/manual-block.ts write`,
      );
      return;
    }
    manualText = readFileSync(MANUAL_PATH, "utf8");
    (record as Record<string, unknown>).manual_block = {
      path: path.relative(REPO_ROOT, MANUAL_PATH),
      chars: manualText.length,
      sha256: digestOf(manualText),
      applies: true,
    };
  } else {
    (record as Record<string, unknown>).manual_block = { applies: false };
  }
  // Byte-identical across B/C/D/E or C-B stops being a context-cost measurement.
  const promptBody =
    manualText === null ? taskPrompt : `${manualText}\n---\n\n${taskPrompt}`;

  // RECORD THE EXACT PROMPT. The independent variable of B/C/D/E is the text the agent was
  // given, and it was previously passed as argv and never written down -- so no reader could
  // confirm the manual block was actually delivered. An arm whose treatment is unrecorded is
  // an arm whose result cannot be checked. Written out in full, with a digest for the index.
  writeFileSync(path.join(runDir, "prompt.txt"), promptBody);
  (record as Record<string, unknown>).prompt = {
    path: "prompt.txt",
    chars: promptBody.length,
    sha256: createHash("sha256").update(promptBody).digest("hex"),
    // The manual block's own share, so a reader can see the treatment separated from the task.
    manual_block_chars: manualText === null ? 0 : manualText.length,
    task_chars: taskPrompt.length,
  };
  const probePrompt = spec.bbMcp
    ? "Use the bb_search tool to look up the symbol `subtotal`. Answer with only the file path it reports. Do not use any other tool."
    : "Answer with only the word: READY. Do not use any tool.";

  // The placebo probe asks for a symbol that EXISTS and then asserts the answer did NOT
  // find it. If arm E returned `subtotal`, the proxy did not inject and E is really C wearing
  // a label -- the single most dangerous way this control could silently fail, because the
  // record would still say `arm: E`. */
  const PROBE_SYMBOL = "subtotal";

  const runTurn = async (prompt: string, label: string) => {
    const tracePath = path.join(runDir, `${label}.ndjson`);
    writeFileSync(tracePath, "");
    const res = await streamStamped(
      dshBin,
      [
        "--profile",
        "headless",
        "--json",
        "--permission-mode",
        "workspace-write",
        "--add-dir",
        workDir,
        prompt,
      ],
      {
        cwd: workDir,
        env,
        timeoutMs: Math.max(120_000, task.budget.max_wall_s * 1000),
      },
      (line, atMs) => {
        let stamped = line;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          obj._t_ms = atMs;
          stamped = JSON.stringify(obj);
        } catch {
          stamped = JSON.stringify({
            type: "unparsed",
            raw: line,
            _t_ms: atMs,
          });
        }
        appendFileSync(tracePath, stamped + "\n");
      },
    );
    return { tracePath, res };
  };

  const probe = await runTurn(probePrompt, "probe");
  {
    const events = readTrace(probe.tracePath);
    const s = summarize(events);
    if (spec.bbMcp) {
      // C/D/E must have CALLED a bb tool and got a non-error answer.
      const ok = s.bbCallCount > 0 && s.bbRefusals === 0;
      if (!ok) {
        finish(
          "invalid",
          `probe: arm ${a.arm} has bb mounted but made ${s.bbCallCount} bb call(s) with ${s.bbRefusals} refusal(s) — the server did not load, so this run would measure an agent WITHOUT the tools`,
        );
        return;
      }
      if (spec.placebo) {
        // The placebo must actually have removed the answer.
        const traceText = readFileSync(probe.tracePath, "utf8");
        if (
          traceText.includes(`"${PROBE_SYMBOL}"`) &&
          /subtotal/.test(traceText)
        ) {
          // The probe prompt itself mentions the symbol, so look only at tool RESULTS.
          const found = s.toolCalls.some((c) =>
            (c.result?.result ?? "").includes(PROBE_SYMBOL),
          );
          if (found) {
            finish(
              "invalid",
              `placebo: arm E returned a result for "${PROBE_SYMBOL}", so the argument rewrite did not take effect. This arm is arm C wearing an E label and would fake a content effect.`,
            );
            return;
          }
        }
        (record.arm_enforcement as Record<string, unknown>).placebo_injected =
          true;
      }
    } else {
      // A/B must have touched no bb tool.
      if (s.bbCallCount > 0) {
        finish(
          "invalid",
          `probe: arm ${a.arm} is a no-bb arm but called ${s.bbCallCount} bb tool(s)`,
        );
        return;
      }
    }
  }

  if (a.probeOnly) {
    finish("valid", null);
    console.log(`probe ok: arm ${a.arm} (bb mounted=${spec.bbMcp})`);
    return;
  }

  // ── 5. the measured turn ────────────────────────────────────────────────────
  const measured = await runTurn(promptBody, "trace");
  const events = readTrace(measured.tracePath);
  const s = summarize(events);

  // ── 6. evidence ─────────────────────────────────────────────────────────────
  // The submission is whatever the agent left in the tree: diff against the pin.
  // `git diff --no-index` accepts NO pathspec (verified: it rejects a `:(exclude)` argument
  // with a usage error), so exclusion must happen by only giving it clean trees. Without
  // this, the workspace's installed `node_modules` read as 611 added files and every run
  // looked like it had rewritten the repository.
  const subDir = path.join(runDir, ".submission-tree");
  rmSync(subDir, { recursive: true, force: true });
  cpSync(workDir, subDir, {
    recursive: true,
    filter: (src) =>
      !src.includes(`${path.sep}node_modules`) &&
      !src.includes(`${path.sep}.git`),
  });
  // RELATIVE paths, run from the run directory. With absolute paths the patch header embeds
  // the operator's home directory and the run id, which makes the artifact unreadable and
  // breaks path normalisation. Relative also means grade.ts can strip a fixed prefix.
  const diff = await exec(
    "git",
    [
      "--no-pager",
      "diff",
      "--no-index",
      "--no-color",
      "--",
      "pristine",
      ".submission-tree",
    ],
    {
      cwd: runDir,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } as Record<
        string,
        string
      >,
      timeoutMs: 120_000,
    },
  );
  const patchPath = path.join(runDir, "submission.patch");
  writeFileSync(patchPath, diff.stdout);
  rmSync(subDir, { recursive: true, force: true });
  const filesChanged = new Set<string>();
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of diff.stdout.split("\n")) {
    if (line.startsWith("+++ b/") || line.startsWith("+++ ")) {
      const f = line.replace(/^\+\+\+ (b\/)?/, "").replace(/\t.*$/, "");
      if (f && f !== "/dev/null") filesChanged.add(f);
    } else if (line.startsWith("+") && !line.startsWith("+++")) linesAdded++;
    else if (line.startsWith("-") && !line.startsWith("---")) linesRemoved++;
  }

  // bb-leak scan: a no-bb arm that reached the CLI (by any path) is invalid.
  const enforcement = record.arm_enforcement as Record<string, unknown>;
  const absBb = profile.shadowedBb ? path.resolve(profile.shadowedBb) : null;
  let bbCliInvocations = 0;
  let absInvocations = 0;
  if (!spec.bbMcp) {
    for (const c of s.toolCalls) {
      const text = JSON.stringify(c.input ?? "");
      if (
        /(^|[\s"'=;&|(])bb\s+(mcp|index|tool|setup|health|stats|status|search|ask|--version|-v)\b/.test(
          text,
        )
      )
        bbCliInvocations++;
      if (absBb && text.includes(absBb)) absInvocations++;
    }
  }
  enforcement.bb_cli_invocations = bbCliInvocations;
  enforcement.absolute_path_invocations = absInvocations;

  const bbUsage = record.bb_usage as Record<string, unknown>;
  bbUsage.calls = s.bbCallCount;
  bbUsage.by_tool = s.toolCounts;
  bbUsage.refusals = s.bbRefusals;
  bbUsage.fallback_answers = s.bbFallbackAnswers;
  bbUsage.fallback_rate =
    s.bbCallCount > 0
      ? Math.round((s.bbFallbackAnswers / s.bbCallCount) * 1000) / 1000
      : 0;

  const cost = record.cost as Record<string, unknown>;
  cost.wall_s = Math.round(measured.res.ms / 100) / 10;
  cost.tool_calls = s.toolCalls.length;
  // Per-tool wall time, derived from call->result arrival deltas. This field existed and was
  // ALWAYS ZERO because nothing assigned it; the data was in the trace all along (measured:
  // 98 calls, median 39 ms, max 42.8 s). Arrival deltas are an UPPER BOUND, same caveat as
  // every other ms figure here.
  const callAt = new Map<string, number>();
  for (const c of s.toolCalls)
    if (c.atMs !== null) callAt.set(c.callId, c.atMs);
  const resultAt = new Map<string, number>();
  for (const e of events) {
    if (
      e.type === "tool_result" &&
      typeof e.callId === "string" &&
      typeof e._t_ms === "number"
    ) {
      resultAt.set(e.callId, e._t_ms);
    }
  }
  const durations: number[] = [];
  const perTool: Record<string, number[]> = {};
  for (const c of s.toolCalls) {
    const a = callAt.get(c.callId);
    const b = resultAt.get(c.callId);
    if (a === undefined || b === undefined || b < a) continue;
    const d = b - a;
    durations.push(d);
    (perTool[c.tool] ??= []).push(d);
  }
  const med = (xs: number[]): number => {
    if (xs.length === 0) return 0;
    const q = [...xs].sort((x, y) => x - y);
    const m = Math.floor(q.length / 2);
    return q.length % 2 ? q[m] : Math.round((q[m - 1] + q[m]) / 2);
  };
  cost.tool_call_ms = durations.reduce((x, y) => x + y, 0);
  cost.tool_ms_median = med(durations);
  cost.tool_ms_max = durations.length ? Math.max(...durations) : 0;
  cost.tool_ms_by_tool = Object.fromEntries(
    Object.entries(perTool).map(([k, v]) => [
      k,
      { calls: v.length, median: med(v), max: Math.max(...v) },
    ]),
  );
  cost.tool_call_bytes = s.toolResultBytes;

  // DISCOVERY TAX. Tokens are the primary measure (the trace has no harness timestamps);
  // ms is an arrival-time UPPER BOUND used only for ordering. Nulls are explicit about
  // WHICH part was unmeasurable -- "unknown" must never read as zero.
  const tax = discoveryTax(events, task.golden.files);
  const totals = tokenTotals(events);
  const disc = record.discovery as Record<string, unknown>;
  disc.static_prefix_tokens = tax.staticPrefixTokens;
  disc.tokens_before_first_edit = tax.tokensBeforeFirstEdit;
  disc.tokens_before_first_edit_complete = tax.complete;
  disc.first_edit_step = tax.firstGoldenEditStep;
  disc.first_edit_ms = tax.firstGoldenEditMs;
  disc.measured_on = "tokens-primary; ms is runner-arrival (upper bound)";
  // The mechanism split. See lib/trace.ts exposureOf and PRIOR-WORK.md 1.4.
  const exp = exposureOf(events, task.golden.files);
  disc.exposed = exp.exposed;
  disc.exposed_at_step = exp.exposedAtStep;
  disc.exposed_at_ms = exp.exposedAtMs;
  disc.exposed_by_tool = exp.byTool;
  disc.edited_golden = exp.editedGolden;
  disc.conversion = exp.conversion;
  (record.cost as Record<string, unknown>).tokens_in = totals.input ?? 0;
  (record.cost as Record<string, unknown>).tokens_out = totals.output ?? 0;
  (record.cost as Record<string, unknown>).tokens_cached =
    totals.cacheRead ?? 0;
  (record.cost as Record<string, unknown>).usage_complete = totals.complete;

  const sub = record.submission as Record<string, unknown>;
  sub.diff_path = path.relative(runDir, patchPath);
  sub.files_changed = filesChanged.size;
  sub.lines_added = linesAdded;
  sub.lines_removed = linesRemoved;

  // ── invalidity gates, in the order they must be checked ─────────────────────
  if (measured.res.timedOut) {
    finish("invalid", "budget: wall clock exceeded");
    return;
  }
  // The harness reports WHY a turn ended and the runner used to ignore it, so a crashed or
  // aborted turn was recorded as `valid` and scored as a failure of the ARM rather than of
  // the infrastructure. Only `completed` is a valid measurement.
  // ── BENCHMARK-CONTAMINATION GATE ────────────────────────────────────────────
  //
  // An agent that reaches the harness's own files is not solving the task. This is checked
  // from the trace, not from where the workspace happens to be, because location isolation is
  // a mitigation and this is the measurement: if a tool call mentions the golden patch, the
  // task file, the prompt, or the wave directory, the run is VOID.
  //
  // Measured in the first wave: 11 of 17 valid runs read `golden/<id>.patch` -- the answer
  // key -- and every one scored 1.0. The number was real, the measurement was not, and only
  // reading the traces revealed it.
  {
    const CONTAMINATING =
      /golden\/t\d-[a-z0-9-]+\.(tests\.)?patch|tasks\/t\d-[a-z0-9-]+\.json|\/prompt\.txt|benchmarks\/\.work|check-golden/;
    const touched: string[] = [];
    for (const c of s.toolCalls) {
      const payload = JSON.stringify(c.input ?? "");
      if (CONTAMINATING.test(payload)) touched.push(payload.slice(0, 140));
    }
    if (touched.length > 0) {
      finish(
        "invalid",
        `benchmark-contamination: the agent touched the harness's own files (${touched.length} call(s)); first: ${touched[0]}. The workspace must be outside the checkout and no run may read its own golden patch.`,
      );
      return;
    }
  }
  if (s.finalReason !== null && s.finalReason !== "completed") {
    finish(
      "infra_error",
      `turn ended with reason "${s.finalReason}" (not completed); this is not a measurement of the arm`,
    );
    return;
  }
  if (s.finalReason === null) {
    finish(
      "infra_error",
      "no terminal final event in the trace; the run did not finish",
    );
    return;
  }
  if (!spec.bbMcp && (bbCliInvocations > 0 || absInvocations > 0)) {
    finish(
      "invalid",
      `bb-leak: arm ${a.arm} invoked the bb CLI ${bbCliInvocations} time(s) (${absInvocations} by absolute path); the control arm was not a control`,
    );
    return;
  }
  if (s.suspiciousCalls.length > 0) {
    finish(
      "invalid",
      `network/install: ${s.suspiciousCalls
        .map((c) => c.why)
        .join("; ")
        .slice(0, 300)}`,
    );
    return;
  }
  if (
    a.embeddingArm === "C2" &&
    spec.bbMcp &&
    s.bbCallCount > 0 &&
    s.bbFallbackAnswers > 0
  ) {
    finish(
      "invalid",
      `embedding: ${s.bbFallbackAnswers} bb answer(s) declared a lexical/keyword fallback; a C2 run must measure the semantic path`,
    );
    return;
  }

  // ── evidence block + checksums ──────────────────────────────────────────────
  const traceText = readFileSync(measured.tracePath, "utf8");
  const sessionDir = path.join(profile.home, "sessions");
  let sessionPath: string | null = null;
  if (existsSync(sessionDir)) {
    for (const slug of readdirSync(sessionDir)) {
      const sd = path.join(sessionDir, slug);
      if (!statSync(sd).isDirectory()) continue;
      for (const id of readdirSync(sd)) {
        const f = path.join(sd, id, "session.v4.jsonl.zstd");
        if (existsSync(f)) sessionPath = f;
      }
    }
  }
  // The harness's independent session record is COPIED into the run directory. Leaving it
  // in the disposable DSH home would make the evidence path point at a directory that is
  // wiped between waves -- a citation that resolves today and 404s tomorrow is not
  // evidence.
  let sessionRel: string | null = null;
  if (sessionPath) {
    const dest = path.join(runDir, "session.v4.jsonl.zstd");
    cpSync(sessionPath, dest);
    sessionRel = "session.v4.jsonl.zstd";
  }
  const files: Record<string, string> = {
    [path.basename(measured.tracePath)]: sha256(traceText),
    "submission.patch": sha256(diff.stdout),
  };
  if (sessionRel)
    files["session.v4.jsonl.zstd"] = sha256(
      readFileSync(path.join(runDir, sessionRel)),
    );
  // PUBLISH GUARD. The trace is written by a process that had the operator's DSH home on
  // DSH_HOME, so it can contain a credential a tool result echoed. If it does, this run
  // REFUSES to publish -- it is not sanitised, because an edited trace is no longer the
  // trace of what happened. Path normalisation is separate and recorded.
  const scrubbed = scrubFile(measured.tracePath, {
    workspace: workDir,
    write: false,
  });
  if (!scrubbed.ok) {
    finish(
      "invalid",
      `secret: evidence contains ${scrubbed.findings
        .map((f) => `${f.kind} at ${f.where}`)
        .join("; ")
        .slice(0, 300)}; refusing to publish a trace with a credential`,
    );
    return;
  }
  if (scrubbed.normalised.length > 0) {
    writeFileSync(measured.tracePath, scrubbed.text);
  }
  const finalTrace = readFileSync(measured.tracePath, "utf8");
  record.evidence = {
    trace_path: path.relative(runDir, measured.tracePath),
    session_path: sessionRel,
    trace_lines: finalTrace.split("\n").filter((l) => l.trim()).length,
    trace_sha256: sha256(finalTrace),
    session_sha256: sessionRel
      ? sha256(readFileSync(path.join(runDir, sessionRel)))
      : null,
    scrubbed: true,
    scrape_findings: scrubbed.normalised.map(
      (n) => `normalised ${n.from} -> ${n.to}`,
    ),
  };
  writeFileSync(
    path.join(runDir, "checksums.txt"),
    Object.entries(files)
      .map(([f, h]) => `${h}  ${f}`)
      .join("\n") + "\n",
  );

  finish("valid", null);
  if (!a.keepWork) rmSync(workDir, { recursive: true, force: true });
  console.log(
    `valid: ${runId}  status=valid tokens_in=${cost.tokens_in} tools=${cost.tool_calls} changed=${filesChanged.size}`,
  );
}

main().catch((e: unknown) => {
  console.error(`run-arm: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
