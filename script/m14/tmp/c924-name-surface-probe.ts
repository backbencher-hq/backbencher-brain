// #924 diagnosis — WHICH published strings are not names, on the exact files the R10
// census flagged, and what the source line behind each one says.
//
// The census (`validation/m60/results/target-spelling.json`) reports per-lane whitespace
// and delimiter anomalies and routes `payloadSigil` / `matchesOwnSymbol` to #924 — but it
// reads the SPELLING of a target and cannot say where in the graph the string came from,
// nor what the source actually spells. This probe answers both for the lanes #924 still
// names (kotlin, scala, zig, haskell, elixir): it runs the PRODUCTION entry (`parseFile`)
// over the census's own sample files and prints every published symbol name and
// relationship target whose text is not a name, beside the source line that produced it.
//
// It also RE-DERIVES each census sample from the live analyzer, so a sample the census
// recorded but the analyzer no longer publishes is visible as `census-sample-not-found`
// rather than silently dropped — the census is an artifact of a dated run, and this probe
// is the check that its claims still reproduce.
//
// Classification (a classification, not a count — the fix surface differs per class):
//   Q  quoting syntax is PART of the published string: kotlin/scala backticks around a
//      name that needs them, zig's `@"…"` sigil.                                    (#924 clause 1)
//   E  an expression / payload / bracket construct published where a name belongs: a
//      call chain, a type-argument list, a constructor pattern, a comment, an
//      anonymous-class synthesis.                                                   (#924 clause 2)
//   R  a RULED naming form (cpp's `operator char*` member), owned by the target-spelling
//      register's `operatorMember` subclass — printed so it is visibly not dropped, and
//      never counted as #924 work.
//
// Run: bun script/m14/tmp/c924-name-surface-probe.ts [--lang kotlin,scala] [--json]
// Read-only: it writes nothing and parses through the same entry the lanes measure.
import * as fs from "node:fs"
import * as path from "node:path"

const CORPUS = "<corpus-root>/bb_tests/repositories"
const CENSUS = "<corpus-root>/mcp/backbencher-brain/validation/m60/results/target-spelling.json"
const LANES = ["kotlin", "scala", "zig", "haskell", "elixir"] as const

const args = process.argv.slice(2)
const langArg = args.includes("--lang") ? args[args.indexOf("--lang") + 1] : null
const asJson = args.includes("--json")
const wantLangs = (langArg ? langArg.split(",").map((s) => s.trim()) : [...LANES]).filter((l) => (LANES as readonly string[]).includes(l))

type Kind = "Q" | "E" | "R" | "OK"
const QUOTING = /[`]|@"/
/** A quoted identifier as a WHOLE string: its quoting syntax is around the name, so the
 *  name is the content. Anything else with whitespace/brackets is an expression. */
const quotedWhole = (s: string) => (/^`[^`]*`$/.test(s) || /^@"[^"]*"$/.test(s))
/**
 * Does the SOURCE spell this exact string as a quoted identifier? That is the only
 * honest arbiter for a name that merely contains whitespace: `fun `test char column
 * read and write`()` declares a name WITH SPACES, so once the quoting syntax is
 * stripped the published name still has spaces and is nevertheless correct — the
 * census's whitespace subclass is a PROXY for quoting, not a defect in itself.
 * Zig's `@"…"` is checked as well (its content is the name, the sigil is quoting).
 */
const spelledQuotedInSource = (src: string, s: string) =>
  src.includes("`" + s + "`") || src.includes('@"' + s + '"')
/**
 * The IDENTIFIER SPINE of a sample: drop every bracketed group (arguments, lambdas,
 * indexes — nesting-aware), then everything a name cannot contain. This is the same
 * rule the E-half remedy applies (a name is the chain of identifiers along the
 * callee/receiver spine), so a site whose expression target was repaired is still
 * visible here — as "spelling repaired", never as "site gone".
 */
const spineOf = (s: string): string => {
  let out = ""
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue }
    if (ch === ")" || ch === "]" || ch === "}") { if (depth > 0) depth--; continue }
    if (depth > 0) continue
    out += ch
  }
  let kept = ""
  for (const ch of out) {
    const ok =
      (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") || ch === "_" || ch === "$" || ch === "."
    if (ok) kept += ch
  }
  while (kept.includes("..")) kept = kept.replace("..", ".")
  return kept.replace(/^\.+|\.+$/g, "")
}

