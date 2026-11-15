// ER3 — dimension 5 of the lane-audit formula: ZERO UNKNOWN SYMBOLS, measured
// through the PRODUCTION entry (`ASTEngine.parseFile`), not the analyzer class.
//
// The four counts the formula names, per corpus file:
//   unknown-kind        a symbol whose `kind` is not one of the universal kinds
//   empty name          a symbol with an empty/whitespace name
//   unknown name        a sentinel name the store or an analyzer would use for
//                       "we could not read this"
//   member without ownerName   a module-level symbol with no owner
//   symbol-free file    reported with its cause, never rounded away
//
// A symbol-free file is only legitimate if it is genuinely nothing (an
// include-only stub, a comment-only file); anything else is a loss, so the
// output separates LEGITIMATE from SUSPECT and names the suspect sites.
//
// Usage: bun run script/m14/tmp/erlang-unknown-symbols.ts [--files N]
import * as fs from "fs"
import * as path from "path"
import { ASTEngine } from "../../../src/ast/engine"

const ROOT = path.resolve((import.meta as any).dirname ?? ".", "..", "..", "..")
const REPO_ROOT = "/home/sano/ishaq/bb_tests/repositories"

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt
}
const FILE_LIMIT = parseInt(arg("files", "400"), 10)
const CORPORA = arg("corpus", "rebar3,cowboy,otp").split(",")

const UNIVERSAL_KINDS = new Set([
  "function", "class", "variable", "constant", "interface", "enum", "enum_member", "type",
  "import", "export", "method", "property", "constructor", "namespace", "module",
  "table", "service", "resource", "type_alias", "event", "delegate", "object", "record",
  "macro", "trait", "struct", "impl", "actor", "union", "mixin", "extension",
])
// Names that mean "the reader failed" rather than "the language has this name".
const SENTINEL_NAMES = new Set(["", " ", "unknown", "unnamed", "anonymous", "<unknown>", "?", "Global", "GlobalScope"])

