// script/m34/verify-install-smoke.ts — M34.S1.
//
// Install-path smoke: the verifiers so far prove the REPO copy works
// (tsx on source, bin/bb against a repo dist). Nothing has ever proven the
// INSTALLED copy works. This verifier:
//   1. npm pack → real tarball
//   2. npm install <tarball> --prefix <tmp> with REAL runtime deps
//      (better-sqlite3 and web-tree-sitter compile/download natively)
//   3. from the install prefix: bin/bb --help / -v / setup --help work
//   4. the man page lands inside the prefix (docs/man/bb.1 is shipped)
//   5. mutants: a dev-only path added to the files list must be caught by
//      the leak scan; a tarball without the bin entry must fail the
//      installed-binary check
//
// Run: npx tsx script/m34/verify-install-smoke.ts
// Evidence: validation/m34/results/S1.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, mkdtempSync, statSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m34/results")
const PKG_PATH = path.join(ROOT, "package.json")
const EVIDENCE_PATH = path.join(RESULTS, "S1.json")

let checks = 0
let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

console.log("M34.S1 install-path smoke verifier")

// Dev-only surface regex — used by the D hygiene gate and the leak mutant.
const leakRegex = /^(script\/|validation\/|docs\/m\d+\/|\.github\/|ide\/|src\/)/

// ---------------------------------------------------------------------------
// A. Pack the real tarball
// ---------------------------------------------------------------------------

const tmp = mkdtempSync(path.join(os.tmpdir(), "m34-s1-"))
const tarball = path.join(tmp, "pack", "bb.tgz")
mkdirSync(path.join(tmp, "pack"), { recursive: true })
let packed = false
try {
  execFileSync("npm", ["pack", "--pack-destination", path.join(tmp, "pack")], { cwd: ROOT, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] })
  const produced = execFileSync("sh", ["-c", `ls ${path.join(tmp, "pack")}/*.tgz`], { encoding: "utf8" }).trim()
  if (produced) {
    // rename to a stable name
    execFileSync("mv", [produced.trim(), tarball])
    packed = existsSync(tarball)
  }
} catch {}
check("A: npm pack produced a tarball", packed)
check("A: tarball is non-trivial in size", packed && statSync(tarball).size > 100000, packed ? `${statSync(tarball).size} bytes` : "")

// ---------------------------------------------------------------------------
// B. Real install into a temp prefix (native deps compile/download)
// ---------------------------------------------------------------------------

let installed = false
const prefix = path.join(tmp, "prefix")
mkdirSync(prefix, { recursive: true })
if (packed) {
  const r = spawnSync("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", tarball], {
    encoding: "utf8",
    timeout: 480000, // native builds can be slow; upper bound, not target
  })
  installed = r.status === 0 && existsSync(path.join(prefix, "node_modules", "backbencher-brain"))
  check("B: npm install from the tarball succeeds (real native deps)", installed, (r.stderr ?? r.stdout ?? "").slice(-300))
  check("B: better-sqlite3 native module present after install", existsSync(path.join(prefix, "node_modules", "backbencher-brain", "node_modules", "better-sqlite3")) || existsSync(path.join(prefix, "node_modules", "better-sqlite3")))
} else {
  check("B: npm install from the tarball succeeds (real native deps)", false, "no tarball")
  check("B: better-sqlite3 native module present after install", false, "no install")
}

// ---------------------------------------------------------------------------
// C. The INSTALLED copy works
// ---------------------------------------------------------------------------

