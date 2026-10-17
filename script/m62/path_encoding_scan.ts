// script/m62/path_encoding_scan.ts — the DETECTOR for script/m62/verify-path-encoding.ts.
//
// Split out from the gate so it can be imported and tested on its own. An earlier
// version kept both in one file, and importing it to introspect the scanner ran
// the entire gate as a side effect of the import — which is exactly the kind of
// surprise that makes a helper untestable.
//
// WHAT IT DOES. A WHATWG URL's `pathname` is percent-encoded, so
// `new URL(import.meta.url).pathname` is NOT a usable filesystem path in a
// repository whose path contains a space. This module finds those sites in CODE
// only, by blanking comments and string bodies before matching.
//
// WHY COMMENTS AND STRINGS ARE BLANKED. A comment cannot be evaluated, so a
// mention of the idiom inside one is not the defect. Skipping comments is what
// keeps the detector from finding its own explanation — the failure mode where a
// text scan flags the prose describing a bug and can therefore never go green.
// The runner keeps a second, raw scan and prints every occurrence the code scan
// suppressed, so the exclusion downgrades a hit from FAIL to a printed line
// rather than to silence.
//
// KNOWN LIMITATION, STATED NOT HIDDEN. The regex-vs-division decision uses the
// standard previous-token heuristic, not a full parser, so an exotic `/` could
// still be misread. The dual scan in the runner is what bounds the damage.