/**
 * #924 clause 2 (E): the CANONICAL spelling of an expression published where a name
 * belongs — the HEAD identifier of the type/expression, which is what the E-half fixes
 * publish (`ScalaRandom(Applicative.pure(new JavaSecureRandom())) with SecureRandom` →
 * `ScalaRandom`), with the `anonymous_` prefix preserved because that is the synthetic
 * name's declared shape. This is the class the Q-half canonicalizer structurally cannot
 * see: there is no quoting to strip, and the identifier SPINE of that expression is not
 * its head. Derived from the census sample TEXT — never from the fix's output, or the
 * check would be asking the fix whether the fix worked.
 */
const eHeadOf = (s: string): string => {
  const anon = s.startsWith("anonymous_")
  const body = anon ? s.slice("anonymous_".length) : s
  let end = body.length
  for (const sep of ["(", "[", "<", " {"]) {
    const i = body.indexOf(sep)
    if (i !== -1 && i < end) end = i
  }
  const head = body.slice(0, end).trim()
  if (!head) return s
  return anon ? "anonymous_" + head : head
}

const spellings = (s: string): string[] => {
  const out = [s]
  // Every COMPLETE quoting run, the same rule the analyzers and the oracle
  // apply: a backticked identifier is named by its content, `@"…"` likewise.
  let stripped = ""
  for (let i = 0; i < s.length; ) {
    if (s.charCodeAt(i) === 96) {
      const close = s.indexOf("`", i + 1)
      if (close === -1) { stripped += s.slice(i); break }
      stripped += s.slice(i + 1, close)
      i = close + 1
    } else if (s[i] === "@" && s[i + 1] === "\"") {
      const close = s.indexOf('"', i + 2)
      if (close === -1) { stripped += s.slice(i); break }
      stripped += s.slice(i + 2, close)
      i = close + 1
    } else { stripped += s[i]; i++ }
  }
  if (stripped !== s) out.push(stripped)
  const spine = spineOf(stripped === s ? s : stripped)
  if (spine && spine !== s && !out.includes(spine)) out.push(spine)
  // E half: the head of an expression, and its unqualified leaf (a qualified head
  // publishes its own spelling; the leaf is the other candidate, and each candidate is
  // only ever a MATCH — the defect counts above read the raw published strings).
  const eHead = eHeadOf(stripped === s ? s : stripped)
  if (eHead && eHead !== s && !out.includes(eHead)) out.push(eHead)
  const eLeaf = eHead.slice(eHead.lastIndexOf(".") + 1)
  if (eLeaf && eLeaf !== eHead && !out.includes(eLeaf)) out.push(eLeaf)
  return out
}
const classify = (s: string, src: string, line: string | null): Kind => {
  if (QUOTING.test(s)) return "Q"
  if (/operator\s/.test(s) && !spelledQuotedInSource(src, s)) return "R"
  if (!/\s/.test(s) && !/[(){}[\],]/.test(s)) return "OK"
  if (spelledQuotedInSource(src, s)) return "OK"
  if (line && spelledQuotedInSource(line, s)) return "OK"
  if (!/[(){}[\],]/.test(s)) return "E"
  return "E"
}

const census = JSON.parse(fs.readFileSync(CENSUS, "utf8"))
const rowOf = (lang: string) => (census.rows as any[]).find((r) => r.lang === lang)
const stripQuoting = (s: string) => s.replace(/^`|`$/g, "").replace(/^@?"|"$/g, "")

interface Hit {
  lang: string
  file: string
  where: "symbol" | "target"
  type: string
  text: string
  kind: Kind
  line: number | null
  source: string | null
}
const results: Hit[] = []
// EVERY published string (symbol names and relationship targets), flagged or not.
// The reproduction check needs this side: a repaired spelling is BY CONSTRUCTION a
// well-formed name, so it never appears in the flagged set — searching only the
// defects made a repaired site indistinguishable from a disappeared one (measured:
// kotlin's E half read 7/33 with the spine canonicalizer in place, every missing
// sample one whose target is now `dest.selectAll.where.single`).
const allPublished: Record<string, string[]> = {}
// Every published string WITH its source line, per file — the E half's line rule needs it:
// when a site's published NAME legitimately moves (elixir's comment-split head publishes the
// function name at the `defp` line, not at the comment's line), no spelling of the sample can
// match, and only "this file still publishes a well-formed name here" can tell a repaired
// site from a disappeared one.
const pubByFile: Record<string, Record<string, { text: string; line: number | null }[]>> = {}
const srcByFile: Record<string, string> = {}
const reproduce: Record<string, { sample: string; found: boolean; hits: number; repaired: boolean; truncated: number; bySpine?: boolean; byLine?: boolean; lineDelta?: number | null; commentHead?: string | null }[]> = {}

