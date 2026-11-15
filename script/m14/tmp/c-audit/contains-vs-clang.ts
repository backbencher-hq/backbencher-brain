/**
 * C audit probe: adjudicate every `contains` edge against CLANG, per record.
 *
 * WHY CLANG AND NOT THE PARSE. The `calls` and `uses` probes judge the payload
 * against tree-sitter -- the SAME parser the analyzer uses. That makes them sound
 * about emission (did the analyzer publish an edge for something the grammar saw?)
 * and structurally BLIND about the other direction: if the grammar never produced
 * a node, no comparison against it can notice. A file whose members are invisible
 * to tree-sitter yields no `contains` edge and no complaint, and the probe's
 * `uses` half says so explicitly -- it cannot convict a miss, because measuring
 * that needs the payload's own owner attribution.
 *
 * `contains` is the largest structural claim the analyzer makes: 16,847 edges over
 * the census scope, pinned by 16 hand-audited facts on three fixture files. So it
 * is both the biggest unoracled relationship type and the one where an
 * independent parser is most valuable. Clang is a different implementation with a
 * different recovery strategy, so agreement between it and the payload is real
 * evidence rather than a tautology.
 *
 * WHAT IS COMPARED. Per record type declared in the file:
 *
 *   clang     every `FieldDecl` / `EnumConstantDecl` that is a DIRECT child of the
 *             RecordDecl, with its name and declaration line
 *   payload   every `contains` edge whose SOURCE is that record
 *
 *   payload > clang   a member edge for a field clang does not have -- a phantom
 *   payload < clang   a field clang has that the payload never published -- a
 *                      MISSED MEMBER, invisible to every counter in the lane
 *   equal              correct, including bitfields and anonymous inline members
 *
 * Anonymous inline aggregates are FLATTENED on both sides, because a
 * `struct { int a; } inner;` contributes `a` to the enclosing record's member set
 * and `inner` is itself a member of its parent. Clang nests the anonymous record
 * as a child with no name; the payload publishes the flattened members. Comparing
 * raw child lists would report every anonymous member as missing on both sides.
 *
 * REACH IS REPORTED, NEVER ASSUMED. Clang needs the project's `-D` set and include
 * path, and a file it cannot parse is a legitimate "cannot measure" -- so the
 * unmeasurable count is printed with a named reason, and a file that yields no
 * clang record is excluded rather than counted as agreement. A rate over the files
 * clang happened to accept, presented as a corpus verdict, is the failure mode
 * this probe is written to avoid.
 *
 *   bun run script/m14/tmp/c-audit/contains-vs-clang.ts --dir <corpus> [--max-files N]
 */
import { execFileSync, spawnSync } from "child_process"
import * as fs from "fs"
import * as path from "path"

const ROOT = path.resolve((import.meta as any).dirname, "..", "..", "..", "..")
const argv = process.argv.slice(2)
const arg = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DIR = arg("dir", "/home/sano/ishaq/bb_tests/repositories/redis/src")
const MAX_FILES = Number(arg("max-files", "200"))
const SHOW = Number(arg("show", "15"))
/**
 * The repository root for `DIR`, which may be a subdirectory such as `curl/lib`.
 *
 * `path.basename(path.dirname(DIR))` -- the form layout-vs-clang.ts uses because it
 * is always handed a corpus's top source dir -- yields `lib` for `curl/lib`, and
 * every include root then resolved inside `curl/lib` itself. Clang reported
 * "no such file or directory" for a file the probe had just listed, and curl came
 * back 0 of 120 measurable with no diagnostic at all, which is the worst shape an
 * instrument can fail in. The root is now found by walking up to the ancestor that
 * owns the conventional source directories.
 */
const REPO = (() => {
  let d = path.resolve(DIR)
  for (let i = 0; i < 4; i++) {
    const base = path.basename(d)
    if (["curl", "libgit2", "redis"].includes(base)) return base
    const parent = path.dirname(d)
    if (parent === d) break
    d = parent
  }
  return path.basename(path.resolve(DIR, ".."))
})()

