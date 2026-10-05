/**
 * The checkout fingerprint and the DB fingerprint must agree on an unchanged tree.
 *
 * These two numbers are computed by different code paths and then COMPARED to
 * decide whether an index is stale:
 *
 *   computeCheckoutFingerprint(root)  — walks the filesystem, honouring
 *                                       .gitignore, skip-dirs, and language
 *                                       detection
 *   computeDbFingerprint(raw, git)    — reads `relative_path` from brain_file,
 *                                       i.e. what was actually INDEXED
 *
 * If they disagree on an unchanged tree, every project looks stale forever and
 * nothing is ever trusted. If they agree when the tree HAS changed, a stale index
 * is served as fresh — which is the dangerous direction.
 *
 * This has broken once already, and the comment at fingerprint.ts:117-121 records
 * it: testing the bare `relativePath` instead of `"/" + relativePath` let
 * top-level dist/, build/ and node_modules/ into the walk while discovery skipped
 * them, so the fingerprint stopped matching and adoption silently never fired.
 * The bug was invisible because both numbers were individually plausible.
 *
 * The assertion is an invariant on a CONTROLLED fixture: index it, then compare.
 * Nothing here depends on this repository's own index, which legitimately goes
 * stale as the working tree changes.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { DatabaseSync } from "node:sqlite"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")

let failures = 0
function ok(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  ok: ${name}`)
  else {
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
    failures++
  }
}

const { computeCheckoutFingerprint, computeDbFingerprint } = await import(
  path.join(ROOT, "src", "ast", "fingerprint.ts")
)
const { indexProjectParallel } = await import(
  path.join(ROOT, "src", "ast", "parallel-indexer.ts")
)

function pidFor(root: string): string {
  const real = execFileSync("node", ["-e", `console.log(require("fs").realpathSync(process.argv[1]))`, root], {
    encoding: "utf8",
  }).trim()
  return createHash("sha1").update(real).digest("hex").slice(0, 40)
}

const DATA = mkdtempSync(path.join(tmpdir(), "bb-fp-data-"))
process.env.BB_DATA_DIR = DATA

/** Build a fixture with sources AND the kinds of files the walk must skip. */
function makeFixture(tag: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `bb-fp-${tag}-`))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < 4; i++) {
    writeFileSync(path.join(root, "src", `m${i}.ts`), `export const a${i} = ${i}\n`)
  }
  // Directories and files the walker must EXCLUDE. If any of these reach the
  // fingerprint, the two numbers drift apart — which is the historical bug.
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true })
  writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "module.exports=1\n")
  mkdirSync(path.join(root, "dist"), { recursive: true })
  writeFileSync(path.join(root, "dist", "bundle.js"), "console.log(1)\n")
  writeFileSync(path.join(root, ".gitignore"), "ignored/\n")
  mkdirSync(path.join(root, "ignored"), { recursive: true })
  writeFileSync(path.join(root, "ignored", "skip.ts"), "export const x = 1\n")
  // An unsupported extension must also be excluded from BOTH sides.
  writeFileSync(path.join(root, "notes.unknownext"), "not a language\n")
  // An extensionless file WITH a shebang is a real, indexable script.
  writeFileSync(path.join(root, "nvm"), "#!/bin/bash\necho hi\n")
  return root
}

console.log("checkout fingerprint == db fingerprint on an unchanged tree")
{
  const root = makeFixture("match")
  const pid = pidFor(root)
  await indexProjectParallel(pid as any, root, { onProgress: () => {}, noSetup: true } as any)

  const db = new DatabaseSync(path.join(DATA, "projects", pid, "brain.db"), { readOnly: true })
  const checkout = await computeCheckoutFingerprint(root)
  const fromDb = computeDbFingerprint(db, null)
  const rows = (db.prepare("SELECT COUNT(*) c FROM brain_file").get() as any).c

  ok("the fixture indexed some files", rows > 0, `rows=${rows}`)
  ok(
    "checkout and db fingerprints agree",
    checkout.fingerprint === fromDb,
    `checkout=${checkout.fingerprint} (${checkout.fileCount} files) db=${fromDb} (${rows} rows)`,
  )

  console.log("\nthe walk excludes what discovery excludes")
  {
    const paths = db.prepare("SELECT relative_path p FROM brain_file ORDER BY p").all() as any[]
    const names = paths.map((r) => r.p)
    ok("node_modules is not indexed", !names.some((n) => n.includes("node_modules")), names.filter((n) => n.includes("node_modules")).join(","))
    ok("dist is not indexed", !names.some((n) => n.startsWith("dist/")), names.filter((n) => n.startsWith("dist/")).join(","))
    ok("gitignored paths are not indexed", !names.some((n) => n.startsWith("ignored/")), names.filter((n) => n.startsWith("ignored/")).join(","))
    ok("an unsupported extension is not indexed", !names.some((n) => n.endsWith(".unknownext")), names.join(","))
    ok("the extensionless shebang script IS indexed", names.includes("nvm"), names.join(","))
    // The counts must agree too — the same disagreement in a second place.
    ok(
      "file counts agree (walk count == indexed rows)",
      checkout.fileCount === rows,
      `walk=${checkout.fileCount} rows=${rows}`,
    )
  }
  db.close()
  rmSync(root, { recursive: true, force: true })
}

console.log("\na changed tree is DETECTED as different")
{
  // The dangerous direction is the opposite one: if a change does NOT move the
  // fingerprint, a stale index is served as fresh.
  const root = makeFixture("stale")
  const pid = pidFor(root)
  await indexProjectParallel(pid as any, root, { onProgress: () => {}, noSetup: true } as any)
  const db = new DatabaseSync(path.join(DATA, "projects", pid, "brain.db"), { readOnly: true })
  const before = computeDbFingerprint(db, null)

  writeFileSync(path.join(root, "src", "brand-new.ts"), "export const fresh = 1\n")
  const after = await computeCheckoutFingerprint(root)

  ok("adding a file changes the checkout fingerprint", after.fingerprint !== before, `${after.fingerprint} vs ${before}`)
  db.close()
  rmSync(root, { recursive: true, force: true })
}

try { rmSync(DATA, { recursive: true, force: true }) } catch {}

console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`} — fingerprint agreement`)
if (failures > 0) process.exitCode = 1
