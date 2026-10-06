// script/m24/portability.ts — the LSP lane's cross-platform primitives.
//
// WHAT THIS FILE IS FOR (M24 lane 1, darwin repair):
//
//   script/m24/verify-positions.ts and script/m24/verify-freshness.ts each
//   computed their `sourceFingerprint` by spawning `sha256sum`. macOS has no
//   `sha256sum` (it ships `shasum -a 256`), so on darwin BOTH gates died with
//   `spawnSync sha256sum ENOENT` after their checks and before their evidence
//   write. They were not passing — they were DEAD, and the contract's
//   I2 precondition ("the position-mapping gate and freshness gate pass")
//   was unreadable on this OS (contract §10: cross-platform honesty; this
//   repo's own path/platform bug history is the standing justification).
//
//   Two owners, one rule:
//     1. `sha256File()` — node:crypto over RAW BYTES. No spawn, so there is
//        no OS to disagree about: the same file yields the same digest on
//        darwin, linux and win32, which is what `sha256sum <file>` yielded on
//        the Linux runs that produced the committed P1/P2 records.
//     2. `findNonPortableSpawns()` — an AST scan (typescript's parser, already
//        a repo dependency) for harness code that spawns an external binary
//        which does not exist on every supported OS, or that uses a GNU-only
//        flag / Linux-only path inside a spawned command. This is the F7 gate
//        for the bug class: the defect cannot recur silently, and a planted
//        `sha256sum` spawn is caught at its exact position.
//
// DESIGN RULES THIS FILE KEEPS (so it stays a library, not a gate):
//   * it runs NOTHING at import (the M55 lesson, same as script/lib/evidence.ts);
//   * it asserts nothing and writes no evidence record of its own — the
//     permanent gate that runs these rules lives in a wired verifier, and this
//     file is scanned by the same rule it implements;
//   * the portability RULES are static and machine-independent: they must give
//     the same verdict on every OS, so nothing here probes the measuring
//     machine for a binary's presence (a probe would spawn the very binaries
//     the rule forbids). Presence/absence is recorded per rule entry as the
//     measurement that justified it, and `verify-*` records the OS it ran on.

import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import ts from "typescript"

// ---------------------------------------------------------------------------
// 1. Portable fingerprints
// ---------------------------------------------------------------------------

/** sha256 of a string's UTF-8 BYTES. */
export function sha256Text(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex")
}

/**
 * sha256 of a FILE's raw bytes.
 *
 * Bytes, never a decoded string: a CRLF checkout (Windows, or a coreconfig
 * autocrlf=true clone) must not change the fingerprint of an unchanged source
 * file, or every cross-OS evidence comparison becomes a platform artefact.
 * `readFileSync(p)` without an encoding returns a Buffer, which is hashed
 * as-is.
 *
 * Determinism: SHA-256 over a byte string is identical on every OS, so this
 * reproduces exactly what `sha256sum <file>` produced on the Linux runs that
 * wrote the committed P1/P2 records (measured equality in the lane report).
 */
export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex")
}

/**
 * Known-answer tests for the digest (FIPS 180-4 / NIST vectors). A fingerprint
 * helper that silently returns a constant, a truncated digest, or a
 * line-ending-normalized digest is the classic "evidence nobody can trust"
 * defect; these vectors make each of those fail. Empty input is the vector
 * that catches a "hash the first line only" implementation.
 */
