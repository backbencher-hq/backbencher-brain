/**
 * ERLANG OVERRIDE-CONSTRUCT PROBE — the second measurement for the one type
 * `script/m60/erlang-construct-probe.ts` rules on grounds that its own probes
 * cannot reach.
 *
 *   npx tsx script/m60/erlang-override-construct-probe.ts [--out <path>] [--repos otp,elixir]
 *
 * ## Why this file exists
 *
 * The sibling probe rules `overrides` in-file and REPORTS it cross-file, on eight
 * probes (B1..B8). Eight probes of FUNCTIONS leave one hole, and this file closes
 * it: Erlang's SECOND definition namespace is the preprocessor's, and the
 * preprocessor has its own explicit override marker which the sibling probe never
 * looks for. If that marker occurs in the corpus, the in-file tier is not 33
 * self-loops — it is a real, arity-exact, single-file supply relation, which is
 * the tier every other lane publishes its member-level `overrides` on.
 *
 * The marker is not a guess; it is read out of OTP's own preprocessor, which is in
 * the corpus. `otp/lib/stdlib/src/epp.erl`:
 *
 *   -type macros() :: [atom() | {atom(), term()} | {atom(), term(), 'redefine'}].
 *
 *   scan_define_2(Arity, Def, {_,_,Key}=Mac, From, #epp{macs=Ms}=St) ->
 *       case Ms of
 *           #{Key:=Defs} when is_list(Defs) ->
 *               case proplists:is_defined(Arity, Defs) of
 *                   true  -> epp_reply(From, {error,{loc(Mac),epp,{redefine,Key}}}),
 *                   ...
 *
 * so a second `-define` of a name that is ALREADY defined is a COMPILE ERROR —
 * `{redefine, Key}` — unless the earlier definition carried the third argument,
 * which is the `'redefine'` tag in that `macros()` type. That is an explicit
 * opt-in "this definition may be replaced", which is the same role Elixir's
 * `defoverridable` plays, and it is the reason the two `-define`s are one function
 * per (name, arity) in the FUNCTIONS namespace and a replacement pair in the MACRO
 * namespace.
 *
 * ## The probes
 *
 *   M1 the marker: `pp_define` carrying a `replacement_guard_and` — the pinned
 *      grammar's node for the two-argument tail of the three-argument form. This
 *      is the `'redefine'` opt-in, counted on the tree so a nested `, false)` in a
 *      macro BODY cannot fake it. (A text probe cannot: `-define(condstrip1, {_,
 *      T1, S1} = condstrip(T, S, false))` in `otp/lib/xmerl/include/xmerl.hrl`
 *      matches `-define(NAME, ..., false)` while being a TWO-argument form. That
 *      false positive is measured here too, so the number that rules the probe out
 *      is a number and not an assertion.)
 *   M2 the replacement: a SECOND `pp_define` of a name the same file already
 *      defines — split by whether the earlier definition carried M1. The unmarked
 *      split is a compile error per `scan_define_2` and is reported so the ruling
 *      can be checked against the compiler rather than against a prose claim.
 *   M3 `-undef(NAME)` — `pp_undef`. The preprocessor's REMOVAL operator. It is
 *      counted because it is the third thing a reader would propose as an
 *      override, and a probe that leaves the obvious candidate unmeasured invites
 *      the same prose-only ruling this workstream was written to stop.
 *   M4 the CROSS-FILE macro override, which is the one tier with both endpoints in
 *      reach of ONE parse: a file that `-include`s a project-local header which
 *      defines a macro the INCLUDING file also defines. An `.erl` and its included
 *      header share one preprocessing context, so this redefinition is legal where
 *      a cross-file one is not — and both endpoints are derivable from two files
 *      without any project index.
 *   M5 `-compile({parse_transform, M})`: a parse transform is handed the module's
 *      abstract form and returns a replacement for it, which is a whole-module
 *      override. Counted because it is the fourth candidate, and because whether
 *      its TARGET members can be named is the question that decides the label.
 *
 * ## PREPROCESSOR REGIONS — the discipline M2 would otherwise get wrong
 *
 * The first version of M2 reported 2 replacements in `otp/lib/kernel/src/
 * logger_h_common.hrl` and they are NOT redefinitions. That file is
 *
 *     -ifdef(TEST).
 *         -define(init_test_hooks(), …).
 *         -define(set_defaults(), …).
 *     -else.                      % DEFAULTS!
 *         -define(init_test_hooks(), ok).
 *         -define(set_defaults(), ok).
 *     -endif.
 *
 * two MUTUALLY EXCLUSIVE branches, and the preprocessor keeps exactly one. This is
 * the same failure the sibling probe records in its own header: `-ifdef`/`-else`/
 * `-endif` are flat SIBLING markers in this grammar, not containers, so a walker
 * that tracks nesting sees both definitions at the same depth and calls a
 * conditional-compilation choice a redefinition. The region is a DOCUMENT-ORDER
 * property and is computed as one, so M2 is split by whether the second
 * definition sits in a DIFFERENT branch of a conditional.
 *
 * That correction moved M2 from "2 replacements" to **0**, which is the difference
 * between an implemented edge and a fabricated one, so it is stated here rather than
 * buried in the artifact.
 *
 * ## Honesty
 *
 * Tree-level counts over EVERY admitted file of the named repos, one parse each,
 * sorted, no sampling and no seed. This is a claim about the LANGUAGE as the pinned
 * grammar sees it, not about the analyzer: `real-erlang-analyzer.ts` is not
 * imported and shares no code with this file. Where a probe cannot decide the
 * question — M5 names a module and not the members it replaces — it says so in the
 * output rather than reporting a number in its place.
 */