function lineOf(text: string, needle: string): { line: number; source: string } | null {
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(needle)) return { line: i + 1, source: lines[i].trim().slice(0, 130) }
  return null
}

/**
 * The E half's second canonical form, for a sample that is a COMMENT published as a name
 * (elixir's definition head split across lines): the name the SOURCE declares — the
 * identifier heading the nearest definition line above the comment. Read from the source, so
 * it is derived from the sample's own file and not from the fix's output. Deliberately narrow:
 * only the comment case, and only the definition keywords that declare a named member.
 */
function commentHeadName(src: string, line: number): string | null {
  const lines = src.split("\n")
  for (let i = line - 2; i >= Math.max(0, line - 6); i--) {
    const t = (lines[i] ?? "").trim()
    const m = t.match(/^(defp?|defmacrop?|defguardp?|defdelegate)\s+([A-Za-z_][A-Za-z0-9_?!]*)/)
    if (m) return m[2]
  }
  return null
}

for (const lang of wantLangs) {
  const row = rowOf(lang)
  if (!row) { console.error(`no census row for ${lang}`); continue }
  const samples = [...(row.whitespaceSamples ?? []), ...(row.anomalies ?? [])]
  const files = [...new Set(samples.map((s: any) => s.file as string))]
  reproduce[lang] = []
  allPublished[lang] = []
  for (const rel of files) {
    const abs = path.join(CORPUS, rel)
    let src = ""
    try { src = fs.readFileSync(abs, "utf8") } catch { console.error(`unreadable: ${rel}`); continue }
    srcByFile[rel] = src
    ;(pubByFile[lang] ??= {})[rel] ??= []
    let r: any
    try { r = await (await import("../../../src/ast/engine")).parseFile(abs, src) } catch (e: any) { console.error(`parse threw: ${rel}: ${e?.message ?? e}`); continue }
    for (const s of r.symbols ?? []) {
      const text = String(s.name ?? "")
      if (!text) continue
      allPublished[lang].push(text)
      pubByFile[lang][rel].push({ text, line: lineOf(src, text)?.line ?? null })
      if (QUOTING.test(text) || /\s/.test(text) || /[()[\]{},]/.test(text)) {
        const loc = lineOf(src, text) ?? lineOf(src, stripQuoting(text))
        results.push({ lang, file: rel, where: "symbol", type: String(s.kind ?? s.type ?? "symbol"), text, kind: classify(text, src, loc?.source ?? null), line: loc?.line ?? null, source: loc?.source ?? null })
      }
    }
    for (const x of r.relationships ?? []) {
      const text = String(x.target ?? "")
      if (!text) continue
      allPublished[lang].push(text)
      pubByFile[lang][rel].push({ text, line: lineOf(src, text)?.line ?? null })
      if (QUOTING.test(text) || /\s/.test(text) || /[(){}[\],]/.test(text)) {
        const loc = lineOf(src, text) ?? lineOf(src, stripQuoting(text))
        results.push({ lang, file: rel, where: "target", type: String(x.type ?? "edge"), text, kind: classify(text, src, loc?.source ?? null), line: loc?.line ?? null, source: loc?.source ?? null })
      }
    }
  }
  // The census's own claims, re-derived from the live analyzer: did each flagged string
  // reproduce? The samples are DISPLAY-TRUNCATED in the census (they are cut to keep the
  // artifact readable), so an exact-only comparison would report a false `not found` for
  // every long string — measured on scala's anonymous-class sample. A hit that starts with
  // the sample less its last two characters counts as `truncated-in-census` and is NOT a
  // missing claim; only a string no hit begins with is a sample that no longer reproduces.
  for (const s of samples) {
    const text = String(s.target ?? "")
    const trunc = (v: string) => v.slice(0, Math.max(1, v.length - 2))
    let exact = 0
    let near = 0
    let rawMatched = 0
    let canonicalMatched = 0
    let spineMatched = 0
    for (const v of spellings(text)) {
      const pool = allPublished[lang] ?? []
      const e = pool.filter((p) => p === v).length
      const n = e > 0 ? 0 : pool.filter((p) => p.startsWith(trunc(v))).length
      exact += e
      near += n
      if (v === text) rawMatched += e + n
      else if (v === spineOf(text)) spineMatched += e + n
      else canonicalMatched += e + n
    }
    // The E half's COMMENT rule: the sample is a COMMENT published as a name, so no spelling
    // of the sample can ever match again (the fix publishes the FUNCTION's name). The
    // canonical form is read from the sample's own file — the identifier heading the nearest
    // definition line above the comment — and the site counts as intact only when the analyzer
    // publishes exactly that name. Nothing is inferred from proximity, and the derived name is
    // printed so the reclassification can be checked by eye.
    let lineMatched = 0
    let lineDelta: number | null = null
    let commentHead: string | null = null
    if (rawMatched + canonicalMatched + spineMatched === 0 && text.startsWith("#")) {
      const srcFile = String((s as any).file ?? "")
      const srcText = srcByFile[srcFile]
      const at = srcText ? lineOf(srcText, text) : null
      if (srcText && at) {
        commentHead = commentHeadName(srcText, at.line)
        if (commentHead && (allPublished[lang] ?? []).includes(commentHead)) {
          lineMatched++
          const pub = (pubByFile[lang]?.[srcFile] ?? []).find((p) => p.text === commentHead)
          lineDelta = pub?.line != null ? pub.line - at.line : null
        }
      }
    }

    // `found` = the site still publishes something (raw or canonical spelling).
    // `repaired` = visible ONLY canonically: the sample's backticked form is gone
    // because the name is now published without its quoting — that is the fix,
    // not a disappeared site. Neither spelling visible = a site no longer read,
    // which is the one thing this check exists to catch.
    reproduce[lang].push({
      sample: text,
      found: rawMatched + canonicalMatched + spineMatched + lineMatched > 0,
      hits: exact,
      repaired: canonicalMatched + spineMatched + lineMatched > 0 && rawMatched === 0,
      truncated: exact === 0 && rawMatched + canonicalMatched + spineMatched > 0,
      bySpine: spineMatched > 0 && rawMatched === 0 && canonicalMatched === 0,
      byLine: lineMatched > 0 && rawMatched === 0 && canonicalMatched === 0 && spineMatched === 0,
      lineDelta,
      commentHead,
    })
  }
}

