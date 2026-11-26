#!/usr/bin/env node
// script/bench/run-wave.ts — run one wave: every task x every arm, grading and verifying.
//
// WHY THIS EXISTS AS A SCRIPT. Running a wave by hand means five commands per cell and a
// per-cell chance of forgetting to grade or verify. The failure mode is silent: a run that
// was never graded looks identical to a run that scored zero, and a record that was never
// verified looks identical to one that is consistent. This makes the sequence mandatory.
//
// CONCURRENCY. `--jobs N` runs N (task, arm) cells at once. DESIGN.md 12.1: compute fans
// out, the instrument converges -- each cell is independent (own workspace, own DSH home,
// own bb index), so they can share the machine. Index builds are the memory peak (measured
// ~278 MB with the local embedder), so the cap defaults to 4 on a 15 GB box rather than to
// the core count: swap pressure was what hung this machine once already.
//
// USAGE
//   run-wave.ts --tasks <glob-dir-or-file> --arms A,B,C,D,E --wave W1 [--jobs 4] [--reps 1]
//               [--project <project.json>] [--embedding-arm C0] [--dry]

import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");
const TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

interface Args {
  tasks: string[];
  arms: string[];
  wave: string;
  jobs: number;
  reps: number;
  project: string | null;
  embeddingArm: string;
  dry: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string | null = null): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
  };
  const taskArg = get("tasks");
  if (!taskArg) throw new Error("run-wave: --tasks is required");
  const resolved = path.resolve(REPO_ROOT, taskArg);
  // A FILE is one task; a DIRECTORY is every *.json inside it. This must STAT the path:
  // an earlier version ran `readdirSync` on whatever was given, so `--tasks .../t1.json`
  // threw ENOTDIR -- the single-task case, i.e. the most common way to smoke-test a wave.
  if (!existsSync(resolved))
    throw new Error(`run-wave: --tasks path does not exist: ${resolved}`);
  const isDir = statSync(resolved).isDirectory();
  const tasks = isDir
    ? readdirSync(resolved)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.join(resolved, f))
        .sort()
    : [resolved];
  if (tasks.length === 0)
    throw new Error(`run-wave: no task files under ${resolved}`);
  return {
    tasks,
    arms: (get("arms", "A,B,C,D,E") as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    wave: get("wave", "W1") as string,
    jobs: Number(get("jobs", "4")),
    reps: Number(get("reps", "1")),
    project: get("project"),
    embeddingArm: get("embedding-arm", "C0") as string,
    dry: argv.includes("--dry"),
  };
}