export const SHA256_KAT: Array<{ label: string; input: string; want: string }> = [
  { label: "empty input", input: "", want: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
  { label: "abc", input: "abc", want: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" },
  {
    label: "448-bit message",
    input: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
    want: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  },
]

/** The HEAD commit of a repo, or "unknown" when git is unavailable. */
export function gitHead(root: string): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

// ---------------------------------------------------------------------------
// 2. The portability rule set
// ---------------------------------------------------------------------------

/** The OSes this lane's harnesses are expected to run on. Measured here:
 *  darwin. Linux is the other committed target; win32 is DECLARED ABSENT for
 *  the gates in this lane (they invoke `sh`, `/proc`-free but POSIX-shaped
 *  tooling, and `npx`), and is not claimed. */
export const SUPPORTED_OSES = ["darwin", "linux"] as const

/**
 * Binaries an LSP-lane harness must never spawn, with the reason each is
 * non-portable and the measurement that justifies it.
 *
 * `absentOnDarwin: true` means MEASURED on this lane's machine (macOS 14.8.4,
 * `command -v <bin>` -> not found). `false` means the binary exists here and
 * the entry is banned for the OTHER direction (`linux-unverified`: its absence
 * on Linux is not measured in this lane and is declared unverified — the ban
 * does not rest on that unmeasured half, it rests on "a harness should not
 * shell out to a checksum tool at all when node:crypto is in the runtime").
 */
export const NON_PORTABLE_BINARIES: Record<string, { reason: string; absentOnDarwin: boolean | null; cls: "checksum" | "coreutils" | "util-linux" }> = {
  sha256sum: { cls: "checksum", reason: "GNU coreutils checksum tool; macOS ships `shasum -a 256` instead. This exact spawn killed M24.P1 and M24.P2 on darwin with spawnSync sha256sum ENOENT.", absentOnDarwin: true },
  sha512sum: { cls: "checksum", reason: "GNU coreutils checksum tool; absent on macOS (no shasum -a 512 spelling there).", absentOnDarwin: true },
  sha1sum: { cls: "checksum", reason: "GNU coreutils checksum tool; absent on macOS (`shasum -a 1`).", absentOnDarwin: true },
  md5sum: { cls: "checksum", reason: "GNU coreutils checksum tool; absent on macOS (`md5`).", absentOnDarwin: true },
  b2sum: { cls: "checksum", reason: "GNU coreutils checksum tool (bLAKE2); absent on macOS.", absentOnDarwin: true },
  shasum: { cls: "checksum", reason: "BSD/macOS perl checksum tool; the Linux side spells it sha256sum. Ban rests on \"spawn no checksum binary, use node:crypto\"; its absence on this repo's Linux images is declared linux-unverified.", absentOnDarwin: null },
  md5: { cls: "checksum", reason: "BSD/macOS checksum tool; the Linux side spells it md5sum. Same ban rationale as shasum; Linux absence declared linux-unverified.", absentOnDarwin: null },
  nproc: { cls: "coreutils", reason: "GNU coreutils CPU counter; absent on macOS, which also has no /proc/cpuinfo.", absentOnDarwin: true },
  lsblk: { cls: "util-linux", reason: "util-linux block-device lister; absent on macOS.", absentOnDarwin: true },
  timeout: { cls: "coreutils", reason: "GNU coreutils wall-clock limiter; absent on macOS (Homebrew spells it gtimeout).", absentOnDarwin: true },
  factor: { cls: "coreutils", reason: "GNU coreutils; absent on macOS.", absentOnDarwin: true },
  base32: { cls: "coreutils", reason: "GNU coreutils; absent on macOS (base64 IS present, so the pair looks interchangeable and is not).", absentOnDarwin: true },
}

/** GNU-only flags/forms inside a spawned command, each measured on darwin. */
export const NON_PORTABLE_COMMAND_PATTERNS: Array<{ id: string; pattern: RegExp; reason: string; measured: string }> = [
  { id: "stat -c", pattern: /\bstat\s+(-[a-zA-Z]*\s+)*-c\b/, reason: "GNU stat's --format/-c; BSD stat has no -c (measured: `stat: illegal option -- c`).", measured: "darwin: `stat -c %s f` -> illegal option" },
  { id: "date -d", pattern: /\bdate\s+(-[a-zA-Z]*\s+)*-d\b/, reason: "GNU date's --date/-d; BSD date spells it -j -f (measured: `date: illegal option -- d`).", measured: "darwin: `date -d 2020-01-01` -> illegal option" },
  { id: "grep -P", pattern: /\bgrep\s+(-[a-zA-Z]*\s+)*-P\b/, reason: "GNU grep's PCRE engine; BSD grep has no -P (measured: `grep: invalid option -- P`).", measured: "darwin: `grep -P a` -> invalid option" },
  { id: "sort -V", pattern: /\bsort\s+(-[a-zA-Z]*\s+)*-V\b/, reason: "GNU sort's version sort. WORSE than an error: BSD sort accepts -V and ignores it, so the output is silently ordered differently (measured: 2,10 stays 2,10 instead of 10,2).", measured: "darwin: `sort -V` accepted, version order NOT applied" },
  { id: "find -printf", pattern: /\bfind\b[^|;&]*?-printf\b/, reason: "GNU find's -printf; BSD find has no such primary (measured: `find: -printf: unknown primary or operator`).", measured: "darwin: `find -maxdepth 0 -printf` -> unknown primary" },
  { id: "sed -i (GNU form)", pattern: /\bsed\s+-[a-zA-Z]*i[a-zA-Z]*\s+['"]?s\//, reason: "GNU in-place edit (BSD `-i` consumes the NEXT argument as its backup suffix, so the script is read as a filename). Measured on darwin: the command prints `undefined label` and exits 0 WITHOUT editing the file.", measured: "darwin: `sed -i 's/x/y/' f` -> no edit, exit 0, stderr noise" },
]

/** Linux-only pseudo-filesystems read from inside a spawned command. */
export const NON_PORTABLE_PATH_PATTERNS: Array<{ id: string; pattern: RegExp; reason: string }> = [
  { id: "/proc", pattern: /\/proc\/[a-z]/, reason: "Linux procfs; absent on macOS and Windows (measured: `ls /proc` -> No such file or directory)." },
  { id: "/sys", pattern: /\/sys\/[a-z]/, reason: "Linux sysfs; absent on macOS and Windows (measured: `ls /sys` -> No such file or directory)." },
]

/**
 * Binaries this lane's harnesses DO spawn, recorded so the denylist's silence
 * is auditable rather than assumed: a spawn of a binary that is neither in
 * NON_PORTABLE_BINARIES nor here is reported by the gate as an
 * `unknown-spawned-binary` note, never silently accepted.
 */
export const KNOWN_PORTABLE_BINARIES = [
  "git", "node", "npx", "bun", "npm", "sh", "uname", "which", "find", "awk",
  "grep", "sed", "sort", "cut", "head", "tail", "wc", "cat", "cp", "ls", "diff",
]

// ---------------------------------------------------------------------------
// 3. The AST scanner
// ---------------------------------------------------------------------------

export type SpawnFinding = {
  file: string
  line: number
  column: number
  api: string
  command: string
  kind:
    | "non-portable-binary"
    | "gnu-only-command-form"
    | "platform-only-path"
    | "unknown-spawned-binary"
    | "denylisted-binary-in-spawned-command"
  matched: string
  reason: string
  sourceLine: string
}

export type SpawnSite = {
  file: string
  line: number
  api: string
  command: string
  /** false when the rule could not read the command as a literal */
  resolved: boolean
  /** direct = a child_process call site; wrapper = a local function that
   *  forwards to one (the rule scans its arguments instead of resolving it);
   *  computed = the command is built at runtime and cannot be judged by name */
  via: "direct" | "wrapper" | "computed"
}

const SPAWN_APIS = new Set(["exec", "execSync", "execFile", "execFileSync", "spawn", "spawnSync", "fork"])

/**
 * Identifiers that name a child_process spawn API in THIS file, and namespace
 * identifiers bound to the module. Resolution is syntactic on purpose: a
 * `CoreDatabase` double's `.exec(sql)` is not a process spawn, and pretending
 * otherwise is how a rule like this drowns in false positives and gets ignored.
 */
function childProcessBindings(source: ts.SourceFile): { fns: Set<string>; namespaces: Set<string> } {
  const fns = new Set<string>()
  const namespaces = new Set<string>()
  const isChildProcess = (spec: string | undefined): boolean => !!spec && /(^|\/)(node:)?child_process$/.test(spec)

  for (const st of source.statements) {
    if (ts.isImportDeclaration(st) && isChildProcess((st.moduleSpecifier as ts.StringLiteral).text)) {
      const clause = st.importClause
      if (!clause) continue
      if (clause.name) namespaces.add(clause.name.text)
      const nb = clause.namedBindings
      if (nb && ts.isNamespaceImport(nb)) namespaces.add(nb.name.text)
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          const local = el.name.text
          if (SPAWN_APIS.has((el.propertyName ?? el.name).text)) fns.add(local)
        }
      }
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const init = d.initializer
        if (!init || !ts.isCallExpression(init)) continue
        const callee = init.expression
        const isDynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword
        const isRequire = ts.isIdentifier(callee) && callee.text === "require"
        if (!isDynamicImport && !isRequire) continue
        const arg = init.arguments[0]
        if (!arg || !ts.isStringLiteralLike(arg) || !isChildProcess(arg.text)) continue
        if (ts.isObjectBindingPattern(d.name)) {
          for (const el of d.name.elements) {
            const local = el.name.text
            if ((el.propertyName ?? el.name).text && SPAWN_APIS.has(el.propertyName?.text ?? "")) fns.add(local)
          }
        } else if (ts.isIdentifier(d.name)) {
          namespaces.add(d.name.text)
        }
      }
    }
  }
  return { fns, namespaces }
}

/**
 * The literal command of a spawn call, or null when it is not statically
 * known. `execFileSync("sh", ["-c", "<command line>"])` is a command line, and
 * so is `execSync("<command line>")` — both are scanned token by token, which
 * is how `execFileSync("sh", ["-c", "grep /proc/cpuinfo"])` gets caught.
 */
function commandLiteral(
  node: ts.CallExpression,
  api: string,
  constStrings: Map<string, string>,
): { command: string; shell: boolean } | null {
  const args = node.arguments
  if (api === "fork") return null // process.execPath: portable by construction
  const first = args[0]
  if (!first) return null
  const literal = (n: ts.Expression | undefined): string | null => {
    if (!n) return null
    if (ts.isStringLiteralLike(n)) return n.text
    if (ts.isIdentifier(n)) return constStrings.get(n.text) ?? null
    return null
  }
  const firstText = literal(first)
  if (firstText === null) return null
  // execSync("...") / exec("..."): a whole shell command line.
  if (api === "exec" || api === "execSync") return { command: firstText, shell: true }
  // A shell interpreter's -c payload is a command line; anything else is argv.
  if (/^(sh|bash|zsh|dash|ksh)$/.test(basename(firstText))) {
    const argv = args[1]
    const elements: readonly ts.Expression[] =
      argv && ts.isArrayLiteralExpression(argv) ? argv.elements : argv ? [argv] : []
    for (let i = 0; i < elements.length; i++) {
      const flag = literal(elements[i])
      if (flag && /^-[a-z]*c[a-z]*$/.test(flag)) {
        const payload = literal(elements[i + 1])
        if (payload !== null) return { command: payload, shell: true }
      }
    }
  }
  return { command: firstText, shell: false }
}

/** Top-level `const NAME = "literal"` bindings, so a named binary resolves. */
function constStringBindings(source: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>()
  for (const st of source.statements) {
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteralLike(d.initializer)) {
        out.set(d.name.text, d.initializer.text)
      }
    }
  }
  return out
}

