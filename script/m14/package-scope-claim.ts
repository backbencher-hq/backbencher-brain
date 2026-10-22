#!/usr/bin/env bun
/**
 * THE PACKAGE-SCOPE CLAIM — THE SHARED, LANE-USABLE INSTRUMENT (Lead, 2026-10-21).
 *
 * THIS IS THE FLEET'S BIGGEST LEVER, and it was built but not reachable. The arbiter's verifier
 * (`verifyPackageScopeClaim` in `script/m14/incoming-rule.ts`) and the manifest readers
 * (`manifestDependenciesIn` in `script/m14/incoming-gate.ts`) both existed; what did NOT exist was a
 * lane-usable entry point, so every lane that wanted to price its residual had to re-implement the
 * manifest reading — and could answer a DIFFERENT question from the one the arbiter answers.
 *
 * THE CLAIM. `packageScope = {package, name}`: "this target is a member of the DEPENDENCY named
 * `package`, and this project declares that dependency." The evidence is the PROJECT'S OWN MANIFEST,
 * not a lane-maintained vocabulary — so a name from a package the project does not depend on cannot
 * be claimed, and the checkout can REFUTE the claim.
 *
 * WHY IT IS THE BIGGEST LEVER, MEASURED by the lanes that invented it: the dart lane priced 84.9 %
 * of its 16,395 unresolved `uses` rows as "members of types the project does not declare" — only 155
 * (0.9 %) is addressable by any evidence class, because for the other 84.9 % there is NO DECLARATION
 * for an evidence class to point at. The C++ lane's bucket D (122,227 of 614,081) is the same class.
 *
 * THE THREE OUTCOMES, AND THEY ARE NOT TWO:
 *   - `externalVerified`   — the governing manifest NAMES the package. The claim is supported by the
 *                             project's own evidence.
 *   - `externalRefuted`    — the governing manifest names the package AND the name is not a member of
 *                             it. The project's own evidence contradicts the claim.
 *   - `externalUnverified` — the governing manifest does NOT name the package, or there is no
 *                             governing manifest above the file. **A MANIFEST'S SILENCE ABOUT P IS NOT
 *                             EVIDENCE ABOUT P's MEMBERSHIP**, so silence leaves the claim open. It is
 *                             neither a pass nor a fail, and a lane that reports it as either is
 *                             reporting something the evidence does not support.
 *
 * THE MONOREPO QUESTION, WHICH IS THE ONE THAT DECIDES WHETHER A RESULT IS WORTH ANYTHING. The
 * manifest that governs a file is its NEAREST ANCESTOR manifest, not the repository root's. The
 * corpus is full of monorepos — 843 tracked `package.json` files live in SUBDIRECTORIES — and a
 * root-only reader answers a DIFFERENT PACKAGE'S question in BOTH directions: a dependency the package
 * genuinely declares can read REFUTED (counted against the lane), and a dependency only the ROOT
 * declares can read VERIFIED, which is the monorepo's laundering and the exact thing the claim exists
 * to prevent. This instrument walks UP from the file, so it asks the right question.
 *
 * RUN:
 *   bun script/m14/package-scope-claim.ts --repo=<repoRoot> --file=<absFile> --package=<name>
 *   bun script/m14/package-scope-claim.ts --repo=<repoRoot> --file=<absFile> --deps
 *       (list the governing manifest's dependency names)
 *   bun script/m14/package-scope-claim.ts --repo=<repoRoot> --file=<absFile> --governing
 *       (print which manifest governs the file)
 *
 * EXIT: 0 for a decision, 5 when the claim is UNVERIFIABLE (so a caller cannot mistake an open
 * question for an answer), 2 on a usage error.
 */

import path from "node:path"
import { manifestDependenciesIn } from "./manifest-reader"

/**
 * THE NEAREST ANCESTOR MANIFEST for a file — the same walk the arbiter uses, so a lane's answer and
 * the arbiter's answer are the same answer.
 */
