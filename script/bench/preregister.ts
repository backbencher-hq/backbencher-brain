#!/usr/bin/env node
// script/bench/preregister.ts — freeze the experiment BEFORE data, and refuse drift after.
//
// WHY. A benchmark whose hypotheses, task roster or prompt text can change after the first
// result is not evidence, it is a negotiation with the data. This tool computes a digest
// over everything that defines the experiment, writes it beside the pre-registration, and
// then REFUSES to let a wave proceed if any of it moved.
//
// WHAT IS IN THE DIGEST (and why each one):
//   tasks       -- adding or removing a task changes the denominator of every rate.
//   prompts     -- a clarified prompt is a different experiment, however small the edit.
//   manual block-- arms B/C/D must share a byte-identical block; if it moves, C-B stops
//                  being a measurement of context cost.
//   arm specs   -- tool inventory IS the independent variable.
//   fixtures    -- the repository under test.
// NOT in the digest: results. The window widens for measurement, never to fit it.
//
// USAGE
//   preregister.ts freeze  <dir> --name <wave>   write <dir>/.preregistration.json
//   preregister.ts check   <dir>                 verify nothing moved; exit 1 on drift
//   preregister.ts digest  <dir>                 print the digest only

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { createHash } from "node:crypto"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, "../..")

/** The normative arm definitions, duplicated from lib/profile.ts as data so the digest can
 *  cover them. A drift check that imported the runtime values would not notice a change. */
export const ARM_SPEC_DATA = {
  A: { bbMcp: false, manualBlock: false, skills: false },
  B: { bbMcp: false, manualBlock: true, skills: false },
  C: { bbMcp: true, manualBlock: true, skills: false },
  D: { bbMcp: true, manualBlock: true, skills: true },
} as const

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git" || name.startsWith(".")) continue
    const p = path.join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

export interface Preregistration {
  schemaVersion: 1
  name: string
  createdAt: string
  digest: string
  parts: { path: string; sha256: string }[]
}

/** Digest everything that defines the experiment under `dir`. Paths are repo-relative so
 *  the digest is stable across machines and worktrees. */
export function computeDigest(dir: string, name: string): Preregistration {
  const root = path.resolve(dir)
  const files = walk(root)
    .filter((f) => /\.(json|md|patch)$/.test(f) && !path.basename(f).startsWith(".preregistration"))
    .sort()
  const parts = files.map((f) => ({
    path: path.relative(REPO_ROOT, f),
    sha256: sha256(readFileSync(f)),
  }))
  const canonical = JSON.stringify({ name, arms: ARM_SPEC_DATA, parts }, null, 0)
  return {
    schemaVersion: 1,
    name,
    createdAt: new Date().toISOString(),
    digest: sha256(canonical),
    parts,
  }
}

export function checkDigest(dir: string, expected: Preregistration): { ok: boolean; reasons: string[] } {
  const now = computeDigest(dir, expected.name)
  const reasons: string[] = []
  if (now.digest === expected.digest) return { ok: true, reasons }
  const before = new Map(expected.parts.map((p) => [p.path, p.sha256]))
  const after = new Map(now.parts.map((p) => [p.path, p.sha256]))
  for (const [p, h] of after) {
    if (!before.has(p)) reasons.push(`added: ${p}`)
    else if (before.get(p) !== h) reasons.push(`changed: ${p}`)
  }
  for (const [p] of before) if (!after.has(p)) reasons.push(`removed: ${p}`)
  if (reasons.length === 0) reasons.push("digest differs but no per-file difference was found (part ordering?)")
  return { ok: false, reasons }
}

const argv = process.argv.slice(2)
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = argv[0]
  const dir = argv[1]
  if (!mode || !dir) {
    console.error("preregister: usage: preregister.ts <freeze|check|digest> <dir> [--name <wave>]")
    process.exit(2)
  }
  const nameIdx = argv.indexOf("--name")
  const name = nameIdx >= 0 ? argv[nameIdx + 1] : path.basename(path.resolve(dir))
  const storePath = path.join(path.resolve(dir), ".preregistration.json")

  if (mode === "freeze") {
    if (existsSync(storePath)) {
      console.error(`preregister: refusing to overwrite existing ${path.relative(REPO_ROOT, storePath)}. A moved pre-registration needs a NEW name and a dated reason, never a rewrite.`)
      process.exit(1)
    }
    const pr = computeDigest(dir, name)
    writeFileSync(storePath, JSON.stringify(pr, null, 2) + "\n")
    console.log(`frozen: ${pr.name} digest=${pr.digest.slice(0, 16)}… over ${pr.parts.length} files`)
    process.exit(0)
  }

  if (mode === "check") {
    if (!existsSync(storePath)) {
      console.error(`preregister: no ${path.relative(REPO_ROOT, storePath)}. Freeze the wave before running it.`)
      process.exit(1)
    }
    const expected = JSON.parse(readFileSync(storePath, "utf8")) as Preregistration
    const r = checkDigest(dir, expected)
    if (r.ok) {
      console.log(`preregistered: ${expected.name} digest=${expected.digest.slice(0, 16)}… (unchanged)`)
      process.exit(0)
    }
    console.error("preregister: DRIFT — the experiment moved after it was frozen:")
    for (const x of r.reasons) console.error(`  - ${x}`)
    console.error("  A change after freeze is a NEW pre-registration with a dated reason, not an edit.")
    process.exit(1)
  }

  if (mode === "digest") {
    const pr = computeDigest(dir, name)
    console.log(pr.digest)
    process.exit(0)
  }

  console.error(`preregister: unknown mode "${mode}" (freeze|check|digest)`)
  process.exit(2)
}
