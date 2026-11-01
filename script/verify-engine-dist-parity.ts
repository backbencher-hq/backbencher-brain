// script/verify-engine-dist-parity.ts — does the shipped binary still share the source's facts?
//
// The review asked one question about engine.ts that no gate answered: is what bb SHIPS (bin/bb → dist/, the
// compiled bundle) still the same product the source path runs, and are the pinned grammar bytes actually the
// tracked files? This gate answers the three parts that are checkable without launching a build:
//
//   1. GRAMMAR PINS: every digest in engine.ts's PATCHED_GRAMMAR_SHA256 table must equal the SHA-256 of the
//      file in wasm/. A pin that drifts silently routes that language to a different grammar than the one the
//      lane verified — the exact class the pin exists to prevent.
//   2. TRACKED BYTES: the matlab/vba grammars were once untracked (a fresh clone had no grammar for two of
//      the 50 lanes); the pinned files must be tracked by git.
//   3. VERSION PARITY: the source entry and the compiled launcher must report the same version. bin/bb runs
//      dist/, so if these disagree, one of the two paths is stale.
//
// It also WARNS (never fails) when dist/ predates the newest tracked src file: in a development checkout that
// is expected until `npm run build`; the warning states the measured timestamps so nobody mistakes the
// compiled path for current source behaviour. Rebuilding is the release pipeline's job, not this gate's.
//
// Run: npx tsx script/verify-engine-dist-parity.ts
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..")
let checks = 0
let failed = 0
const warnings: string[] = []
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function sha256File(p: string): string | null {
  try {
    return createHash("sha256").update(readFileSync(p)).digest("hex")
  } catch {
    return null
  }
}
function run(cmd: string, args: string[], cwd = ROOT): { status: number | null; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 120_000 })
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() }
}

// ── 1. grammar pins vs the tracked wasm bytes ──────────────────────────────────────────────────────
const engineText = readFileSync(path.join(ROOT, "src/ast/engine.ts"), "utf8")
const tableAt = engineText.indexOf("PATCHED_GRAMMAR_SHA256")
const tableEnd = engineText.indexOf("\n  }", tableAt)
check("engine.ts declares the patched-grammar table", tableAt >= 0 && tableEnd > tableAt)
const table = tableAt >= 0 && tableEnd > tableAt ? engineText.slice(tableAt, tableEnd) : ""
const PINNED = ["tree-sitter-typescript.wasm", "tree-sitter-make.wasm", "tree-sitter-matlab.wasm", "tree-sitter-vba.wasm"]
for (const name of PINNED) {
  const key = `"${name}": "`
  const at = table.indexOf(key)
  if (at < 0) {
    check(`engine.ts pins ${name}`, false, "no entry")
    continue
  }
  const digest = table.slice(at + key.length, at + key.length + 64)
  const actual = sha256File(path.join(ROOT, "wasm", name))
  check(`${name} pin matches the file byte-for-byte`, actual === digest, `pin=${digest.slice(0, 16)}… file=${String(actual).slice(0, 16)}…`)
}

// ── 2. the pinned bytes are tracked (the matlab/vba regression class) ─────────────────────────────
const tracked = run("git", ["ls-files", "wasm/"])
check("matlab grammar is tracked", tracked.out.split("\n").includes("wasm/tree-sitter-matlab.wasm"))
check("vba grammar is tracked", tracked.out.split("\n").includes("wasm/tree-sitter-vba.wasm"))
check("typescript and make grammars are tracked", tracked.out.split("\n").includes("wasm/tree-sitter-typescript.wasm") && tracked.out.split("\n").includes("wasm/tree-sitter-make.wasm"))

// ── 3. source vs compiled version ────────────────────────────────────────────────────────────────
const pkgVersion = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string
const source = run(process.execPath, ["--import", "tsx", path.join(ROOT, "src/cli/index.ts"), "version"])
const sourceVersionLine = source.out.split("\n").find((l) => l.includes(pkgVersion)) ?? ""
check("the source entry runs and reports the package version", source.status === 0 && sourceVersionLine.includes(pkgVersion), source.out.slice(0, 200))

const distDir = path.join(ROOT, "dist")
const bin = path.join(ROOT, "bin/bb")
if (existsSync(distDir) && existsSync(bin)) {
  const compiled = run(bin, ["version"])
  const compiledVersionLine = compiled.out.split("\n").find((l) => l.includes(pkgVersion)) ?? ""
  check("the compiled launcher runs", compiled.status === 0, `status=${compiled.status} ${compiled.out.slice(0, 200)}`)
  check("compiled and source report the same version", compiledVersionLine === sourceVersionLine && sourceVersionLine.length > 0, `source=${sourceVersionLine} compiled=${compiledVersionLine}`)

  // stale-build warning: dist mtime vs newest tracked src file
  const newestSrc = run("git", ["ls-files", "src"]).out
    .split("\n")
    .filter(Boolean)
    .reduce((max, rel) => {
      try {
        return Math.max(max, statSync(path.join(ROOT, rel)).mtimeMs)
      } catch {
        return max
      }
    }, 0)
  const distMtime = statSync(distDir).mtimeMs
  if (newestSrc > distMtime) {
    warnings.push(
      `compiled dist/ is OLDER than the newest tracked src file (dist ${new Date(distMtime).toISOString()}, src ${new Date(newestSrc).toISOString()}) — bin/bb runs the old bundle until \`npm run build\`; the source entry (bun/npx tsx) is authoritative in a dev checkout`,
    )
  }
} else {
  check("compiled dist/ and bin/bb exist for the shipped-path parity check", false, `dist=${existsSync(distDir)} bin=${existsSync(bin)}`)
}

console.log(`\nENGINE PARITY: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
for (const w of warnings) console.log(`  WARNING: ${w}`)
process.exit(failed === 0 ? 0 : 1)