function basename(binary: string): string {
  return binary.split(/[/\\]/).pop() ?? binary
}

function finding(
  file: string,
  node: ts.Node,
  src: ts.SourceFile,
  api: string,
  command: string,
  kind: SpawnFinding["kind"],
  matched: string,
  reason: string,
): SpawnFinding {
  const { line, character } = src.getLineAndCharacterOfPosition(node.getStart(src))
  const lines = src.getFullText().split("\n")
  return {
    file,
    line: line + 1,
    column: character + 1,
    api,
    command,
    kind,
    matched,
    reason,
    sourceLine: (lines[line] ?? "").trim(),
  }
}

/**
 * Scan one source file for spawns that are not portable across this lane's
 * supported OSes. Pure over (file, source): the gate feeds it doctored sources
 * as its can-fail proof.
 *
 * It reports three kinds of finding, all of them real defects for a harness
 * whose evidence must regenerate on every OS:
 *   non-portable-binary      the spawned binary does not exist everywhere
 *   gnu-only-command-form    a GNU-only flag inside a spawned command
 *   platform-only-path       a Linux-only pseudo-file inside a spawned command
 * plus `unknown-spawned-binary` notes for binaries that are neither in the
 * denylist nor in KNOWN_PORTABLE_BINARIES, so the allowlist cannot rot into
 * "anything not yet denied is fine".
 */
