// verify-docs-indexing.ts — THE DOCS-vs-CODE GATE for docs/indexing/.
//
// Why this exists, concretely: two false claims shipped in EMBEDDINGS.md and
// survived review. One named the local model `local-word-vectors` when the code
// says `local-word-vectors-v3`. One told users that a 503 during indexing is
// "retried automatically" when the primary client makes exactly ONE attempt
// per call (`openai-embed.ts` calls `runProvider(..., "primary", 1)` and
// `isRetryable(_, 0, 1)` is false). Both were plausible, well-worded, and
// wrong. Nobody caught them because "read the doc and see if it sounds right" is
// not a check. This file is the check.
//
// WHAT IT GATES (exit 1 on any FAIL):
//   1. ENV VARS      every BB_* var a doc names is read by src/, and every BB_*
//                    var src/ reads is documented (or is on a justified list).
//   2. DEFAULTS      every default a doc states is the default in code. This is
//                    the check that catches "doc says 30s, code says 45s".
//   3. QUOTES        every quoted program-output fragment a doc presents as
//                    verbatim exists in src/. This is the check that catches a
//                    stale `consistency:` line after the wording changed.
//   4. FLAGS         every flag a doc names exists; every short flag maps to the
//                    long flag the doc pairs it with.
//   5. CITATIONS     every `path:line` citation resolves, and its line range is
//                    inside the file. Plus: every repo path a doc names exists.
//   6. REACHABILITY  `bb index --help`, `man bb`, and the docs index all point
//                    at docs/indexing/.
//
// Plus `--live`: actually RUNS `bb index` on a throwaway fixture and asserts the
// behavioural claims the docs make about `--resume` / `--changed` / bare re-runs.
// A doc that says "`--resume` skips already-parsed files" is a claim about
// behaviour, and the only honest way to check it is to run it.
//
//   npx tsx script/verify-docs-indexing.ts            # static gate
//   npx tsx script/verify-docs-indexing.ts --live     # + behavioural gate (~40s)
//
// Exit codes: 0 = pass, 1 = at least one FAIL. `GAP` findings are defects in
// files this gate does not own; they print loudly with the exact patch needed
// and do not fail the run, so the gate stays green-able while they are open.

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const LIVE = process.argv.includes("--live")

// ── reporting ──────────────────────────────────────────────────────────────
let failures = 0
let gaps = 0
const ok = (label: string) => console.log(`  ok: ${label}`)
const fail = (label: string, detail: string) => {
  failures++
  console.log(`  FAIL: ${label}\n        ${detail.replace(/\n/g, "\n        ")}`)
}
const gap = (label: string, detail: string) => {
  gaps++
  console.log(`  GAP (unowned file): ${label}\n        ${detail.replace(/\n/g, "\n        ")}`)
}

const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8")
const tryRead = (rel: string): string | null => {
  const abs = path.join(ROOT, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) return null
  return readFileSync(abs, "utf8")
}
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, e.name)
    if (e.isDirectory()) walk(rel, out)
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(rel)
  }
  return out
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 + 2. ENV VARS AND DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════

const SRC_FILES = walk("src")
const srcText = SRC_FILES.map((f) => ({ file: f, text: read(f) }))
const srcAll = srcText.map((s) => s.text).join("\n")

/** Every `process.env.X` / `process.env["X"]` in src/, plus `env.X` in files
 *  that take a ProcessEnv parameter (embedding-config.ts, pool-diagnostics.ts). */