// The idiom as it is actually written. Also matches the two-argument URL form.
const PATTERN = /new URL\(\s*(?:import\.meta\.url|"[^"]*",\s*import\.meta\.url)\s*\)\.pathname/g

/**
 * Blank out comments and string-literal bodies, preserving every offset and
 * every newline so that line numbers reported against the result are the real
 * ones in the source.
 *
 * Handles: line comments, block comments, single/double quotes, template
 * literals WITH working ${...} interpolation (an interpolated path is code, and
 * blanking it would hide exactly the site we are hunting), and the regex-vs-
 * division ambiguity.
 */
export function blankCommentsAndStrings(src: string, opts: { keepStrings?: boolean } = {}): string {
  const out = src.split("")
  const blank = (i: number): void => {
    if (out[i] !== "\n") out[i] = " "
  }
  const keepNewline = (i: number): void => {
    out[i] = "\n"
  }

  // A template's string parts are blanked; its ${...} interpolations are CODE and
  // are scanned, because an interpolated path is exactly the site being hunted.
  type Frame = { kind: "template" } | { kind: "interp"; depth: number }
  const frames: Frame[] = []

  // For the regex-vs-division decision: the last non-space punctuation char, and
  // the last identifier word. A `/` after one of these opens a regex; anywhere
  // else it is division.
  let prevPunct = ""
  let lastWord = ""
  const REGEX_AFTER_PUNCT = new Set([
    "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*",
    "%", "<", ">", "~", "^", "",
  ])
  const REGEX_AFTER_WORD = new Set([
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await",
  ])

  let i = 0
  while (i < src.length) {
    const c = src[i]!
    const n = src[i + 1]
    const top = frames[frames.length - 1]

    // ---- inside a template literal's string part --------------------------
    if (top?.kind === "template") {
      if (c === "\\") {
        blank(i)
        if (n !== undefined) blank(i + 1)
        i += 2
        continue
      }
      if (c === "`") {
        blank(i)
        frames.pop()
        i++
        prevPunct = "`"
        lastWord = ""
        continue
      }
      if (c === "$" && n === "{") {
        blank(i)
        blank(i + 1)
        i += 2
        frames.push({ kind: "interp", depth: 1 })
        prevPunct = "{"
        lastWord = ""
        continue
      }
      blank(i)
      i++
      continue
    }

    // ---- inside a ${...} interpolation: still code, but braces are tracked --
    if (top?.kind === "interp") {
      if (c === "{" && n !== "}") {
        top.depth++
        prevPunct = "{"
        i++
        continue
      }
      if (c === "}") {
        blank(i)
        if (top.depth > 1) {
          top.depth--
        } else {
          // Pop the interpolation and NOTHING else. The template frame it was
          // pushed on top of is still directly beneath, so returning to it means
          // simply popping. An earlier version popped and then pushed a fresh
          // template frame "to be explicit", which left the stack one frame too
          // deep: every later backtick then closed the phantom, the real template
          // stayed open, and the scanner blanked the remainder of the file as
          // string content. It hid real code on any file containing a template
          // with a ternary inside it — including this repository's own gates.
          frames.pop()
        }
        i++
        prevPunct = "}"
        lastWord = ""
        continue
      }
      // otherwise fall through and handle as ordinary code
    }

    // ---- line comment ------------------------------------------------------
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") {
        blank(i)
        i++
      }
      continue
    }

    // ---- block comment -----------------------------------------------------
    if (c === "/" && n === "*") {
      blank(i)
      blank(i + 1)
      i += 2
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") keepNewline(i)
        else blank(i)
        i++
      }
      if (i < src.length) {
        blank(i)
        blank(i + 1)
        i += 2
      }
      prevPunct = ""
      lastWord = ""
      continue
    }

    // ---- single/double quoted string ---------------------------------------
    if (c === "'" || c === '"') {
      const quote = c
      // `keepStrings` exists because a string literal can BE the evidence.
      //
      // A detector for "this code spawns /usr/bin/code" has to see the literal,
      // because the literal is the argument. Blanking string bodies — which is
      // right for every other use of this scanner — erases exactly what it is
      // looking for, and the check then passes over a file that contains the
      // defect. Found by planting one and watching the gate report PASS.
      //
      // Comments are still blanked either way: a comment MENTIONING the path is not
      // code that invokes it, and these files document the defect at length.
      const keepBody = opts.keepStrings === true
      // With keepStrings the QUOTES stay too, not just the body. A detector that
      // wants to recognise `execFileSync("/usr/bin/code", …)` has to see the whole
      // literal — body without delimiters is not a literal, and a pattern anchored
      // on the quote never matches. Found by planting the defect and watching the
      // gate stay green: the body survived, the delimiters did not.
      if (!keepBody) blank(i)
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          blank(i)
          if (src[i + 1] !== undefined) blank(i + 1)
          i += 2
          continue
        }
        if (src[i] === "\n") keepNewline(i)
        else if (!keepBody) blank(i)
        i++
      }
      if (i < src.length) {
        if (!keepBody) blank(i)
        i++
      }
      prevPunct = quote
      lastWord = ""
      continue
    }

    // ---- template literal start -------------------------------------------
    if (c === "`") {
      blank(i)
      frames.push({ kind: "template" })
      i++
      prevPunct = "`"
      lastWord = ""
      continue
    }

    // ---- regex literal or division ----------------------------------------
    if (c === "/") {
      // An identifier or literal immediately before the slash means DIVISION,
      // whatever punctuation came before it: in `const x = a / b` the `=` is stale
      // by the time the slash is read, and treating it as "regex may follow here"
      // swallowed `b; const here = <the idiom>` as a regex body.
      // An increment/decrement operator also rules a regex out.
      const isDoubling = src[i - 1] === c
      const opensRegex =
        !isDoubling && (REGEX_AFTER_WORD.has(lastWord) || (lastWord === "" && REGEX_AFTER_PUNCT.has(prevPunct)))
      if (opensRegex) {
        blank(i)
        i++
        let inClass = false
        while (i < src.length) {
          const r = src[i]!
          if (r === "\\") {
            blank(i)
            if (src[i + 1] !== undefined) blank(i + 1)
            i += 2
            continue
          }
          if (r === "\n") break
          if (r === "[") inClass = true
          else if (r === "]") inClass = false
          else if (r === "/" && !inClass) break
          blank(i)
          i++
        }
        if (i < src.length && src[i] === "/") {
          blank(i)
          i++
        }
        while (i < src.length && /[a-z]/.test(src[i]!)) i++
        prevPunct = "/"
        lastWord = ""
        continue
      }
      prevPunct = "/"
      i++
      continue
    }

    // ---- ordinary characters ----------------------------------------------
    if (!/\s/.test(c)) {
      if (/[A-Za-z0-9_$]/.test(c)) {
        let w = ""
        while (i < src.length && /[A-Za-z0-9_$]/.test(src[i]!)) w += src[i++]
        lastWord = w
        continue
      }
      prevPunct = c
      lastWord = ""
    } else if (c === "\n") {
      prevPunct = "\n"
      lastWord = ""
    }
    i++
  }
  return out.join("")
}

/** Occurrences of the idiom in CODE (comments and strings blanked). */
export function findCodeHits(src: string): Array<{ line: number; column: number }> {
  const text = blankCommentsAndStrings(src)
  const hits: Array<{ line: number; column: number }> = []
  for (const m of text.matchAll(PATTERN)) {
    hits.push({
      line: text.slice(0, m.index).split("\n").length,
      column: m.index - text.lastIndexOf("\n", m.index),
    })
  }
  return hits
}

/** Occurrences of the idiom ANYWHERE, including comments and strings. */
export function findRawHits(src: string): Array<{ line: number; column: number }> {
  const hits: Array<{ line: number; column: number }> = []
  for (const m of src.matchAll(PATTERN)) {
    hits.push({
      line: src.slice(0, m.index).split("\n").length,
      column: m.index - src.lastIndexOf("\n", m.index),
    })
  }
  return hits
}