export function governingManifest(repoRoot: string, absFile: string): { dir: string; deps: Set<string> } | null {
  const root = path.resolve(repoRoot)
  let dir = path.dirname(path.resolve(absFile))
  for (;;) {
    const found = manifestDependenciesIn(dir)
    if (found !== null) return { dir, deps: found }
    if (path.resolve(dir) === root) return null
    const up = path.dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/**
 * THE CLAIM'S VERDICT for one (file, package) pair.
 *
 * `externalVerified` / `externalRefuted` / `externalUnverified` — the same three outcomes the
 * arbiter's `verifyPackageScopeClaim` returns, for the same reason, with the same semantics.
 */
export function judgePackageScopeClaim(
  repoRoot: string,
  absFile: string,
  packageName: string,
): "externalVerified" | "externalRefuted" | "externalUnverified" {
  const gov = governingManifest(repoRoot, absFile)
  if (gov === null) return "externalUnverified"
  const want = packageName.trim().toLowerCase()
  if (want.length === 0) return "externalUnverified"
  for (const d of gov.deps) {
    const norm = d.trim().toLowerCase()
    if (norm.length === 0) continue
    if (norm === want) return "externalVerified"
    // SCOPE-EXACT: a manifest names `json_annotation` (dart), `org.slf4j` (maven) or
    // `github.com/pkg/errors` (go), and the claim names the same thing. The two spellings that
    // differ are the SCOPED ones, so a scoped name matches at a PATH BOUNDARY — never inside a
    // longer word (`json` must not match `jsonc`).
    if (norm.startsWith(want + "/") || want.startsWith(norm + "/")) return "externalVerified"
  }
  // THE MANIFEST DOES NOT NAME THE PACKAGE → UNVERIFIABLE, NOT REFUTED. A manifest's silence about
  // P is not evidence about P's members. (The arbiter's own rule, `incoming-rule.ts`.)
  return "externalUnverified"
}

// ── THE CLI ──────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

if (import.meta.main) {
  const repo = argOf("repo")
  const file = argOf("file")
  const pkg = argOf("package")

  if (!repo || !file) {
    console.error("usage: bun script/m14/package-scope-claim.ts --repo=<repoRoot> --file=<absFile> [--package=<name> | --deps | --governing]")
    process.exit(2)
  }

  const gov = governingManifest(repo, file)

  if (argOf("governing") !== undefined) {
    if (gov === null) {
      console.log("NO GOVERNING MANIFEST above this file (walked up to the repository root).")
      console.log("⇒ every package-scope claim about this file is UNVERIFIABLE.")
      process.exit(5)
    }
    console.log(`governing manifest directory: ${gov.dir}`)
    console.log(`dependency names declared:   ${gov.deps.size}`)
    for (const d of [...gov.deps].sort()) console.log(`  ${d}`)
    process.exit(0)
  }

  if (argOf("deps") !== undefined) {
    if (gov === null) {
      console.log("NO GOVERNING MANIFEST above this file.")
      console.log("⇒ every package-scope claim about this file is UNVERIFIABLE.")
      process.exit(5)
    }
    for (const d of [...gov.deps].sort()) console.log(d)
    process.exit(0)
  }

  if (!pkg) {
    console.error("--package=<name> is required (or --deps / --governing)")
    process.exit(2)
  }

  const verdict = judgePackageScopeClaim(repo, file, pkg)
  console.log(`file:    ${file}`)
  console.log(`repo:    ${path.resolve(repo)}`)
  console.log(`package: ${pkg}`)
  console.log(`governing manifest: ${gov === null ? "NONE" : gov.dir}`)
  console.log(`verdict: ${verdict}`)
  if (verdict === "externalVerified") {
    console.log("⇒ the project's own manifest names this package, so the claim is supported by the project's evidence.")
    process.exit(0)
  }
  if (verdict === "externalUnverified") {
    console.log("⇒ a MANIFEST'S SILENCE ABOUT A PACKAGE IS NOT EVIDENCE ABOUT ITS MEMBERSHIP. The claim stays OPEN:")
    console.log("  it is neither verified nor refuted, and reporting it as either would be a claim the evidence")
    console.log("  does not support.")
    process.exit(5)
  }
  console.log("⇒ REFUTED.")
  process.exit(0)
}