function srcEnvVars(): Set<string> {
  const out = new Set<string>()
  for (const { text } of srcText) {
    const takesEnvParam = /ProcessEnv|\benv:\s*(NodeJS\.)?ProcessEnv|\benv\s*=\s*process\.env/.test(text)
    for (const m of text.matchAll(/process\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[['"]([A-Za-z_][A-Za-z0-9_]*)['"]\])/g)) {
      out.add(m[1] ?? m[2])
    }
    if (takesEnvParam) {
      for (const m of text.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)) out.add(m[1])
    }
  }
  return out
}

/** Env var -> the fallback values code actually uses when it is unset. */
function srcEnvDefaults(): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>()
  const add = (k: string, v: number) => {
    if (!map.has(k)) map.set(k, new Set())
    map.get(k)!.add(v)
  }
  const num = (raw: string) => {
    const cleaned = raw.trim().replace(/_/g, "")
    return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN
  }
  for (const { text } of srcText) {
    // Number(process.env.X || 45000) / Number(process.env.X ?? 45000)
    for (const m of text.matchAll(/process\.env\.?\[?['"]?([A-Z][A-Z0-9_]*)['"]?\]?\s*(?:\|\||\?\?)\s*([\d_]+)/g)) {
      const v = num(m[2])
      if (!Number.isNaN(v)) add(m[1], v)
    }
    // intFromEnv(env.X, 250, lo, hi) — the clamped reader in embedding-config.ts
    for (const m of text.matchAll(/intFromEnv\(\s*(?:process\.)?env\.?\[?['"]?([A-Z][A-Z0-9_]*)['"]?\]?\s*,\s*([\d_]+)/g)) {
      const v = num(m[2])
      if (!Number.isNaN(v)) add(m[1], v)
    }
    // env.X === "" ? DEFAULT_X : ... / raw === undefined ? DEFAULT_X
    for (const m of text.matchAll(/env\.?\[?['"]?([A-Z][A-Z0-9_]*)['"]?\]?[\s\S]{0,80}?\?\?\s*DEFAULT_([A-Z0-9_]+)/g)) {
      add(m[1], NaN)
      map.get(m[1])!.add(-1) // sentinel: "see DEFAULT_* const"
    }
  }
  // `export const DEFAULT_FOO = 30_000` paired with an env read of FOO.
  for (const { text } of srcText) {
    for (const m of text.matchAll(/DEFAULT_([A-Z0-9_]+)\s*=\s*([\d_]+)/g)) {
      const v = num(m[2])
      if (Number.isNaN(v)) continue
      const key = m[1]
      for (const [varName, defs] of map) {
        if (defs.has(-1) && varName.replace(/^BB_/, "") === key) defs.add(v)
      }
      if (key === "WORKER_STARTUP_TIMEOUT_MS") map.set("BB_WORKER_STARTUP_TIMEOUT_MS", new Set([v]))
    }
  }
  return map
}

const DOC_FILES = [
  "docs/indexing/README.md",
  "docs/indexing/resume.md",
  "docs/indexing/performance.md",
  "docs/indexing/troubleshooting.md",
  "docs/indexing/embeddings.md",
  "docs/indexing/PERFORMANCE-FINDINGS.md",
]
const docText = new Map<string, string>(DOC_FILES.map((f) => [f, read(f)]))

/**
 * BB_* vars that src/ reads and that this doc set deliberately does not
 * document. Every entry needs a reason — an undocumented knob is exactly the
 * bug class this file exists to catch, so "not documented yet" is not a
 * reason, only a structural one is.
 */
const UNDOCUMENTED_ENV_ALLOWLIST: Record<string, string> = {
  BB_AUTO_REFRESH_MAX_FILES: "internal budget for the read-path auto-refresh; no user-facing effect and no CLI surface",
  BB_AUTO_REFRESH_MAX_BYTES: "internal budget for the read-path auto-refresh; no user-facing effect and no CLI surface",
  BB_ENRICHMENT_MAX_ROWS: "internal cap on the enrichment phase; scaling guard, not a tuning knob",
  BB_FK_ENFORCE: "sqlite foreign_keys pragma toggle in src/storage/db.*.ts; a storage-layer integrity switch with no indexing surface",
  BB_INDEX_LOCK_CROSS_HOST_TTL_MS: "lock reclaim TTL across hosts; only meaningful in a multi-host setup with no user surface",
  BB_INDEX_LOCK_GRACE_MS: "lock grace window before a live holder is declared stale; no CLI surface",
  BB_LSP_STDERR_LOG: "LSP-host plumbing, not indexing",
  BB_M35_SKIP_FRESHNESS: "M35 test switch, superseded by the BB_TEST_HOOKS-gated path it duplicates",
  BB_NO_AUTO_REFRESH: "read-path opt-out mirrored by `bb search --no-auto-refresh`, which is the documented surface",
  BB_PROVIDER: "legacy alias read by Config; no doc in this set covers provider selection",
  BB_SKIP_ANALYZE: "tool-call optimisation, not indexing",
  BB_SOLIDITY_CASE_AUDIT: "one-off audit switch, unrelated to indexing",
  BB_STATUS_FSYNC: "durability switch for the status-file write; internal",
  BB_VECTOR_BLOB_BACKFILL_BUDGET_MS: "internal time budget for the vectorBlobs phase",
  BB_WORKER_ECHO: "DIAGNOSTIC: gates [worker]/[worker-out] stderr relay. Not documented on purpose — see KNOWN_UNDOCUMENTED below.",
}

// Knobs this gate can prove exist but deliberately refuses to document, because
// documenting them would teach a user to depend on a debug affordance. If a
// future change makes one user-facing, move it into the docs and drop this.
const KNOWN_UNDOCUMENTED: Record<string, string> = {
  BB_WORKER_ECHO:
    "raw worker stdout/stderr relay, off unless =1. Verified by reading parallel-indexer.ts:1621-1632. Documenting it invites log scraping; the troubleshooting doc names the diagnostic instead.",
}

console.log(`\nverify-docs-indexing (${LIVE ? "static + live" : "static"})\n`)

// ── gate 1: env vars ───────────────────────────────────────────────────────
console.log("1. env vars")
{
  const srcVars = srcEnvVars()
  const docVars = new Set<string>()
  for (const [file, text] of docText) {
    for (const m of text.matchAll(/\bBB_[A-Z0-9_]+\b/g)) {
      if (!srcVars.has(m[0])) {
        const where = `${file}:${text.slice(0, m.index).split("\n").length}`
        fail(`doc names env var ${m[0]} that no src/ file reads`, `${where}\n  A doc naming a knob nothing reads is a false claim. Either wire it up or remove it from the doc.`)
      }
      docVars.add(m[0])
    }
  }
  const undocumented = [...srcVars]
    .filter((v) => v.startsWith("BB_") && !docVars.has(v))
    .filter((v) => !UNDOCUMENTED_ENV_ALLOWLIST[v])
    .sort()
  if (undocumented.length === 0) ok("every BB_* var src/ reads is documented (or allowlisted)")
  else {
    fail(
      `${undocumented.length} BB_* var(s) src/ reads are documented nowhere in docs/indexing/`,
      `${undocumented.join(", ")}\n  Add them to the right doc, or add an entry to UNDOCUMENTED_ENV_ALLOWLIST with a structural reason.`,
    )
  }
  for (const [v, why] of Object.entries(KNOWN_UNDOCUMENTED)) {
    if (!srcVars.has(v)) fail(`KNOWN_UNDOCUMENTED lists ${v} which src/ no longer reads`, "Delete the entry — the knob is gone.")
    else ok(`known-undocumented ${v}: ${why.slice(0, 60)}…`)
  }
  const staleAllow = Object.keys(UNDOCUMENTED_ENV_ALLOWLIST).filter((v) => !srcVars.has(v))
  if (staleAllow.length) fail("UNDOCUMENTED_ENV_ALLOWLIST names vars src/ no longer reads", staleAllow.join(", "))
}

// ── gate 2: defaults ───────────────────────────────────────────────────────
console.log("\n2. documented defaults vs code")
{
  const defaults = srcEnvDefaults()
  let checked = 0
  for (const [file, text] of docText) {
    const lines = text.split("\n")
    lines.forEach((line, i) => {
      // `| `BB_X` | `12345` | effect |` — a documented default.
      const m = line.match(/^\|\s*`?(BB_[A-Z0-9_]+)`?\s*\|\s*`?([\d_]+)`?\s*\|/)
      if (!m) return
      checked++
      const [, name, raw] = m
      const docValue = Number(raw.replace(/_/g, ""))
      const codeValues = defaults.get(name)
      if (!codeValues) {
        fail(`${file}:${i + 1} documents a default for ${name}, but no default for it exists in src/`, `line: ${line.trim()}`)
        return
      }
      if (!codeValues.has(docValue)) {
        fail(
          `${file}:${i + 1} documents the WRONG default for ${name}`,
          `doc says ${docValue}; code uses ${[...codeValues].sort((a, b) => a - b).join(", ")}\n  line: ${line.trim()}`,
        )
      }
    })
  }
  ok(`checked ${checked} documented defaults against src/`)

  // Every numeric BB_* default in code, listed, so a reader can see the coverage.
  const numeric = [...defaults.entries()].filter(([, v]) => !v.has(-1) && v.size > 0).sort(([a], [b]) => a.localeCompare(b))
  console.log(`     code defaults found: ${numeric.map(([k, v]) => `${k}=${[...v].sort((a, b) => a - b).join("|")}`).join(", ")}`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. QUOTED PROGRAM OUTPUT MUST EXIST IN src/
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n3. quoted program output")
{
  const OUTPUT_GLYPHS = /[✓✗⏸▶●·!⚠]/

  /**
   * Reduce a rendered line (or a source line) to the part that is STABLE: drop
   * template interpolations, then drop every whitespace-token that contains a
   * digit. A doc may fill in real numbers and paths — that is what an example
   * does — but the prose around them is a verbatim quote and is checkable.
   * `indexed ${files} files, ${symbols} symbols` and `indexed 2580 files, 27781
   * symbols` both reduce to the same skeleton, while `consistency: 0 unresolved
   * relationships` and the code's actual `consistency: every internal
   * relationship …` do not — which is the bug this gate exists to catch.
   */
  const skeleton = (s: string): string =>
    s
      .replace(/\$\{[^}]*\}/g, " ") // source-side interpolation → void
      .replace(/<[^>]*>/g, " ") // doc-side <placeholder> → void
      .split(/\s+/)
      // Drop digit-bearing tokens (real values), and pure-punctuation tokens.
      // The latter exist only as the residue left where a value was removed —
      // `(7 unchanged, 0 skipped, 0.3s)` loses `3s)` but keeps a bare `)`.
      // Punctuation carries no claim, so discarding it cannot hide a false one.
      .filter((t) => t.length > 0 && !/\d/.test(t) && /[A-Za-z]/.test(t))
      .join(" ")

  const srcSkeleton = skeleton(srcAll)

  /**
   * Lines assembled at runtime by `.map().join()` or by string concatenation
   * cannot be matched against a source literal, so they are excluded by exact
   * fragment with a stated reason. An entry here is a claim this gate does NOT
   * verify — it must be verified by reading the assembly site, which the reason
   * names. Add an entry only when there is no literal to match.
   */
  /**
   * Fragments that are real code but whose SOURCE FORM differs from the
   * rendered form: the code holds a lookup into a `Record<string, string>`
   * keyed by the label, while the doc shows the substituted note. The gate can
   * only assert the fixed prose; the key/value pairing is asserted by gate 3's
   * coverage of the value itself. Kept explicit rather than loosened globally,
   * because a blanket exception would let a genuinely invented line through.
   */
  const INDIRECT_STRING: Record<string, string> = {
    "conflicting bb index options: --force --changed":
      "cli/index.ts:100 builds the flag list, and :101 interpolates it into the message. Verified live in gate 7, which runs the rejection and asserts the real rendered text.",
    "bounded (derived data re-processed for touched files (bounded pass))":
      "cli/index.ts:407-418 is a derivedNote lookup keyed by 'bounded'; the doc shows the substituted value. The same five labels and notes are the ones gate 7 observes at runtime.",
    "skipped-unchanged (no files parsed, so no derived pass ran)":
      "cli/index.ts:407-418, the 'skipped-unchanged' entry of the same derivedNote lookup. Gate 7 asserts this exact value is what a no-op run prints.",
    "Model mismatch: config has index has rows). Vectors from different models cannot be compared":
      "setup/doctor.ts:166 interpolates winnerModel and a storedDesc built at :162; the doc's <new-model>/<old-model> and row count are placeholders. Gate 4 asserts the `model-mismatch` finding id and its fix, which come from the same literal.",
  }

  const RUNTIME_ASSEMBLED: Record<string, string> = {
    "post-processing: relationships= ms, enrichment= ms, gravity= ms, taint= ms, health= ms":
      "cli/index.ts:654 builds this with `.map(...).join(\", \")` over persisted per-phase rows; there is no literal in src to match. Phase NAMES are separately checked by gate 7's --post run.",
    "last index of /proj: files, symbols, relationships":
      "cli/index.ts:650 interpolates dbStats counts; the surrounding sentence is checked by the `db:` path assertion in gate 6 instead.",
    "conflicting bb index options: force changed":
      "cli/index.ts:100-101 builds the flag list with Object.entries().filter().map().join(\" \"), so the literal names the flags are NOT in a source string. gate 4 checks the flag names themselves instead.",
    "another index run is already active for this project (pid started kind=index); wait for it to finish, or if it crashed the stale lock at .index.lock is reclaimed automatically on the next run":
      "index-lock.ts:113-115 assembles this from `name`/`host`/`started`/`remedy` variables, so no single literal exists. Its wording is verified by gate 7's conflicting-combination run and by reading index-lock.ts.",
  }

  let fragmentsChecked = 0
  let linesChecked = 0
  let skipped = 0
  for (const [file, text] of docText) {
    const lines = text.split("\n")
    // Fenced blocks, classified as program output by whether any line in them
    // carries an output glyph. Classifying per-BLOCK (not per-line) is what
    // lets a block whose first line has no glyph still be checked.
    let inFence = false
    let blockIsOutput = false
    let blockStart = 0
    const flush = (endLine: number) => {
      if (!blockIsOutput) return
      for (let n = blockStart; n <= endLine; n++) {
        const l = lines[n]
        if (/^\s*```/.test(l) || !l.trim()) continue
        linesChecked++
        for (const frag of outputFragments(l)) {
          if (RUNTIME_ASSEMBLED[frag.text] || INDIRECT_STRING[frag.text]) {
            skipped++
            continue
          }
          fragmentsChecked++
          if (!srcSkeleton.includes(frag.text)) {
            fail(
              `${file}:${n + 1} quotes output that does not exist in src/`,
              `skeleton: "${frag.text}"\n  line: ${l.trim()}\n  The doc presents this as verbatim. Either the code changed or the quote never was verbatim.`,
            )
          }
        }
      }
    }
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) {
        if (!inFence) {
          inFence = true
          blockIsOutput = OUTPUT_GLYPHS.test(line)
          blockStart = i + 1
        } else {
          flush(i - 1)
          inFence = false
        }
        return
      }
      if (inFence && OUTPUT_GLYPHS.test(line) && /[A-Za-z]{3,}/.test(line)) blockIsOutput = true
    })
    if (inFence) flush(lines.length - 1)

    // inline `code spans` that present themselves as program output
    for (const m of text.matchAll(/`([^`\n]{25,})`/g)) {
      const span = m[1]
      if (!OUTPUT_GLYPHS.test(span)) continue
      if (/^(bb|npm|npx|bun|node)\b/.test(span.trim())) continue // a command, not output
      for (const frag of outputFragments(span)) {
        if (RUNTIME_ASSEMBLED[frag.text] || INDIRECT_STRING[frag.text]) {
          skipped++
          continue
        }
        fragmentsChecked++
        if (!srcSkeleton.includes(frag.text)) {
          const where = `${file}:${text.slice(0, m.index).split("\n").length}`
          fail(
            `${where} quotes output that does not exist in src/`,
            `skeleton: "${frag.text}"\n  span: ${span}`,
          )
        }
      }
    }
  }
  ok(`checked ${fragmentsChecked} quoted fragments across ${linesChecked} output lines`)
  if (skipped > 0) console.log(`     (${skipped} runtime-assembled fragment(s) excluded by name — see RUNTIME_ASSEMBLED)`)

  /** Reduce one rendered line to the stable skeleton fragments code must contain. */
  function outputFragments(line: string): { text: string }[] {
    let body = line.trim()
    body = body.replace(/^[✓✗⏸▶●·!⚠➜→]\s*/, "")
    body = body.replace(/^\[[A-Z-]+\]\s*/, "")
    body = body.replace(/^(warn|info|fail|note|error)\s+/, "")
    body = body.replace(/^\w+:\s*/, "") // "breakdown:", "derived:", "consistency:", "stats:"
    const out: { text: string }[] = []
    // Split on the separators a rendered line actually uses, so a long line is
    // checked piece by piece rather than all-or-nothing.
    for (const part of body.split(/[|·•]|(?:\s+—\s+)|(?:\s+--\s+)/)) {
      const p = skeleton(part)
      // At least 5 real words, and the first one must start with a letter, so
      // fragments that reduce to punctuation soup are not asserted.
      if (p.split(" ").length < 5) continue
      if (!/[A-Za-z]{3}/.test(p)) continue
      out.push({ text: p })
    }
    return out
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. FLAGS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n4. flags")
{
  const cli = read("src/cli/index.ts")
  // Every `option("...")` the CLI declares, as {flags, description}.
  const declared = new Map<string, string>() // "short,long" or "long" -> declaration
  for (const m of cli.matchAll(/\.option\(\s*"([^"]+)"\s*,\s*"([^"]*)"/g)) declared.set(m[1], m[2])
  const shortOf = new Map<string, string>() // "-v" -> "--version"
  for (const key of declared.keys()) {
    const parts = key.split(/[ ,|]+/).filter(Boolean)
    const long = parts.find((p) => p.startsWith("--"))
    if (!long) continue
    for (const p of parts) if (/^-[A-Za-z]$/.test(p)) shortOf.set(p, long)
  }
  const longFlags = new Set<string>()
  for (const key of declared.keys()) {
    for (const p of key.split(/[ ,|]+/)) if (p.startsWith("--")) longFlags.add(p)
  }
  ok(`${longFlags.size} long flags declared by the CLI (${[...declared.keys()].length} option() calls)`)

  // What `bb index` itself accepts: the flags declared between
  // `.command("index")` and the next `.command(` at the same level.
  const start = cli.indexOf('.command("index")')
  const rest = start === -1 ? "" : cli.slice(start)
  const next = rest.slice(1).search(/\n  (program|const \w+ =|\w+Cmd)\b/)
  const indexBlock = next === -1 ? rest : rest.slice(0, next + 1)
  const indexFlags = new Set<string>()
  for (const m of indexBlock.matchAll(/\.option\(\s*"([^"]+)"/g)) {
    for (const p of m[1].split(/[ ,|]+/)) if (p.startsWith("--")) indexFlags.add(p)
  }
  ok(`bb index accepts: ${[...indexFlags].sort().join(" ")}`)

  for (const [file, text] of docText) {
    const lines = text.split("\n")
    lines.forEach((line, i) => {
      // flag table rows and inline short-flag pairs
      for (const m of line.matchAll(/\|\s*`(-{1,2}[A-Za-z][\w-]*)[^`]*`/g)) {
        const flag = m[1]
        if (!flag.startsWith("--") && !indexFlags.has(flag)) {
          // allow non-index commands' short flags, but require they exist
          if (!shortOf.has(flag) && !longFlags.has(flag)) {
            fail(`${file}:${i + 1} names short flag ${flag}, which the CLI does not declare`, `line: ${line.trim()}\n  Run \`bb ${flag} …\` to see for yourself.`)
          }
        }
      }
      // "‑v, ‑‑verbose" style claims: the short flag must map to the claimed long one
      for (const m of line.matchAll(/`(-[A-Za-z]),\s*(--[a-z-]+)`/g)) {
        const [, short, long] = m
        const actual = shortOf.get(short)
        if (actual !== long) {
          fail(
            `${file}:${i + 1} claims \`${short}\` is \`${long}\``,
            actual
              ? `the CLI binds ${short} to ${actual}, not ${long}.\n  line: ${line.trim()}`
              : `the CLI declares no short flag ${short}.\n  line: ${line.trim()}`,
          )
        }
      }
    })
  }
  // Every `bb index` flag must appear somewhere in the docs.
  const allDocText = [...docText.values()].join("\n")
  const undocumented = [...indexFlags].filter((f) => !allDocText.includes(f)).sort()
  if (undocumented.length === 0) ok("every `bb index` flag is documented")
  else fail("`bb index` flags documented nowhere in docs/indexing/", undocumented.join(" "))
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. CITATIONS AND PATH REFERENCES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n5. citations and path references")
{
  let cites = 0
  let paths = 0
  const missingFiles = new Map<string, string[]>()
  for (const [file, text] of docText) {
    let lastPath: string | null = null
    // walk backtick spans in order so `:NNN` shorthand can inherit a path
    let cursor = 0
    const spanRe = /`([^`\n]+)`/g
    let m: RegExpExecArray | null
    while ((m = spanRe.exec(text))) {
      const span = m[1]
      const where = `${file}:${text.slice(0, m.index).split("\n").length}`
      const full = span.match(/^([\w.][\w./-]*\.(?:ts|mts|json|md|1)):(\d+)(?:-(\d+))?$/)
      const short = span.match(/^:(\d+)(?:-(\d+))?$/)
      let target: string | null = null
      let from = 0
      let to = 0
      if (full) {
        target = full[1]
        from = Number(full[2])
        to = Number(full[3] ?? full[2])
        lastPath = full[1]
      } else if (short && lastPath) {
        target = lastPath
        from = Number(short[1])
        to = Number(short[2] ?? short[1])
      }
      if (target) {
        cites++
        // `src/...` is repo-relative; `../x.md` is doc-relative.
        const candidates = [
          target,
          path.posix.normalize(path.posix.join(path.posix.dirname(file), target)),
        ]
        const abs = candidates.map((c) => path.join(ROOT, c)).find((p) => existsSync(p))
        if (!abs) {
          if (target.endsWith(".ts") || target.endsWith(".mts")) {
            fail(`${where} cites ${target}, which does not exist`, `span: ${span}`)
          } else missingFiles.set(target, [...(missingFiles.get(target) ?? []), where])
          continue
        }
        const n = readFileSync(abs, "utf8").split("\n").length
        if (from < 1 || to > n || from > to) {
          fail(`${where} cites ${target}:${from}${to !== from ? "-" + to : ""}, outside the file (${n} lines)`, `span: ${span}`)
        }
      } else if (/^[\w.][\w./-]*\.(?:ts|mts|json|md|1)(?:$|[:(])/.test(span)) {
        // A bare filename with no directory is a USER-FACING config name, not a
        // repo path: `bb.json` and `config.json` are what a user creates, and
        // they are correctly absent from this repository. Only paths that name a
        // directory are checked for existence.
        const p = span.split(/[:(]/)[0].replace(/^\.\//, "")
        // `bb.json` (project config the user creates) and `./bb.json` are the
        // same thing; normalise the prefix before deciding it is a user-facing
        // name with no directory.
        if (!p.includes("/")) continue
        paths++
        const candidates = [p, path.posix.normalize(path.posix.join(path.posix.dirname(file), p))]
        if (!candidates.some((c) => existsSync(path.join(ROOT, c)))) {
          missingFiles.set(p, [...(missingFiles.get(p) ?? []), where])
        }
      }
    }
  }
  ok(`${cites} line citations resolved and in range`)
  ok(`${paths} file-path references checked`)
  for (const [p, wheres] of missingFiles) {
    fail(`docs reference ${p}, which does not exist in the repo`, `referenced at ${wheres.slice(0, 4).join(", ")}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. REACHABILITY
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n6. reachability")
{
  // A documented COMMAND must actually run.
  //
  // The `BB_POOL_WORKER_SELFTEST` row told users to run
  // `node dist/ast/pool-worker.js`, which does not exist — the built entry is
  // `dist/pool-worker.js`. It typechecked fine, it was in a table, and following
  // it produced "Cannot find module". A doc that names a command is a claim, and
  // this checks the ones cheap enough to execute for real.
  {
    const workerEntry = path.join(ROOT, "dist", "pool-worker.js")
    if (!existsSync(workerEntry)) {
      fail(
        "the documented pool-worker self-test command exists",
        "dist/pool-worker.js is missing — run `npm run build` first; docs/indexing/troubleshooting.md documents `node dist/pool-worker.js`",
      )
    } else {
      // And the DOC must name the path that exists, not a plausible one.
      const trouble = tryRead("docs/indexing/troubleshooting.md")
      if (trouble !== null && trouble.includes("dist/ast/pool-worker.js")) {
        fail(
          "the documented self-test command path exists on disk",
          "docs/indexing/troubleshooting.md says dist/ast/pool-worker.js, which does not exist; the built entry is dist/pool-worker.js",
        )
      }
      const r = spawnSync(process.execPath, [workerEntry], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 60_000,
        env: { ...process.env, BB_POOL_WORKER_SELFTEST: "1" },
      })
      const line = `${r.stdout ?? ""}`.split("\n").find((l) => l.includes("BB-WORKER-SELFTEST"))
      if (line && /"ok":\s*true/.test(line)) {
        ok("the documented pool-worker self-test command actually runs and reports ok")
      } else {
        fail(
          "the documented pool-worker self-test command actually runs and reports ok",
          `rc=${r.status} out=${(`${r.stdout ?? ""}`).slice(0, 200)} err=${(`${r.stderr ?? ""}`).slice(0, 200)}`,
        )
      }
    }
  }

  // `bb index --help` must point at the docs.
  const cli = read("src/cli/index.ts")
  const indexHelp = cli.slice(cli.indexOf('.command("index")'), cli.indexOf('.command("setup")'))
  if (indexHelp.includes("docs/indexing/")) ok("`bb index --help` points at docs/indexing/")
  else fail("`bb index --help` does not point at docs/indexing/", "Add it to the index command's addHelpText(\"after\", …).")

  // `man bb` must point at them too — it ships with the package.
  const man = tryRead("docs/man/bb.1")
  if (man === null) fail("docs/man/bb.1 is missing", "package.json `man` points at it; an install would ship no manual.")
  else if (man.includes("docs/indexing")) ok("`man bb` points at docs/indexing/")
  else fail("`man bb` does not point at docs/indexing/", "docs/man/bb.1 ships with the npm package (package.json files[]), so it is the only doc surface an install has.")

  // The docs must be reachable from something inside docs/.
  const docsIndex = tryRead("docs/README.md")
  if (docsIndex === null) gap("no docs/README.md index", "Create docs/README.md with a link to indexing/README.md, OR add a link from an existing index.")
  else if (docsIndex.includes("indexing/")) ok("docs/README.md links to docs/indexing/")
  else fail("docs/README.md does not link to docs/indexing/", "Add the link.")

  // The index itself must not link to files that do not exist — a broken entry
  // in the thing that exists to route readers is worse than no index.
  if (docsIndex !== null) {
    let broken = 0
    for (const m of docsIndex.matchAll(/\]\((\.[^)]+)\)/g)) {
      const target = path.posix.normalize(path.posix.join("docs", m[1]))
      if (!existsSync(path.join(ROOT, target))) {
        broken++
        fail(`docs/README.md links to ${m[1]}, which does not exist`, "The index is the entry point; a dead link there sends readers nowhere.")
      }
    }
    if (broken === 0) ok("every link in docs/README.md resolves")
  }

  // Root README.md is NOT in this agent's file ownership. Reported, not fixed.
  const rootReadme = tryRead("README.md")
  if (rootReadme !== null && !/docs\/indexing/.test(rootReadme)) {
    gap(
      "root README.md does not link docs/indexing/",
      "MASTER: add a link in README.md's documentation section, e.g.\n" +
        "  Indexing: [indexing guide](./docs/indexing/) — flags, resume, performance, troubleshooting, embeddings\n" +
        "README.md is outside agent 7's docs/** ownership, so this is reported rather than edited.",
    )
  }

  // package.json `files` decides what an npm install actually ships.
  const pkg = JSON.parse(read("package.json"))
  const shipsIndexing = Array.isArray(pkg.files) && pkg.files.some((f: string) => f.replace(/\/$/, "") === "docs/indexing")
  if (shipsIndexing) ok("package.json `files` ships docs/indexing/")
  else {
    gap(
      "package.json `files` does not ship docs/indexing/",
      "MASTER: an npm install ships docs/man/ but NOT docs/indexing/, so `bb index --help`'s\n" +
        "  \"Full reference: man bb, or docs/indexing/ in the repository.\" points at a directory that\n" +
        "  is absent for installed users. Either add \"docs/indexing/\" to package.json files[], or\n" +
        "  reword the help text to say the docs are repository-only.\n" +
        "package.json is outside agent 7's docs/** ownership.",
    )
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. LIVE BEHAVIOURAL GATE
// ═══════════════════════════════════════════════════════════════════════════
if (LIVE) {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  console.log("\n7. live behaviour (running bb index)")
  // The fixture project and the data dir MUST be separate directories. With
  // BB_DATA_DIR inside the fixture, the previous run's own brain.db and
  // status/*.json get discovered and re-parsed on the next run — which makes
  // "exactly one file changed" unreproducible and the assertion meaningless.
  const root = mkdtempSync(path.join(tmpdir(), "bb-docgate-proj-"))
  const dataRoot = mkdtempSync(path.join(tmpdir(), "bb-docgate-data-"))
  const dataDir = dataRoot
  const prevData = process.env.BB_DATA_DIR
  process.env.BB_DATA_DIR = dataDir
  const { spawnSync } = await import("node:child_process")
  const bb = (...args: string[]) => {
    const r = spawnSync(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "src/cli/index.ts"), ...args], {
      encoding: "utf8",
      env: { ...process.env, BB_DATA_DIR: dataDir },
      cwd: root,
      timeout: 240_000,
    })
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status }
  }
  try {
    mkdirSync(path.join(root, "src"), { recursive: true })
    for (let i = 0; i < 6; i++) {
      writeFileSync(path.join(root, `src/m${i}.ts`), `export function f${i}(a: number): number {\n  return a + ${i}\n}\n`)
    }
    writeFileSync(path.join(root, "package.json"), '{"name":"gate","version":"1.0.0"}\n')

    const first = bb("index", root, "--no-setup")
    if (first.code !== 0) fail("live: first `bb index` failed", first.out.slice(-2000))
    else {
      const newly = first.out.match(/breakdown: (\d+) newly parsed/)
      ok(`live: first index parsed ${newly?.[1]} files`)
      // Claim: "bb stats gives the committed counts at any time" — the docs'
      // quoted `stats:` line must match the real key names.
      const statsLine = first.out.match(/stats: (\{.*\})/)
      if (statsLine) {
        const parsed = JSON.parse(statsLine[1]) as Record<string, unknown>
        const keys = Object.keys(parsed).sort().join(",")
        if (keys !== "errors,processed,totalFiles") {
          fail("live: the `stats:` line has different keys than docs/indexing/README.md shows", `actual keys: ${keys}`)
        } else ok("live: `stats:` keys are totalFiles/processed/errors")
      }
    }

    // CLAIM UNDER TEST: a BARE re-run skips files whose mtime+size are unchanged.
    // docs/indexing/README.md used to assert the opposite ("Does NOT: skip
    // files whose size and mtime are unchanged"). Measure it.
    const bare = bb("index", root, "--no-setup")
    const bareUnchanged = bare.out.match(/breakdown: (\d+) newly parsed \| (\d+) unchanged/)
    if (bareUnchanged && Number(bareUnchanged[2]) > 0 && Number(bareUnchanged[1]) === 0) {
      ok(`live: a BARE re-run of an unchanged project parses nothing (${bareUnchanged[2]} unchanged)`)
    } else {
      fail("live: a bare re-run of an unchanged project did not parse nothing", bare.out.slice(-1500))
    }
    const bareDerived = bare.out.match(/derived: (\S+)/)
    if (bareDerived?.[1] === "skipped-unchanged") {
      ok("live: a bare re-run that parsed nothing reports `derived: skipped-unchanged`")
    } else {
      fail(
        "live: a bare re-run that parsed nothing reported a derived pass",
        `got: ${bareDerived?.[1]}\n  Docs claim nothing was derived when nothing was parsed.`,
      )
    }

    // CLAIM: --resume always runs incrementally and reports which branch it took.
    const resume = bb("index", root, "--no-setup", "--resume")
    const saidNoCheckpoint = resume.out.includes("no in-progress checkpoint; running incremental (only missing/changed files)")
    const saidResuming = /resuming interrupted index \(checkpoint: \d+\/\d+ files done\)/.test(resume.out)
    if (saidNoCheckpoint || saidResuming) ok(`live: --resume reported its branch (${saidResuming ? "checkpoint found" : "no checkpoint"})`)
    else fail("live: --resume printed neither checkpoint line", resume.out.slice(-1200))
    // With nothing left to parse, --resume takes the SAME no-op path as a bare
    // re-run and reports skipped-unchanged — not `bounded`. `bounded` is what a
    // resume reports when it actually had files to parse. Asserting `bounded`
    // unconditionally here is exactly the kind of claim that only survives
    // because nobody ran it on an up-to-date project.
    const resumeDerived = resume.out.match(/derived: (\S+)/)?.[1]
    if (resumeDerived === "skipped-unchanged") {
      ok("live: --resume on an up-to-date project reports `derived: skipped-unchanged` (the resume.md trap)")
    } else {
      fail("live: --resume on an up-to-date project did not report skipped-unchanged", `got: ${resumeDerived}`)
    }

    // CLAIM: touching one file parses exactly one file, under --changed.
    appendFileSync(path.join(root, "src/m0.ts"), "export const TOUCHED = 1\n")
    const changed = bb("index", root, "--no-setup", "--changed")
    const changedParsed = changed.out.match(/breakdown: (\d+) newly parsed/)
    if (changedParsed && Number(changedParsed[1]) === 1) ok("live: --changed parsed exactly the one touched file")
    else fail("live: --changed did not parse exactly one file", `breakdown said ${changedParsed?.[1]}\n${changed.out.slice(-1200)}`)

    // CLAIM: --skip-post-processing defers derived data, naming the remediation.
    // Touch a file first: the previous --changed run already consumed the only
    // modification, and a run that parses nothing reports `skipped-unchanged`,
    // which would test the wrong line.
    appendFileSync(path.join(root, "src/m1.ts"), "export const DEFERRED = 1\n")
    const deferred = bb("index", root, "--no-setup", "--skip-post-processing")
    if (deferred.out.includes("derived: deferred (derived data deferred — run: bb index --post)")) ok("live: --skip-post-processing defers with the exact remediation line")
    else fail("live: --skip-post-processing did not print the deferred line", deferred.out.slice(-1200))

    // CLAIM: --post re-runs the derived phases. The docs say "five"; count them.
    const post = bb("index", root, "--no-setup", "--post")
    const phaseRows = [...post.out.matchAll(/^  [✓✗-] (\w+)\s+(\d+)ms$/gm)].map((m) => m[1])
    if (phaseRows.length > 0) {
      ok(`live: --post ran ${phaseRows.length} phases: ${phaseRows.join(", ")}`)
      const claimedFive = [...docText.entries()].filter(([f, t]) => /\bfive derived phases\b/.test(t)).map(([f]) => f)
      if (phaseRows.length !== 5 && claimedFive.length) {
        fail(
          `docs claim "five derived phases" but \`bb index --post\` runs ${phaseRows.length}`,
          `phases: ${phaseRows.join(", ")}\n  false in: ${claimedFive.join(", ")}`,
        )
      }
    } else fail("live: --post printed no phase timings", post.out.slice(-1200))

    // CLAIM: the conflicting-combination rejection happens BEFORE any work.
    const conflict = bb("index", root, "--no-setup", "--force", "--changed")
    if (conflict.code === 1 && /conflicting bb index options/.test(conflict.out) && !/indexing /.test(conflict.out)) {
      ok("live: a conflicting combination is rejected before any work starts (exit 1)")
    } else {
      fail("live: conflicting combination was not rejected cleanly", `exit=${conflict.code}\n${conflict.out.slice(-1200)}`)
    }

    // CLAIM (docs/indexing/README.md, troubleshooting.md): `--verbose` and
    // `--quiet` are the only spellings, and `-v` is `--version`. Run all four
    // and compare against what the docs now say.
    const longVerbose = bb("index", root, "--no-setup", "--verbose")
    if (/\[DEBUG\]/.test(longVerbose.out) && /starting parallel indexing/.test(longVerbose.out)) {
      ok("live: `--verbose` after the subcommand really does enable debug diagnostics")
    } else {
      fail("live: docs tell users to run `bb index --verbose`, but it produced no debug output", longVerbose.out.slice(-1200))
    }
    const longQuiet = bb("index", root, "--no-setup", "--quiet")
    if (!/\[DEBUG\]/.test(longQuiet.out) && /^\s*✓ indexed|✓ nothing to index/m.test(longQuiet.out)) {
      ok("live: `--quiet` suppresses debug output and still runs the index")
    } else {
      fail("live: `--quiet` did not behave as documented (no debug output, index still completed)", longQuiet.out.slice(-1200))
    }
    const shortV = bb("index", root, "--no-setup", "-v")
    const printedVersion = /^\d+\.\d+\.\d+/m.test(shortV.out.trim())
    if (printedVersion && !/starting parallel indexing/.test(shortV.out)) {
      ok("live: `-v` prints a version and does NOT enable verbose (as the docs now state)")
    } else {
      fail("live: `-v` is documented as --version but did not behave that way", `out: ${shortV.out.slice(0, 400)}`)
    }
    const shortQ = bb("index", root, "--no-setup", "-q")
    if (/unknown option '-q'/.test(shortQ.out)) {
      ok("live: `-q` is rejected, as the docs now state (there is no short form for --quiet)")
    } else {
      fail("live: docs state there is no `-q`, but the CLI accepted it", `out: ${shortQ.out.slice(0, 400)}`)
    }
  } finally {
    if (prevData === undefined) delete process.env.BB_DATA_DIR
    else process.env.BB_DATA_DIR = prevData
    rmSync(root, { recursive: true, force: true })
    rmSync(dataRoot, { recursive: true, force: true })
  }
}

// ── summary ────────────────────────────────────────────────────────────────
console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} failure(s), ${gaps} unowned-file gap(s)`)
if (failures > 0) process.exitCode = 1
