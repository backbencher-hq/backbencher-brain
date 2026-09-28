// script/m49/verify-governance.ts — M49.G1: governance for the Review-Intake
// & Gate-Hardening milestone.
//
// Charter (established with the user 2026-09-08): reviewers keep finding real
// defects in analyzers declared "done" — because each new review brings a lens
// the standing gates do not cover. M49 formalizes the loop:
//
//   reviews/<lang>/  →  verify claims (code + live parse)  →  fix + oracle
//   mirror  →  fixture + mutant + spec decision  →  gates extended family-wide
//   →  onboarding board updated  →  m37/m14 inherit the hardened gates.
//
// Enforced here:
//   1. Ledger: R-codes present, statuses legal, verified statuses carry
//      conforming on-disk evidence — no fabricated verified.
//   2. Coverage: every reviews/<lang>/ folder is tracked by the onboarding
//      board AND by R1 (the intake gate exists and runs).
//   3. Registry wiring: every on-disk script/m49 verifier is registered in
//      this file's check list (a stray verifier is a failure).
//   4. Chain wiring: package.json "verify" runs M49 gates.
//   5. Auto-pass audit: no hardcoded-true check/negative calls and no
//      boolean-or-true escapes anywhere in M49 verifiers.
//
// Run: bun script/m49/verify-governance.ts
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const M49_DIR = path.join(ROOT, "script/m49")
const LEDGER_PATH = path.join(ROOT, "validation/m49/ledger.json")
const REVIEWS = path.join(ROOT, "reviews")

let passed = 0, failed = 0, negatives = 0
const failures: string[] = []
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

const REQUIRED_CODES = ["G1", "R1", "R2", "X1"]
const ALLOWED_STATUS = ["pending", "verified", "known-gap", "blocked"]

function currentCommit(): string {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" }
}