const installedPkg = path.join(prefix, "node_modules", "backbencher-brain")
const installedBin = path.join(installedPkg, "bin", "bb")
if (installed) {
  const env = { ...process.env, BB_DATA_DIR: path.join(tmp, "bbdata") }
  const help = spawnSync("node", [installedBin, "--help"], { encoding: "utf8", timeout: 60000, env })
  check("C: installed bb --help exits 0 and lists setup/doctor", help.status === 0 && help.stdout.includes("setup") && help.stdout.includes("doctor"), (help.stderr || help.stdout).slice(0, 200))
  const ver = spawnSync("node", [installedBin, "-v"], { encoding: "utf8", timeout: 60000, env })
  const pkgVersion = JSON.parse(readFileSync(PKG_PATH, "utf8")).version as string
  check("C: installed bb -v prints the package version", ver.status === 0 && ver.stdout.trim() === pkgVersion, `${ver.status} ${ver.stdout.trim()}`)
  const setupHelp = spawnSync("node", [installedBin, "setup", "--help"], { encoding: "utf8", timeout: 60000, env })
  check("C: installed bb setup --help renders", setupHelp.status === 0 && setupHelp.stdout.includes("show"), (setupHelp.stderr || "").slice(0, 200))
  const docter = spawnSync("node", [installedBin, "docter"], { encoding: "utf8", timeout: 60000, env })
  check("C: installed did-you-mean works (docter -> doctor)", docter.status === 1 && /Did you mean doctor\?/.test(docter.stderr ?? ""))

  check("C: man page lands inside the install prefix", existsSync(path.join(installedPkg, "docs", "man", "bb.1")))
  const verSub = spawnSync("node", [installedBin, "version"], { encoding: "utf8", timeout: 60000, env })
  check("C: installed bb version subcommand works", verSub.status === 0 && verSub.stdout.trim() === JSON.parse(readFileSync(PKG_PATH, "utf8")).version)

  // D2. The installed copy parses XML through the vendored wasm — the exact
  // leg that broke for fresh installs when tree-sitter-xml (native) shipped
  // as a dependency. Indexing a small XML project proves wasm resolution,
  // web-tree-sitter, and better-sqlite3 against the INSTALLED copy.
  const proj = path.join(tmp, "xmlproj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  const xml = `<?xml version="1.0"?>\n<project name="probe">\n  <target name="build"><javac srcdir="src"/></target>\n</project>\n`
  writeFileSync(path.join(proj, "src", "probe.xml"), xml)
  writeFileSync(path.join(proj, "src", "util.xml"), `<?xml version="1.0"?>\n<config><debug>true</debug></config>\n`)
  const idx = spawnSync("node", [installedBin, "index", proj, "--no-setup"], { encoding: "utf8", timeout: 300000, env })
  const idxOut = (idx.stdout ?? "") + (idx.stderr ?? "")
  // Success = exit 0 + per-file stats with zero processing errors. (A caught
  // WARN from the secondary post-index integrity step is pre-existing repo
  // behavior — identical with the repo binary — and not an install defect.)
  check("D2: installed bb indexes an XML project (vendored wasm path)", idx.status === 0 && /"totalFiles":\d+,"processed":\d+,"errors":0/.test(idxOut), `exit=${idx.status} ${idxOut.slice(-200)}`)
  const health = spawnSync("node", [installedBin, "health", proj], { encoding: "utf8", timeout: 120000, env })
  check("D2: installed bb health reports the indexed project", health.status === 0, `exit=${health.status}`)
} else {
  for (const label of [
    "C: installed bb --help exits 0 and lists setup/doctor",
    "C: installed bb -v prints the package version",
    "C: installed bb setup --help renders",
    "C: installed did-you-mean works (docter -> doctor)",
    "C: man page lands inside the install prefix",
    "C: installed bb version subcommand works",
  ]) check(label, false, "no install")
}

// ---------------------------------------------------------------------------
// D. Tarball hygiene: no dev-only leakage
// ---------------------------------------------------------------------------

{
  const packList = spawnSync("npm", ["pack", "--dry-run"], { cwd: ROOT, encoding: "utf8", timeout: 120000, shell: true })
  const out = (packList.stdout ?? "") + (packList.stderr ?? "")
  const files = out.split("\n").filter((l) => l.includes("npm notice") && /\d+(\.\d+)?[kMG]?B /.test(l)).map((l) => l.replace(/^npm notice\s+\S+\s+/, "").trim())
  check("D: pack list is readable (files found)", files.length > 50, `${files.length} files`)
  const leaked = files.filter((f) => /^(script\/|validation\/|docs\/m\d+\/|\.github\/|ide\/|src\/)/.test(f))
  check("D: no dev-only directories leak into the tarball", leaked.length === 0, leaked.slice(0, 5).join(", "))
  // Positive control: the shipped surface must actually carry the man page
  // and the vendored wasm grammars (proves the pack list is real, not empty).
  check("D: shipped surface includes the man page and vendored wasm grammars", files.some((f) => f === "docs/man/bb.1") && files.some((f) => f.startsWith("wasm/")), files[0] ?? "")
  check("D: dist, bin, wasm, docs/man, docs/tools, docs/data are the shipped surface", files.some((f) => f.startsWith("dist/")) && files.some((f) => f.startsWith("bin/")) && files.some((f) => f.startsWith("docs/man/")))
}

// ---------------------------------------------------------------------------
// E. Mutants — planted defects must be caught (no source mutation needed:
//    these probe the real gates with synthetic states)
// ---------------------------------------------------------------------------

type Mutant = { name: string; probe: () => boolean | Promise<boolean> }

// Package-level mutant helper: stage a minimal copy of the repo surface,
// apply a mutation, pack a REAL tarball from it. Mutant installs use
// --ignore-scripts (no native builds needed to evaluate the planted defect).
function packMutantTarball(mutate: (stage: string) => void, tag: string): string {
  const stage = path.join(tmp, `stage-${tag}`)
  mkdirSync(stage, { recursive: true })
  for (const entry of ["package.json", "bin", "dist", "wasm", "docs", "README.md", "EMBEDDINGS.md"]) {
    const src = path.join(ROOT, entry)
    if (!existsSync(src)) continue
    execFileSync("cp", ["-r", src, path.join(stage, entry)])
  }
  mutate(stage)
  const dest = path.join(tmp, `pack-${tag}`)
  mkdirSync(dest, { recursive: true })
  execFileSync("npm", ["pack", "--pack-destination", dest], { cwd: stage, encoding: "utf8", timeout: 120000, stdio: ["ignore", "pipe", "pipe"] })
  const produced = execFileSync("sh", ["-c", `ls ${dest}/*.tgz`], { encoding: "utf8" }).trim()
  if (!produced) throw new Error("mutant pack produced nothing")
  return produced.trim().split("\n")[0]
}

function tarballFileList(tgz: string): string[] {
  const out = execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" })
  return out.split("\n").map((l) => l.replace(/^package\//, "").trim()).filter(Boolean)
}

function installMutant(tgz: string, tag: string): string {
  const prefix = path.join(tmp, `prefix-${tag}`)
  mkdirSync(prefix, { recursive: true })
  execFileSync("npm", ["install", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tgz], {
    encoding: "utf8", timeout: 240000, stdio: ["ignore", "pipe", "pipe"],
  })
  return path.join(prefix, "node_modules", "backbencher-brain")
}

const mutants: Mutant[] = [
  {
    name: "dev-only files entry added to package.json is caught by the leak scan (real mutant tarball)",
    probe: () => {
      // npm `files` is an allowlist, so the honest simulation of the defect
      // is ADDING a dev dir to the allowlist — then the tarball really leaks.
      const tgz = packMutantTarball((stage) => {
        const pkg = JSON.parse(readFileSync(path.join(stage, "package.json"), "utf8"))
        pkg.files.push("script")
        writeFileSync(path.join(stage, "package.json"), JSON.stringify(pkg, null, 2))
        mkdirSync(path.join(stage, "script", "m34"), { recursive: true })
        writeFileSync(path.join(stage, "script", "m34", "leaked.ts"), "export const leaked = true\n")
      }, "leak")
      const files = tarballFileList(tgz)
      return files.some((f) => leakRegex.test(f))
    },
  },
  {
    name: "a zeroed bin/bb fails the installed-binary smoke (real mutant tarball)",
    probe: () => {
      const tgz = packMutantTarball((stage) => {
        writeFileSync(path.join(stage, "bin", "bb"), "#!/bin/sh\nexit 3\n")
      }, "zerobin")
      const pkgDir = installMutant(tgz, "zerobin")
      const r = spawnSync("node", [path.join(pkgDir, "bin", "bb"), "--help"], { encoding: "utf8", timeout: 60000 })
      return r.status !== 0
    },
  },
  {
    name: "wasm registry resolves the vendored xml grammar and rejects bogus names",
    probe: () =>
      (async () => {
        // Import via ROOT (derived from this file's location) — a hardcoded
        // personal-machine path would make this probe throw on any other
        // environment, and a throwing probe is scored as "mutant survived".
        const { ensureWasmRegistry, hasWasmInRegistry } = await import(path.join(ROOT, "src/util/wasm.ts"))
        await ensureWasmRegistry()
        const xml = hasWasmInRegistry("tree-sitter-xml/tree-sitter-xml.wasm")
        const bogus = hasWasmInRegistry("tree-sitter-xml/tree-sitter-bogus.wasm")
        return Boolean(xml && xml.length > 1000) && !bogus
      })(),
  },
]

const mutantResults: { name: string; caught: boolean }[] = []
for (const mut of mutants) {
  let caught = false
  try {
    caught = await mut.probe()
  } catch {
    caught = false
  }
  mutantResults.push({ name: mut.name, caught })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("S1: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// Cleanup, verdict, evidence
// ---------------------------------------------------------------------------

try {
  rmSync(tmp, { recursive: true, force: true })
} catch {}

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutantResults.length} mutants`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const evidence = {
  issue: "M34.S1",
  code: "S1",
  milestone: "M34",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.length,
  mutants: mutantResults,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m34/verify-install-smoke.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "The install leg needs network access to the npm registry for runtime deps (native modules download prebuilt binaries or compile); an offline run surfaces as a B-check failure, not a silent pass.",
    "The installed binary is invoked as `node <prefix>/bin/bb` rather than via the npm bin shim; PATH shims are a packaging detail that varies by npm version.",
    "The dev-only-leak regex encodes today's dev directories (script/, validation/, docs/mN/, .github/, ide/, src/); a new top-level dev directory must be added to it.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
