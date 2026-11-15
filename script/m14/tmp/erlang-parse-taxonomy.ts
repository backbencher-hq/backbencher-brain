// Why does the grammar fail? A COMPLETE taxonomy of every parse-error cause in the
// erlang corpus, classified from the grammar's own ERROR nodes rather than from a
// heuristic on the first offending line of text.
//
// The previous probe (`erlang-parse-census.ts`) named a cause per FILE from its
// FIRST error line, using textual patterns. That leaves two problems this one fixes:
//
//  1. A file with several different causes is filed under whichever came first, so
//     the tail is invisible. Every ERROR site is classified here, and a file's cause
//     set is the union.
//  2. A textual pattern on one line cannot tell an abstract-format `-record #r{}`
//     from a comment that happens to mention one. The classification here reads the
//     node the grammar FAILED ON — the nearest enclosing attribute, macro or
//     declaration — which is the construct the grammar was in the middle of.
//
// It also separates the classes that are NOT defects in the analyzer:
//
//   - files that are not Erlang at all (rebar3 mustache templates, wx api_gen
//     code-generation markup), and
//   - files that are Erlang but not to THIS grammar (OTP's abstract-format
//     `-record #r{...}`, the pre-R16 `-module(Name, Params)` form).
//
// Anything left is reported as UNCLASSIFIED with its error-site context, because a
// taxonomy that silently rounds its remainder into a bucket is a count, not a
// taxonomy.
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPOS = [
  { name: "otp", dir: "/home/sano/ishaq/bb_tests/repositories/otp" },
  { name: "rebar3", dir: "/home/sano/ishaq/bb_tests/repositories/rebar3" },
  { name: "cowboy", dir: "/home/sano/ishaq/bb_tests/repositories/cowboy" },
]

interface Site {
  file: string
  line: number
  text: string
  /** The nearest enclosing construct the grammar was parsing. */
  enclosing: string
  cause: string
}

function enclosingConstruct(n: any): string {
  // Walk up to the nearest node that names a construct. The ERROR node's own parent
  // is usually a list or a block, so the interesting ancestor is further up.
  const DECLARATION = new Set([
    "pp_define",
    "record_decl",
    "module_attribute",
    "type_alias",
    "opaque",
    "nominal",
    "export_attribute",
    "import_attribute",
    "spec",
    "callback",
    "function_clause",
    "source_file",
    "pp_include",
    "pp_include_lib",
    "attribute",
    "wild_attribute",
  ])
  let cur = n?.parent
  let hops = 0
  while (cur && hops < 12) {
    if (DECLARATION.has(cur.type)) return cur.type
    cur = cur.parent
    hops++
  }
  return "(top level)"
}

/**
 * FILE-level classification, tried FIRST.
 *
 * This ordering is the whole point of the rewrite. The previous probe classified the
 * line the ERROR node starts on, and for several real files that line is perfectly
 * ordinary Erlang — `tracer() -> tracer(node()).`, `Sz =:= MfaSz andalso …`,
 * `foo() ->` — because the ERROR node's start position is not where the failure is.
 * Classifying by the line therefore produced 372 UNCLASSIFIED sites that were not a
 * mystery at all: the file was a mustache template and the error landed on line 15
 * where the placeholder had already been substituted away.
 *
 * So the file is identified first, by a marker that cannot be substituted:
 * a template placeholder anywhere, wx's `<<EXPORT:` opener, a generated lexer's
 * `##token` table, or a directory named as compile-error test data. Only what
 * survives is classified by construct.
 */