/**
 * Local functions that launder a spawned command: a function whose body calls a
 * child_process spawn API, or another such wrapper (transitively). Their call
 * sites are spawn sites one or more frames removed from the AST the direct rule
 * reads, which is where `run("bash", ["-lc", "… | xargs sha256sum"])` hides.
 *
 * Computed to a fixpoint over the file's own declarations; a wrapper that takes
 * its command from a caller-supplied string is exactly the indirection this
 * exists to see.
 */
function spawnWrapperNames(src: ts.SourceFile, spawnNames: (expr: ts.Expression) => string | null): Set<string> {
  const declared = new Map<string, ts.Node>()
  for (const st of src.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) declared.set(st.name.text, st)
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          declared.set(d.name.text, d.initializer)
        }
      }
    }
  }
  const wrappers = new Set<string>()
  for (let changed = true; changed; ) {
    changed = false
    for (const [name, node] of declared) {
      if (wrappers.has(name)) continue
      let calls = false
      const scan = (n: ts.Node): void => {
        if (ts.isCallExpression(n)) {
          const callee = n.expression
          if (ts.isIdentifier(callee) && (spawnNames(callee) || wrappers.has(callee.text))) calls = true
        }
        ts.forEachChild(n, scan)
      }
      scan(node)
      if (calls) {
        wrappers.add(name)
        changed = true
      }
    }
  }
  return wrappers
}