const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const P = wts.Parser ?? wts.default ?? wts
const L = wts.Language ?? wts.default?.Language
await P.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })
const parser = new P()
parser.setLanguage(await L.load(fs.readFileSync(path.join(ROOT, "wasm/tree-sitter-c.wasm"))))
const { RealCAnalyzer } = await import(path.join(ROOT, "src/ast/real-c-analyzer.ts"))

/**
 * The flags a real compile of this corpus would be given.
 *
 * curl's public headers need `CURL_EXTERN`/`CURL_HIDDEN` defined, which the build
 * system passes and a hand-written probe does not; without them clang stops at
 * "too small curl_off_t" and every file becomes unmeasurable. Same note, same
 * reason, as layout-vs-clang.ts.
 */
const REPO_DEFINES: Record<string, string[]> = {
  // curl is additionally out of reach, and NOT for want of a flag. Its headers are
  // generated by `configure`, and each -D that fixes one complaint exposes the next:
  // without `SIZEOF_CURL_OFF_T` every file dies on `curl_setup.h:537: "too small
  // curl_off_t"`; WITH it, curl defines its own `struct timeval` and 850 of them then
  // collide with glibc's. Chasing that means reproducing configure's ~200 probes, and
  // the number reported is then a property of my flag set rather than of the corpus.
  // Recorded as a reach limit with a named reason, which is the honest shape.
  curl: ["-DCURL_EXTERN=extern", "-DCURL_HIDDEN=static", "-DCURL_EXTERN_STATIC=", "-DBUILDING_LIBCURL"],
  libgit2: ["-DGIT_EXTERN=extern", "-DGIT_HIDDEN=static", "-DGIT_DEPRECATED_HARD=0"],
  redis: [],
}

/**
 * Every directory in the repository that actually holds a `.h`, up to three levels
 * deep -- which is what an include path has to be for a vendored dependency tree.
 *
 * The first version built its roots from a fixed list (`src`, `include`, `deps`,
 * `lib`, `.`) relative to the corpus root, exactly as layout-vs-clang.ts does, and
 * that was the difference between measuring 7 records and measuring most of the
 * corpus. redis keeps Lua at `deps/lua/src/lua.h`, so a root list without
 * `deps/lua/src` makes every file that reaches `server.h` unparseable, and 67 of
 * 100 sampled files were unparseable for that reason alone. The failing diagnostic
 * is `fatal error: 'lua.h' file not found` -- the file EXISTS, three levels down.
 *
 * No `/usr/include` and no `/usr/include/<triple>`: the compiler already searches
 * glibc's own directories in the right order, and naming them breaks multiarch
 * resolution (`inttypes.h: unknown type name 'intmax_t'`).
 */
