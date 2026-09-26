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
//      extraction just as much as the per-language file does;
//   2. every fixture file under `validation/m12/fixtures/<lang>/`;
//   3. the ground truth `validation/m12/ground-truth/<lang>.json`;
//   4. the grammar source `grammars/tree-sitter-<lang>/grammar.js` when the
//      grammar lives in-tree.
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

export type FileFingerprint = { sha256: string; bytes: number }

export type Inputs = {
  /** Hard inputs: path (repo-relative) -> fingerprint. */
  files: Record<string, FileFingerprint>
  /** Digest over `files`, order-independent. */
  digest: string
  /** Informational: the parser artifact this run resolved. */
  parser: { path: string; sha256: string; bytes: number } | null
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
  const cand = path.join(root, "src/ast", `real-${lang}-analyzer.ts`)
  return existsSync(cand) ? cand : null
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
  const add = (abs: string): void => {
    if (existsSync(abs) && statSync(abs).isFile()) files[rel(root, abs)] = sha256File(abs)
  }

  const analyzer = analyzerFileFor(root, lang)
  if (!analyzer) {
    return { files: {}, digest: sha256Text(""), parser: resolvedParser(root, lang), unresolved: "no src/ast/real-<lang>-analyzer.ts" }
  }
  for (const f of importClosure(root, analyzer)) add(f)

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
  return { files, digest, parser: resolvedParser(root, lang) }
}

/**
 * Compare a recorded input set against the tree as it is now. Returns the
 * paths that moved, split so a caller can report what kind of change it was.
 */
export function diffInputs(
  root: string,
  recorded: Record<string, FileFingerprint>,
  lang: string,
): { changed: string[]; added: string[]; removed: string[]; current: Inputs } {
  const current = computeInputs(root, lang)
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []
  for (const [p, fp] of Object.entries(recorded)) {
    const now = current.files[p]
    if (!now) removed.push(p)
    else if (now.sha256 !== fp.sha256) changed.push(p)
  }
  for (const p of Object.keys(current.files)) if (!(p in recorded)) added.push(p)
  return { changed: changed.sort(), added: added.sort(), removed: removed.sort(), current }
}