import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const argOf = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const OUT = argOf("--out")
const REPOS = (argOf("--repos") ?? "otp,elixir").split(",").map((s) => s.trim()).filter(Boolean)

// The preprocessor conditionals. `-ifdef(X).` is a LEAF `pp_ifdef` SIBLING of the forms
// it guards in this grammar, so a region is a document-order property and is computed as
// one. See the header: without this, `-ifdef/-else` branches of one header are reported
// as redefinitions, which is how this probe's first version claimed 2 replacements that
// do not exist.
const PP_OPEN = new Set(["pp_if", "pp_ifdef", "pp_ifndef"])
const PP_BRANCH = new Set(["pp_else", "pp_elif", "pp_elseif", "pp_elseifdef"])
const PP_CLOSE = new Set(["pp_endif"])

type File = { repo: string; abs: string; rel: string; dir: string; text: string }

function named(node: any): any[] {
  return node?.namedChildren ?? []
}
function namedOfType(node: any, type: string): any | null {
  for (const c of named(node)) if (c?.type === type) return c
  return null
}
/**
 * `-define(NAME, …)`: the name is the `var` of the `macro_lhs`, or a quoted `atom`,
 * AND THE ARITY, which is the `var_args` parameter count.
 *
 * The arity is not a refinement — it is the identity, and a probe that omits it measures
 * a different language. `epp.erl`'s own reader takes it as a separate argument:
 * `scan_define_2(Arity, Def, {_,_,Key}=Mac, …)` tests `proplists:is_defined(Arity, Defs)`,
 * and the dictionary type is `[{atom(), term()} | {atom(), term(), 'redefine'}]` keyed per
 * arity. So `-define(CT_PEER_NAME(TestCase), …)` and `-define(CT_PEER_NAME(), …)` in
 * `otp/lib/common_test/include/ct.hrl:41-42` are TWO macros, not a redefinition.
 *
 * Keyed by name alone, this probe reported 221 same-branch redefinitions in 83 files and
 * one cross-file replacement in `otp/lib/diameter/test/` — every one of them a different
 * arity of the same name. Those two numbers were the size of an `overrides` edge class,
 * and both were wrong.
 */
function defineKey(rd: any): string | null {
  const lhs = namedOfType(rd, "macro_lhs")
  if (!lhs) return null
  const v = namedOfType(lhs, "var") ?? namedOfType(lhs, "atom")
  if (!v?.text) return null
  const params = namedOfType(lhs, "var_args")
  let arity = 0
  if (params) for (const c of named(params)) if (c?.type !== "comment") arity++
  return `${v.text}/${arity}`
}
function defineBase(rd: any): string | null {
  const key = defineKey(rd)
  return key === null ? null : (key.slice(0, key.lastIndexOf("/")) ?? key)
}
/** The include target of a `pp_include` / `pp_include_lib`, read from its `string` child.
 *  The first version matched a quoted string against the NODE's text, which is
 *  `-include("foo.hrl").` and never matches — so `includes` was always empty and M4
 *  reported "of 0 resolvable -include" while claiming the cross-file tier did not exist.
 *  A probe that resolved nothing has not measured anything. */
