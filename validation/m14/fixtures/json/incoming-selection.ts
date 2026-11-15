/**
 * DETERMINISTIC FILE SELECTION for the incoming half of the JSON lane.
 *
 * `script/m14/incoming-check.ts` takes files as positional arguments, so the
 * measurement is only reproducible if the SELECTION is reproducible too. This
 * file is that selection, written down: sorted by (repo, relative path), no
 * randomness, no dependence on directory-read order.
 *
 * Method, stated so a reader can falsify it:
 *   1. list the immediate children of CORPUS_ROOT (one entry per repository);
 *   2. within each repository, walk for `*.json` / `*.jsonc` / `*.json5`,
 *      skipping build and VCS directories by SEGMENT (never by substring, which
 *      would drop a repo whose name contains "out");
 *   3. sort each repository's files by relative path, lexicographically;
 *   4. take up to PER_REPO files from each repository by STRIDE — index
 *      floor(i * n / PER_REPO) — so the sample spreads across the repository
 *      instead of clustering in its first alphabetically-sorted directory
 *      (which for most repos is a fixture or changelog dump);
 *   5. drop any path containing a space, because the documented invocation
 *      passes them through the shell and a space splits one path into two
 *      arguments, which throws inside parseFile and silently contributes zero
 *      symbols. The dropped count is printed so it is a number and not a
 *      disappearance.
 *
 * The result is written as one path per line to the file named by argv[2], and
 * is meant to be consumed by `xargs -a <file> -d '\n'` — the `-d '\n'` matters,
 * and is the whole reason this filter exists.
 *
 * Regex-free, per the lane's no-regex rule: every predicate below is a string
 * comparison or a path-segment test.
 *
 *   npx tsx validation/m14/fixtures/json/incoming-selection.ts /tmp/json-incoming-files.txt
 *   xargs -a /tmp/json-incoming-files.txt -d '\n' \
 *     npx tsx script/m14/incoming-check.ts json
 */

import fs from "node:fs";
import { admittedFiles, describeWalk, stridePerRepo } from "./admitted-files";

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories";
// Overridable so a before/after pair can be pinned to ONE file list. The stride is a
// sampling choice, and a comparison across two different strides measures the stride.
const PER_REPO = Number(process.env.BB_PER_REPO ?? 3);

const outFile = process.argv[2] ?? "/tmp/json-incoming-files.txt";

/**
 * The population is now the census's, imported from `admitted-files.ts`, rather than a
 * filesystem walk re-derived here.
 *
 * The walk this replaced had two defects, both measured, and both invisible in its own
 * output:
 *
 *   - it filtered repository entries with `Dirent.isDirectory()`, which is FALSE for a
 *     symlink, so it never sampled `proxicall` — a real repository in this corpus,
 *     reached through a symlink, with 114 tracked json files. The walk printed
 *     "repositories: 198" against a corpus holding 199, and nobody could tell that 198
 *     was wrong;
 *   - it walked the filesystem, so it admitted **781** json files from `proxicall` where
 *     `git ls-files` sees **114** — 450 of them under `.dart_tool`, a build directory.
 *     The count therefore moved every time somebody ran a build, which is what made this
 *     lane's admitted-file total disagree with the census's by 67.
 *
 * Both are gone because the rules are now stated once. What remains different from the
 * census is `PER_REPO` and the stride, which is a SAMPLING choice and is declared here
 * rather than being a silent second denominator.
 */
const walk = admittedFiles(CORPUS_ROOT);
const { selected: picked, droppedForSpace } = stridePerRepo(walk.files, PER_REPO);

const selected = picked.map((f) => f.abs);
selected.sort();
fs.writeFileSync(outFile, selected.length === 0 ? "" : `${selected.join("\n")}\n`);

console.log(describeWalk(walk, CORPUS_ROOT));
console.log(`per-repo stride    : ${PER_REPO}`);
console.log(`dropped for space  : ${droppedForSpace}`);
console.log(`selected           : ${selected.length}`);
console.log(`written            : ${outFile}`);
