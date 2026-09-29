// script/m12/differential-provenance.ts — what an M12 differential artifact was
// measured ON, recorded inside the artifact itself.
//
// Why this exists. `validation/m12/results/<lang>-differential.json` claims a
// precision/recall for a language. Nothing in the tree recorded what code that
// number described, so a `precision: 1.000` could outlive its own analyzer
// indefinitely. #893 is exactly that: the groovy artifact's content was written
// at bafcce7a, then carried UNCHANGED through four more commits while the
// analyzer changed 12 times beneath it — including 62239b9d, whose subject is
// "commit regenerated milestone evidence at HEAD" and which re-committed
// byte-identical content against a tree that measures 0.861, not 1.000. The
// artifact was false at the commit that claimed to regenerate it, and no gate
// noticed because the artifact recorded no inputs to compare against.
//
// So: an artifact now carries a fingerprint of its inputs, and
// `verify-differential-freshness.ts` recomputes them and fails when they move.
//
// What is a HARD input (deterministic, in git, a mismatch is a real staleness):
//
//   1. the analyzer source and its relative-import closure under `src/` —
//      including shared modules like `engine.ts`, because those determine
//      extraction just as much as the per-language file does, MINUS the sibling
//      per-language analyzers (see LANE-DISJOINT SIBLINGS below);
//   2. every fixture file under `validation/m12/fixtures/<lang>/`;
//   3. the ground truth `validation/m12/ground-truth/<lang>.json`;
//   4. the grammar source `grammars/tree-sitter-<lang>/grammar.js` when the
//      grammar lives in-tree.
//
// LANE-DISJOINT SIBLINGS. The closure is over-inclusive BY DESIGN — "a missed
// edge here widens what goes unverified" — and that instinct is right for
// everything except one class. `real-<lang>-analyzer.ts` imports `engine.ts`,
// and `engine.ts` reaches all 41 analyzers through a dynamic
// `import("./real-<lang>-analyzer")` inside its analyzer factory, so the regex
// sweep pulls every sibling into every lane's closure. That is 59 src files for a
// lane whose own analyzer is one of them.
//
// The siblings are genuinely unreachable: `ASTEngine.getAnalyzer(language)`
// dispatches on the language string, so parsing a `.css` file constructs
// `RealCssAnalyzer` and nothing else. A sibling analyzer cannot alter this lane's
// extraction.
//
// Measured, at `c3468eb4` with two sibling analyzers dirty in the shared tree:
// **18 of 18** pinned artifacts reported STALE and **12 of those 18 were stale
// ONLY over sibling files they cannot execute** — css, clean, clojure, elixir,
// erlang, fsharp, groovy, haskell, objective-c, ruby, scala, swift. The gate was
// 0/18 green, i.e. UNIFORMLY RED, which is the no-signal shape: a gate that is
// always red is not a gate. It is also the exact failure the W7 resolution
// already ruled against for the regex census — "the gates re-scanned the working
// tree, so a foreign in-flight wave could hold a global gate red … Committed
// truth is now the only fatal comparison; working-tree drift is printed in full
// and fatal only under `--require-clean`". This module had reintroduced it
// through the import closure.
//
// So: siblings move OUT of the hard set and INTO `siblings`, which is recorded
// with the same fingerprints and REPORTED as drift by the caller. Nothing is
// silently ignored — a sibling's movement stays visible on every lane — it
// simply stops being fatal for a lane that cannot execute it. Every shared
// extraction module (`engine.ts`, `type-inference.ts`,
// `framework-intelligence.ts`, `language-detection.ts`, `override-context.ts`,
// `test-classification.ts`) stays hard, because those DO determine extraction
// for every language.
//
// What is INFORMATIONAL (recorded, never a hard failure): the resolved parser
// wasm — path, size, sha256. It cannot be a hard input for two measured
// reasons: most grammars resolve out of `node_modules`, and the wasm is not
// byte-reproducible (`tree-sitter build --wasm` differs between builds of
// identical source; recorded in reviews/m59-841-assert-comma-separator.md).
// Making it hard would fail every artifact after every rebuild, including
// rebuilds that change no behaviour — the false-positive mode this repo has
// already been burned by. It is still recorded, so a reader can see which
// parser an artifact's numbers came from.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
// The alias-aware analyzer-path rule already has one owner. Duplicating it here is
// the "rules that live in two places" shape this repo has paid for twice, and the
// objc spelling (`real-objective-c-analyzer.ts`) is exactly the case that would
// drift.
import { analyzerFileFor as aliasAwareAnalyzerFileFor } from "../m60/family-closure"