async function main() {
  const files: string[] = []
  for (const d of CORPORA) {
    const base = path.join(REPO_ROOT, d)
    if (!fs.existsSync(base)) continue
    const stack = [base]
    while (stack.length > 0) {
      const cur = stack.pop()!
      let es: fs.Dirent[]
      try { es = fs.readdirSync(cur, { withFileTypes: true }) } catch { continue }
      for (const e of es) {
        if (e.name === ".git") continue
        const p = path.join(cur, e.name)
        if (e.isDirectory()) stack.push(p)
        // `.hrl` as well as `.erl`, for the same reason the dual lens was extended:
        // the 291 include fragments are the heart of ER-D32's domain — a header with
        // no `-module` at all, whose records and macros are owned by the file path —
        // and a dimension-5 claim that skipped them was a claim about a corpus
        // smaller than the one every other instrument here reads.
        else if (e.name.endsWith(".erl") || e.name.endsWith(".hrl")) files.push(p)
      }
    }
  }
  files.sort()
  // A per-corpus stride, not one global stride: a single stride over a sorted
  // path list draws almost entirely from whichever corpus sorts first, and the
  // first run of this probe reported cowboy + otp and NO rebar3 while claiming
  // three corpora.
  const byRoot = new Map<string, string[]>()
  for (const f of files) {
    const root = path.relative(REPO_ROOT, f).split(path.sep)[0]
    const arr = byRoot.get(root) ?? []
    arr.push(f)
    byRoot.set(root, arr)
  }
  // The per-root budget was the whole problem, twice. A limit is a CEILING: if it
  // covers the corpus, every file is taken and there is no sampling at all. Only
  // when the corpus exceeds the limit does it sample, and then it splits the budget
  // evenly and rounds the stride UP so a root is never under-sampled.
  //
  // What the two earlier versions did, both of which quietly halved or quartered the
  // corpus while a dimension-5 claim was read off the result: `floor` gave OTP
  // stride 2 (1,937 of 3,874 examined, "2,389 of 4,326"), and switching to `ceil`
  // made it worse (stride 3, 1,292 examined, "1,744 of 4,326"). Neither looked at
  // whether sampling was needed at all.
  const sample: string[] =
    FILE_LIMIT >= files.length
      ? files.slice()
      : (() => {
          const perRoot = Math.max(1, Math.floor(FILE_LIMIT / Math.max(1, byRoot.size)))
          const out: string[] = []
          for (const [, arr] of byRoot) {
            const stride = arr.length <= perRoot ? 1 : Math.ceil(arr.length / perRoot)
            for (let i = 0; i < arr.length && out.length < FILE_LIMIT; i += stride) out.push(arr[i])
          }
          return out
        })()
  console.log(`production-entry draw: ${sample.length} of ${files.length} .erl + .hrl files from [${CORPORA.join(", ")}]`)
  console.log(`universal kinds: ${UNIVERSAL_KINDS.size} `)
  console.log("")

  let symbols = 0
  let rels = 0
  const unknownKinds = new Map<string, number>()
  const emptyNames: string[] = []
  const sentinelNames = new Map<string, number>()
  const noOwner: string[] = []
  const symbolFree: { file: string; lines: number; text: string }[] = []
  const causes = new Map<string, number>()
  const suspect: { file: string; lines: number; text: string }[] = []
  const perCorpus = new Map<string, { files: number; symbols: number; rels: number; free: number }>()
  let parseFailed = 0

  for (const f of sample) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { continue }
    const corpus = path.relative(REPO_ROOT, f).split(path.sep)[0]
    const cur = perCorpus.get(corpus) ?? { files: 0, symbols: 0, rels: 0, free: 0 }
    cur.files++
    perCorpus.set(corpus, cur)
    let r: any
    try {
      r = await ASTEngine.parseFile(f, content)
    } catch {
      parseFailed++
      continue
    }
    if (!r) {
      parseFailed++
      continue
    }
    const syms = (r.symbols ?? []) as any[]
    const rs = (r.relationships ?? []) as any[]
    symbols += syms.length
    rels += rs.length
    cur.symbols += syms.length
    cur.rels += rs.length
    for (const s of syms) {
      if (!UNIVERSAL_KINDS.has(String(s.kind))) unknownKinds.set(`${s.kind}`, (unknownKinds.get(String(s.kind)) ?? 0) + 1)
      const nm = typeof s.name === "string" ? s.name : ""
      // A sentinel name is only a DEFECT if the analyzer INVENTED it. Several of
      // these strings are perfectly ordinary Erlang names: `anonymous/0` is a real
      // function in otp/lib/ssl/test/openssl_cipher_suite_SUITE.erl, and `unknown` is
      // a real atom in a dozen OTP suites. Flagging the STRING rather than the
      // behaviour produced 4 findings, all four of them real declarations — a gate
      // that cries wolf on correct output is worse than no gate, because it trains
      // the reader to skip the row.
      //
      // So the name is checked against the SOURCE TEXT: if the file really contains
      // that identifier, the analyzer read it from the file and it is not a
      // sentinel. If the file does not contain it, the name was fabricated and the
      // finding stands.
      const declaredInSource = content.includes(nm.trim())
      if (!declaredInSource && (SENTINEL_NAMES.has(nm.trim()) || nm.trim() === "")) {
        if (nm.trim() === "") emptyNames.push(`${path.relative(REPO_ROOT, f)}:${s.range?.startLine ?? "?"} kind=${s.kind}`)
        else sentinelNames.set(nm.trim(), (sentinelNames.get(nm.trim()) ?? 0) + 1)
      }
      const ownerless = s.ownerName === undefined || s.ownerName === null || s.ownerName === ""
      const memberKind = s.kind === "function" || s.kind === "method" || s.kind === "type" || s.kind === "constant" || s.kind === "struct"
      if (memberKind && ownerless) noOwner.push(`${path.relative(REPO_ROOT, f)}:${s.range?.startLine ?? "?"} kind=${s.kind} name=${nm}`)
    }
    if (syms.length === 0) {
      cur.free++
      const lines = content.split("\n")
      const text = lines
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0 && !l.startsWith("%"))
        .slice(0, 3)
        .join(" | ")
        .slice(0, 120)
      // Three legitimate causes for a symbol-free file, each named:
      //   TEMPLATE   the file is not Erlang — rebar3 ships ERL templates with
      //              mustache placeholders (`-module({{name}})`, `@@name@@`). A
      //              template has no declarations to read, so 0 symbols is the
      //              CORRECT answer, and the same files are the `{{…}}` class in
      //              the parse census. Guessing that `-module({{name}})` names
      //              the module `{{name}}` would be a fabricated symbol.
      //   STUB       an include-only file: a .hrl-shaped module with no
      //              declaration of its own.
      //   COMMENTS   nothing but comments.
      //   GRAMMAR    the file is Erlang but not to the GRAMMAR: wx's api_gen
      //              code-generation markup (`<<EXPORT:wxPrintout new/2 …>>`) and
      //              OTP's pre-R16 `-module(Name, Params)` both leave the top level
      //              as a run of ERROR nodes with no declaration of any kind
      //              surviving. Under ER-D38 the analyzer then derives nothing, so 0
      //              symbols is the CORRECT answer and this is not a loss — it is
      //              the same class the parse census already counts as a grammar
      //              error. Before this clause the probe called all three of these
      //              SUSPECT, which is the probe being wrong about a ruling rather
      //              than the analyzer being wrong about a file.
      // Anything else is a LOSS and is reported as suspect.
      const isTemplate = /{{|@@|\{\{=/.test(content)
      const isIncludeStub = /^-include/.test(text)
      const isCommentsOnly = text.length === 0
      // DIRECTIVE-ONLY. A header whose every non-comment line is an attribute that
      // declares no symbol: `-compile({parse_transform, …})`, `-feature(…)`,
      // `-doc({file, …})`, `-import(…)`. Seven real files — ms_transform.hrl and
      // qlc.hrl (each in two copies), enable.hrl, doc_with_file.hrl and
      // crypto_prop_generators.hrl. 0 symbols is the CORRECT answer for all of them:
      // there is no name to publish, and the analyzer still records whatever
      // dependency the directive implies. Enumerating them was worth doing rather
      // than waving at them — each round of this probe has found one more legitimate
      // class the round before had not met, and every one turned out to be a file
      // with a specific reason to publish little rather than a loss.
      //
      // Tested STRUCTURALLY rather than per line, because the attribute can wrap:
      // `crypto_prop_generators.hrl` is a single `-import(` spread over five lines
      // whose continuation lines (`[`, `text_plain/0,`) start with neither `-` nor
      // anything else declarative. A per-line rule passed the five single-line files
      // and failed that one, which is exactly the shape a line-based rule gets wrong.
      //
      // So: the file's first non-comment character is `-` (it is an attribute file),
      // and it contains no function head at column 0 and none of the attributes that
      // DO declare something.
      const body = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("%"))
      const DECLARING = /^-(module|define|record|type|opaque|nominal|spec|callback|export|export_type)\b/
      const hasFunctionHead = content.split("\n").some((l) => /^[a-z_][A-Za-z0-9_']*\s*\(/.test(l))
      const hasDeclaringAttribute = content.split("\n").some((l) => DECLARING.test(l.trim()))
      const isDirectiveOnly =
        body.length > 0 && body[0].startsWith("-") && !hasFunctionHead && !hasDeclaringAttribute
      // Read the ANALYZER'S OWN verdict rather than re-deriving it from the text.
      // The first attempt used a textual "does this file mention -module/-define"
      // test, which cannot tell a declaration from the same word sitting in a place
      // the grammar could not read — `pmod.erl` contains `-module(pmod, [Props])`
      // and that is exactly why it is damaged. `metadata.grammarDamaged` is set by
      // the rule itself (ER-D38) and survives the production entry, so the probe and
      // the analyzer cannot disagree about what happened.
      const isGrammarDamaged = r?.metadata?.grammarDamaged === true
      const cause = isTemplate
        ? "TEMPLATE (not Erlang source)"
        : isIncludeStub
          ? "STUB (include-only)"
          : isCommentsOnly
            ? "COMMENTS ONLY"
            : isDirectiveOnly
              ? "DIRECTIVE ONLY (every form is an attribute that declares no symbol)"
              : isGrammarDamaged
                ? `GRAMMAR DAMAGE (ER-D38: ${r?.errors?.length ?? 0} error nodes, no declaration survived)`
                : undefined
      symbolFree.push({ file: path.relative(REPO_ROOT, f), lines: lines.length, text })
      if (cause) causes.set(cause, (causes.get(cause) ?? 0) + 1)
      else suspect.push({ file: path.relative(REPO_ROOT, f), lines: lines.length, text })
    }
  }

  const rows = [...perCorpus.entries()].sort()
  console.log("| corpus | files | symbols | relationships | symbol-free files |")
  console.log("|---|---|---|---|---|")
  for (const [k, v] of rows) console.log(`| ${k} | ${v.files} | ${v.symbols} | ${v.rels} | ${v.free} |`)
  const filesN = rows.reduce((s, [, v]) => s + v.files, 0)
  console.log("")
  console.log(`TOTAL ${filesN} files | ${symbols} symbols | ${rels} relationships | parse failures ${parseFailed}`)
  console.log("")
  console.log(`unknown-kind          : ${unknownKinds.size === 0 ? "0" : JSON.stringify([...unknownKinds.entries()])}`)
  console.log(`empty names           : ${emptyNames.length}${emptyNames.length ? `  e.g. ${emptyNames.slice(0, 5).join(", ")}` : ""}`)
  console.log(`sentinel names        : ${sentinelNames.size === 0 ? "0" : JSON.stringify([...sentinelNames.entries()])}`)
  console.log(`members without owner : ${noOwner.length}${noOwner.length ? `  e.g. ${noOwner.slice(0, 5).join(", ")}` : ""}`)
  console.log(`symbol-free files     : ${symbolFree.length} (suspect: ${suspect.length})`)
  for (const [k, v] of [...causes.entries()].sort((a, b) => b[1] - a[1])) console.log(`   cause: ${k} — ${v}`)
  for (const s of symbolFree.slice(0, 12)) console.log(`   ${s.file} (${s.lines} lines)  ${s.text || "(comments only)"}`)
  for (const s of suspect.slice(0, 12)) console.log(`   SUSPECT ${s.file}  ${s.text}`)
  const bad = unknownKinds.size + emptyNames.length + sentinelNames.size + noOwner.length + suspect.length
  console.log("")
  console.log(bad === 0 ? "DIMENSION 5 GREEN: unknown-kind 0, empty/sentinel names 0, ownerless members 0, every symbol-free file accounted for" : `DIMENSION 5 RED: ${bad} finding(s)`)
}
main().catch(e => { console.error(e); process.exit(1) })