function classifyFile(whole: string, rel: string): string | undefined {
  if (/\{\{=|\{\{|@@\w*@@|\{\{=@@/.test(whole)) {
    return "NOT ERLANG: rebar3 mustache/cheetah template (placeholders substituted before the line that failed)"
  }
  if (/^<<[A-Z_]+[: ]/m.test(whole) || /^[A-Za-z_]+\n/m.test(whole) === false) {
    // `<<EXPORT:` is the opener; the closer is a bare `Name>>` line.
    if (/<</.test(whole) && /^[A-Za-z_][A-Za-z0-9_]*>>$/m.test(whole)) {
      return "NOT ERLANG: wx api_gen code-generation markup (<<EXPORT:… Name>>)"
    }
  }
  // An edoc/heredoc triple-quoted string. Once the grammar loses its footing on one,
  // EVERY later line in the file reports as an error site, so this has to be caught
  // at the file level for the same reason the template case does. Measured on
  // otp/lib/observer/src/ttb.erl, where the first error is `-doc """` and 59 sites
  // follow it, and the site lines are ordinary Erlang (`tracer(Nodes) ->
  // tracer(Nodes,[]).`). That is exactly what the INSTRUMENT class was reporting.
  if (/"""/.test(whole)) {
    return "GRAMMAR: an edoc/heredoc triple-quoted string -- once the grammar loses its footing, every later line in the file reports as an error site"
  }
  if (/^##\w+/m.test(whole)) {
    return "NOT ERLANG: leex/yecc generated lexer token table (##token)"
  }
  if (/erl_SUITE_data|erlc_SUITE_data|epp_SUITE_data|misc_SUITE_data/.test(rel)) {
    return "NOT ERLANG: deliberately-invalid or generated compile test data (…_SUITE_data)"
  }
  if (/^-record\s+#/m.test(whole)) {
    return "GRAMMAR: OTP abstract-format -record #name{…} anywhere in the file"
  }
  if (/^-import_record\(/m.test(whole)) {
    return "GRAMMAR: abstract-format -import_record(Mod, [a, b])"
  }
  if (/^-module\s*\(\s*[a-z_][A-Za-z0-9_']*\s*,/m.test(whole)) {
    return "GRAMMAR: pre-R16 two-argument -module(Name, Params)"
  }
  return undefined
}

function classify(text: string, enclosing: string, whole: string): string {
  const t = text.trim()
  // --- not Erlang at all ---
  if (/{{|@@|\{\{=/.test(t)) {
    return "NOT ERLANG: rebar3 mustache/cheetah template placeholder"
  }
  if (/^<<[A-Z_]+[: ]/.test(t)) {
    return "NOT ERLANG: wx api_gen code-generation markup (<<EXPORT:… >>)"
  }
  // --- the `?line` / `? line` preprocessor directive inside an expression ---
  // A `when` guard inside a MACRO INVOCATION's arguments: the macro takes an
  // expression list and one of them is a guard. Measured on
  // otp/lib/tools/test/tprof_SUITE.erl, where a MISSING token lands inside
  // `macro_call_args` on `when Sz =:= (DownMsgSz + MfaSz) andalso ...`, and the
  // reported line for the error after it is the perfectly ordinary
  // `Sz =:= MfaSz andalso SzAvg == MfaSz,`.
  if (/\bwhen\b/.test(t) && /:=/.test(t)) {
    return "GRAMMAR: a `when` guard inside a macro invocation's arguments"
  }
  // A record expression whose atom is a NON-ASCII byte. edoc's own test data for it:
  // `#\uFFFDrec{}` — the atom is a latin-1 é, and the grammar's `atom` token does not
  // accept a byte above 0x7F there. The line is not readable as text because the
  // source is not ASCII, which is also why this is the one site the earlier
  // line-based probe never classified.
  if (/[^\x00-\x7F]/.test(text) && /#/.test(t)) {
    return "GRAMMAR: a record expression with a NON-ASCII atom (`#<latin-1>rec{}`) — the atom token rejects bytes above 0x7F"
  }
  if (/^\?\s*line\b/.test(t)) {
    return "GRAMMAR: the `?line` preprocessor directive inside an expression (`? line` with a space too)"
  }
  // --- Erlang, but not to this grammar ---
  if (/^-record\s+#/.test(t)) {
    return "GRAMMAR: OTP abstract-format -record #name{…} (no parentheses)"
  }
  if (/^-import_record\(/.test(t)) {
    return "GRAMMAR: abstract-format -import_record(Mod, [a, b])"
  }
  if (/^-module\s*\(?\s*[a-z_][A-Za-z0-9_']*\s*,/.test(t)) {
    return "GRAMMAR: pre-R16 two-argument -module(Name, Params)"
  }
  if (/^-module\s+[a-z_]/.test(t) && !/^-module\s*\(/.test(t)) {
    return "GRAMMAR: -module without parentheses"
  }
  if (t.startsWith("%") || t.startsWith("%%")) {
    return "GRAMMAR: first error site falls inside a comment/directive region"
  }
  // --- construct-shaped ---
  if (/-define\s*\([^)]*,\s*\)/.test(t)) {
    return "GRAMMAR: macro body with an empty tail (-define(K, V, ))"
  }
  if (/\?[A-Z_][A-Za-z0-9_]*\([^)]*->/.test(t) || t.includes("?WITH_STACKTRACE")) {
    return "GRAMMAR: macro expansion required — an arrow inside a macro body"
  }
  if (/\?[A-Za-z_][A-Za-z0-9_]*\s*:/.test(t)) {
    return "GRAMMAR: macro-headed call expression (?MACRO:f(…))"
  }
  if (enclosing === "pp_define") {
    return "GRAMMAR: inside a -define body the grammar cannot close"
  }
  if (enclosing === "record_decl") {
    return "GRAMMAR: inside a record declaration"
  }
  if (enclosing === "type_alias" || enclosing === "opaque" || enclosing === "nominal") {
    return "GRAMMAR: inside a type declaration"
  }
  if (enclosing === "spec" || enclosing === "callback") {
    return "GRAMMAR: inside a spec/callback signature"
  }
  if (enclosing === "function_clause") {
    return "GRAMMAR: inside a function clause"
  }
  if (enclosing === "module_attribute" || enclosing === "attribute" || enclosing === "wild_attribute") {
    return "GRAMMAR: inside an attribute"
  }
  if (/^\s*(bad_bad_suite|no_compile)\b/.test(t) || /ct_error_SUITE_data/.test(whole)) {
    return "NOT ERLANG: deliberately-invalid common_test fixture (ct_error_SUITE_data)"
  }
  // The last honest bucket. If we got here, the file is Erlang, carries no template
  // or abstract-format marker, and the ERROR node starts on a line that reads as
  // ordinary Erlang — which means the ERROR node's start position is not where the
  // failure is. Naming that as its own class is more useful than calling it
  // unexplained: it says the INSTRUMENT needs work, not the grammar and not the file.
  if (/^[a-z_][A-Za-z0-9_']*\s*\([^)]*\)\s*->/.test(t) || /^[A-Za-z_][\w']*\s*:=/.test(t) || /^[-a-z_]+\s*\(/.test(t)) {
    return "INSTRUMENT: the ERROR node starts on a line that is ordinary Erlang — the reported line is not the cause"
  }
  return "UNCLASSIFIED"
}

async function main(): Promise<void> {
  const wts: any = await import("web-tree-sitter")
  const P = wts.Parser ?? wts.default ?? wts
  const L = wts.Language ?? wts.default?.Language
  await P.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const langBytes = fs.readFileSync(path.join(ROOT, "wasm", "tree-sitter-erlang.wasm"))

  const files: { repo: string; rel: string; abs: string }[] = []
  for (const r of REPOS) {
    if (!fs.existsSync(r.dir)) continue
    const listed = execFileSync("git", ["-C", r.dir, "ls-files", "*.erl", "*.hrl"], {
      encoding: "utf8",
      maxBuffer: 1 << 28,
    })
      .trim()
      .split("\n")
      .filter(Boolean)
    for (const rel of listed) files.push({ repo: r.name, rel, abs: path.join(r.dir, rel) })
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : 1))

  const parser = new P()
  parser.setLanguage(await L.load(langBytes))

  const byCause = new Map<string, number>()
  const byFileCause = new Map<string, Set<string>>()
  const sites: Site[] = []
  let ok = 0
  let bad = 0

  for (const f of files) {
    let content: string
    try {
      content = fs.readFileSync(f.abs, "utf8")
    } catch {
      continue
    }
    const lines = content.split("\n")
    let tree: any
    try {
      tree = parser.parse(content)
    } catch {
      continue
    }
    if (!tree) continue
    const root = tree.rootNode
    if (!root.hasError) {
      ok++
      tree.delete()
      continue
    }
    bad++
    const rel = `${f.repo}/${f.rel}`
    const fileCauses = new Set<string>()
    const fileVerdict = classifyFile(content, rel)
    const stack: any[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "ERROR" || n.isMissing) {
        const row = n.startPosition.row + 1
        const text = lines[row - 1] ?? ""
        const enc = enclosingConstruct(n)
        const cause =
          fileVerdict ??
          (n.isMissing
            ? "GRAMMAR: a MISSING token — the grammar expected something the source does not have"
            : classify(text, enc, content))
        byCause.set(cause, (byCause.get(cause) ?? 0) + 1)
        fileCauses.add(cause)
        if (sites.length < 4000) sites.push({ file: rel, line: row, text: text.slice(0, 110), enclosing: enc, cause })
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) stack.push(c)
      }
    }
    byFileCause.set(rel, fileCauses)
    tree.delete()
  }

  const unclassifiedFiles = [...byFileCause.entries()].filter(([, s]) => s.has("UNCLASSIFIED"))
  const multiCause = [...byFileCause.entries()].filter(([, s]) => s.size > 1)

  console.log("")
  console.log("ER3 parse-error taxonomy — every ERROR site classified from the grammar's own nodes")
  console.log(`  files ${files.length} | parse clean ${ok} | with a grammar error ${bad}`)
  console.log(`  files with more than one distinct cause: ${multiCause.length}`)
  console.log("")
  console.log("| cause | error sites | files |")
  console.log("|---|---|---|")
  const filesByCause = new Map<string, Set<string>>()
  for (const [f, cs] of byFileCause) for (const c of cs) filesByCause.set(c, (filesByCause.get(c) ?? new Set()).add(f))
  for (const [c, n] of [...byCause.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`| ${c} | ${n} | ${filesByCause.get(c)?.size ?? 0} |`)
  }
  console.log("")
  console.log(`UNCLASSIFIED error sites: ${byCause.get("UNCLASSIFIED") ?? 0}`)
  console.log(`files carrying at least one UNCLASSIFIED site: ${unclassifiedFiles.length}`)
  for (const [f, cs] of unclassifiedFiles.slice(0, 25)) {
    const s = sites.find((x) => x.file === f && x.cause === "UNCLASSIFIED")
    console.log(`  ${f}:${s?.line ?? "?"}  enclosing=${s?.enclosing ?? "?"}  "${(s?.text ?? "").trim().slice(0, 80)}"`)
  }
  if (unclassifiedFiles.length > 25) console.log(`  … ${unclassifiedFiles.length - 25} more`)

  const out = {
    gate: "ER3 parse-error taxonomy (erlang)",
    files: files.length,
    parseClean: ok,
    withGrammarError: bad,
    filesWithMultipleCauses: multiCause.length,
    causes: Object.fromEntries([...byCause.entries()].sort((a, b) => b[1] - a[1])),
    filesByCause: Object.fromEntries([...filesByCause.entries()].map(([c, s]) => [c, s.size])),
    unclassifiedSites: byCause.get("UNCLASSIFIED") ?? 0,
    filesWithUnclassified: unclassifiedFiles.length,
  }
  fs.writeFileSync(path.join(ROOT, "validation/m14/results/archive/erlang-parse-taxonomy.json"), JSON.stringify(out, null, 2) + "\n")
  console.log("")
  console.log(`written: validation/m14/results/archive/erlang-parse-taxonomy.json`)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})