function includePath(node: any): string | null {
  const str = namedOfType(node, "string")
  const raw = str?.text ?? ""
  const m = /^"(.*)"$/.exec(raw.trim())
  return m ? (m[1] ?? null) : null
}

async function main(): Promise<void> {
  const root = resolve((import.meta as any).dirname ?? dirname(process.argv[1] ?? "."), "..", "..")
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => join(root, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(readFileSync(join(root, "wasm", "tree-sitter-erlang.wasm"))))

  // ── corpus ────────────────────────────────────────────────────────────────
  const files: File[] = []
  for (const repo of REPOS) {
    const dir = join(CR, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      })
        .split("\0")
        .filter(Boolean)
    } catch {
      continue
    }
    for (const rel of tracked.sort()) {
      if (!rel.endsWith(".erl") && !rel.endsWith(".hrl")) continue
      const abs = join(dir, rel)
      try {
        if (statSync(abs).size > 512 * 1024) continue
      } catch {
        continue
      }
      files.push({ repo, abs, rel: `${repo}/${rel}`, dir, text: readFileSync(abs, "utf8") })
    }
  }
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  const revs: Record<string, string> = {}
  for (const repo of REPOS) {
    try {
      revs[repo] = execFileSync("git", ["-C", join(CR, repo), "rev-parse", "HEAD"], { encoding: "utf8" }).trim()
    } catch {
      revs[repo] = "unknown"
    }
  }
  // M4's resolver: a header is identified by its BASENAME, and a basename that more than
  // one header in the checkout answers is AMBIGUOUS and never used. The first two
  // versions resolved only against the including file's own directory, which is how the
  // Erlang compiler does NOT work — `-include("logger.hrl")` in `otp/lib/kernel/src/`
  // resolves through the CODE PATH to `otp/lib/kernel/include/` — so both measured
  // "0 resolvable pairs" and would have reported a cross-file tier as empty because they
  // had resolved nothing to compare.
  const headerByBase = new Map<string, File[]>()
  for (const f of files) {
    if (!f.rel.endsWith(".hrl")) continue
    const base = f.rel.slice(f.rel.lastIndexOf("/") + 1)
    const arr = headerByBase.get(base) ?? []
    arr.push(f)
    headerByBase.set(base, arr)
  }
  const headerTree = new Map<string, any>()

  // ── counters ─────────────────────────────────────────────────────────────
  const M1 = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  const M2marked = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  const M2unmarked = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  const M2exclusiveBranch = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  const M2independentConditionals = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  const M3 = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  const M4 = {
    occurrences: 0,
    files: new Set<string>(),
    examples: [] as string[],
    /** Every `-include` whose project-local target was found in this checkout — the
     *  denominator, so a zero numerator cannot be read as "the resolver never fires". */
    resolvablePairs: 0,
    /** And the ones NOT resolved, which is what makes the denominator meaningful. */
    unresolvedIncludes: 0,
    /** Resolved to MORE THAN ONE header of that basename: counted separately and never
     *  used, because picking one would be a guess about the code path. */
    ambiguousIncludes: 0,
  }
  const M5 = { occurrences: 0, files: new Set<string>(), examples: [] as string[], modules: new Set<string>() }
  /** The text-probe false positive, measured so the ruling has a number. */
  const textFalsePositive = { occurrences: 0, files: new Set<string>(), examples: [] as string[] }
  /** Header macros by absolute path, for M4. */
  const headerMacros = new Map<string, Map<string, string>>()
  let parsedFiles = 0
  let errorFiles = 0
  let crashFiles = 0

  for (const f of files) {
    let tree: any
    try {
      tree = parser.parse(f.text)
    } catch {
      crashFiles++
      continue
    }
    if (!tree) {
      crashFiles++
      continue
    }
    parsedFiles++
    if (tree.rootNode.hasError) errorFiles++

    /** name -> whether the first definition carried the `'redefine'` marker. */
    const firstDefine = new Map<string, { marked: boolean; region: string; line: number }>()
    const definesInOrder: Array<{ name: string; marked: boolean; line: number; startIndex: number; region: string }> = []
    const undefs: Array<{ name: string; line: number; startIndex: number; region: string }> = []
    const includes: Array<{ path: string; lib: boolean; line: number }> = []

    const stack: any[] = [tree.rootNode]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node.isNamed) continue
      if (node.type === "pp_define") {
        const name = defineKey(node)
        if (name) {
          // The pinned grammar types the three-argument form's tail as a
          // `replacement_guard_and`; a two-argument form has the value directly.
          const marked = namedOfType(node, "replacement_guard_and") !== null
          const line = node.startPosition.row + 1
          definesInOrder.push({ name, marked, line, startIndex: node.startIndex, region: "PENDING" })
          if (marked) {
            M1.occurrences++
            M1.files.add(f.rel)
            if (M1.examples.length < 20) M1.examples.push(`${f.rel}:${line}: -define(${name}, …, <marker>)`)
          }
          if (!firstDefine.has(name)) firstDefine.set(name, { marked, region: "", line })
        }
      } else if (node.type === "pp_undef") {
        const v = namedOfType(node, "var") ?? namedOfType(node, "atom")
        if (v?.text) {
          undefs.push({ name: v.text, line: node.startPosition.row + 1, startIndex: node.startIndex, region: "PENDING" })
          M3.occurrences++
          M3.files.add(f.rel)
          if (M3.examples.length < 20) M3.examples.push(`${f.rel}:${node.startPosition.row + 1}: -undef(${v.text})`)
        }
      } else if (node.type === "pp_include" || node.type === "pp_include_lib") {
        const p = includePath(node)
        if (p) includes.push({ path: p, lib: node.type === "pp_include_lib", line: node.startPosition.row + 1 })
      } else if (node.type === "compile_options_attribute") {
        // `-compile({parse_transform, M}).` and `-compile([{parse_transform, M}])`.
        const visitTuple = (t: any) => {
          const kids = named(t)
          if (kids[0]?.text === "parse_transform" && kids[1]?.text) {
            M5.occurrences++
            M5.files.add(f.rel)
            M5.modules.add(kids[1].text)
            if (M5.examples.length < 20) {
              M5.examples.push(`${f.rel}:${node.startPosition.row + 1}: parse_transform ${kids[1].text}`)
            }
          }
        }
        const walkOpt = (n: any) => {
          for (const c of named(n)) {
            if (c.type === "tuple") visitTuple(c)
            else if (c.type === "list") for (const g of named(c)) if (g.type === "tuple") visitTuple(g)
          }
        }
        walkOpt(node)
      }
      for (let i = node.namedChildCount - 1; i >= 0; i--) {
        const c = node.namedChild(i)
        if (c) stack.push(c)
      }
    }

    // The text probe's false positive, measured: a two-argument `-define` whose BODY
    // ends in `, true)` or `, false)`. Recorded so "the text probe finds 4" is a
    // statement about the probe and not about the language.
    const lines = f.text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const m = /^\s*-\s*define\(\s*[A-Za-z_][A-Za-z0-9_']*\s*,(.*)\s*,\s*(?:true|false)\s*\)\s*\.?\s*$/.exec(lines[i]!)
      if (m && !definesInOrder.some((d) => d.line === i + 1 && d.marked)) {
        textFalsePositive.occurrences++
        textFalsePositive.files.add(f.rel)
        if (textFalsePositive.examples.length < 20) {
          textFalsePositive.examples.push(`${f.rel}:${i + 1}: ${lines[i]!.trim().slice(0, 70)}`)
        }
      }
    }

    // ── PREPROCESSOR REGIONS, in DOCUMENT ORDER ───────────────────────────
    // `-ifdef`/`-else`/`-endif` are flat sibling markers here, so the region of a form
    // is a stack of branch indices walked over the top level in document order. Every
    // `pp_define` and `pp_undef` is then stamped with the region it sits in, and M2 is
    // decided on the stamp rather than on tree nesting — which is the only version of
    // this question that does not call `-ifdef/-else` a redefinition.
    {
      // Each CONDITIONAL gets a unique id, and a region's key carries the id, so two
      // SIBLING `-ifdef` blocks are distinguishable. The first model keyed a region on
      // its branch index alone, so the second `-ifdef` at the same depth produced the
      // same key as the first and the two were reported as a duplicate in one branch:
      // `otp/lib/kernel/test/code_SUITE_data/other.erl` has `-ifdef(VERSION_1)` and
      // `-ifdef(VERSION_2)` blocks that each define `VERSION/0`, and the second model
      // called that an unconditional redefinition (an epp compile ERROR) when it is a
      // pair of version-guarded bodies of which the compiler selects one. A region key
      // that cannot distinguish two different conditionals cannot answer the question.
      let nextCondId = 0
      const stack: Array<{ id: number; branch: number }> = []
      const regionOf = (): string => stack.map((f) => `${f.id}.${f.branch}`).join("/")
      const markers: any[] = []
      const collectMarkers = (n: any): void => {
        for (const c of named(n)) {
          if (PP_OPEN.has(c.type) || PP_BRANCH.has(c.type) || PP_CLOSE.has(c.type)) markers.push(c)
          collectMarkers(c)
        }
      }
      collectMarkers(tree.rootNode)
      markers.sort((a, b) => a.startIndex - b.startIndex)
      // The stamp is keyed on the form's OWN startIndex. An earlier version compared a
      // marker's byte offset against a form's LINE number, so every form fell through to
      // the final stamp and every region came out equal.
      let current = ""
      const stamp = (upto: number, region: string): void => {
        for (const d of definesInOrder) if (d.region === "PENDING" && d.startIndex < upto) d.region = region
        for (const u of undefs) if (u.region === "PENDING" && u.startIndex < upto) u.region = region
      }
      for (const m of markers) {
        stamp(m.startIndex, current)
        if (PP_OPEN.has(m.type)) stack.push({ id: nextCondId++, branch: 0 })
        else if (PP_BRANCH.has(m.type)) {
          const top = stack[stack.length - 1]
          if (top) top.branch++
        } else if (PP_CLOSE.has(m.type)) stack.pop()
        current = regionOf()
      }
      stamp(Number.MAX_SAFE_INTEGER, current)
    }

    // ── M2 ────────────────────────────────────────────────────────────────
    // A second `-define` of one (name, arity) the same file already declares, split by
    // what the PREPROCESSOR does with it. Three cases, because two of them are legal and
    // one is not, and only one of the three is a redefinition:
    //
    //   same region        the body is reached twice with no conditional between them,
    //                      which `scan_define_2` rejects with `{error,{redefine,Key}}`.
    //                      An illegal program, not an override.
    //   same conditional, different branch   `-ifdef`/`-else`/`-elif`: exactly ONE body
    //                      survives preprocessing. Two alternative implementations, and
    //                      nothing replaces anything.
    //   different conditional                two independent guards, e.g. `-ifdef(A)`
    //                      and `-ifdef(B)`. Whether both bodies are compiled depends on
    //                      the `-D` flags the compiler was invoked with, and this
    //                      analyzer is not given them — so the case is REPORTED as
    //                      undecidable rather than counted either way. Calling it an
    //                      override would be a claim about a command line nobody read;
    //                      calling it an error would be wrong whenever only one flag is set.
    {
      const seen = new Map<string, { marked: boolean; region: string; line: number }>()
      for (const d of definesInOrder) {
        const prior = seen.get(d.name)
        if (!prior) {
          seen.set(d.name, { marked: d.marked, region: d.region, line: d.line })
          continue
        }
        const sameCond = prior.region.split("/")[0] === d.region.split("/")[0]
        const label = `${f.rel}:${d.line}: -define(${d.name}, …) vs the definition at line ${prior.line}`
        if (prior.region === d.region) {
          const bucket = prior.marked ? M2marked : M2unmarked
          bucket.occurrences++
          bucket.files.add(f.rel)
          if (bucket.examples.length < 20) {
            bucket.examples.push(`${label} — SAME branch, first marked: ${prior.marked}`)
          }
        } else if (sameCond) {
          M2exclusiveBranch.occurrences++
          M2exclusiveBranch.files.add(f.rel)
          if (M2exclusiveBranch.examples.length < 20) {
            M2exclusiveBranch.examples.push(
              `${label} — branches ${prior.region || "(top)"} vs ${d.region || "(top)"} of ONE conditional; one body survives preprocessing`,
            )
          }
        } else {
          M2independentConditionals.occurrences++
          M2independentConditionals.files.add(f.rel)
          if (M2independentConditionals.examples.length < 20) {
            M2independentConditionals.examples.push(
              `${label} — two INDEPENDENT conditionals (${prior.region || "(top)"} vs ${d.region || "(top)"}); whether both bodies compile depends on -D flags this analyzer is not given`,
            )
          }
        }
      }
    }

    // ── M4 ────────────────────────────────────────────────────────────────
    // An `.erl` and a project-local header it includes share ONE preprocessing context,
    // so a macro the header defines and the includer also defines is a redefinition with
    // BOTH endpoints in reach of two parses and no project index. `-include_lib` is
    // excluded: the path resolves through the code path, which this analyzer is not
    // given, and naming it would be a guess.
    for (const inc of includes) {
      if (inc.lib) continue
      const base = inc.path.slice(inc.path.lastIndexOf("/") + 1)
      const resolved = headerByBase.get(base)
      if (!resolved) {
        M4.unresolvedIncludes++
        continue
      }
      if (resolved.length > 1) {
        M4.ambiguousIncludes++
        continue
      }
      const header = resolved[0]!
      M4.resolvablePairs++
      let hTree: any
      try {
        hTree = headerTree.get(header.abs) ?? parser.parse(header.text)
      } catch {
        continue
      }
      if (!hTree) continue
      headerTree.set(header.abs, hTree)
      const hMacros = new Map<string, string>()
      const hstack: any[] = [hTree.rootNode]
      while (hstack.length > 0) {
        const n = hstack.pop()
        if (!n.isNamed) continue
        if (n.type === "pp_define") {
          const name = defineKey(n)
          if (name && !hMacros.has(name)) hMacros.set(name, `${header.rel}:${n.startPosition.row + 1}`)
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const c = n.namedChild(i)
          if (c) hstack.push(c)
        }
      }
      for (const d of definesInOrder) {
        const origin = hMacros.get(d.name)
        if (!origin) continue
        M4.occurrences++
        M4.files.add(f.rel)
        if (M4.examples.length < 20) {
          M4.examples.push(`${f.rel}:${d.line}: -define(${d.name}, …) replaces ${origin}`)
        }
      }
    }
    void undefs
  }

  // ── report ───────────────────────────────────────────────────────────────
  const n = (x: number) => String(x).padStart(6)
  console.log(`erlang override-construct probe — ${REPOS.join(", ")} @ ${Object.entries(revs)
    .map(([k, v]) => `${k} ${v.slice(0, 12)}`)
    .join(" + ")}`)
  console.log(`files: ${files.length} admitted, ${parsedFiles} parsed, ${errorFiles} with ERROR nodes, ${crashFiles} crashes\n`)
  console.log(`M1  the 'redefine' opt-in (-define(NAME/A, V, <marker>))     ${n(M1.occurrences)} occurrences in ${M1.files.size} files`)
  console.log(`M2  same-file redefinition, FIRST marked ('redefine' present) ${n(M2marked.occurrences)} occurrences in ${M2marked.files.size} files`)
  console.log(`M2  same-file redefinition, FIRST UNMARKED (an epp ERROR)     ${n(M2unmarked.occurrences)} occurrences in ${M2unmarked.files.size} files`)
  console.log(`M2  two branches of ONE conditional (not a redefinition)     ${n(M2exclusiveBranch.occurrences)} occurrences in ${M2exclusiveBranch.files.size} files`)
  console.log(`M2  two INDEPENDENT conditionals (UNDECIDABLE without -D)     ${n(M2independentConditionals.occurrences)} occurrences in ${M2independentConditionals.files.size} files`)
  console.log(`M3  -undef(NAME)                                              ${n(M3.occurrences)} occurrences in ${M3.files.size} files`)
  console.log(`M4  includer re-defines a macro its project header defines   ${n(M4.occurrences)} occurrences in ${M4.files.size} files (of ${M4.resolvablePairs} resolvable, ${M4.ambiguousIncludes} ambiguous, ${M4.unresolvedIncludes} absent)`)
  console.log(`M5  -compile({parse_transform, M})                           ${n(M5.occurrences)} occurrences in ${M5.files.size} files, ${M5.modules.size} distinct transforms`)
  console.log(`--  the TEXT probe's false positives (2-arg -define, ', false)' tail) ${n(textFalsePositive.occurrences)} occurrences in ${textFalsePositive.files.size} files`)
  console.log()
  console.log("M5 decides nothing about members: a parse transform is handed the")
  console.log("module's whole abstract form and returns a replacement for it, so it")
  console.log("names a MODULE and not the declarations it removes or rewrites. There is")
  console.log("no `f/1` anywhere in `-compile({parse_transform, T})` to hang an edge on.")

  const artifact = {
    at: new Date().toISOString(),
    script: "erlang-override-construct-probe",
    corpus: { root: CR, repos: REPOS, revs, files: files.length, parsedFiles, errorFiles, crashFiles },
    instrument: "B:parse-tree-count, over every admitted file of the named repos, one parse each, sorted",
    languageAuthority: {
      source: "otp/lib/stdlib/src/epp.erl",
      typeDeclaration: "-type macros() :: [atom() | {atom(), term()} | {atom(), term(), 'redefine'}].",
      rule: "scan_define_2 returns {error,{loc(Mac),epp,{redefine,Key}}} when the name is already defined, unless the earlier definition carried the 'redefine' tag written as the third -define argument",
      consequence:
        "a second -define of the same name in one preprocessing context is a COMPILE ERROR, so a macro redefinition is only a legal replacement where the earlier definition opted in — the marker M1 measures",
    },
    identityRule: {
      key: "macro identity is (name, ARITY), keyed the same way epp keys it — scan_define_2(Arity, Def, {_,_,Key}=Mac, ...) tests proplists:is_defined(Arity, Defs)",
      consequence:
        "two -defines of the same NAME at different arities are two macros, not a redefinition; probing by name alone reported 221 same-branch redefinitions and 1 cross-file replacement, every one of them a different arity",
    },
    grammarShapes: {
      threeArgumentDefine: "pp_define with a replacement_guard_and child (the two-argument tail)",
      undef: "pp_undef with a var child",
      parseTransform: "compile_options_attribute -> (list of) tuple with a leading parse_transform atom",
    },
    M1_redefineMarker: { occurrences: M1.occurrences, files: M1.files.size, examples: M1.examples },
    M2_sameFileRedefinition: {
      firstMarked: { occurrences: M2marked.occurrences, files: M2marked.files.size, examples: M2marked.examples },
      firstUnmarked: {
        occurrences: M2unmarked.occurrences,
        files: M2unmarked.files.size,
        examples: M2unmarked.examples,
        note: "epp rejects these with {error,{redefine,Key}} — they are not legal programs",
      },
      twoBranchesOfOneConditional: {
        occurrences: M2exclusiveBranch.occurrences,
        files: M2exclusiveBranch.files.size,
        examples: M2exclusiveBranch.examples,
        note: "the same identity in two branches of one -ifdef/-else/-elif. NOT a redefinition: exactly one body survives preprocessing. Without the region stamp these were counted as replacements — otp/lib/kernel/src/logger_h_common.hrl contributed 2 of them — which is the sibling probe's recorded -ifdef-as-sibling-marker trap",
      },
      twoIndependentConditionals: {
        occurrences: M2independentConditionals.occurrences,
        files: M2independentConditionals.files.size,
        examples: M2independentConditionals.examples,
        note: "two independent -ifdef blocks declaring the same identity, e.g. otp/lib/kernel/test/code_SUITE_data/other.erl -ifdef(VERSION_1) and -ifdef(VERSION_2) each defining VERSION/0. UNDECIDABLE: both bodies compile only when both -D flags are passed, and the analyzer is not given the command line. Counted, not classified either way",
      },
    },
    M3_undef: { occurrences: M3.occurrences, files: M3.files.size, examples: M3.examples },
    M4_includeRedefinition: {
      occurrences: M4.occurrences,
      files: M4.files.size,
      resolvableIncludePairs: M4.resolvablePairs,
      ambiguousIncludes: M4.ambiguousIncludes,
      unresolvedIncludes: M4.unresolvedIncludes,
      resolver: "header basename, unique in this checkout; ambiguous basenames are counted and never used",
      examples: M4.examples,
      note: "an .erl and the header it -include share ONE preprocessing context, so both endpoints are reachable from two parses and no project index is needed; -include_lib is excluded because its path resolves through the code path, which this analyzer is not given",
    },
    M5_parseTransform: {
      occurrences: M5.occurrences,
      files: M5.files.size,
      distinctTransforms: M5.modules.size,
      examples: M5.examples,
      verdict:
        "CANNOT CARRY A MEMBER EDGE — the construct names a module, not the declarations it rewrites, so there is no endpoint to attach",
    },
    textProbeFalsePositives: {
      occurrences: textFalsePositive.occurrences,
      files: textFalsePositive.files.size,
      examples: textFalsePositive.examples,
      note: "why the marker had to be measured on the tree: a two-argument -define whose body ends in ', false)' matches the text shape of the three-argument form",
    },
  }
  const outPath = OUT ?? join(root, "validation", "m14", "tmp", "erlang-override-construct-probe.json")
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(artifact, null, 2))
  console.log(`\nartifact: ${outPath}`)
}

await main()
