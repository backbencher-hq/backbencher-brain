// M14.6 perl lane instrument. Re-runnable by the next reader, which is the point
// of tracking it here (reviews/LANE-AUDIT-FORMULA.md, evidence-integrity rule 4).
//
// Paths: REPO is derived from this file's own location, so the instrument travels
// with the repo. The corpora are NOT in the repo -- they are large upstream
// checkouts -- so point BB_PERL_CORPUS at them. Everything written lands in
// BB_PERL_OUT (default /tmp), never inside the repo.
const REPO = path.resolve(import.meta.dir, "..", "..", "..")
const CORPUS = process.env.BB_PERL_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const OUTDIR = process.env.BB_PERL_OUT ?? "/tmp"
/**
 * FORWARD-COMPATIBILITY: does the analyzer produce the SAME emissions under the
 * wired grammar and under a freshly built one?
 *
 * This is the measurement that decides the tree-sitter-perl 1.2.1 -> 2.0.0 bump.
 * 2.0.0 adds `parenthesized_expression`, which removes the multi-child paren
 * field that made 39,897 payload sites unreachable in 1.2.1 — so the question
 * is not "does it parse" but "does every symbol, edge, line, import, export and
 * metadata value come out byte-identical". A grammar change that alters one
 * `line_number` is a re-baseline, not an upgrade.
 *
 * Two runs, two digest files, then diff them:
 *   bun forward-compat.mts                        # wired  -> emissions-wired.tsv
 *   bun forward-compat.mts --grammar fresh-2.0.0  # 2.0.0  -> emissions-fresh-2.0.0.tsv
 *   diff emissions-wired.tsv emissions-fresh-2.0.0.tsv
 *
 * usage: bun forward-compat.mts [--grammar wired|fresh-1.2.1|fresh-2.0.0] [corpus...]
 *
 * RECONSTRUCTED 2026-09-27. The previous copy of this file was truncated to zero
 * bytes by a full disk, so `emissions()` below is a rewrite, not the original.
 * The digest is therefore STRICTLY WIDER than the one that produced the earlier
 * "5,847 of 5,875" figure: it now covers decorators, evidence tiers, reason-free
 * metadata and parse-error text, none of which the old digest hashed. Any figure
 * from this file is comparable only to another figure from this file; the old
 * number is not a baseline for it and must not be quoted beside it.
 */
import * as fs from "fs"
import * as path from "path"
import { createHash } from "crypto"

const ROOT = path.resolve(import.meta.dir, "..", "..", "..")
const CR = process.env.BB_PERL_CORPUS ?? "/home/ishaq2321/bb_tests/repositories"
const wts: any = await import(path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.js"))
const ParserClass = wts.Parser ?? wts.default ?? wts
const Language = wts.Language ?? wts.default?.Language
await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules/web-tree-sitter/tree-sitter.wasm") })

const GRAMMAR = (() => {
  const i = process.argv.indexOf("--grammar")
  return i >= 0 ? process.argv[i + 1] : "wired"
})()
const BUILDS: Record<string, string> = {
  wired: path.join(ROOT, "wasm/tree-sitter-perl.wasm"),
  "fresh-1.2.1": "/tmp/perl-grammar/v1.2.1/tree-sitter-perl.wasm",
  "fresh-2.0.0": "/tmp/perl-grammar/v2.0.0/tree-sitter-perl.wasm",
}
if (!BUILDS[GRAMMAR]) throw new Error(`unknown --grammar ${GRAMMAR}; known: ${Object.keys(BUILDS).join(", ")}`)

const CORPORA: Record<string, string> = {
  mojo: path.join(CR, "mojo"),
  plack: path.join(CR, "plack"),
  Moose: path.join(CR, "cpan/Moose-2.4000"),
  Moo: path.join(CR, "cpan/Moo-2.005005"),
  Catalyst: path.join(CR, "cpan/Catalyst-Runtime-5.90132"),
  DBI: path.join(CR, "cpan/DBI-1.654"),
  perl5: path.join(CR, "perl5"),
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out
  let es: fs.Dirent[]
  try {
    es = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of es) {
    if (e.name === ".git" || e.name === "build" || e.name === "node_modules") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out, depth + 1)
    // production's set: src/ast/language-detection.ts:42 maps pl|pm|t|perl only.
    // `PL` is not a perl extension to the engine, so it is not measured here.
    else if (/\.(pm|pl|t)$/.test(e.name)) out.push(p)
  }
  return out
}

// `--grammar <value>`: the value does not start with "-", so a naive
// "everything that isn't a flag is a corpus name" filter eats it and the run
// walks ZERO files while exiting 0. Drop the flag AND its value.
const argv = process.argv.slice(2)
const corporaArgs: string[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("-")) {
    if (argv[i] === "--grammar") i++
    continue
  }
  corporaArgs.push(argv[i])
}
const corpusNames = corporaArgs.length ? corporaArgs : Object.keys(CORPORA)
const files: string[] = []
const perCorpus: Record<string, number> = {}
for (const n of corpusNames) {
  const d = CORPORA[n]
  if (!d || !fs.existsSync(d)) {
    console.error(`corpus ${n} not found at ${d} — skipped`)
    continue
  }
  const f = walk(d).sort()
  perCorpus[n] = f.length
  files.push(...f)
}
if (files.length === 0) throw new Error(`no files found for corpora [${corpusNames.join(", ")}] — refusing to report an empty comparison`)

