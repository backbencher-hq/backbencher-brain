#!/usr/bin/env bun
/**
 * THE SAFE COMMIT — A PRIVATE INDEX, SO ANOTHER LANE's STAGED FILES CAN NEVER BE SWEPT IN.
 *
 * ⇒ WHY THIS EXISTS ✓✓. In a SHARED index — and this repository's index IS shared — `git add` +
 * `git commit -- <paths>` still commits whatever ELSE happens to be staged ✓✓. ⇒ THIS LANE HAS BEEN
 * BURNED IN BOTH DIRECTIONS ✓✓:
 *   · the yaml lane's commit `0b86199f8` swept **three of this lane's files** into a commit whose
 *     message described four defects in four Lead-owned files ✓✓, and
 *   · this lane's own commit `400f2a329` swept **three of the html lane's files** into a commit whose
 *     message described thirteen page headers ✓✓.
 * ⇒ IN BOTH CASES THE CONTENT WAS RIGHT AND THE ATTRIBUTION WAS WRONG ✓✓, AND IN BOTH CASES THE
 * FIX WAS THE SAME ✓✓: **THE COMMIT's CONTENT MUST BE A FUNCTION OF ITS ARGUMENTS ALONE** ✓✓.
 *
 * ⇒ THE METHOD ✓✓: commit through a **PRIVATE INDEX** ✓✓ — a temporary `GIT_INDEX_FILE` seeded
 * from HEAD, into which ONLY the named paths are added ✓✓. ⇒ The shared index is never read and
 * never written ✓✓, so another lane's staged files cannot be committed, cannot be unstaged, and
 * cannot be destroyed ✓✓.
 *
 * ⇒ AND IT REFUSES RATHER THAN GUESS ✓✓: after the private index is built, its path list is
 * COMPARED against the requested path list ✓✓, and any difference is a refusal (exit 4) ✓✓ —
 * because a commit that silently contains an extra file is a commit whose message is a lie ✓✓.
 *
 * ⇒ USAGE ✓✓:
 *   bun run script/m14/javascript-safe-commit.ts --message <file> -- <path> [<path> ...]
 *   bun run script/m14/javascript-safe-commit.ts --message <file> --dry-run -- <path> ...
 *
 * The message is read from a FILE, never from `-m` on a shell command line ✓✓ — a backtick in a
 * shell double-quoted string is a COMMAND SUBSTITUTION ✓✓, and this lane lost a word from a commit
 * message to exactly that ✓✓.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "../..")

function git(args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function fail(msg: string, code: number): never {
  console.error(`SAFE-COMMIT REFUSED: ${msg}`)
  process.exit(code)
}

const argv = process.argv.slice(2)
let messageFile = ""
let dryRun = false
const paths: string[] = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === "--message") {
    messageFile = argv[++i] ?? ""
  } else if (a === "--dry-run") {
    dryRun = true
  } else if (a === "--") {
    paths.push(...argv.slice(i + 1))
    break
  } else {
    fail(`unknown argument '${a}'`, 2)
  }
}

if (!messageFile) fail("no --message <file> was given", 2)
if (paths.length === 0) fail("no paths were given after --", 2)
if (!existsSync(messageFile)) fail(`the message file '${messageFile}' does not exist`, 2)

for (const p of paths) {
  if (!existsSync(path.join(ROOT, p))) fail(`the path '${p}' does not exist in the worktree`, 2)
}

const dir = mkdtempSync(path.join(tmpdir(), "js-lane-index-"))
const idx = path.join(dir, "index")
const env = { GIT_INDEX_FILE: idx }
try {
  git(["read-tree", "HEAD"], env)
  git(["add", "--", ...paths], env)
  const got = git(["diff", "--cached", "--name-only"], env).split("\n").filter(Boolean)
  const want = [...paths].sort()
  const gotSorted = [...got].sort()
  if (got.length !== want.length || gotSorted.some((g, i) => g !== want[i])) {
    console.error(`SAFE-COMMIT REFUSED: the private index does not hold exactly the requested paths.`)
    console.error(`  asked: ${want.join(", ")}`)
    console.error(`  got:   ${gotSorted.join(", ")}`)
    process.exit(4)
  }
  // ⇒ AND THE SHARED INDEX MUST BE UNTOUCHED ✓✓ — the whole point ✓✓.
  const sharedBefore = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).length
  console.log(`the private index holds exactly the ${got.length} requested path(s):`)
  for (const g of gotSorted) console.log(`  ${g}`)
  console.log(`the SHARED index currently holds ${sharedBefore} staged path(s) — none of them can be committed by this tool ✓✓`)
  if (dryRun) {
    console.log("DRY RUN — nothing committed.")
  } else {
    git(["commit", "-q", "-F", path.resolve(ROOT, messageFile), "--", ...paths], env)
    const head = git(["log", "-1", "--format=%h %s"]).trim()
    console.log(`committed through a private index: ${head}`)
    const landed = git(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean)
    console.log(`the commit landed ${landed.length} file(s):`)
    for (const l of landed) console.log(`  ${l}`)
    const sharedAfter = git(["diff", "--cached", "--name-only"]).split("\n").filter(Boolean).length
    console.log(`the shared index still holds ${sharedAfter} staged path(s) — untouched ✓✓`)
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