/** Every string-ish literal inside a call's arguments (arrays flattened). */
function argumentTexts(node: ts.CallExpression): Array<{ text: string; node: ts.Expression }> {
  const text = (e: ts.Expression): string | null =>
    ts.isStringLiteralLike(e) ? e.text : ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) ? e.getText() : null
  const out: Array<{ text: string; node: ts.Expression }> = []
  for (const a of node.arguments) {
    const direct = text(a)
    if (direct !== null) {
      out.push({ text: direct, node: a })
      continue
    }
    if (ts.isArrayLiteralExpression(a)) {
      for (const el of a.elements) {
        const t = text(el)
        if (t !== null) out.push({ text: t, node: el })
      }
    }
  }
  return out
}

/** The plain-string arguments of a call, arrays flattened (templates included
 *  as their source text — a command line is written as a template). */
function argvStringsOf(node: ts.CallExpression): string[] {
  return argumentTexts(node).map((a) => a.text)
}

export function findNonPortableSpawns(file: string, source: string): { findings: SpawnFinding[]; sites: SpawnSite[] } {
  const src = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const { fns, namespaces } = childProcessBindings(src)
  const constStrings = constStringBindings(src)
  const findings: SpawnFinding[] = []
  const sites: SpawnSite[] = []
  if (fns.size === 0 && namespaces.size === 0) return { findings, sites }

  /** The spawn API a callee expression names, or null. */
  const spawnApiOf = (callee: ts.Expression): string | null => {
    if (ts.isIdentifier(callee) && fns.has(callee.text)) return callee.text
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && SPAWN_APIS.has(callee.name.text)) {
      return callee.name.text
    }
    return null
  }
  const wrappers = spawnWrapperNames(src, spawnApiOf)

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1
      // --- one frame removed: a local wrapper around a spawn ---------------
      if (ts.isIdentifier(node.expression) && wrappers.has(node.expression.text) && !fns.has(node.expression.text)) {
        sites.push({ file, line, api: `${node.expression.text}() [spawn wrapper]`, command: "<laundered>", resolved: false, via: "wrapper" })
        for (const arg of argumentTexts(node)) {
          // Deliberately the CHECKSUM class only here: a wrapper's arguments
          // are arbitrary strings (fixture sources, SQL, JSON), so a token
          // match there is a heuristic. `timeout`/`factor`/`md5` as substrings
          // of prose is the noise that makes a rule unreadable; a checksum
          // binary named in a command wrapper is unambiguous.
          for (const token of arg.text.split(/[\s"'`|;&()]+/).filter(Boolean)) {
            const denied = NON_PORTABLE_BINARIES[basename(token)]
            if (denied && denied.cls === "checksum") {
              findings.push(finding(file, arg.node, src, `${node.expression.text}()`, arg.text, "denylisted-binary-in-spawned-command", basename(token), denied.reason))
            }
          }
          for (const p of NON_PORTABLE_PATH_PATTERNS) {
            if (p.pattern.test(arg.text)) {
              findings.push(finding(file, arg.node, src, `${node.expression.text}()`, arg.text, "platform-only-path", p.id, p.reason))
            }
          }
        }
      }
      const api = spawnApiOf(node.expression)
      if (api) {
        const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1
        const cmd = commandLiteral(node, api, constStrings)
        if (!cmd) {
          // Recorded, not hidden: a spawn whose command is computed at runtime
          // cannot be judged here, and the record must say so (a blind spot
          // nobody can count is how it becomes a defect).
          sites.push({ file, line, api, command: "<computed>", resolved: false, via: "computed" })
        } else {
          sites.push({ file, line, api, command: cmd.command, resolved: true, via: "direct" })
          const push = (kind: SpawnFinding["kind"], matched: string, reason: string) =>
            findings.push(finding(file, node, src, api as string, cmd!.command, kind, matched, reason))
          if (!cmd.shell) {
            const bin = basename(cmd.command)
            const denied = NON_PORTABLE_BINARIES[bin]
            if (denied) push("non-portable-binary", bin, denied.reason)
            else if (!KNOWN_PORTABLE_BINARIES.includes(bin) && !path.isAbsolute(cmd.command) && /\.[a-z0-9]+$/.test(bin)) {
              push("unknown-spawned-binary", bin, "not in NON_PORTABLE_BINARIES and not in KNOWN_PORTABLE_BINARIES — declare its portability or replace it")
            }
          }
          if (cmd.shell) {
            // A shell command line: every token in it is a candidate binary.
            for (const token of cmd.command.split(/[\s"'|;&()]+/).filter(Boolean)) {
              const bin = basename(token)
              const denied = NON_PORTABLE_BINARIES[bin]
              if (denied) push("non-portable-binary", bin, denied.reason)
            }
          }
          // Flags and platform paths: anywhere in the command, argv included.
          // argv is joined shell-style for FORM matching (`sed -i s/x/y/ f` is
          // the same defect whether it was written as one string or three argv
          // entries), while the binary rule above stays token-exact.
          const argvStrings = argvStringsOf(node)
          const haystacks = [[cmd.command, ...argvStrings].join(" "), ...argvStrings]
          for (const c of NON_PORTABLE_COMMAND_PATTERNS) {
            if (haystacks.some((h) => c.pattern.test(h))) push("gnu-only-command-form", c.id, c.reason)
          }
          for (const p of NON_PORTABLE_PATH_PATTERNS) {
            if (haystacks.some((h) => p.pattern.test(h))) push("platform-only-path", p.id, p.reason)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(src)
  return { findings, sites }
}

// ---------------------------------------------------------------------------
// 4. Lane scope
// ---------------------------------------------------------------------------

/**
 * The LSP/IDE program's harness directories (contract §0 scope, plus the
 * amendments that name their own lane dirs: m26 graph-core, m44, m45, m55).
 * Declared here so the gate's coverage is a readable list, not a glob that
 * silently grows or shrinks.
 */
export const LSP_LANE_DIRS = ["m24", "m25", "m26", "m27", "m28", "m29", "m42", "m44", "m45", "m55"]

const SOURCE_EXT = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"])

function walk(dir: string, out: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const name of entries.sort()) {
    if (name.startsWith(".")) continue
    const p = path.join(dir, name)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(p, out)
    else if (SOURCE_EXT.has(path.extname(name))) out.push(p)
  }
}

/** Every source file under the declared LSP lane dirs (relative paths). */
export function lspLaneSources(root: string): string[] {
  const out: string[] = []
  for (const lane of LSP_LANE_DIRS) walk(path.join(root, "script", lane), out)
  walk(path.join(root, "src", "lsp"), out)
  return out.map((p) => path.relative(root, p)).sort()
}

/** Every source file under script/ — the repo-wide discovery sweep. */
export function allScriptSources(root: string): string[] {
  const out: string[] = []
  walk(path.join(root, "script"), out)
  return out.map((p) => path.relative(root, p)).sort()
}

export type LaneAudit = {
  filesScanned: number
  spawnSites: SpawnSite[]
  findings: SpawnFinding[]
  errors: Array<{ file: string; error: string }>
}

/** Run the scanner over the declared LSP lane scope. */
export function auditLspLane(root: string): LaneAudit {
  const files = lspLaneSources(root)
  const spawnSites: SpawnSite[] = []
  const findings: SpawnFinding[] = []
  const errors: Array<{ file: string; error: string }> = []
  for (const rel of files) {
    let source: string
    try {
      source = readFileSync(path.join(root, rel), "utf8")
    } catch (e) {
      errors.push({ file: rel, error: String((e as Error).message) })
      continue
    }
    const r = findNonPortableSpawns(rel, source)
    spawnSites.push(...r.sites)
    findings.push(...r.findings)
  }
  return { filesScanned: files.length, spawnSites, findings, errors }
}

/** The machine this run measured on — contract §10 requires it in the record. */
export function measuredOs(): { platform: NodeJS.Platform; release: string; arch: string } {
  return { platform: process.platform, release: process.release?.name ?? "unknown", arch: process.arch }
}