const includeRoots = (() => {
  // The scan starts at the REPOSITORY ROOT, not at `DIR/..`. libgit2's sources sit
  // at `src/libgit2/` while its public headers sit at `include/`, so a scan rooted
  // at `src` never sees `git2/common.h` and 37 of 40 files fail on it -- the probe
  // was pointed at a source subtree and quietly measured the wrong include path.
  const repoRootGuess = (() => {
    let d = path.resolve(DIR)
    for (let i = 0; i < 4; i++) {
      if (fs.existsSync(path.join(d, ".git"))) return d
      const p = path.dirname(d)
      if (p === d) break
      d = p
    }
    return path.resolve(DIR, "..")
  })()
  const root = repoRootGuess
  // The scan is BOUNDED BY THE REPOSITORY. Unbounded, it walked out of
  // /repositories/redis into the sibling `abseil-cpp` and put an unrelated C++
  // tree on the include path -- 8 files then failed on
  // `absl/base/config.h file not found`, a header that has nothing to do with redis.
  // A diagnostic that names a file outside the corpus under test is a harness bug
  // wearing a corpus fact's clothes.
  const repoRoot = root
  const out = new Set<string>()
  const scan = (d: string, depth: number) => {
    if (depth > 4) return
    let es: fs.Dirent[]
    try {
      es = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    if (es.some((e) => e.isFile() && e.name.endsWith(".h"))) out.add(d)
    for (const e of es) {
      if (!e.isDirectory() || e.name === ".git") continue
      const next = path.join(d, e.name)
      if (next !== repoRoot && !next.startsWith(repoRoot + path.sep)) continue
      scan(next, depth + 1)
    }
  }
  scan(root, 0)
  if (fs.existsSync(DIR)) out.add(DIR)
  // #984: a root that SHADOWS a C standard header breaks every file, and the
  // diagnostic it produces names a file outside the corpus -- `/usr/include/
  // inttypes.h:290: unknown type name 'intmax_t'` -- which is the same shape as
  // the unbounded-scan fault above: a harness bug wearing a corpus fact's
  // clothes. libgit2 is the measured case:
  //
  //   libgit2/include/git2/stdint.h   is an MSVC-ONLY shim, the whole body
  //                                    inside `#ifdef _MSC_VER`. It defines
  //                                    nothing under clang, and it shadows the
  //                                    C library's <stdint.h> for every
  //                                    forced include AND every `#include
  //                                    <stdint.h>` in the corpus.
  //
  // Measured, one file, one flag apart (blob.c, both with the real generated
  // git2_features.h from a configured build on the path):
  //
  //   without -I include/git2     compiles clean
  //   with    -I include/git2     intmax.h/inttypes.h:290 unknown type intmax_t
  //
  // and 60 of 60 `src/libgit2/*.c` compile with the root excluded, against 0 of
  // 120 measurable in the probe as it stood. The fix is to refuse a shadowing
  // root rather than to work around its consequences, because the workaround
  // (naming the C headers absolutely) does not help: `#include_next` from
  // clang's own stdint.h then finds the shim anyway.
  //
  // The list is the C standard headers a vendored tree is most likely to ship a
  // platform shim for. A root that collides is dropped, not renamed.
  const SHADOWING = new Set([
    "stdint.h", "stddef.h", "inttypes.h", "stdbool.h", "limits.h", "float.h",
    "stdarg.h", "errno.h", "time.h", "math.h", "string.h", "assert.h",
    "stdlib.h", "stdio.h", "signal.h", "setjmp.h", "locale.h", "wchar.h",
  ])
  for (const d of [...out]) {
    let entries: string[]
    try {
      entries = fs.readdirSync(d)
    } catch {
      continue
    }
    if (entries.some((n) => SHADOWING.has(n))) out.delete(d)
  }
  return [...out]
})()


/** Why a file produced no verdict. A harness fault and a corpus fact differ. */
const unmeasurable = new Map<string, number>()

interface ClangMember {
  name: string
  line: number
  bitfield: boolean
  /**
   * The owner PATH for this member, e.g. `bio_job.fd_args` for a field of the
   * anonymous aggregate `fd_args` inside `bio_job`.
   *
   * The first version of this probe FLATTENED nested anonymous aggregates into
   * the parent, on the theory that the payload publishes a flattened set. It does
   * not: `bio_job.fd_args -> type`, `-> fd`, `-> offset`, `-> need_fsync`,
   * `-> need_reclaim_cache` are all published, owner-qualified by the nested
   * aggregate's own name. Flattening therefore reported 39 MISSING members in
   * redis/src that the analyzer had published correctly and with more precision
   * than the probe was asking for -- the tenth confident wrong number from this
   * lane's instrumentation, and the second in this one file.
   */
  ownerPath: string
}
interface ClangRecord {
  name: string
  line: number
  /** Direct members, each carrying its owner PATH so nesting is comparable. */
  members: ClangMember[]
  /** Members reached through an anonymous inline aggregate, kept for reporting. */
  viaAnonymous: number
  /** The record's own kind, so an enum is never compared against a struct. */
  kind: "struct" | "union" | "enum"
}

/**
 * Clang's member list for every complete record in `file`.
 *
 * Two things this gets right that the first draft did not:
 *
 *  - A RecordDecl's fields are `inner` children, not a `fields` array. Looking for
 *    the array finds none and reports "0 records compared" while printing a rate.
 *  - `completeDefinition` is required. A forward declaration
 *    (`struct Foo;`) has no members, and treating it as an empty record would
 *    report every field of the real definition as an over-emission.
 *
 * Returns null when clang cannot parse the file, with the reason recorded by the
 * caller -- a program error (TypeError/ReferenceError) is re-thrown rather than
 * reported as a corpus property, which is the discipline every probe in this lane
 * follows after a draft printed "0 of 49 types comparable" while throwing.
 */
interface ClangInclude {
  /** The header as WRITTEN in the source (`"server.h"` / `<float.h>`). */
  written: string
  /** The path clang RESOLVED it to, absolute. */
  resolved: string
  line: number
  angled: boolean
  /** The file the directive APPEARS in, which is not always the file compiled. */
  inFile: string
}

function clangRecords(file: string, incs: string[], defs: string[], extraDefs: string[] = []): { records: ClangRecord[]; includes: ClangInclude[] } | null {
  let ast: any
  try {
    ast = JSON.parse(
      execFileSync("clang", [...STD, "-w", ...FORCED, ...defs, ...extraDefs, ...allIncs, "-Xclang", "-ast-dump=json", "-fsyntax-only", file], {
        stdio: ["ignore", "pipe", "pipe"],
        // 60s per file. A timeout is a HARNESS limit, not a corpus fact, and the
        // two must not share a bucket: at --max-files 150 the run reported 145 of
        // 150 files unmeasurable while at 120 it measured 40, which is a resource
        // ceiling rather than any property of redis. The reason string says which.
        timeout: 120000,
        maxBuffer: 512 * 1024 * 1024,
      }).toString(),
    )
  } catch (err: any) {
    if (err instanceof TypeError || err instanceof ReferenceError) throw err
    // NAME THE BLOCKER. Returning a bare null made clang's "no such file or
    // directory" indistinguishable from "this file has no records", and curl came
    // back 0 of 100 measurable with no diagnostic -- an instrument that cannot see
    // anything reporting nothing, which reads exactly like a clean result. A bucket
    // label that cannot be acted on sends the reader back to the harness by hand, so
    // the first real diagnostic is kept and classified.
    const stderr = String(err?.stderr ?? "")
    const diag =
      stderr
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && !l.includes("^") && !l.startsWith("In file") && !l.startsWith("clang")) ??
      stderr.split("\n")[0] ??
      String(err?.message ?? err).slice(0, 80)
    const reason = /ETIMEDOUT|Command failed.*timed out/i.test(String(err?.message ?? ""))
      ? "clang timed out (HARNESS limit -- raise --file-timeout to measure it)"
      : /no such file or directory/.test(stderr)
      ? `the file could not be read (HARNESS fault -- check the path) -- ${diag}`
      : /file not found/.test(stderr)
        ? `a header is not on the include path (HARNESS fault -- the vendored tree is deeper than the roots) -- ${diag}`
        : /fatal error|error:/.test(stderr)
          ? `clang rejected the translation unit (the corpus needs build configuration) -- ${diag}`
          : `clang failed -- ${diag}`
    unmeasurable.set(reason, (unmeasurable.get(reason) ?? 0) + 1)
    return null
  }

  const out: ClangRecord[] = []
  const includes: ClangInclude[] = []
  const lineOf = (n: any): number => n?.range?.begin?.[0] ?? 0
  const kindOf = (k: string): ClangRecord["kind"] => (k === "UnionDecl" ? "union" : k === "EnumDecl" ? "enum" : "struct")

  /**
   * The DIRECT members of a record, each tagged with its owner path.
   *
   * A nested anonymous aggregate is a member of this record BY ITS OWN NAME
   * (`fd_args`), and its fields are members of the child, keyed
   * `bio_job.fd_args`. The payload publishes exactly that shape, so the probe must
   * model the nesting rather than dissolve it: dissolving it produced 39 phantom
   * misses on redis/src alone, for members the analyzer published correctly.
   */
  const membersOf = (rec: any, ownerPath: string): { members: ClangMember[]; viaAnonymous: number } => {
    const members: ClangMember[] = []
    let viaAnonymous = 0
    for (const c of rec.inner ?? []) {
      if (!c) continue
      if (c.kind === "FieldDecl" && c.name) {
        members.push({ name: c.name, line: lineOf(c), bitfield: c.isBitfield === true, ownerPath })
      } else if (c.kind === "EnumConstantDecl" && c.name) {
        members.push({ name: c.name, line: lineOf(c), bitfield: false, ownerPath })
      } else if (c.kind === "RecordDecl" && !c.name && c.completeDefinition) {
        // An anonymous inline aggregate: `struct { int a; } inner;`.
        //
        // clang emits the anonymous RecordDecl and the FieldDecl that NAMES it as
        // SIBLINGS, in that order -- not as parent and child. Measured on
        // bio.c:90-117 (`bio_job` holds three of them, `header`, `fd_args`,
        // `free_args`, `comp_rq`):
        //
        //   RecordDecl  name=undefined   nested FieldDecl "type", "fd", ...
        //   FieldDecl   name="fd_args"
        //
        // so the pairing is POSITIONAL: the FieldDecl that immediately FOLLOWS an
        // unnamed RecordDecl is that record's name. The first version of this code
        // searched the record's own children for a FieldDecl whose type was a
        // RecordDecl and found none, so it emitted no child path at all -- and then
        // reported 37 correct `bio_job.fd_args -> type` edges as phantoms. The
        // analyzer had them right; the probe was looking in the wrong place.
        const kids = rec.inner ?? []
        const at = kids.indexOf(c)
        const next = kids[at + 1]
        const childName = next?.kind === "FieldDecl" ? next.name : null
        if (childName) {
          members.push({ name: childName, line: lineOf(next), bitfield: false, ownerPath })
          const inner = membersOf(c, `${ownerPath}.${childName}`)
          members.push(...inner.members)
          viaAnonymous += inner.viaAnonymous + 1
        }
      }
    }
    return { members, viaAnonymous }
  }

  const walk = (n: any) => {
    if (!n || typeof n !== "object") return
    if (
      (n.kind === "RecordDecl" || n.kind === "UnionDecl" || n.kind === "EnumDecl") &&
      n.completeDefinition &&
      n.name
    ) {
      // ONLY records DEFINED IN THIS FILE count. Clang parses the whole translation
      // unit, so its AST also carries every record declared in an INCLUDED header --
      // and comparing those against a per-file payload is how the first run of this
      // probe reported 7.40% agreement and 1,001 "missed" members on redis/src.
      //
      // The measurement was wrong, not the analyzer: adlist.c declares NO type at
      // all (`list`, `listNode`, `listIter` live in adlist.h), so it has no
      // `contains` edge and is not supposed to. tree-sitter parses the single file,
      // so the payload's universe is the file's own declarations, and comparing it
      // to a whole-TU view compares two different questions. A per-file payload can
      // only be wrong about a record it should have declared, which is the
      // same-file set. The loc test is what makes the two universes agree.
      const loc = n.loc as any
      const here =
        typeof loc === "string" ? loc.startsWith(`${file}:`) : loc?.file === file || loc?.includedFrom === undefined
      if (!here) {
        // Fall through to the recursion below but do not record the type.
        for (const c of n.inner ?? []) walk(c)
        return
      }
      const { members, viaAnonymous } = membersOf(n, n.name)
      out.push({ name: n.name, line: lineOf(n), members, viaAnonymous, kind: kindOf(n.kind) })
    }
    for (const c of n.inner ?? []) walk(c)
  }
  walk(ast)
  return { records: out, includes }
}