if (asJson) {
  console.log(JSON.stringify({ results, reproduce }, null, 1))
} else {
  for (const lang of wantLangs) {
    const mine = results.filter((h) => h.lang === lang)
    const byKind = (k: Kind) => mine.filter((h) => h.kind === k)
    console.log(`\n=== ${lang}: ${byKind("Q").length + byKind("E").length + byKind("R").length} non-name published string(s)  Q=${byKind("Q").length} E=${byKind("E").length} R=${byKind("R").length} OK=${byKind("OK").length}`)
    for (const h of mine.filter((h) => h.kind !== "OK").sort((a, b) => (a.kind > b.kind ? 1 : -1))) {
      console.log(`  [${h.kind}] ${h.where}/${h.type} ${JSON.stringify(h.text.slice(0, 90))}`)
      console.log(`        ${h.file}${h.line ? `:${h.line}` : ""}`)
      if (h.source) console.log(`        src: ${h.source}`)
    }
    const repro = reproduce[lang] ?? []
    const miss = repro.filter((r) => !r.found)
    const repair = repro.filter((r) => r.repaired).length
    const bySpine = repro.filter((r) => r.bySpine).length
    const trunc = repro.filter((r) => r.truncated).length
    const byLine = repro.filter((r) => r.byLine)
    console.log(`  census samples: ${repro.length - miss.length}/${repro.length} still published` + (repair ? ` (${repair} only under the canonical spelling — spelling repaired, site intact${bySpine ? `; ${bySpine} of them by the identifier spine` : ""}${byLine.length ? `; ${byLine.length} by the E-half COMMENT rule (the name the source declares above the comment is published${byLine.some((r) => r.commentHead) ? `: ${byLine.map((r) => JSON.stringify(r.commentHead)).join(", ")}` : ""})` : ""})` : "") + (trunc ? ` (${trunc} matched only a display-truncated census sample)` : ""))
    for (const m of miss) console.log(`    census-sample-not-found: ${JSON.stringify(m.sample.slice(0, 80))}`)
  }
}
