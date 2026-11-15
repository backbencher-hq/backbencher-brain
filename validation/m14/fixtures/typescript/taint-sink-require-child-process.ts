// The taint sink rule's evidence that a BARE exec is Node's own comes from the
// file importing child_process. For a long time that evidence was only read off
// an `import_statement` (or an `import ... = require(...)` clause), so the
// CommonJS spelling of the SAME fact was invisible:
//
//   const { execSync } = require("child_process")
//
// which is what most of this repository actually uses. A bare `execSync` in
// such a file produced no sink at all, so no flow could ever be traced into it.
// Measured on the tracked corpus before the fix: 24 files and 27 sink records
// missing, with 0 records wrongly present — every one of them a bare exec-family
// call in a file that genuinely requires child_process. The twin fixture
// `taint-sink-require-not-loader` pins the exclusion that must not widen
// alongside this.
//
// Authored BEFORE the analyzer run.
const { execFileSync } = require("child_process");

// The CommonJS form, which used to be a guaranteed miss.
export function headSha(root: string): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
}