export type FileFingerprint = { sha256: string; bytes: number }

export type Inputs = {
  /** Hard inputs: path (repo-relative) -> fingerprint. */
  files: Record<string, FileFingerprint>
  /** Digest over `files`, order-independent. */
  digest: string
  /** Informational: the parser artifact this run resolved. */
  parser: { path: string; sha256: string; bytes: number } | null
  /**
   * Informational: the per-language analyzers of OTHER languages, which are in
   * the import closure but provably cannot affect this lane's extraction. Their
   * fingerprints are recorded and their drift is REPORTED, so nothing is hidden
   * — they are simply not fatal for a lane that cannot execute them. See the
   * LANE-DISJOINT SIBLINGS note in the header.
   */
  siblings?: Record<string, FileFingerprint>
  /** Languages whose analyzer file could not be located. Never silently empty. */
  unresolved?: string
}

export function sha256File(abs: string): FileFingerprint {
  const buf = readFileSync(abs)
  return { sha256: createHash("sha256").update(buf).digest("hex"), bytes: buf.length }
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/** Repo-relative, POSIX separators, so fingerprints are machine-independent. */
function rel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/")
}

/**
 * The analyzer file for a language, by the tree's own convention. `framework`
 * and `make` have no `real-<lang>-analyzer.ts`, and that is reported rather
 * than papered over — an unmapped language cannot be fingerprinted, and
 * pretending otherwise is the defect this module exists to prevent.
 */
export function analyzerFileFor(root: string, lang: string): string | null {
  const cand = path.join(root, aliasAwareAnalyzerFileFor(lang))
  return existsSync(cand) ? cand : null
}

/**
 * Every per-language analyzer file in the tree EXCEPT this lane's own.
 *
 * Discovered by reading `src/ast/`, not by a hard-coded list, so an analyzer
 * added tomorrow is covered without a second edit — and so a renamed file stops
 * being silently trusted. Repo-relative, sorted.
 */
function siblingAnalyzerFiles(root: string, lang: string): string[] {
  const dir = path.join(root, "src/ast")
  if (!existsSync(dir)) return []
  const ownAbs = analyzerFileFor(root, lang)
  const own = ownAbs ? rel(root, ownAbs) : ""
  return readdirSync(dir)
    .filter((f) => /^real-.*-analyzer\.ts$/.test(f))
    .map((f) => `src/ast/${f}`)
    .filter((p) => p !== own)
    .sort()
}

/**
 * Transitive relative-import closure of a source file, bounded to `src/`.
 *
 * Regex, not a TS parse: the only thing needed is which local files are read
 * at module scope, and a missed edge here widens what goes unverified. So the
 * scan is deliberately over-inclusive — it takes every `from "./x"` and
 * `import("./x")` occurrence, and any file it fails to resolve is left out
 * rather than guessed at.
 */
export function importClosure(root: string, entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const abs = queue.shift() as string
    if (seen.has(abs)) continue
    seen.add(abs)
    let src: string
    try {
      src = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
      const spec = m[1]
      const base = path.resolve(path.dirname(abs), spec)
      for (const cand of [base, `${base}.ts`, path.join(base, "index.ts")]) {
        if (!existsSync(cand) || !statSync(cand).isFile()) continue
        // Bound to src/: the artifact describes analyzer behaviour, and
        // validation/ or script/ changes do not alter it.
        if (!rel(root, cand).startsWith("src/")) continue
        queue.push(cand)
        break
      }
    }
  }
  return [...seen].sort()
}

/** Every file under a directory, sorted, repo-relative. */
export function filesUnder(root: string, dir: string): string[] {
  if (!existsSync(dir)) return []
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else if (e.isFile()) out.push(rel(root, abs))
    }
  }
  walk(dir)
  return out.sort()
}

/**
 * The parser artifact a run actually loaded, from the engine's own resolution
 * (the `/tmp` mirror the log names), so the recorded parser is the one used
 * rather than one inferred from a directory listing.
 */
export function resolvedParser(root: string, lang: string): Inputs["parser"] {
  const candidates = [
    path.join(root, "grammars", `tree-sitter-${lang}`, `tree-sitter-${lang}.wasm`),
    path.join(process.env.TMPDIR ?? "/tmp", `bb-wasm_tree-sitter-${lang}_tree-sitter-${lang}.wasm`),
  ]
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) {
      const fp = sha256File(c)
      return { path: rel(root, c).startsWith("..") ? c : rel(root, c), sha256: fp.sha256, bytes: fp.bytes }
    }
  }
  return null
}