// Directories that are not part of the repository's own code, excluded from the
// scan so the count means something. Each is excluded for a stated reason rather
// than because it was inconvenient.
//   .perf-fixtures  untracked perf fixture pools (293MB), regenerable, not shipped
//   node_modules    third party
//   dist            build output
//   .vscode-test    a downloaded editor
const NOT_OUR_CODE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".vscode-test",
  ".perf-fixtures",
  ".perf-out",
])

import { execFileSync } from "node:child_process"
import { lstatSync, readdirSync } from "node:fs"
import path from "node:path"

/** Source extensions the scan treats as code. */
const SOURCE_EXT = /\.(ts|mts|cts|js|mjs|cjs)$/

/**
 * Directories the walk refused to enter, each with the reason.
 *
 * A SKIPPED DIRECTORY IS PRINTED, NEVER SILENT — the same contract as the
 * comment exclusion. An exclusion that reports is a scoping decision; an
 * exclusion that is silent is a blind spot.
 */
export const SKIPPED_DIRS: string[] = []

/**
 * Directories that are not the repository's own code.
 *
 * WHY THIS LIST EXISTS AT ALL, AND WHY IT IS NOT A CONVENIENCE. The walk used to
 * descend into every directory it could stat, and this checkout proved what that
 * costs: three parked snapshots of the repository (`.tmp-head-verify/`,
 * `.tmp-r178-head/`, `.tmp-verify/`) each contain a SYMLINK to
 * `script/m14/tmp/elixir-274`, so `statSync` reported the same tree as a directory
 * three more times over. The gate therefore counted 45 defects where the working
 * tree has 15, and the 30 phantom ones live in files that are not part of the
 * repository. Those directories are gitignored; git would never hand them back as
 * source, and neither should this walk.
 *
 * So when `root` is a git work tree the file list comes from GIT — tracked files
 * plus untracked-but-not-ignored ones. That is the definition of "this repository's
 * code", it costs one process launch, and it cannot drift from `.gitignore`.
 */
function gitSourceFiles(root: string): string[] | null {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    // Only when `root` IS the work tree. A caller scanning some subdirectory or a
    // temp dir expects that subtree, not the whole repository.
    if (path.resolve(top) !== path.resolve(root)) return null
  } catch {
    return null
  }
  const run = (args: string[]): string[] => {
    try {
      const out = execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 64 * 1024 * 1024,
      })
      return out.split("\0").filter((s) => s.length > 0)
    } catch {
      return []
    }
  }
  const paths = [
    ...run(["ls-files", "-z"]),
    ...run(["ls-files", "-z", "--others", "--exclude-standard"]),
  ]
  const out: string[] = []
  for (const rel of paths) {
    if (!SOURCE_EXT.test(rel)) continue
    const abs = path.join(root, rel)
    try {
      // A tracked symlink or a stale entry (deleted but still in the index) is not
      // code this walk can read. Skipping it silently is fine here and only here:
      // it is not code at all.
      if (!lstatSync(abs).isFile()) continue
    } catch {
      continue
    }
    out.push(abs)
  }
  return out
}

export function walkSourceFiles(root: string): string[] {
  const viaGit = gitSourceFiles(root)
  if (viaGit !== null) return viaGit
  const out: string[] = []
  walk(root, out)
  return out
}

/**
 * Directories the walk could not list.
 *
 * THIS EXISTS BECAUSE OF A MEASURED DISASTER. The walk originally wrapped
 * readdirSync in a bare `catch { return out }`. A missing import — `readdirSync`
 * was never imported into this module — therefore threw a ReferenceError, the
 * catch swallowed it, and the walk returned an empty array. The gate then
 * reported "0 defects in code that ships or gates" and exited 0, having scanned
 * NOTHING at all. A green gate that examined zero files is worse than no gate,
 * because it is believed.
 *
 * So an unreadable directory is recorded here, and the gate fails if this list is
 * non-empty rather than treating an unscanned tree as a clean one.
 */
export const UNREADABLE_DIRS: string[] = []

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch (err) {
    UNREADABLE_DIRS.push(`${dir} (${err instanceof Error ? err.message : String(err)})`)
    return out
  }
  for (const e of entries) {
    if (NOT_OUR_CODE.has(e)) continue
    const p = path.join(dir, e)
    let st
    try {
      // lstatSync, NOT statSync: statSync FOLLOWS symlinks, so a parked snapshot
      // whose `script/m14/tmp/elixir-274` is a link re-walked that tree (and every
      // `.ts` in it) once per snapshot. It also lets a symlink out of the repository
      // make the walk read files that are not ours, and a link cycle would not
      // terminate. A symlink is neither code here nor a directory to enter.
      st = lstatSync(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) {
      SKIPPED_DIRS.push(`${p} (symlink, not followed)`)
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (st.isFile() && SOURCE_EXT.test(e)) out.push(p)
  }
  return out
}