/**
 * libgit2 ships `git2_features.h` only as a `#cmakedefine` TEMPLATE
 * (`src/util/git2_features.h.in`); the real header is produced by CMake into a
 * build directory the corpus does not contain, and 57 of 60 sampled files fail on
 * `fatal error: 'git2_features.h' file not found` without it.
 *
 * A template means a FEATURE CHOICE, so this is a configuration decision rather
 * than a harness repair, and it is recorded as one: every `#cmakedefine` line is
 * left UNDEFINED, which is the configuration a default build with no optional
 * backends produces. It is not the configuration libgit2's CI would use, and if a
 * feature guard turned out to gate a type definition this oracle would be measuring
 * a different program than the corpus. The flag set is written to a temp directory
 * and never into the corpus, so a re-run cannot drift the tree under test.
 */
function generatedHeaderDirs(): string[] {
  const tpl = path.join(path.resolve(DIR, ".."), "util", "git2_features.h.in")
  const alt = "/home/sano/ishaq/bb_tests/repositories/libgit2/src/util/git2_features.h.in"
  const src = fs.existsSync(tpl) ? tpl : fs.existsSync(alt) ? alt : null
  if (!src) return []
  let text: string
  try {
    text = fs.readFileSync(src, "utf8")
  } catch {
    return []
  }
  const dir = fs.mkdtempSync("/tmp/opencode/cfeatures-")
  // Undefine every cmakedefine: the no-optional-features configuration.
  const out = text.replace(/^#cmakedefine.*$/gm, "/* #undef */")
  fs.writeFileSync(path.join(dir, "git2_features.h"), out)
  return [dir]
}

// #981: EXTRA include roots and -D defines, supplied on the command line.
//
// The scan above is deliberately BOUNDED BY THE REPOSITORY, and that bound is right:
// unbounded, it walked out of redis into the sibling `abseil-cpp` and put an unrelated
// C++ tree on the include path. But two of the three corpora cannot be compiled
// without a CONFIGURED BUILD, and the generated headers live OUTSIDE the repository:
//
//   curl     lib/curl_config.h  -- configure-time; cmake writes it into the build dir.
//                                 Without it curl_setup.h fails at
//                                 `#error "too small curl_off_t"`, then
//                                 `Missing definition of macro sread`.
//   libgit2  src/git2_util.h    -- BUILD-time, so libgit2 needs `make`, not just cmake.
//
// So the bound stays, and the generated roots are named EXPLICITLY instead of
// discovered. That keeps the property the bound exists to protect (no sibling corpus
// leaks onto the path) while letting a real configured build supply what a real
// compiler would have. `--extra-include` is repeatable; `--define` is repeatable.
const extraIncludes = argv.reduce((acc: string[], a: string, i: number) => (a === "--extra-include" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), [])
const extraDefines = argv.reduce((acc: string[], a: string, i: number) => (a === "--define" && argv[i + 1] ? [...acc, argv[i + 1]] : acc), [])
const incs = [...includeRoots, ...extraIncludes].flatMap((r) => ["-I" + r])
const GENERATED = generatedHeaderDirs()
const allIncs = [...incs, ...GENERATED.flatMap((d) => ["-I" + d])]
const allDefines = extraDefines.flatMap((d) => ["-D" + d])
const defs = REPO_DEFINES[REPO] ?? []

/**
 * The C library's own typedefs, force-included.
 *
 * `sds.h:33: error: unknown type name 'uint8_t'` and `rax.h:89: unknown type name
 * 'uint32_t'` are not defects in those headers -- every real compile of this corpus
 * reaches them through an include chain that provides `<stdint.h>` first, and this
 * probe compiles each file in ISOLATION with only `-I` roots. layout-vs-clang.ts
 * sidesteps the same problem differently, by wrapping the header in a probe source
 * that includes `<stdio.h>` before it; the equivalent for a file compiled directly
 * is `-include`, which needs no wrapper and cannot change the line numbering the
 * probe reports.
 */
/**
 * The dialect flag, and why it is `gnu11` rather than `c11`.
 *
 * Under strict `-std=c11` the POSIX declarations are hidden, so 53 of 150 sampled
 * redis files died on one line -- `server.h:2808: field has incomplete type 'struct
 * timeval'` -- and the oracle reported a 13% reach that was really a flag choice. The
 * same files compile under `-std=gnu11`, which is what redis's own build uses. A
 * measurement of "how much of this corpus can clang read" that is really a
 * measurement of which -std was passed is not a measurement of the corpus.
 */
const STD = ["-std=gnu11"]

const FORCED = ["-include", "stdint.h", "-include", "stddef.h", "-include", "inttypes.h"]

const files: string[] = []
;(function collect(d: string) {
  if (files.length >= MAX_FILES) return
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (files.length >= MAX_FILES) return
    if (e.name === ".git") continue
    const full = path.join(d, e.name)
    if (e.isDirectory()) collect(full)
    else if (/\.[ch]$/.test(e.name)) files.push(full)
  }
})(DIR)