/** Compute the full input set for a language's differential artifact. */
export function computeInputs(root: string, lang: string): Inputs {
  const files: Record<string, FileFingerprint> = {}
  const siblings: Record<string, FileFingerprint> = {}
  const add = (abs: string): void => {
    if (existsSync(abs) && statSync(abs).isFile()) files[rel(root, abs)] = sha256File(abs)
  }

  const analyzer = analyzerFileFor(root, lang)
  if (!analyzer) {
    return { files: {}, digest: sha256Text(""), parser: resolvedParser(root, lang), unresolved: "no analyzer file for this language" }
  }

  // Lane-disjoint siblings are PARTITIONED out of the closure rather than
  // filtered afterwards, so the hard set is exactly the files that can change
  // this lane's output. See the LANE-DISJOINT SIBLINGS note in the header.
  const siblingRel = new Set(siblingAnalyzerFiles(root, lang))
  for (const f of importClosure(root, analyzer)) {
    const p = rel(root, f)
    if (siblingRel.has(p)) siblings[p] = sha256File(f)
    else add(f)
  }

  const fixtureDir = path.join(root, "validation/m12/fixtures", lang)
  const fixtures = filesUnder(root, fixtureDir)
  for (const f of fixtures) add(path.join(root, f))
  const truth = path.join(root, "validation/m12/ground-truth", `${lang}.json`)
  add(truth)

  // In-tree grammar source, when the grammar lives here (groovy, fsharp, and the
  // functional family's vendored trees). The rule is ENTRY POINTS + hand-written
  // sources, not "everything under grammars/":
  //
  //   - generated files (`src/parser.c`, `src/grammar.json`, `src/node-types.json`)
  //     are deliberately NOT hard inputs. They are not byte-reproducible across
  //     generator versions, so a regeneration that changes no behaviour would flag
  //     every artifact — the same false-positive mode that keeps the wasm
  //     informational below.
  //   - `src/scanner.c` is not a candidate either, on purpose: `cpp` vendors one too,
  //     and adding it here would stale another family's artifacts from this
  //     module. Scanner drift is caught by `script/m14/verify-grammar-pins.ts`,
  //     which fails on ANY drift in a pinned grammar's file set, including scanners.
  const grammarSourceCandidates = [
    path.join(root, "grammars", `tree-sitter-${lang}`, "grammar.js"),
    // split-grammar layout (haskell): grammar.js requires ./grammar/*.js
    ...filesUnder(root, path.join(root, "grammars", `tree-sitter-${lang}`, "grammar"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => path.join(root, f)),
    // per-language subdirectory layout (fsharp: <pkg>/fsharp/grammar.js)
    path.join(root, "grammars", `tree-sitter-${lang}`, lang, "grammar.js"),
    // external scanner implementation shared by both sub-grammars (fsharp)
    path.join(root, "grammars", `tree-sitter-${lang}`, "common", "scanner.h"),
  ]
  for (const cand of grammarSourceCandidates) add(cand)

  const digest = sha256Text(Object.entries(files).map(([p, fp]) => `${p}:${fp.sha256}`).sort().join("\n"))
  return { files, digest, parser: resolvedParser(root, lang), siblings }
}

/**
 * Compare a recorded input set against the tree as it is now. Returns the
 * paths that moved, split so a caller can report what kind of change it was.
 */
export function diffInputs(
  root: string,
  recorded: Record<string, FileFingerprint>,
  lang: string,
): {
  changed: string[]
  added: string[]
  removed: string[]
  siblingDrift: string[]
  current: Inputs
} {
  const current = computeInputs(root, lang)
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []
  for (const [p, fp] of Object.entries(recorded)) {
    const now = current.files[p]
    if (!now) {
      // A path that moved from the hard set into the sibling set is a partition
      // change, not a deleted input, and must never read as staleness.
      if (current.siblings?.[p]) continue
      removed.push(p)
    } else if (now.sha256 !== fp.sha256) changed.push(p)
  }
  for (const p of Object.keys(current.files)) if (!(p in recorded)) added.push(p)
  const siblingDrift: string[] = []
  for (const [p, fp] of Object.entries(current.siblings ?? {})) {
    const was = recorded[p]
    if (!was) siblingDrift.push(`${p} (entered the sibling set)`)
    else if (was.sha256 !== fp.sha256) siblingDrift.push(p)
  }
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort(), siblingDrift: siblingDrift.sort(), current }
}
