/**
 * Where this lane's probes live and what they read.
 *
 * The same rule `graphql/paths.mts` states, and for the same reason: a probe
 * lives in a TRACKED location so the next reader can re-run it, and the lane
 * directory and repository root are derived from this file's own location so a
 * clone has its probes, its ground truth and its artifacts. `BB_ROOT` overrides
 * the root because a second clone on this machine must work without editing
 * twenty files.
 *
 * The third-party corpora are deliberately NOT tracked — they are cloned
 * protobuf-dominant repositories totalling well over a gigabyte — so they are
 * the one input a reader must fetch. Every probe that reads them records the
 * revision it used, and `corpus-manifest.json` pins each one, so a missing
 * corpus is a fetch instruction rather than a mystery.
 */
import { createHash } from "crypto"
import { execFileSync } from "child_process"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

/** This lane's directory: `script/m14/tmp/protobuf`. */
export const PB = path.resolve(path.dirname(fileURLToPath(import.meta.url)))

/** Alias, for probes written before this module settled on one name. */
export const HERE = PB

/** The repository root: `<repo>/script/m14/tmp/protobuf` walked up four levels. */
export const ROOT = process.env.BB_ROOT
  ? path.resolve(process.env.BB_ROOT)
  : path.resolve(PB, "..", "..", "..", "..")

/** Generated artifacts, written under the external workspace to keep the repo clean. */
export const OUT = process.env.PB_OUT ?? "<corpus-root>/bb_tests/protobuf/out"

/** The hand-derived differential truth: the input, not an output. */
export const GROUND_TRUTH = path.join(PB, "fixtures", "ground-truth.json")

/** The pinned corpus manifest. Checked in; the corpora it names are not. */
export const MANIFEST = path.join(PB, "corpus-manifest.json")

/**
 * The third-party corpora. Not tracked; see the note above.
 * `PB_CORPORA` overrides the root so a reader can stage them anywhere.
 */
export const CORPORA = process.env.PB_CORPORA ?? "<corpus-root>/bb_tests/protobuf/repos"

/** The wired grammar under test. */
export const WASM = process.env.PB_WASM ?? path.join(ROOT, "wasm/tree-sitter-protobuf.wasm")

/**
 * The grammar this one REPLACED — upstream `amaanq/tree-sitter-proto` as
 * published, before any of the eight patches.
 *
 * It lives in THIS lane's workspace, and that is a correction. The baseline used
 * to sit at `bb_tests/graphql/baseline/tree-sitter-proto-UPSTREAM.wasm` — another
 * lane's directory, in a workspace that is not a repository and is not anyone's to
 * keep. That directory was deleted, taking the A/B's entire comparison basis with
 * it, and two of this lane's gates stopped being able to run at all.
 *
 * The recovery is the useful part: the baseline is not a binary to be preserved,
 * it is REPRODUCIBLE from the pinned revision. `ensureBaseline()` below re-clones
 * `amaanq/tree-sitter-proto` at `.upstream-revision`, adds the ABI-15
 * `tree-sitter.json` that upstream lacks (without it the CLI drops to ABI 14 and
 * `tree-sitter build --wasm` refuses outright), builds, and then checks the
 * result against the sha the pin has recorded. The rebuild matched
 * `dbbde8a8f047b6b6…` / 72,342 B to the byte, so nothing was lost — the artifact
 * was derived state all along and had been filed next to the other pre-patch
 * grammars purely by coincidence.
 */
export const PREVIOUS_WASM =
  process.env.PB_PREVIOUS_WASM ??
  path.join(process.env.PB_OUT ?? "<corpus-root>/bb_tests/protobuf/out", "..", "baseline", "tree-sitter-proto-UPSTREAM.wasm")

/** The sha the pin recorded for the pre-patch build. Verified on every rebuild. */
export const PREVIOUS_WASM_SHA = "dbbde8a8f047b6b661c113fb61fdb0d5aceff3956e11b7d5f58ac22ff02a473f"

/** The upstream revision, read from the vendored grammar rather than restated. */
export const UPSTREAM_REVISION = (): string =>
  fs.readFileSync(path.join(ROOT, "grammars/tree-sitter-proto/.upstream-revision"), "utf8").trim()

/**
 * Guarantee the pre-patch baseline exists, rebuilding it from the pinned revision
 * when it does not, and refusing to proceed if the bytes are not the ones the pin
 * recorded.
 *
 * The sha check is the whole point. A rebuild that produced DIFFERENT bytes would
 * still be a wasm, would still parse, and would still let the A/B run — against
 * the wrong comparison basis, silently. So the sha is verified and a mismatch is
 * a hard failure rather than a warning.
 */
export function ensureBaseline(): string {
  if (fs.existsSync(PREVIOUS_WASM)) {
    const h = createHash("sha256").update(fs.readFileSync(PREVIOUS_WASM)).digest("hex")
    if (h === PREVIOUS_WASM_SHA) return PREVIOUS_WASM
    throw new Error(
      `${PREVIOUS_WASM} exists but hashes ${h.slice(0, 16)}, not the recorded ${PREVIOUS_WASM_SHA.slice(0, 16)}. ` +
        `Refusing to A/B against bytes the pin does not vouch for.`,
    )
  }
  const rev = UPSTREAM_REVISION()
  const tmp = fs.mkdtempSync("/tmp/pb-baseline-")
  const checkout = path.join(tmp, "proto")
  const run = (cmd: string, args: string[], cwd?: string) =>
    execFileSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
  run("git", ["clone", "-q", "https://github.com/amaanq/tree-sitter-proto", checkout])
  run("git", ["checkout", "-q", rev], checkout)
  // Upstream has no tree-sitter.json, so the CLI drops to ABI 14 and
  // `tree-sitter build --wasm` refuses. Adding the marker is what makes the
  // pinned revision buildable at all.
  fs.copyFileSync(path.join(ROOT, "grammars/tree-sitter-proto/tree-sitter.json"), path.join(checkout, "tree-sitter.json"))
  // The CLI is not in this repository's node_modules — it is installed in the
  // external workspace. Both locations are tried, then PATH, because a lane that
  // hardcodes one of them breaks when the other moves, and a rebuild that cannot
  // find its own compiler is a very confusing failure to read.
  const cli = [
    path.join(ROOT, "node_modules/.bin/tree-sitter"),
    path.join("<corpus-root>/bb_tests/node_modules/.bin/tree-sitter"),
  ].find((c) => fs.existsSync(c)) ?? "tree-sitter"
  run(cli, ["generate"], checkout)
  const out = path.join(tmp, "tree-sitter-proto-UPSTREAM.wasm")
  run(cli, ["build", "--wasm", "-o", out], checkout)
  const h = createHash("sha256").update(fs.readFileSync(out)).digest("hex")
  if (h !== PREVIOUS_WASM_SHA) {
    throw new Error(
      `Rebuilt the pre-patch grammar at ${rev} and got sha ${h.slice(0, 16)}, not the recorded ` +
        `${PREVIOUS_WASM_SHA.slice(0, 16)}. The pin records different bytes, so the baseline is NOT ` +
        `reproducible and the A/B cannot be trusted.`,
    )
  }
  fs.mkdirSync(path.dirname(PREVIOUS_WASM), { recursive: true })
  fs.copyFileSync(out, PREVIOUS_WASM)
  return PREVIOUS_WASM
}