const parser = new ParserClass()
parser.setLanguage(await Language.load(fs.readFileSync(BUILDS[GRAMMAR])))
const { RealPerlAnalyzer } = await import(path.join(ROOT, "src/ast/real-perl-analyzer.ts"))

const j = (v: any) => JSON.stringify(v ?? null)

/**
 * Everything the analyzer publishes that a grammar change could move. Order is
 * fixed and every list is SORTED, so a digest difference means a value changed,
 * never that iteration order did.
 */
function emissions(res: any): string {
  const out: string[] = []
  for (const s of [...(res.symbols ?? [])].sort((a: any, b: any) =>
    `${a.kind}|${a.ownerName ?? ""}|${a.name}|${a.range?.startLine ?? 0}`.localeCompare(
      `${b.kind}|${b.ownerName ?? ""}|${b.name}|${b.range?.startLine ?? 0}`),
  )) {
    const r = s.range ?? {}
    out.push(
      `S ${j(s.kind)} ${j(s.ownerName)} ${j(s.name)} ${r.startLine}:${r.startColumn}-${r.endLine}:${r.endColumn}` +
      ` p=${j((s.parameters ?? []).map((p: any) => `${p.name}${p.isOptional ? "?" : ""}`))}` +
      ` d=${j((s.decorators ?? []).slice().sort())}`,
    )
  }
  for (const e of [...(res.relationships ?? [])].sort((a: any, b: any) =>
    `${a.type}|${a.source}|${a.target}|${a.line_number ?? 0}`.localeCompare(
      `${b.type}|${b.source}|${b.target}|${b.line_number ?? 0}`),
  )) {
    out.push(
      `R ${j(e.type)} ${j(e.source)} ${j(e.target)} c=${e.confidence ?? 1} ln=${e.line_number ?? "none"}` +
      ` tier=${j(e.metadata?.evidenceClass)}`,
    )
  }
  for (const i of [...(res.imports ?? [])].sort((a: any, b: any) => `${a.module}|${(a.items ?? []).join(",")}`.localeCompare(`${b.module}|${(b.items ?? []).join(",")}`))) {
    out.push(`I ${j(i.module)} items=${j([...(i.items ?? [])].sort())} ns=${i.isNamespaceImport ? 1 : 0} def=${i.isDefault ? 1 : 0}`)
  }
  for (const e of [...(res.exports ?? [])].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))) {
    out.push(`X ${j(e.name)}`)
  }
  const m = res.metadata ?? {}
  out.push(
    `M complexity=${m.cyclomaticComplexity ?? 0} loc=${m.linesOfCode ?? 0}` +
    ` perlVersion=${j(m.perlVersion)} perlVersions=${j(m.perlVersions)}` +
    ` patterns=${j([...(m.patterns ?? [])].sort())} frameworks=${j([...(m.detectedFrameworks ?? [])].sort())}`,
  )
  const errs = [...(res.errors ?? [])].map((e: any) => `${e.message ?? ""}@${e.range?.startLine ?? 0}`).sort()
  out.push(`E n=${errs.length} ${j(errs.slice(0, 5))}`)
  return out.join("\n")
}

if (process.env.FC_ONE) {
  const src = fs.readFileSync(process.env.FC_ONE, "utf8")
  for (const [label, wasm] of [["1.2.1", BUILDS.wired], ["2.0.0", BUILDS["fresh-2.0.0"]]] as [string, string][]) {
    const p2 = new ParserClass()
    p2.setLanguage(await Language.load(fs.readFileSync(wasm)))
    const r: any = new RealPerlAnalyzer().analyze(p2.parse(src).rootNode, src, process.env.FC_ONE)
    console.log(`===== ${label} =====`)
    console.log(emissions(r))
  }
  process.exit(0)
}

const lines: string[] = []
let parseFailures = 0
for (const f of files.sort()) {
  let src: string
  try {
    src = fs.readFileSync(f, "utf8")
  } catch {
    continue
  }
  let res: any
  try {
    res = new RealPerlAnalyzer().analyze(parser.parse(src).rootNode, src, f)
  } catch (e: any) {
    parseFailures++
    res = { symbols: [], relationships: [], imports: [], exports: [], errors: [{ message: `THREW ${e?.message}` }], metadata: {} }
  }
  lines.push(`${path.relative(CR, f)}\t${createHash("sha256").update(emissions(res)).digest("hex").slice(0, 32)}`)
}
const digestFile = `emissions-${GRAMMAR}.tsv`
fs.writeFileSync(path.join(process.env.BB_PERL_OUT ?? "/tmp", digestFile), lines.join("\n") + "\n")
console.log(JSON.stringify({ grammar: GRAMMAR, files: lines.length, parseFailures, corpora: perCorpus, digestFile }))
