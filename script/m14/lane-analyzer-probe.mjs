// script/m14/lane-analyzer-probe.mjs — the cross-lane census instrument.
//
// WHY THIS EXISTS. `script/m14/run-fixtures.ts` answers "does this lane pass its
// fixtures?" It cannot answer "does ANY branch in this repository hold the analyzer
// that would make them pass?" — the question that decides whether a lane's failing
// fixtures are parked work or work that never landed. This probe answers it with the
// real harness, in one process:
//
//   base  = runLang(lane)               -> this tree's analyzer, runner and fixtures
//   probe = runLang(lane, BranchCtor)   -> the same runner and fixtures, the branch's analyzer
//
// Both runs share the comparison logic, the parser and the fixture set, so the only
// variable is the analyzer. Measured with it: no probed lane's newest-unmerged-analyzer
// ref fixes its failures (see docs/LOST-ANALYZER-CENSUS.md).
//
// USAGE. The branch analyzer must be materialised first — a worktree, because a copied
// file would import THIS tree's helper modules instead of the branch's:
//
//   git worktree add --detach /tmp/wt/<name> <ref>
//   ln -s "$PWD/node_modules" /tmp/wt/<name>/node_modules
//   bun run script/m14/lane-analyzer-probe.mjs <lane>=/tmp/wt/<name> [lane2=/tmp/wt/<name2> ...]
//
// CONFOUNDS, stated rather than hidden: the branch analyzer imports the branch tree's
// `./engine` and helpers, so two engines are live in the process; and one ref at a time
// is what is on the command line — this is a census of the refs you name, not of all refs.

//   probe = runLang(lane, BranchCtor)  -> the SAME runner and fixtures, branch worktree's analyzer
//
// Both runs happen in one process, so the comparison logic, the parser cache and the
// fixture set are identical by construction. The only thing that changes is the analyzer.
//
// Usage: bun /tmp/bb-lane-probe.mjs lane=worktreeDir [lane=worktreeDir ...]
// e.g.:  bun /tmp/bb-lane-probe.mjs elixir=/tmp/opencode/wt/ELIXIR_FIX3
import { pathToFileURL } from "node:url";

const REPO = "$HOME/backbencher-brain";
const { runLang, getParser } = await import(`${REPO}/script/m14/run-fixtures.ts`);

const spec = process.argv.slice(2);
if (!spec.length) {
  console.error("usage: bun /tmp/bb-lane-probe.mjs <lane>=<worktreeDir> ...");
  process.exit(2);
}

const out = [];
for (const s of spec) {
  const i = s.indexOf("=");
  const lane = s.slice(0, i);
  const wt = s.slice(i + 1);

  // load the branch's analyzer exactly as the real runner would (its own tree)
  const { LANGS } = await import(`${REPO}/script/m14/run-fixtures.ts`);
  const cfg = LANGS[lane];
  if (!cfg) { console.log(`${lane}: UNKNOWN LANE`); continue; }
  let mod;
  try {
    mod = await import(pathToFileURL(`${wt}/src/ast/${cfg.analyzerFile}.ts`).href);
  } catch (e) {
    console.log(`${lane}\tIMPORT FAILED\t${String(e).split("\n")[0]}`);
    continue;
  }
  const Ctor = mod[cfg.className];
  if (!Ctor) { console.log(`${lane}\tCLASS ${cfg.className} MISSING\t-`); continue; }

  const base = await runLang(lane);          // HEAD analyzer
  const inst = new Ctor();
  // the same grammar handoff the non-override path performs (static, on the ctor)
  try {
    const p = await getParser(lane);
    if (typeof Ctor.setGrammar === "function") Ctor.setGrammar(p.language, p.constructor);
  } catch { /* analyzer keeps its main pass only, same contract as the engine path */ }
  const probe = await runLang(lane, inst);

  const b = new Map(base.details.map((d) => [d.fixture, d.ok]));
  const p = new Map(probe.details.map((d) => [d.fixture, d.ok]));
  const fixed = [...b.keys()].filter((k) => b.get(k) === false && p.get(k) === true);
  const broken = [...b.keys()].filter((k) => b.get(k) === true && p.get(k) === false);
  const stillFail = [...b.keys()].filter((k) => b.get(k) === false && p.get(k) !== true);
  const missing = [...p.keys()].filter((k) => !b.has(k));
  // WHY a fixture broke: the runner's own problem strings, so "label moved" is
  // distinguishable from "edge lost" without re-reading either analyzer.
  if (process.argv.includes("--why")) {
    const probs = new Map(probe.details.map((d) => [d.fixture, d.problems ?? (d.reason ? [d.reason] : [])]));
    for (const k of [...broken, ...stillFail]) {
      const list = probs.get(k) ?? [];
      console.log(`    why ${k}:`);
      for (const s of list.slice(0, 4)) console.log(`       - ${s}`);
    }
  }

  out.push({ lane, wt, base: base.fail, probe: probe.fail, fixed, broken, stillFail, missing });
  console.log(`\n### ${lane}  (branch analyzer: ${wt})`);
  console.log(`    HEAD: ${base.pass} pass / ${base.fail} fail     BRANCH: ${probe.pass} pass / ${probe.fail} fail`);
  console.log(`    FIXED BY BRANCH (${fixed.length}): ${fixed.join(", ") || "-"}`);
  if (broken.length) console.log(`    BROKEN BY BRANCH (${broken.length}): ${broken.join(", ")}`);
  console.log(`    still failing under branch (${stillFail.length}): ${stillFail.join(", ") || "-"}`);
  if (missing.length) console.log(`    only in branch's run (${missing.length}): ${missing.slice(0, 8).join(", ")}`);
}
import { readFileSync, writeFileSync } from "node:fs";
let acc = [];
try { acc = JSON.parse(readFileSync("/tmp/bb-lane-probe.json", "utf8")); } catch {}
const byLane = new Map(acc.map((r) => [r.lane, r]));
for (const r of out) byLane.set(r.lane, r);
writeFileSync("/tmp/bb-lane-probe.json", JSON.stringify([...byLane.values()], null, 1));
console.log("\nwrote /tmp/bb-lane-probe.json (" + byLane.size + " lanes accumulated)");