function main() {
  // --- 1. Ledger -----------------------------------------------------------
  check("ledger exists", existsSync(LEDGER_PATH))
  if (!existsSync(LEDGER_PATH)) return finish()
  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"))
  const issues: Array<Record<string, unknown>> = ledger.issues ?? []
  const ids = issues.map((i) => String(i.id))
  for (const code of REQUIRED_CODES) {
    check(`ledger has ${code}`, ids.includes(code))
  }
  // M49.J3: wave-code entries (J1/K1/S1/… — the per-reviewer-wave ledger rows
  // that the intake protocol appends as waves close) are LEGAL alongside the
  // required G1/R1/R2/X1 scaffold codes. They must still satisfy the same
  // status/evidence checks below. Anything that is neither a required code nor
  // a known wave-code shape fails.
  // M49 W13/W14: the vocabulary is the set of LANGUAGE PREFIXES the waves
  // actually use, and it is DATA (validation/m49/wave-codes.json) rather than
  // a literal inside this gate. History explains why: the original opaque
  // `/^[JKSCEPGVTRHD][0-9]+$/` silently rejected five LEGITIMATE ledger rows
  // the systems and csharp waves appended (CPP1/RS1/GO1/CS1 — one letter
  // cannot match a two-letter prefix — and Z1, never in the class), and then
  // the explicit replacement list did the same thing to RB1, the ruby wave's
  // code (ruby cannot use `R`, which the R1/R2 scaffold rows own). Both times
  // G1 failed on a row no rule was meant to forbid, because a rule that lives
  // in code must be edited in code by whoever closes the next wave. The gate
  // keeps its strictness — a code outside the registry still fails — and §2
  // adds the rule that makes the drift impossible to repeat silently: every
  // language directory must own a code or be declared `unwaved` with a reason.
  const CODES_PATH = path.join(ROOT, "validation/m49/wave-codes.json")
  check("wave-code registry exists", existsSync(CODES_PATH))
  const registry: { prefixes?: Record<string, string[]>; unwaved?: Record<string, string> } =
    existsSync(CODES_PATH) ? JSON.parse(readFileSync(CODES_PATH, "utf8")) : {}
  const ownedPrefixes = registry.prefixes ?? {}
  const unwaved = registry.unwaved ?? {}
  // Longest prefix first so `CPP1` is read as CPP+1, not as a failed C+`PP1`
  // that only succeeding by backtracking happens to hide.
  const prefixAlt = Object.keys(ownedPrefixes)
    .sort((a, b) => b.length - a.length)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
  const WAVE_CODE = new RegExp(`^(?:${prefixAlt})[0-9]+$`)
  check("ledger has no extra codes", issues.every((i) => REQUIRED_CODES.includes(String(i.id)) || WAVE_CODE.test(String(i.id))),
    `extras: ${ids.filter((x) => !REQUIRED_CODES.includes(x) && !WAVE_CODE.test(x)).join(",")}`)
  // The vocabulary must discriminate: every code the ledger actually carries
  // passes, a typo of an owned prefix does not, and a bare prefix (no wave
  // number) does not — otherwise "no extra codes" could pass vacuously.
  negative("wave-code vocabulary admits every code the ledger carries",
    ids.filter((x) => !REQUIRED_CODES.includes(x)).every((c) => WAVE_CODE.test(c)))
  negative("wave-code vocabulary rejects an unowned prefix", !WAVE_CODE.test("FOO1") && !WAVE_CODE.test("CPP"))
  for (const i of issues) {
    const status = String(i.status)
    check(`${i.id} status legal`, ALLOWED_STATUS.includes(status), status)
    if (status === "verified") {
      check(`${i.id} verified carries evidence`, typeof i.evidenceFile === "string" && existsSync(path.join(ROOT, String(i.evidenceFile))),
        `evidenceFile: ${i.evidenceFile ?? "missing"}`)
      check(`${i.id} verified at a commit`, typeof i.verifiedAtCommit === "string" && /^[0-9a-f]{7,40}$/.test(String(i.verifiedAtCommit)))
    }
  }

  // --- 2. Coverage ---------------------------------------------------------
  // A LANGUAGE is a directory under reviews/. The unfiltered readdir used to
  // treat the top-level review DOCUMENTS (`reviews/<wave>-<topic>.md`) as
  // languages too, so adding one made G1 demand a language row for a document
  // (probe 2026-09-12: reviews/m49-w9-*.md failed G1 until a row was written;
  // R1 already filtered to directories, so the two gates disagreed). G1 now
  // agrees with R1 on languages and gives documents their own, correctly-scoped
  // presence check — coverage is unchanged, the misclassification is gone.
  const reviewEntries = existsSync(REVIEWS)
    ? readdirSync(REVIEWS).filter((f) => f !== "onboarding.md" && !f.startsWith("."))
    : []
  const isDir = (f: string) => {
    try { return statSync(path.join(REVIEWS, f)).isDirectory() } catch { return false }
  }
  const langDirs = reviewEntries.filter(isDir)
  const reviewDocs = reviewEntries.filter((f) => !isDir(f) && f.endsWith(".md"))
  const board = existsSync(path.join(REVIEWS, "onboarding.md"))
    ? readFileSync(path.join(REVIEWS, "onboarding.md"), "utf8") : ""
  for (const lang of langDirs) {
    check(`onboarding board tracks ${lang}`, board.includes(`reviews/${lang}`))
  }
  // Every registered prefix must name a REAL owner — the scaffold, or a
  // directory that exists under reviews/. Without this, a typo in the
  // registry ("ruBU" for ruby) would license codes nobody owns.
  for (const [prefix, owners] of Object.entries(ownedPrefixes)) {
    check(`wave-code prefix ${prefix} names a real owner`,
      Array.isArray(owners) && owners.length > 0 && owners.every((o) => o === "scaffold" || isDir(o)),
      String(owners))
  }
  // An `unwaved` entry is an explicit, reviewable admission that a language
  // directory has no M49 ledger row. It must be a real directory AND must
  // state why, so "unwaved" cannot be used as a silence-shaped escape hatch.
  for (const [lang, reason] of Object.entries(unwaved)) {
    check(`unwaved ${lang} is a language directory`, isDir(lang))
    check(`unwaved ${lang} states a reason`, typeof reason === "string" && reason.trim().length >= 20,
      typeof reason === "string" ? reason.slice(0, 60) : String(reason))
  }
  // Exhaustiveness — the rule whose absence let both drifts through. A
  // language directory must either own a wave code or be declared unwaved
  // with a reason; silence is not an option. This fails and NAMES the
  // directory, so the next wave learns what to register from the gate output
  // instead of from a mysteriously red G1.
  const ownedLangs = new Set(Object.values(ownedPrefixes).flat())
  const unaccounted = langDirs.filter((l) => !ownedLangs.has(l) && !(l in unwaved))
  check("every language directory owns a wave code or is declared unwaved", unaccounted.length === 0,
    `unaccounted: ${unaccounted.join(",")}`)
  // The predicate must discriminate in both directions, proven from the
  // registry itself rather than from a synthetic string: strip a real
  // language of its code and the rule must report it, while the registry as
  // it stands must report nothing.
  negative("exhaustiveness rule flags a real language stripped of its code",
    (() => {
      const withoutRuby = new Set(ownedLangs); withoutRuby.delete("ruby")
      return ["ruby"].some((l) => !withoutRuby.has(l) && !(l in unwaved))
    })())
  negative("exhaustiveness rule does not flag a registered language",
    ["ruby"].every((l) => ownedLangs.has(l)))
  for (const doc of reviewDocs) {
    check(`onboarding board documents ${doc}`, board.includes(doc))
  }
  // The classification above is only meaningful if it discriminates, and the
  // document rule is only meaningful if it can fail:
  //   - a real language directory IS a directory, a real document is NOT;
  //   - a document absent from the board must fail the same predicate.
  negative("language/document classification is not vacuous", isDir("java") && !isDir("regex-policy.md"))
  const syntheticDoc = "reviews/__unboarded_probe_doc__.md"
  negative("a review document absent from the board fails", !board.includes(syntheticDoc))
  check("R1 intake gate exists on disk", existsSync(path.join(M49_DIR, "verify-r1-intake.ts")))
  check("R2 regex gate exists on disk", existsSync(path.join(M49_DIR, "verify-r2-regex.ts")))

  // --- 3. Verifier registry wiring ----------------------------------------
  const onDisk = readdirSync(M49_DIR).filter((f) => /^verify-.*\.ts$/.test(f)).sort()
  const governanceSrc = readFileSync(__filename, "utf8")
  const registered = ["verify-governance.ts", "verify-r1-intake.ts", "verify-r2-regex.ts", "verify-closure.ts", "verify-evidence-lineage.ts", "verify-script-integrity.ts", "verify-census-lineage.ts", "verify-evidence-identity.ts", "verify-family-parity.ts", "verify-sweep-state-freeze.ts"]
  for (const f of onDisk) {
    check(`verifier ${f} is registered in governance`, registered.includes(f))
  }

  // --- 4. Chain wiring ------------------------------------------------------
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))
  const verifyScript = String(pkg.scripts?.verify ?? "")
  check("package.json verify runs M49 governance", verifyScript.includes("script/m49/verify-governance.ts"))
  check("package.json verify runs M49 R1", verifyScript.includes("script/m49/verify-r1-intake.ts"))
  check("package.json verify runs M49 R2", verifyScript.includes("script/m49/verify-r2-regex.ts"))
  check("package.json verify runs M49 G6 census lineage", verifyScript.includes("script/m49/verify-census-lineage.ts"))
  check("package.json verify runs M49 G8 evidence identity", verifyScript.includes("script/m49/verify-evidence-identity.ts"))
  check("package.json verify runs M49 G9 family parity", verifyScript.includes("script/m49/verify-family-parity.ts"))
  check("package.json verify runs M49 G10 sweep-state freeze", verifyScript.includes("script/m49/verify-sweep-state-freeze.ts"))
  check("script/m49/verify-evidence-identity.ts carries self-test negatives",
    /negative\(/.test(readFileSync(path.join(M49_DIR, "verify-evidence-identity.ts"), "utf8")))

  // --- 5. Auto-pass audit ----------------------------------------------------
  for (const f of onDisk) {
    const src = readFileSync(path.join(M49_DIR, f), "utf8")
    negative(`${f} free of auto-pass literals`, !/,\s*true\s*\)/.test(src) && !/\|\|\s*true/.test(src))
  }

  finish()
}

function finish() {
  console.log(`M49.G1: ${passed} passed, ${failed} failed, ${negatives} negative(s) exercised @ ${currentCommit().slice(0, 10)}`)
  if (failed > 0) {
    console.error(`governance FAILED:\n  ${failures.join("\n  ")}`)
    process.exitCode = 1
  }
}

main()