let filesParsed = 0
let filesUnmeasurable = 0
/** Files clang parsed that declare no record of their own -- no claim, not a failure. */
let filesSilent = 0
let recordsJudged = 0
let agree = 0
let over = 0
let under = 0
let membersJudged = 0
let membersAgree = 0
let membersOver = 0
let membersUnder = 0
const overRows: string[] = []
const underRows: string[] = []

for (const f of files) {
  const src = fs.readFileSync(f, "utf8")
  let res: any
  try {
    res = await (new RealCAnalyzer() as any).analyze(parser.parse(src).rootNode, src, f)
  } catch (err: any) {
    unmeasurable.set(`the analyzer threw: ${String(err?.message ?? err).slice(0, 60)}`, (unmeasurable.get(`the analyzer threw: ${String(err?.message ?? err).slice(0, 60)}`) ?? 0) + 1)
    filesUnmeasurable++
    continue
  }

  const clangData = clangRecords(f, allIncs, defs, allDefines)
  if (clangData === null) {
    filesUnmeasurable++
    continue
  }
  const records = clangData.records
  if (records.length === 0) {
    // The file PARSED and declares no record of its own. That is the common case in
    // these corpora -- redis puts its types in headers, and a .c file that only
    // defines functions has nothing for `contains` to publish. It is NOT a failure
    // and NOT "not measurable": it is the correct absence of a claim, and lumping it
    // with a parse failure made a healthy 150-file run report "145 of 150 not
    // measurable", which reads like the oracle had almost no reach when in fact it
    // had plenty and the files were simply silent. Counting it as agreement would
    // inflate the denominator with files that make no claim, so it gets its own
    // column.
    filesSilent++
    continue
  }

  // The payload's side: `contains` edges keyed `ownerPath -> member`, which is
  // exactly the SOURCE the edge carries (real-c-analyzer.ts:2344 emits
  // source = s.ownerName, and ownerName is the owner-qualified path -- `bio_job`,
  // `bio_job.fd_args`). So the whole payload collapses into ONE flat map and the
  // nesting on clang's side lines up without either side being flattened.
  const payload = new Map<string, number>()
  for (const r of res.relationships ?? []) {
    if (String(r.type) !== "contains") continue
    const k = `${r.source} -> ${r.target}`
    payload.set(k, (payload.get(k) ?? 0) + 1)
  }

  // #961: a payload owner is matched against clang's owner PATH by SUFFIX, not
  // equality. clang names the record by its source tag (`pick`), while the payload
  // publishes a FUNCTION-QUALIFIED path for a function-local type
  // (`lpRandomEntries.pick`) so that two same-named locals do not collide. Equality
  // reported all 31 such members as missing -- a miss the oracle invented by
  // demanding the less precise name, which is the mirror of the #958 defect this lane
  // fixed in the other direction.
  //
  // A payload owner matches clang's `T` when it is `T` itself or ends with `.T`, so
  // the qualification is invisible to the comparison and only the type identity
  // matters.
  const ownerMatches = (payloadOwner: string, clangOwnerPath: string): boolean =>
    payloadOwner === clangOwnerPath || payloadOwner.endsWith(`.${clangOwnerPath}`)

  filesParsed++
  const claimed = new Set<string>()
  for (const rec of records) {
    recordsJudged++
    for (const m of rec.members) {
      membersJudged++
      const k = `${m.ownerPath} -> ${m.name}`
      let n = payload.get(k) ?? 0
      if (n === 0) {
        // The qualified form of the same edge, if the payload published one.
        for (const [pk, pv] of payload) {
          const arrow = pk.indexOf(" -> ")
          if (arrow < 0) continue
          if (pk.slice(arrow + 4) !== m.name) continue
          if (ownerMatches(pk.slice(0, arrow), m.ownerPath)) { n = pv; claimed.add(pk); break }
        }
      }
      claimed.add(k)
      if (n > 0) {
        membersAgree++
        agree++
      } else {
        membersUnder++
        if (underRows.length < 400)
          underRows.push(`${path.relative(DIR, f)}  ${m.ownerPath} :: ${m.name}  MISSING (clang has it, the payload has not)`)
      }
    }
  }
  // Direction matters, and it is the only direction this probe can convict without
  // knowing which records the payload claims: an edge the payload published for an
  // owner path clang never reported. Scoped to records clang SAW in this file, so a
  // record it could not parse is not a phantom.
  for (const [k, n] of payload) {
    if (claimed.has(k)) continue
    const owner = k.slice(0, k.indexOf(" -> "))
    if (!records.some((r) => r.name === owner || owner.startsWith(r.name + "."))) continue
    membersOver += n
    over += n
    if (overRows.length < 400) overRows.push(`${path.relative(DIR, f)}  ${k}  x${n}  <-- payload member clang does not have`)
  }
}

