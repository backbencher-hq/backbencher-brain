#!/usr/bin/env node
// script/bench/check-golden.ts — assert that a task's OWN reference fix scores 1.0.
//
// THE GATE THAT WAS MISSING. A task whose golden patch cannot pass is not a task, and nothing
// checked it. This shipped once: p-queue 48586f4 scored 0 for all five arms because the fix
// also rewrites its own test to expect the new behaviour, while the grader graded against the
// BASE test that still demanded the old one. Five arms failing identically reads exactly like
// five agents being bad at the task -- it took a manual bisect to find, and it would have
// invalidated a whole wave's results.
//
// This runs the reference patch through the real grader, in the real tree, with no agent
// involved. It is the cheapest possible check and it makes that class of defect impossible.
//
// USAGE
//   check-golden.ts <task.json> <project.json>
// Exit 0 when the golden scores 1.0; 1 otherwise (with the reason printed).

import {
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeRun } from "./grade.ts";
import { materializeTask } from "./lib/materialize.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

interface TaskDef {
  id: string;
  project?: string;
  origin: { base_revision: string; fix_revision: string };
  golden: { files: string[]; patch: string; tests_patch?: string | null };
  grade: { must_pass: string[]; must_not_break: string[] };
}

async function main(): Promise<void> {
  const taskPath = path.resolve(process.argv[2] ?? "");
  const projectPath = path.resolve(process.argv[3] ?? "");
  if (!existsSync(taskPath) || !existsSync(projectPath)) {
    console.error(
      "check-golden: usage: check-golden.ts <task.json> <project.json>",
    );
    process.exit(2);
  }
  const task = JSON.parse(readFileSync(taskPath, "utf8")) as TaskDef;
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as {
    id: string;
    remote?: string;
    revision?: string;
    source?: string;
    test: string[];
  };

  // A fixture task is checked against its committed source tree; a pinned task is materialised
  // from the clone at the task's BASE revision, exactly as a run would.
  const work = path.join(
    REPO_ROOT,
    "benchmarks",
    ".work",
    "check-golden",
    task.id,
  );
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const runDir = path.join(work, "run");
  const pristine = path.join(runDir, "pristine");
  mkdirSync(pristine, { recursive: true });

  if (project.source) {
    const src = path.isAbsolute(project.source)
      ? project.source
      : path.resolve(REPO_ROOT, project.source);
    const { cpSync } = await import("node:fs");
    cpSync(src, pristine, {
      recursive: true,
      filter: (s) =>
        !s.includes(`${path.sep}node_modules`) &&
        !s.includes(`${path.sep}.git`),
    });
  } else {
    materializeTask({
      cacheDir: path.join(REPO_ROOT, "benchmarks", ".work", "cache"),
      project: {
        id: project.id,
        remote: project.remote ?? "",
        revision: project.revision ?? "",
      } as never,
      task: { origin: task.origin, golden: task.golden } as never,
      testFiles: [],
      dest: pristine,
    });
  }

  // Build the submission patch = the golden SOURCE patch, expressed in the submission format
  // (pristine/ -> .submission-tree/) so the real grader parses it unmodified.
  // golden.* paths are PROJECT-relative (they read "golden/<id>.patch"), so they resolve
  // from the project root, not from the task file. Verified against the emitted task files.
  const goldenAbs = path.join(path.dirname(projectPath), task.golden.patch);
  const goldenText = readFileSync(goldenAbs, "utf8");
  const submission = goldenText
    .replace(
      /^diff --git a\/(.+?) b\/(.+)$/gm,
      "diff --git a/pristine/$1 b/.submission-tree/$2",
    )
    .replace(/^--- a\/(.+)$/gm, "--- a/pristine/$1")
    .replace(/^\+\+\+ b\/(.+)$/gm, "+++ b/.submission-tree/$1");
  writeFileSync(path.join(runDir, "submission.patch"), submission);

  // RETRY ONCE, because a golden failure has TWO possible meanings and they must not be
  // conflated. Some of these suites contain tests that are sensitive to machine load
  // ("intervalCap should be respected with high concurrency" fails when anchors are running
  // concurrently). A single failure is therefore ambiguous between "this task is broken" and
  // "the box was busy". One retry disambiguates: a genuinely broken task fails both times,
  // a load flake passes the second. The attempt count is reported so a reader can see it.
  let g = gradeRun(runDir, taskPath, projectPath);
  const firstReason = g.reason;
  let attempts = 1;
  if (!(g.score === 1 && g.success)) {
    attempts = 2;
    g = gradeRun(runDir, taskPath, projectPath);
  }
  rmSync(work, { recursive: true, force: true });
  if (g.score === 1 && g.success) {
    console.log(
      attempts === 1
        ? `PASS ${task.id}`
        : `PASS ${task.id} (attempt 2; first run failed: ${firstReason.slice(0, 80)})`,
    );
    process.exit(0);
  }
  console.log(`FAIL ${task.id} score=${g.score} reason=${g.reason}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(`check-golden: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
});
