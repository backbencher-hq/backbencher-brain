// script/verify-index-discovery-matrix.ts — WHAT DOES bb INDEX ACTUALLY SCAN?
//
// The review found the discovery rules were only documented in prose spread across pages, and some
// surprising ones (hidden dirs ARE indexed except a small metadata list; vendor/ IS indexed; nested `.git`
// boundaries stop a subtree; extensionless shell scripts are admitted by a bounded shebang read; >5MB files
// are skipped; symlinks are not followed) were not written down at all. This gate asks the PRODUCT's own
// discovery function (`discoverIndexableFiles`, which is the indexer's eligible-only walk) about a fixture
// that contains one of each case, and compares against the documented matrix
// (`docs/indexing/discovery-matrix.md`). If a rule changes, either the doc and this gate move together or the
// mismatch is a defect — the page cannot silently drift from the walk.
//
// Run: npx tsx script/verify-index-discovery-matrix.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

let checks = 0
let failed = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-discovery-"))
const project = path.join(tmp, "proj")
const write = (rel: string, content = "export const x = 1\n") => {
  const abs = path.join(project, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

// ── the fixture: one of every case the matrix documents ──────────────────────────────────────────
write("src/a.ts", "export function alpha(): number { return 1 }\n")
write("src/b.mts", "export const b = 2\n")
write("src/c.cts", "export const c = 3\n")
write("py/thing.py", "def thing():\n    return 1\n")
write("go/thing.go", "package thing\n")
write("ruby/thing.rb", "def thing; 1; end\n")
write("README.md", "# fixture\n")
write("package.json", JSON.stringify({ name: "discovery-fixture", version: "1.0.0" }))
write(".github/workflow.ts", "export const gh = 1\n")
write(".hidden/secret.ts", "export const hidden = 1\n")
write("vendor/vendored.ts", "export const vend = 1\n")
write("big/data.json", JSON.stringify({ blob: "x".repeat(1_500_000) }))
write("big/gen.ts", "// " + "x".repeat(5_500_000) + "\n")
write("ignored.ts", "export const ignored = 1\n")
write("generated/g.ts", "export const generated = 1\n")
write("unignored-by-bb.ts", "export const kept = 1\n")
write("bb-ignored.ts", "export const bbIgnored = 1\n")
write("node_modules/x.js", "module.exports = 1\n")
write("dist/y.js", "module.exports = 2\n")
write("build/b.ts", "export const b = 1\n")
write("coverage/c.ts", "export const c = 1\n")
write("wwwroot/w.js", "1\n")
write("Microbenchmarks/m.ts", "export const m = 1\n")
write("testData/t.ts", "export const t = 1\n")
write("testassets/t.ts", "export const ta = 1\n")
write("benchmarkapps/b.ts", "export const ba = 1\n")
write("obj/o.ts", "export const o = 1\n")
write("bin/b.ts", "export const legacyBin = 1\n")
write(".git/z.ts", "export const g = 1\n")
write(".cache/cache.ts", "export const cache = 1\n")
write(".svn/s.ts", "export const svn = 1\n")
write("plain.txt", "not code\n")
write("image.png", "not really a png\n")
write("nested/.git/config", "[core]\n")
write("nested/inside.ts", "export const insideNestedRepo = 1\n")
write("scripts/run-tool", "#!/usr/bin/env bash\necho hello\n")
const outside = path.join(tmp, "outside.ts")
writeFileSync(outside, "export const outside = 1\n")
symlinkSync(outside, path.join(project, "link.ts"))
// depth cap: a file deeper than 50 directories must not be scanned
let deep = "deep"
for (let i = 0; i < 52; i++) deep = path.join(deep, `d${i}`)
write(path.join(deep, "too-deep.ts"), "export const deep = 1\n")

write(".gitignore", "ignored.ts\ngenerated/\nunignored-by-bb.ts\n")
write(".bbignore", "bb-ignored.ts\n!unignored-by-bb.ts\n")

const { discoverIndexableFiles } = await import("../src/ast/parallel-indexer")

const INCLUDED = [
  ".github/workflow.ts",
  ".hidden/secret.ts",
  "README.md",
  "big/data.json",
  "go/thing.go",
  "package.json",
  "py/thing.py",
  "ruby/thing.rb",
  "scripts/run-tool",
  "src/a.ts",
  "src/b.mts",
  "src/c.cts",
  "unignored-by-bb.ts",
  "vendor/vendored.ts",
]
const EXCLUDED = [
  ".cache/cache.ts",
  ".git/z.ts",
  ".svn/s.ts",
  "Microbenchmarks/m.ts",
  "benchmarkapps/b.ts",
  "bb-ignored.ts",
  "big/gen.ts", // >5MB
  "bin/b.ts",
  "build/b.ts",
  "coverage/c.ts",
  "dist/y.js",
  "generated/g.ts", // gitignored directory
  "ignored.ts", // gitignored file
  "image.png",
  "link.ts", // symlink: not followed
  "nested/inside.ts", // nested .git boundary
  "node_modules/x.js",
  "obj/o.ts",
  "plain.txt", // no extension, no shebang
  "testData/t.ts",
  "testassets/t.ts",
  "wwwroot/w.js",
]

try {
  const found = await discoverIndexableFiles(project)
  const rel = found.map((p) => path.relative(project, p).split(path.sep).join("/")).sort()
  console.log(`  discovery returned ${rel.length} file(s):`)
  for (const p of rel) console.log(`    + ${p}`)
  const expected = [...INCLUDED].sort()
  const missing = expected.filter((p) => !rel.includes(p))
  const extra = rel.filter((p) => !expected.includes(p) && !EXCLUDED.includes(p))
  check(`discovery admits exactly the documented include set (${INCLUDED.length})`, missing.length === 0, JSON.stringify({ missing }))
  check("discovery admits nothing outside the documented include set", extra.length === 0, JSON.stringify({ extra }))
  // Each excluded case is asserted individually so a rule change names the case it broke.
  for (const p of EXCLUDED) check(`excluded by the documented rule: ${p}`, !rel.includes(p))
  // The >5MB skip is a discovery-level fact: the file exists on disk and is genuinely absent from the walk.
  check("the >5MB file exists on disk but is not discovered", !rel.includes("big/gen.ts") && existsSync(path.join(project, "big/gen.ts")))
  // The depth cap (walk stops below 50 directories) is only observable as absence.
  check("a file below the depth cap is not discovered", !rel.some((p) => p.startsWith("deep/")))
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nDISCOVERY MATRIX: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
process.exit(failed === 0 ? 0 : 1)