const rate = (a: number, b: number) => (b === 0 ? "n/a (nothing judged)" : `${a}/${b} = ${((a / b) * 100).toFixed(2)}%`)

console.log(`\n== C \`contains\` vs clang :: ${DIR}`)
console.log(
  `   repo ${REPO}   files offered ${files.length}   judged ${filesParsed}   declares no record ${filesSilent}   not measurable ${filesUnmeasurable}`,
)
console.log(`   clang ${clangVersion()}`)
console.log(`   records judged ${recordsJudged}   members judged ${membersJudged}`)
console.log(`   member agreement ${rate(membersAgree, membersJudged)}`)
console.log(`   MISSED members ${membersUnder}   PHANTOM members ${membersOver}`)

if (underRows.length > 0) {
  console.log(`\n   MISSED members (first ${Math.min(SHOW, underRows.length)} of ${underRows.length}):`)
  for (const r of underRows.slice(0, SHOW)) console.log("     " + r)
}
if (overRows.length > 0) {
  console.log(`\n   PHANTOM members (first ${Math.min(SHOW, overRows.length)} of ${overRows.length}):`)
  for (const r of overRows.slice(0, SHOW)) console.log("     " + r)
}
if (unmeasurable.size > 0) {
  console.log(`\n   not measurable, by reason:`)
  for (const [why, n] of [...unmeasurable].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`     ${n}  ${why}`)
}
console.log(
  membersJudged === 0
    ? "\n   VERDICT: NOTHING COMPARED -- a rate over zero rows is not a measurement."
    : membersUnder === 0 && membersOver === 0
      ? "\n   VERDICT (contains): every member clang reports is published, and the payload publishes no" +
        "\n              member clang lacks."
      : `\n   VERDICT (contains): ${membersUnder} missed, ${membersOver} phantom -- see above.`,
)

function clangVersion(): string {
  try {
    return execFileSync("clang", ["--version"], { stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n")[0]
  } catch {
    return "(version unavailable)"
  }
}