/** Run one child, buffering output. Resolves with the exit code; never rejects. */
function run(
  cmd: string,
  args: string[],
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: REPO_ROOT, env: process.env });
    let out = "";
    child.stdout.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.stderr.on("data", (b: Buffer) => {
      out += b.toString();
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", (e) => resolve({ code: 1, out: String(e) }));
  });
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  const waveRoot = path.join(REPO_ROOT, "benchmarks", ".work", a.wave);

  // The project file is needed for grading. A directory of tasks implies its sibling
  // project.json; a bare task file needs --project.
  const projectPath = a.project
    ? path.resolve(REPO_ROOT, a.project)
    : path.join(path.dirname(path.dirname(a.tasks[0])), "project.json");
  if (!existsSync(projectPath)) {
    console.error(
      `run-wave: no project.json at ${path.relative(REPO_ROOT, projectPath)}; pass --project`,
    );
    process.exit(2);
  }
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as {
    id?: string;
  };
  const fixture = a.tasks[0].includes(`${path.sep}fixtures${path.sep}`);

  const cells: { task: string; arm: string; rep: number }[] = [];
  for (const task of a.tasks)
    for (const arm of a.arms)
      for (let r = 1; r <= a.reps; r++) cells.push({ task, arm, rep: r });

  console.log(
    `run-wave: ${a.tasks.length} task(s) x ${a.arms.length} arm(s) x ${a.reps} rep(s) = ${cells.length} cell(s), jobs=${a.jobs}`,
  );
  console.log(
    `  wave=${a.wave} project=${project.id ?? "?"} embedding=${a.embeddingArm}${fixture ? " (fixture)" : ""}`,
  );
  if (a.dry) {
    for (const c of cells)
      console.log(
        `  would run ${path.basename(c.task)} arm=${c.arm} rep=${c.rep}`,
      );
    return;
  }

  let done = 0;
  let failed = 0;
  let skipped = 0;
  const skippedReasons: string[] = [];
  const queue = [...cells];
  const failures: string[] = [];

  const worker = async (): Promise<void> => {
    for (;;) {
      const cell = queue.shift();
      if (!cell) return;
      const label = `${path.basename(cell.task, ".json")} arm=${cell.arm}`;
      const runArgs = [
        path.join(HERE, "run-arm.ts"),
        "--task",
        cell.task,
        "--arm",
        cell.arm,
        "--embedding-arm",
        a.embeddingArm,
        "--wave",
        a.wave,
        "--rep",
        String(cell.rep),
      ];
      if (fixture) runArgs.push("--fixture");
      const r = await run(TSX, runArgs);
      if (r.code !== 0) {
        failed++;
        failures.push(`${label}: run-arm exited ${r.code}`);
        console.error(
          `  FAIL ${label}: ${r.out.split("\n").slice(-2).join(" ").slice(0, 200)}`,
        );
        done++;
        continue;
      }
      // Derive the run id the runner used, then grade and verify it. A cell that is not
      // graded is not a result, so grading failure fails the cell.
      const line = r.out
        .split("\n")
        .find(
          (l) =>
            l.startsWith("valid:") ||
            l.startsWith("invalid:") ||
            l.startsWith("infra_error:"),
        );
      if (!line) {
        failed++;
        failures.push(
          `${label}: no status line (the runner produced no verdict, so it died)`,
        );
        done++;
        continue;
      }
      const runId = line.split(/\s+/)[1];
      // AN INVALID RUN IS A RESULT OF THE WAVE, NOT A FAILURE OF IT.
      //
      // The first real wave counted 13 correctly-invalidated runs as harness failures: two
      // fetched the upstream fix commit with curl (contamination), three crashed, three found
      // the bb server unmounted. Every one is the instrument WORKING. Counting them as
      // failures would pressure a future run into relaxing the invalidity gates, which is the
      // opposite of what they exist for. Counted, named, and skipped for grading.
      if (!line.startsWith("valid:")) {
        skipped++;
        skippedReasons.push(
          `${label}: ${line.replace(/^\S+:\s*/, "").slice(0, 150)}`,
        );
        done++;
        console.log(`  skip ${label} -> ${runId} [${done}/${cells.length}]`);
        continue;
      }
      const runDir = path.join(waveRoot, "runs", runId);
      const g = await run(TSX, [
        path.join(HERE, "grade.ts"),
        runDir,
        cell.task,
        projectPath,
      ]);
      if (g.code !== 0) {
        failed++;
        failures.push(`${label}: grade exited ${g.code}`);
        console.error(
          `  FAIL grade ${label}: ${g.out.split("\n").slice(-2).join(" ").slice(0, 200)}`,
        );
      }
      const v = await run(TSX, [path.join(HERE, "verify-record.ts"), runDir]);
      if (v.code !== 0) {
        failed++;
        failures.push(`${label}: verify-record failed`);
        console.error(
          `  FAIL verify ${label}: ${v.out
            .split("\n")
            .filter((l) => l.includes("error"))
            .slice(0, 2)
            .join(" ")}`,
        );
      }
      done++;
      const status = line.startsWith("valid:") ? "ok  " : "skip";
      const score = /score=(\d+)/.exec(g.out)?.[1] ?? "?";
      console.log(
        `  ${status} ${label} -> ${runId} score=${score} [${done}/${cells.length}]`,
      );
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(a.jobs, cells.length)) }, () =>
      worker(),
    ),
  );

  console.log(
    `\nrun-wave: ${done} cell(s), ${failed} failure(s), ${skipped} correctly invalidated`,
  );
  if (skippedReasons.length > 0) {
    console.log("invalidated (excluded from results, each with its reason):");
    for (const s of skippedReasons) console.log(`  - ${s}`);
  }
  if (failures.length > 0) {
    console.error("failures:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }

  // The wave-level gate: every record must be consistent before a report may exist.
  const v = await run(TSX, [
    path.join(HERE, "verify-record.ts"),
    "--wave",
    waveRoot,
  ]);
  process.stdout.write(v.out);
  const rep = await run(TSX, [
    path.join(HERE, "report.ts"),
    waveRoot,
    path.join(waveRoot, "report"),
    path.join(REPO_ROOT, "benchmarks", "manifest.json"),
  ]);
  process.stdout.write(rep.out);
  if (v.code !== 0 || rep.code !== 0) process.exit(1);
}

main().catch((e) => {
  console.error(`run-wave: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
