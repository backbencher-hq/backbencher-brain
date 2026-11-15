#!/usr/bin/env bun
/**
 * SWIFT renders WHOLE-POPULATION COUNT (lane instrument, 2026-10-23).
 *
 * The R3 renders emission landed (extractRenderRelationships in
 * real-swift-analyzer.ts); this measures its edges over the WHOLE admitted
 * population on the PRODUCTION parse path (parseFile from pool-worker —
 * the same path the residual gate and the production index walk), so the
 * spec's `_implemented_measured` count is a measured number, not the census
 * site count.
 *
 * Population rule: identical to the census (git-tracked .swift per repo,
 * 1 MiB cap). Full-form string: parsed=N/N admitted=N exts=swift index=no.
 */
import { parseFile } from "../../../../src/ast/pool-worker";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../../..");
const REPOS = ["flutter-packages","swift-nio","ghostty","proxicall","alamofire","duckdb","dart-http","sdwebimage","afnetworking","riverpod","nvim-treesitter","pb-grpc","tree-sitter-clean","nlohmann-json"];

const files: string[] = [];
let trackedTotal = 0, overCap = 0, absent = 0;
for (const r of REPOS) {
  const real = fs.realpathSync(`${ROOT}/.corpus/${r}`);
  let list: string[] = [];
  try { list = execSync(`git ls-files '*.swift'`, { cwd: real, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean); }
  catch { continue; }
  for (const f of list) {
    trackedTotal++;
    const p = `${real}/${f}`;
    let st: fs.Stats; try { st = fs.statSync(p); } catch { absent++; continue; }
    if (st.size > 1048576) { overCap++; continue; }
    files.push(p);
  }
}

let parsedOk = 0, parseFail = 0;
let rendersEdges = 0;
const rendersByFile = new Map<string, number>();
const rendersTargets = new Map<string, number>();
const hostFiles = new Set<string>();

for (const f of files) {
  let r: any;
  try { r = await parseFile(f, path.dirname(f), { projectRoot: path.dirname(f) }); }
  catch { parseFail++; continue; }
  if (!r) { parseFail++; continue; }
  parsedOk++;
  const rels = r.relationships ?? [];
  let n = 0;
  for (const rel of rels) {
    if (rel.type === "renders") {
      n++;
      rendersTargets.set(rel.target, (rendersTargets.get(rel.target) ?? 0) + 1);
    }
  }
  if (n > 0) { rendersEdges += n; rendersByFile.set(f, n); hostFiles.add(f); }
}

console.log(`POPULATION: parsed=${parsedOk}/${files.length} admitted=${files.length} exts=swift index=no (git-tracked ${trackedTotal} · over-cap ${overCap} · absent ${absent} · repos ${REPOS.length})`);
console.log(`parse failures: ${parseFail}`);
console.log();
console.log(`renders EDGES (production path): ${rendersEdges}`);
console.log(`files carrying renders: ${hostFiles.size}`);
console.log(`top targets: ${JSON.stringify([...rendersTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))}`);
console.log();
console.log("sample files:");
for (const [f, n] of [...rendersByFile.entries()].slice(0, 8)) console.log(`  ${f.replace(/^.*repositories\//, "")}: ${n}`);
