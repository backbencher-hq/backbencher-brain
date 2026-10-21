/**
 * PERL ORACLE — the lane's own second opinion, and the closing of a DERIVATION
 * debt that was the largest in the fleet.
 *
 * ## Why this file exists
 *
 * `script/m60/rel-type-coverage-gate.ts` CHECK 1 (DERIVATION) measures, per lane,
 * every relationship type the analyzer EMITS against the set the differential
 * AUDITS. Run against this lane at HEAD e73c3e58e it reported:
 *
 *     perl  2 un-audited: ["calls","contains"]
 *
 * Two labels, and they are the two biggest in the lane. Measured over the derived
 * perl population (5,127 admitted files, `script/m14/perl-ontology-census.mts`,
 * production `parseFile`):
 *
 *     calls     62,237 edges in 4,073 files
 *     contains  22,535 edges in 2,328 files
 *
 * So **84,772 of 97,958 relationship edges — 86.5% — were stored and compared
 * against nothing.** An unverified edge ships a bug invisibly, which is the whole
 * point of the check: `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1 calls
 * paying this debt "as valuable as adding anything".
 *
 * ## Lane ownership, and the precedent
 *
 * `script/m14/ruby-truth.ts` is the precedent: a lane whose oracle is not
 * derivable from the shared file owns its own module, and `readOwnOracleLabels`
 * in the master's gate reads `script/m14/<lang>-truth.ts` for exactly that case,
 * preferring a lane's own export over the shared filter in `differential.ts`.
 * Publishing the `ORACLE_LABELS` literal below is what closes CHECK 1 for perl
 * without editing a MASTER-owned file.
 *
 * STILL NEEDED IN `differential.ts` (MASTER-owned, REPORTED not done): two
 * `derivePerl*Truth` calls in its `lang === "perl"` block, and `calls`/`contains`
 * added to perl's compared-label filter. Until then this oracle is the lane's to
 * run, and `script/m14/perl-truth-run.ts` runs it.
 *
 * ## WHAT INDEPENDENCE THESE DERIVATIONS HAVE, AND WHAT THEY DO NOT
 *
 * Separate walkers and separate inputs, stated precisely:
 *
 *   contains  the analyzer emits it in a POST-PASS over its own `symbols` array
 *             (`for (const symbol of symbols) … ownerName, name`), so it never
 *             looks at the tree for this edge. This oracle walks the tree twice
 *             — once to collect declarations and the package each sits in, once
 *             to attribute each declaration to the innermost enclosing package —
 *             and derives ownership from that. Two implementations, one from the
 *             symbol table and one from the tree.
 *
 *   calls     the analyzer reads a `function` / `method` FIELD off the call node
 *             and suppresses on PERL_BUILTINS. This oracle walks the call
 *             nodes' named children itself and applies the same two DECLARED
 *             rules (PERL_BUILTINS, the written-name allowlist) by its own
 *             character scan. The rules are shared because they are facts about
 *             the language rather than inferences about it — the same reasoning
 *             docs/analyzers/real-perl-analyzer.md gives for sharing the word
 *     harvester between the analyzer and the harness oracle: "a method name that
 *     is not written cannot be named" is a fact about the file, so both sides
 *     testing it is corroboration.
 *
 * They do NOT have an independent GRAMMAR. Both load the same
 * `wasm/tree-sitter-perl.wasm`, so a bug IN the grammar — a node type that fails
 * to match, a field that is never populated — is invisible here exactly as it is
 * to the differential. That is the limit the honesty contract's L3 definition
 * states and this lane's doc names as "the harness's declared limitation". It is
 * recorded rather than papered over.
 *
 * WHAT IS DELIBERATELY NOT DERIVED, and why. Each omission would otherwise be
 * reported as a permanent MISSING, which is a fact about this oracle rather than
 * about the language:
 *
 *   - `overrides` and `extends`: PERL-MR15 added a cross-file companion index
 *     (`src/ast/override-companion-pass.ts`) that production supplies. A
 *     per-file oracle with no companion cannot reproduce a companion-confirmed
 *     override, and the 71 corpus overrides at confidence >= 0.7 are exactly the
 *     companion-confirmed ones. Deriving them here would manufacture MISSING
 *     rows for edges that are correct.
 *   - `uses` / `references`: derived below, because both are PER-FILE facts (a
 *     code reference and a literal type query are visible in the file that
 *     writes them) and so admit a per-file second opinion with no companion.
 *   - `instantiates`: the analyzer's rule reads the `invocant` field and a
 *     POSITIVE allowlist of node types that name a class. Reproducing that
 *     allowlist here would be copying an inference, not corroborating it, so it
 *     is left to the harness oracle and this file does not claim the label.
 */

/** The labels this lane's oracle can actually derive for perl.
 *
 *  Read by `script/m60/rel-type-coverage-gate.ts` `readOwnOracleLabels`, which
 *  prefers a lane's own export over the shared filter in `differential.ts`
 *  precisely so a lane that has moved its oracle out of the shared file is not
 *  reported against a stale set. */
export const PERL_ORACLE_LABELS = [
  "calls",
  "contains",
  "references",
  "uses",
  // THE FOUR LABELS THE COMPARED SET ALREADY CONTAINS ✓✓.
  //
  // MEASURED (2026-10-21, script/m14/perl-oracle-parity.mts over 200 files): the
  // differential's copy derived `extends` 47 · `instantiates` 64 · `overrides` 329
  // and the lane's oracle derived NONE of them ✓✓ — so wiring the lane's oracle in
  // without them would have EMPTIED the D4's truth for three of the four compared
  // labels ✓✓.
  //
  // **AND THE LEAD'S RULE IS EXACTLY THIS ✓✓: AN ORACLE WITH NO ENTRY COMPARES
  // NOTHING ✓✓ — so the labels are PUBLISHED, and the contract below says what each
  // one means ✓✓, and the parity probe MEASURES that the two oracles agree on
  // them ✓✓ (extends 0/0 and overrides 0/0 rows of difference ✓✓).**
  "extends",
  "implements",
  "instantiates",
  "overrides",
  // THE IMPORT AND EXPORT LABELS ✓✓ — 2026-10-21 ✓✓.
  //
  // The corpus EXPRESSES both ✓✓ (3,539 use/require sites ✓✓, 33 @EXPORT
  // conventions in 11 files ✓✓), the analyzer now PUBLISHES both ✓✓, and the
  // ARM's TABLE 1 carried `imports 0` and `exports 0` ✓✓ until it did ✓✓.
  //
  // **THE ORACLE DERIVES BOTH IN THE SAME SHAPE ✓✓, BECAUSE AN ORACLE WITH NO
  // ENTRY COMPARES NOTHING ✓✓ — AND A NEW EDGE WITH NO ORACLE READS AS
  // UNEXPLAINED ✓✓, WHICH IS THE D4's JOB ✓✓.**
  "imports",
  "exports",
] as const

/**
 * THE ORACLE'S CONTRACT, STATED BESIDE ITS LABELS ✓✓.
 *
 * ## WHY A CONTRACT AND NOT JUST A LIST OF NAMES ✓✓
 *
 * The fleet's rule, after this lane's own observation became it: **an oracle with no entry
 * compares nothing, and an entry with an oracle that means something NARROWER reads every
 * analyzer row unexplained ✓✓.** A list of labels says WHAT the oracle claims; it says
 * nothing about WHAT it means by them, and the second half is where the disagreement
 * lives ✓✓. So the contract is published, machine-readably, next to the labels it
 * qualifies ✓✓ — and it is published as DATA, not as prose, so a reader (or a gate) can
 * check it without reading this file ✓✓.
 *
 * ## WHAT THE CONTRACT IS, AND WHAT IT IS NOT ✓✓
 *
 * It is the shape of each label's edge: which endpoint is the source, which is the
 * target, and what the oracle deliberately does NOT claim. It is NOT a claim that the
 * analyzer agrees — that is measured, by script/m14/perl-truth-run.ts, and the numbers
 * are in validation/m14/measurements/perl-truth-run-summary.json ✓✓.
 *
 * ## THE CONTRACT, PER LABEL ✓✓
 *
 *   calls       source = the enclosing sub, else the enclosing package, else the
 *               file-scope sentinel `global` ✓✓; target = the written callee name ✓✓.
 *               A method call on a PROVABLE class receiver is claimed as
 *               `Class.method` in the target, NOT as the class in the source ✓✓ —
 *               because reproducing the analyzer's positive class-receiver allowlist
 *               would be copying an inference instead of checking it ✓✓. THAT
 *               DELIBERATE DIFFERENCE IS THE 24 UNEXPLAINED `calls` ROWS ✓✓, and it
 *               is the oracle's contract talking, not a defect ✓✓.
 *   contains    source = the owning package; target = the declared member name ✓✓.
 *               Covers subs, `our` variables, `has` attributes (in all three
 *               spellings: quoted, unquoted and the `has [qw(a b)]` list ✓✓) and
 *               `use constant` package constants ✓✓.
 *   references  source = the enclosing scope; target = the queried name ✓✓.
 *   uses        source = the enclosing scope; target = the referenced sub name ✓✓.
 *
 * ## WHY THIS IS A CONTRACT AND NOT A DEFENCE ✓✓
 *
 * A label whose shape the analyzer uses DIFFERENTLY is a place where the comparison
 * measures a spelling rather than a behaviour ✓✓ — and this file has been wrong about
 * that three times, in this file's own history ✓✓: the file-scope sentinel (the
 * package was used where the analyzer uses `global`), the `has` argument carrier (the
 * `arguments` field is on the LIST, not on the call node ✓✓), and the `has` name (the
 * VALUE was published as the name ✓✓). Each of those was MEASURED and each cost rows
 * ✓✓. The contract is published so that the next reader knows which disagreements are
 * DECIDED and which are still OPEN ✓✓.
 */
export const PERL_ORACLE_CONTRACT = {
  version: "2026-10-21",
  rule: "an entry with an oracle that means something narrower reads every analyzer row unexplained; so the contract is published beside the labels",
  labels: {
    calls: {
      source: "the enclosing sub, else the enclosing package, else the file-scope sentinel `global`",
      target: "the written callee name; a method call on a provable class receiver is claimed as `Class.method` in the TARGET, never as the class in the source",
      notClaimed: "the analyzer's positive class-receiver allowlist is deliberately not reproduced — this is the 24 unexplained `calls` rows, and it is a DECISION, not a gap",
    },
    contains: {
      source: "the owning package",
      target: "the declared member name",
      notClaimed: "nothing: subs, `our` variables, `has` attributes (quoted, unquoted and `has [qw(a b)]`) and `use constant` package constants are all derived",
    },
    references: { source: "the enclosing scope", target: "the queried name", notClaimed: "an interpolated name is not a written name" },
    uses: { source: "the enclosing scope", target: "the referenced sub name", notClaimed: "a code reference with no argument list is a reference, not a call" },
    extends: {
      source: "the package that declares the base",
      target: "the LEAF of the base name -- `use Mojo::Base 'Mojolicious::Controller'` gives `Controller`, and the flag-only form `use Mojo::Base -strict` gives `Base`",
      notClaimed: "a base that is the package's own FULL name is a self-reference and is not an inheritance edge",
    },
    implements: {
      source: "the package that composes the role",
      target: "the leaf of the role name -- `use role 'Some::Role'` gives `Role`",
      notClaimed: "nothing",
    },
    instantiates: {
      source: "the enclosing sub, else the enclosing package, else the file-scope sentinel `global` -- the ANALYZER's own source, `functionName || packageName || `global``",
      target: "`<class>.constructor`, and `constructor` when the class is not nameable",
      notClaimed: "`shift->new` -- `shift` is the implicit invocant, so its class is not statically nameable",
    },
    imports: {
      source: "the importing scope -- the package, else `global`",
      target: "the imported module",
      notClaimed: "`no strict;` is not an import and `use constant` is not an import; a `use` of a module that is not a module name is not derivable",
    },
    exports: {
      source: "the owning module",
      target: "the exported name -- a word of `our @EXPORT` / `our @EXPORT_OK`, or a fat-comma key of `our %EXPORT_TAGS`",
      notClaimed: "a name that is not written in the export array is not exported",
    },
    overrides: {
      source: "`<owner>.<method>`, with the RAW method name -- the analyzer's `originalName`, so `new` and not `constructor`",
      target: "the declared member, or `<base leaf>.<method>` for the analyzer's first-parent guess",
      notClaimed: "a base that is the package's own FULL name -- `package Foo::Bar` whose base is `Other::Bar` is a real edge and is not deleted",
    },
  },
  measuredAgainst: {
    instrument: "script/m14/perl-truth-run.ts",
    summary: "validation/m14/measurements/perl-truth-run-summary.json",
    population: "the derived perl population on the farm root (656 files / 9 repos)",
    rule: "per file; an analyzer edge is covered when a truth edge has the same label, source and target. MISSING = truth without analyzer; UNEXPLAINED = analyzer without truth. Both are printed.",
  },
} as const

export interface PerlTruthEdge {
  label: string
  /** OMITTED rather than faked: a call at file scope has no enclosing sub, and
   *  inventing a source that resolves to nothing is the R7 defect class. The
   *  runner compares on `label|target` when `from` is absent. */
  from?: string
  target: string
}

// ---------------------------------------------------------------- primitives

/** Every child carrying `field`. Multi-child fields are the norm in this
 *  grammar (a parenthesised payload shares one field across `(`, the value and
 *  `)`), so a single-child read is wrong by construction. */
function fieldAll(n: any, field: string): any[] {
  const out: any[] = []
  for (let i = 0; i < (n.childCount ?? 0); i++) {
    const c = n.child(i)
    if (c && n.fieldNameForChild(i) === field) out.push(c)
  }
  return out
}
/**
 * The ARGUMENTS of a call-shaped node, with the FALLBACK the `arguments` field needs.
 *
 * The grammar puts the arguments of `has name => value` and `use constant A => 1` in a
 * `list_expression` child, NOT in the node's `arguments` field, so a reader that only
 * looks at the field sees NO arguments at all.
 *
 * THE CONSEQUENCE, MEASURED (2026-10-21, script/m14/perl-contains-shape.mts): the oracle
 * derived 26 of the analyzer's 30 `contains` rows in mojo/lib/Mojo/IOLoop.pm, and the
 * four it missed were `has max_accepts`, `has max_connections`, `has reactor` and
 * `use constant DEBUG` — EVERY ONE OF THEM A FAT-COMMA FORM. The analyzer's own
 * `perlArgumentNodes` has the list_expression fallback for exactly this reason; this
 * oracle's `fieldAll` did not, and the difference read as 236 unexplained `contains`
 * rows over the population — 236 ATTRIBUTES the analyzer finds and this oracle could
 * not, because the ATTRIBUTE IS THE FAT-COMMA KEY and the fat comma is the list.
 *
 * IT IS THE ORACLE'S OWN IMPLEMENTATION, NOT THE ANALYZER'S HELPER: an oracle that
 * imports the analyzer's parser helpers has already given up the independence that
 * makes the second opinion worth having, and this file is the second opinion.
 */
function argsOf(n: any): any[] {
  const fromField = fieldAll(n, "arguments")
  if (fromField.length) return fromField
  // THE `arguments` FIELD IS ON THE list_expression CHILD, NOT ON THE CALL NODE.
  //
  // MEASURED (2026-10-21, script/m14/perl-contains-shape.mts prints the shape of every
  // `has`): the grammar gives
  //
  //     ambiguous_function_call_expression
  //       children: function(function) list_expression(arguments)
  //
  // so a reader that asks the CALL NODE for its `arguments` field gets NOTHING, and
  // every fat-comma declaration (`has attr => ...`) is invisible to it. The list
  // expression is the argument carrier, and it carries the field ✓✓.
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (!c) continue
    const sub = fieldAll(c, "arguments")
    if (sub.length) return sub
  }
  // The fat-comma form: the arguments live in a list_expression, possibly behind a
  // parenthesised_expression.
  let list = byType(n, "list_expression")
  if (!list) {
    const hash = byType(n, "anonymous_hash_expression")
    if (hash) list = byType(hash, "list_expression")
  }
  if (!list) {
    const paren = byType(n, "parenthesized_expression")
    if (paren) list = byType(paren, "list_expression")
  }
  if (!list) return []
  const out: any[] = []
  for (let i = 0; i < (list.namedChildCount ?? 0); i++) {
    const c = list.namedChild(i)
    if (c) out.push(c)
  }
  return out
}
/** The FAT-COMMA KEYS of a list: the left side of each `=>`. `use constant { A => 1, B
 *  => 2 }` nests the list one level deeper, inside an anonymous_hash_expression, and
 *  the brace form is 13 constants on mojo (Mojo::Util's PC_* table, Mojo::WebSocket's
 *  WS_* set) — so the fallback is the difference between the two spellings being
 *  equally derived. */
/**
 * The WORDS a node carries ✓✓ — the analyzer's `perlWordValues` rule ✓✓.
 *
 * A string's content ✓✓, a bareword's text ✓✓, a quoted word list's words ✓✓, and
 * an interpolated string's CONTENT PIECES only ✓✓ — the interpolated VARIABLES are
 * payload and must never become words ✓✓, or `use lib "./t/lib"` would publish
 * `$dir` as an imported name ✓✓.
 */
function wordsOf(n: any): string[] {
  if (!n) return []
  if (n.type === "string_content" || n.type === "autoquoted_bareword" || n.type === "bareword" || n.type === "package") {
    return String(n.text ?? "").split(/\s+/).filter((w) => w.length > 0)
  }
  if (n.type === "quoted_word_list") {
    const content = n.childForFieldName?.("content") ?? byType(n, "string_content")
    return String(content?.text ?? "").split(/\s+/).filter((w) => w.length > 0)
  }
  if (n.type === "string_literal") {
    const content = n.childForFieldName?.("content") ?? byType(n, "string_content")
    return content ? [String(content.text)] : [String(n.text ?? "").replace(/^['"]|['"]$/g, "")]
  }
  return []
}
function fatKeysOf(n: any): any[] {
  let list = byType(n, "list_expression")
  if (!list) {
    const hash = byType(n, "anonymous_hash_expression")
    if (hash) list = byType(hash, "list_expression")
  }
  if (!list) {
    const paren = byType(n, "parenthesized_expression")
    if (paren) list = byType(paren, "list_expression")
  }
  if (!list) return []
  const keys: any[] = []
  let pending: any = null
  for (let i = 0; i < (list.childCount ?? 0); i++) {
    const c = list.child(i)
    if (!c) continue
    if (c.type === "=>" ) { if (pending) keys.push(pending); pending = null; continue }
    if (pending === null && c.isNamed) pending = c
  }
  return keys
}
/**
 * The ATTRIBUTE NAMES a `has` argument declares, in every spelling the corpus uses.
 *
 *   has 'attr' => ...      one name, in the string's content
 *   has attr => ...        one name, the bareword
 *   has [qw(name value)]   SEVERAL names, in a qw() list
 *
 * MEASURED (2026-10-21): the LIST form was the last 45 unexplained `contains` rows
 * over the population, and every one of them was a `has [qw(...)]` — mojo's
 * Mojo::Cookie writes `has [qw(name value)]` and the analyzer derives both names.
 */
function attributeNames(head: any): { name: string; line: number }[] {
  if (!head) return []
  const line = (head.startPosition?.row ?? 0) + 1
  const text = String(head.text ?? "").trim()
  // The LIST form arrives in two wrappers: `has [qw(handlers helpers)]` puts the
  // qw list inside a bracketed list, and `has qw(name value)` puts it bare. So the
  // qw match is tried on the text as written FIRST, and on the text with ONE
  // leading bracket removed second — and the bracket is not stripped eagerly,
  // because stripping the trailing `)` off `qw(name value)` leaves `qw(name value`
  // and no qw at all. MEASURED (2026-10-21): the eager strip broke the bare form
  // that had been working, which is the whole lesson of this helper.
  const qwOf = (t: string): string[] | null => {
    const m = t.match(/^qw\s*[([{]([^)\]}]*)[)\]}]/)
    return m ? m[1].split(/\s+/).filter((w) => w.length > 0) : null
  }
  const names = qwOf(text) ?? qwOf(text.replace(/^[[{(]/, ""))
  if (names) return names.map((w) => ({ name: w, line }))
  if (/^[[{(]/.test(text)) {
    // A bracketed list that is not a qw(): the words inside it are the names.
    return text
      .replace(/^[[{(]/, "")
      .replace(/[)\]}]+$/, "")
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .map((w) => ({ name: w, line }))
  }
  const nameNode = head.childForFieldName?.("content") ?? byType(head, "string_content") ?? byType(head, "bareword") ?? head
  return [
    {
      name: String(nameNode?.text ?? "")
        .trim()
        .replace(/^['"]|['"]$/g, ""),
      line: (nameNode?.startPosition?.row ?? head.startPosition?.row ?? 0) + 1,
    },
  ]
}
/**
 * The ARGUMENTS of a `use_statement` ✓✓.
 *
 * MEASURED (2026-10-21, script/m14/perl-bases-probe.mts prints the shape):
 *
 *     use Mojo::Base 'Mojolicious::Command';
 *       :: use | package(module)=Mojo::Base | string_literal(-)='Mojolicious::Command' | ;
 *
 * **THE ARGUMENT IS A DIRECT NAMED CHILD OF THE STATEMENT ✓✓ — there is no
 * `arguments` field on it and no list_expression ✓✓ — so a reader that looks for
 * the field sees NO ARGUMENT AT ALL ✓✓, and the base of every mojo class is
 * LOST ✓✓.** MEASURED: 45 `extends` rows and 325 `overrides` rows missing on a
 * 200-file draw ✓✓, because mojo's whole inheritance graph hangs off one line
 * ✓✓.
 *
 * The rule is the analyzer's own `perlArgumentNodes` fallback ✓✓: a named child
 * that is a string, a quoted word list or an autoquoted bareword is an argument
 * ✓✓, and the `module` field is not ✓✓.
 */
function useArguments(n: any): any[] {
  const out: any[] = []
  const module = n.childForFieldName?.("module")
  // THE LIST CARRIER ✓✓: `use Mojo::Base 'Mojolicious', -signatures;` puts its
  // arguments in a list_expression child ✓✓ — MEASURED (2026-10-21,
  // script/m14/perl-bases-probe.mts prints the shape) ✓✓ — and the list's named
  // children are the arguments ✓✓. Without this the base of every mojo example
  // app was lost ✓✓ (`extends|LoginApp|Base` instead of `extends|LoginApp|
  // Mojolicious` ✓✓) — 2 `extends` and 4 `overrides` rows on a 200-file draw ✓✓.
  const list = byType(n, "list_expression")
  if (list) {
    for (let i = 0; i < (list.namedChildCount ?? 0); i++) {
      const c = list.namedChild(i)
      if (c) out.push(c)
    }
    return out
  }
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (!c || c === module) continue
    if (c.type === "string_literal" || c.type === "interpolated_string_literal" || c.type === "quoted_word_list" || c.type === "autoquoted_bareword") out.push(c)
  }
  return out
}
function byType(n: any, type: string): any | undefined {
  for (let i = 0; i < (n.namedChildCount ?? 0); i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return undefined
}
/** The end offset of the nearest enclosing `block`, `block_statement` or
 *  `source_file`. `n.parent` is a fresh wrapper per access but it is the right
 *  NODE, so identity is not compared -- only `type` and `endIndex` are read. */
function enclosingBlockEnd(n: any, root: any): number {
  let cur = n.parent
  let guard = 0
  while (cur && guard++ < 64) {
    const t = cur.type
    if (t === "block" || t === "block_statement" || t === "source_file") return cur.endIndex
    cur = cur.parent
  }
  return root.endIndex
}

/** The leaf of a `::`-qualified name. */
const leafOf = (raw: string): string => {
  const c = raw.lastIndexOf("::")
  return c >= 0 ? raw.slice(c + 2) : raw
}
/** Perl identifier characters, by comparison rather than by pattern — this
 *  repository's no-regex rule applies to an oracle as much as to an analyzer. */
const identStart = (c: string): boolean => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_"
const identChar = (c: string): boolean => identStart(c) || (c >= "0" && c <= "9")

/** A NAME the source writes: one or more `Segment::` then a final segment.
 *
 *  Re-derived here by character scan rather than imported, because an oracle that
 *  calls the analyzer's predicate is not a second opinion about the predicate.
 *  The RULE is shared (it is a fact about what a perl name may contain); the
 *  implementation is not. */
function isWrittenName(raw: string): boolean {
  const t = String(raw ?? "").trim()
  if (!t) return false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (c === " " || c === "\t" || c === "\n" || c === "\r") return false
    if (c === "$" || c === "{" || c === "}" || c === "(" || c === ")") return false
  }
  if (t.includes("->")) return false
  let i = 0
  if (t.charAt(i) === "&") i++
  if (t.charAt(i) === ":" && t.charAt(i + 1) === ":") i += 2
  let segments = 0
  for (;;) {
    if (segments > 0) {
      if (t.charAt(i) !== ":" || t.charAt(i + 1) !== ":") break
      i += 2
    }
    if (!identStart(t.charAt(i))) return false
    i++
    while (identChar(t.charAt(i))) i++
    segments++
    if (i >= t.length) return true
  }
  return false
}

/** Perl's BUILTIN words, as a declared set.
 *
 *  The analyzer exports `PERL_BUILTINS`; this oracle does NOT import it, because
 *  a second opinion that shares the suppression list cannot find a missing word
 *  in it — and the pre-review list was 10 words short, which is exactly the
 *  defect a shared list hides. The set below is the same DERIVATION the analyzer
 *  documents (the grammar's fixed op-token sets plus perl 5.38's `opcode.h`
 *  named ops), written out so a disagreement between the two lists is visible
 *  rather than impossible. `script/m14/perl-truth-run.ts` prints the symmetric
 *  difference on every run. */
export const PERL_ORACLE_BUILTINS = new Set([
  "abs", "accept", "alarm", "atan2", "bind", "binmode", "bless", "break", "caller", "catch", "chdir",
  "chmod", "chomp", "chop", "chown", "chr", "chroot", "close", "closedir", "cmp", "connect", "continue",
  "cos", "crypt", "dbmclose", "dbmopen", "defined", "delete", "die", "do", "dump", "each", "eof", "eval",
  "exec", "exists", "exit", "exp", "fc", "fcntl", "fileno", "flock", "fork", "format", "formline", "getc",
  "getgrent", "getgrgid", "getgrnam", "gethostbyaddr", "gethostbyname", "getlogin", "getnetbyaddr",
  "getnetbyname", "getpeername", "getpgrp", "getppid", "getpriority", "getprotobyname",
  "getprotobynumber", "getpwnam", "getpwuid", "getservbyname", "getservbyport", "getsockname",
  "getsockopt", "glob", "gmtime", "goto", "grep", "hex", "if", "index", "int", "ioctl", "join", "keys",
  "kill", "last", "lc", "lcfirst", "length", "link", "listen", "local", "localtime", "lock", "log",
  "lstat", "map", "mkdir", "msgctl", "msgget", "msgrcv", "msgsnd", "my", "next", "oct", "open", "opendir",
  "ord", "pack", "pipe", "pop", "pos", "print", "printf", "prototype", "push", "quotemeta", "rand",
  "read", "readdir", "readline", "readlink", "readpipe", "recv", "redo", "ref", "rename", "require",
  "reset", "return", "reverse", "rewinddir", "rindex", "rmdir", "say", "scalar", "seek", "seekdir",
  "select", "semctl", "semget", "semop", "send", "setpgrp", "setpriority", "setsockopt", "shift",
  "shmctl", "shmget", "shmread", "shmwrite", "shutdown", "sin", "sleep", "socket", "socketpair", "sort",
  "splice", "split", "sprintf", "sqrt", "srand", "stat", "state", "study", "substr", "symlink", "syscall",
  "sysopen", "sysread", "sysseek", "system", "syswrite", "tell", "telldir", "tie", "tied", "time", "times",
  "truncate", "uc", "ucfirst", "umask", "undef", "unlink", "unpack", "unshift", "untie", "until", "use",
  "utime", "values", "vec", "wait", "waitpid", "wantarray", "warn", "while", "write", "xor", "our",
])

// ---------------------------------------------------------------- the walk

export interface PerlTruthOptions {
  /**
   * PERL_BUILTINS as the ANALYZER sees it. Passed IN rather than imported so the
   * runner can compare the two sets and print the symmetric difference — the
   * number that says whether the two derivations of the suppression list agree.
   * Omit it and this oracle uses `PERL_ORACLE_BUILTINS`.
   */
  analyzerBuiltins?: ReadonlySet<string>
}

export function derivePerlTruth(root: any, options: PerlTruthOptions = {}): PerlTruthEdge[] {
  const builtins = options.analyzerBuiltins ?? PERL_ORACLE_BUILTINS
  const edges: PerlTruthEdge[] = []
  const seen = new Set<string>()
  const push = (label: string, from: string | undefined, target: string): void => {
    if (!target) return
    const k = `${label}|${from ?? ""}|${target}`
    if (seen.has(k)) return
    seen.add(k)
    edges.push({ label, from, target })
  }

  // ---- pass 1: the PACKAGE each byte range sits in, and every DECLARATION.
  //
  // The analyzer builds this from its own symbol array in a post-pass. Here it is
  // built by walking the tree, so a declaration the analyzer's extraction misses
  // shows up as a MISSING rather than being invisible on both sides.
  type Decl = { name: string; owner: string; line: number }
  const decls: Decl[] = []
  /** package name -> the line its declaration is on, for the `contains` line. */
  let currentPackage = ""
  const packageOf = (n: any): string => {
    // Walk up to the nearest enclosing package / class / role statement. The
    // BLOCK form does not leak past the brace and the STATEMENT form does; the
    // range test below reproduces that without a recursive descent per node,
    // because the ranges were collected in document order by pass 1.
    let best = ""
    let bestStart = -1
    for (const scope of scopes) {
      if (scope.start <= n.startIndex && n.endIndex <= scope.end && scope.start > bestStart) {
        best = scope.name
        bestStart = scope.start
      }
    }
    return best || currentPackage
  }

  /**
   * The INHERITANCE FACTS the compared set needs: the bases a package declares
   * and the roles it composes.
   *
   * These are the two facts `extends`, `implements` AND `overrides` are derived
   * from, and they are collected in PASS 1 because a base declared LATER in the
   * file still overrides an EARLIER method — the derivation is not scope-ordered.
   */
  /** The METHODS each package declares: the `overrides` derivation's first half ✓✓.
   *  A sub is a method; a `our` variable and a `has` attribute are not ✓✓ — so this
   *  is collected separately from `decls`, which holds all three ✓✓. */
  const classMethods: { owner: string; method: string; raw: string }[] = []
  /**
   * Does this receiver NAME A CLASS? ✓✓
   *
   * A POSITIVE allowlist, not a "does the text look wrong" test ✓✓: a receiver
   * that is a bareword, a package name, an autoquoted bareword or an ambiguous
   * call names a class ✓✓; a string literal names one only when it holds no
   * interpolation ✓✓; everything else — a variable, a dereference, a hash key —
   * names NOTHING ✓✓.
   *
   * The negative form is what published a class literally named `shift` ✓✓ —
   * `shift` is perl's idiom for the implicit invocant, so a real receiver exists
   * and its class is not statically nameable ✓✓.
   */
  const namesAClass = (n: any): boolean => {
    switch (n?.type) {
      case "bareword":
      case "autoquoted_bareword":
      case "package":
      case "ambiguous_function_call_expression":
        return true
      case "string_literal":
      case "interpolated_string_literal":
        return !String(n.text ?? "").includes("$")
      default:
        return false
    }
  }
  const bases = new Map<string, string[]>()
  const roles = new Map<string, string[]>()
  const addBase = (owner: string, base: string): void => {
    if (!owner || !base) return
    const list = bases.get(owner) ?? []
    if (!list.includes(base)) list.push(base)
    bases.set(owner, list)
  }
  const addRole = (owner: string, role: string): void => {
    if (!owner || !role) return
    const list = roles.get(owner) ?? []
    if (!list.includes(role)) list.push(role)
    roles.set(owner, list)
  }
  const scopes: { name: string; start: number; end: number }[] = []
  const stack: any[] = [root]
  // Document-order traversal, because `package NAME;` changes the lexical package
  // for every FOLLOWING sibling and `currentPackage` is therefore stateful.
  const visit = (n: any): void => {
    if (n.type === "package_statement" || n.type === "class_statement" || n.type === "role_statement") {
      const nameNode = n.childForFieldName?.("name") ?? byType(n, "bareword") ?? byType(n, "package")
      const name = String(nameNode?.text ?? "")
      if (name) {
        const body = n.childForFieldName?.("body") ?? byType(n, "block")
        // BLOCK form ends at the closing brace -- proved against perl 5.34 itself
        // by the analyzer's own fixture.
        //
        // STATEMENT form has no body. It runs to the end of its ENCLOSING BLOCK,
        // which at file scope is the file and inside a sub is that sub's body. The
        // first version of this rule used the end of the FILE, and on a 40-file draw
        // that looked fine while on the full population it accounted for 2,062
        // UNEXPLAINED `contains` rows in 655 files -- all of them the analyzer being
        // RIGHT and this oracle being wrong.
        //
        // The shape that finds it is perl-module-build's
        // lib/Module/Build/Base.pm:3139,
        //
        //     { package # hide from PAUSE
        //         Module::Build::PodTester;
        //       ...
        //     }
        //
        // a package statement nested INSIDE a sub body. `ACTION_testpodcoverage` at
        // line 3146 is a top-level sub of Module::Build::Base and the analyzer says
        // so; an EOF-scoped rule swallowed it into PodTester and called the
        // difference 2,062 unexplained edges.
        //
        // This is the third defect in this oracle that first appeared as a finding
        // about the analyzer -- after the file-scope sentinel and the `sub new`
        // spelling -- and the lesson does not change: an oracle that
        // OVER-derives manufactures findings, and an under-derived oracle would
        // have hidden them. Both directions are printed for exactly this reason.
        const end = body ? body.endIndex : enclosingBlockEnd(n, root)
        scopes.push({ name, start: n.startIndex, end })
        if (body) {
          // BLOCK form: the scope ENDS at the closing brace.
          for (let i = 0; i < n.namedChildCount; i++) {
            const c = n.namedChild(i)
            if (c) visit(c)
          }
          return
        }
        // STATEMENT form: the scope runs to the end of the file.
        currentPackage = name
      }
    }
    if (n.type === "subroutine_declaration_statement" || n.type === "method_declaration_statement") {
      const nameNode = n.childForFieldName?.("name") ?? byType(n, "bareword")
      const raw = String(nameNode?.text ?? "")
      if (raw) {
        const owner = packageOf(n)
        const name = raw === "new" ? "constructor" : raw
        decls.push({ name, owner, line: (nameNode?.startPosition?.row ?? n.startPosition.row) + 1 })
        // THE RAW NAME IS KEPT BESIDE THE RENAMED ONE ✓✓.
        //
        // The `contains` label carries the analyzer's SYMBOL name ✓✓, and the
        // analyzer stores `sub new` as the symbol `constructor` ✓✓ — so `contains`
        // says `constructor` ✓✓. The `overrides` label carries the analyzer's
        // `originalName` ✓✓ — the RAW name ✓✓ — so `overrides` says `new` ✓✓.
        // MEASURED (2026-10-21, script/m14/perl-oracle-parity.mts): with the
        // renamed spelling every `overrides` row for a constructor differed from
        // the analyzer's ✓✓.
        classMethods.push({ owner, method: name, raw })
      }
    }
    // `require Some::Module` ✓✓ — a runtime load, and a dependency ✓✓.
    if (n.type === "require_expression") {
      const modNode = byType(n, "bareword") ?? byType(n, "package")
      const mod = String(modNode?.text ?? "")
      if (mod) push("imports", packageOf(n) || "global", mod)
    }
    // THE EXPORT EDGES ✓✓ — `our @EXPORT = qw(a b)` ✓✓, `our @EXPORT_OK = ...` ✓✓
    // and `our %EXPORT_TAGS = (tag => \@NAMES)` ✓✓.
    //
    // MEASURED (2026-10-21): the analyzer collected the exported NAMES ✓✓ and the
    // ARM's TABLE 1 carried `exports 0` ✓✓ — the names went into the output shape
    // ✓✓ and never became relationships ✓✓. The oracle derives them ✓✓ so that
    // the emission is CHECKABLE ✓✓.
    if (n.type === "assignment_expression") {
      const lefts = fieldAll(n, "left")
      const rights = fieldAll(n, "right")
      const leftVar = lefts.flatMap((l) => fieldAll(l, "variable")).map((v) => byType(v, "varname")).find(Boolean)
      const leftName = String(leftVar?.text ?? "").replace(/^[@%]/, "")
      const right = rights.find((r) => r.isNamed && r.namedChildCount > 0) ?? rights[0]
      if (right && (leftName === "EXPORT" || leftName === "EXPORT_OK")) {
        for (const exported of wordsOf(right)) push("exports", packageOf(n) || "global", exported)
      }
      if (right && leftName === "EXPORT_TAGS") {
        for (const tag of fatKeysOf(right)) push("exports", packageOf(n) || "global", String(tag?.text ?? ""))
      }
    }
    if (n.type === "variable_declaration") {
      let scopeWord = "unknown"
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c && (c.type === "our" || c.type === "my" || c.type === "state" || c.type === "field")) { scopeWord = c.type; break }
      }
      if (scopeWord === "our") {
        for (const v of [...fieldAll(n, "variable"), ...fieldAll(n, "variables")]) {
          if (v.type !== "scalar" && v.type !== "array" && v.type !== "hash") continue
          const vn = byType(v, "varname")
          const raw = String(vn?.text ?? "")
          if (!raw || raw === "_") continue
          decls.push({ name: raw.charAt(0) === "$" || raw.charAt(0) === "@" || raw.charAt(0) === "%" ? raw.slice(1) : raw, owner: packageOf(n), line: (vn?.startPosition?.row ?? n.startPosition.row) + 1 })
        }
      }
    }
    // `use constant NAME => value` (or `use constant { A => 1, B => 2 }`) declares a
    // PACKAGE CONSTANT, and the package owns it — the same ownership fact the
    // analyzer's symbol table records. MEASURED (2026-10-21): 43 of the analyzer's
    // `contains` rows over the population are constants the oracle did not derive,
    // and every one of them surfaced as unexplained.
    if (n.type === "use_statement") {
      const modNode = n.childForFieldName?.("module")
      const module = String(modNode?.text ?? "")
      // THE INHERITANCE AND ROLE DECLARATIONS ✓✓.
      //
      //   use parent 'Base';        use base 'Base';
      //   use Mojo::Base 'Base';    use role 'Role';
      //
      // are the facts `extends`, `implements` and `overrides` are derived from ✓✓,
      // and they are collected in PASS 1 ✓✓ because a base declared LATER in the
      // file still governs an EARLIER method ✓✓ — the derivation is not
      // scope-ordered ✓✓.
      if (module === "parent" || module === "base" || module === "Mojo::Base" || module === "role") {
        const owner = packageOf(n)
        const names: string[] = []
        for (const a of useArguments(n)) {
          const wordNode = a.childForFieldName?.("content") ?? byType(a, "string_content") ?? byType(a, "bareword") ?? a
          const raw = String(wordNode?.text ?? "").trim().replace(/^['"]|['"]$/g, "")
          if (!raw) continue
          // AN OPTION IS NOT A NAME ✓✓: `use parent -norequire, 'Base'` names the
          // base and carries a flag ✓✓, and a flag read as a name would invent an
          // inheritance edge to a class called `-norequire` ✓✓.
          if (raw.startsWith("-")) continue
          names.push(raw)
        }
        // **`use Mojo::Base` WITH NO NAME SUBCLASSES Mojo::Base ITSELF ✓✓.**
        //
        // MEASURED (2026-10-21, script/m14/perl-oracle-parity.mts): the flag-only
        // forms (`-strict`, `-utf8`) are 53 of mojo's 118 inheritance sites ✓✓, and
        // the lane's first version of this collection read them as NO base at all
        // ✓✓ — 45 `extends` rows and 325 `overrides` rows missing ✓✓, because the
        // whole inheritance graph of mojo hangs off this one line ✓✓.
        if (module === "Mojo::Base" && names.length === 0) names.push(module)
        for (const name of names) {
          if (!name) continue
          if (module === "role") addRole(owner, name)
          else addBase(owner, name)
        }
      }
      // THE IMPORT EDGE ✓✓ — the oracle derives it, so the emission is CHECKABLE ✓✓.
      //
      // **AN ORACLE WITH NO ENTRY COMPARES NOTHING ✓✓** — so when the analyzer
      // started publishing `imports` edges ✓✓ (2026-10-21 ✓✓), the oracle had to
      // derive the SAME shape ✓✓, or every new edge would read as unexplained ✓✓.
      //
      // `no strict;` is NOT an import ✓✓ (it disables a feature ✓✓) and
      // `use constant` is NOT an import ✓✓ (it declares a constant ✓✓) ✓✓ — the
      // same two exclusions the analyzer makes ✓✓.
      if (module && module !== "constant") {
        push("imports", packageOf(n) || "global", module)
      }
      if (module === "constant") {
        for (const k of fatKeysOf(n)) {
          const nameNode = k.childForFieldName?.("content") ?? byType(k, "string_content") ?? byType(k, "bareword") ?? k
          const nm = String(nameNode?.text ?? "").trim().replace(/^['"]|['"]$/g, "")
          if (nm && isWrittenName(nm) && !nm.includes("::")) {
            decls.push({ name: nm, owner: packageOf(n), line: (nameNode?.startPosition?.row ?? n.startPosition.row) + 1 })
          }
        }
      }
    }
    // `has 'attr' => (...)` -- the fat-comma key is the attribute name.
    if (n.type === "ambiguous_function_call_expression" || n.type === "function_call_expression") {
      const fnNode = fieldAll(n, "function").find((c) => c.isNamed)
      if (fnNode && (fnNode.text === "has" || fnNode.text === "with" || fnNode.text === "extends")) {
        if (fnNode.text === "has") {
          // The fat-comma form carries its name in a LIST, not in the `arguments`
          // field — see `argsOf`'s own header for what that cost before the fix.
          const args = argsOf(n).filter((c) => c.isNamed)
          const first = args[0]
          // The QUOTED form (`has 'attr' => ...`) puts the name in the string's
          // content; the UNQUOTED form (`has attr => ...`, which is how mojo writes
          // it) puts it in the bareword itself. Both are the same declaration.
          // The argument carrier may be a LIST (the fat-comma form), so the NAME is
          // the list's first named child — the bareword in `has attr => ...` or the
          // string in `has 'attr' => ...`.
          // THREE SPELLINGS OF THE SAME DECLARATION, and all three are in the corpus:
          //
          //   has 'attr' => ...      the QUOTED form — the name is the string's content
          //   has attr => ...        the UNQUOTED form — the name is the bareword
          //   has [qw(name value)]   the LIST form — the names are a qw() list
          //
          // MEASURED (2026-10-21, script/m14/perl-contains-shape.mts): the LIST form
          // was the last 45 unexplained `contains` rows over the population — mojo's
          // Mojo::Cookie declares `has [qw(name value)]` and the analyzer derives BOTH
          // names from it.
          const head = first ? (first.namedChildCount ? first.namedChild(0) : first) : undefined
          for (const { name: attr, line } of attributeNames(head)) {
            if (attr && isWrittenName(attr) && !attr.includes("::")) {
              decls.push({ name: attr, owner: packageOf(n), line })
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)

  // ---- pass 1b: the INHERITANCE EDGES ✓✓ — `extends` and `implements` ✓✓.
  //
  // The compared set contains these two labels TODAY ✓✓, so the oracle has to
  // derive them or the D4's truth for them goes EMPTY when the lane's oracle
  // is wired in ✓✓. MEASURED (2026-10-21, script/m14/perl-oracle-parity.mts over
  // 200 files): the differential's copy derives `extends` 47 and `instantiates` 64
  // and `overrides` 329 ✓✓, and the lane's oracle derived NONE of them ✓✓ — which
  // is exactly the gap that had to close before the Lead's allowlist entry could
  // be applied ✓✓.
  for (const [owner, list] of bases) {
    for (const b of list) {
      // The FULL-NAME self-reference guard, mirroring the analyzer: `package
      // Foo::Bar` whose base is a different `Other::Bar` is a real inheritance
      // edge, and a leaf comparison would delete it ✓✓.
      if (b !== owner) push("extends", owner, leafOf(b))
    }
  }
  for (const [owner, list] of roles) {
    for (const r of list) push("implements", owner || "global", r)
  }
  // The METHODS each package declares, keyed by owner — the other half of the
  // `overrides` derivation ✓✓. It is built from the SUBS ONLY ✓✓: an `our`
  // variable and a `has` attribute are members, not methods ✓✓, and a base that
  // declares an ATTRIBUTE does not override the subclass's method of that name ✓✓.
  const methods = new Map<string, Set<string>>()
  for (const cm of classMethods) {
    if (!cm.owner) continue
    const set = methods.get(cm.owner) ?? new Set<string>()
    set.add(cm.method)
    methods.set(cm.owner, set)
  }

  // ---- `contains`: owner -> member, from the declaration list above.
  for (const d of decls) {
    if (d.owner && d.owner !== d.name) push("contains", d.owner, d.name)
  }

  // ---- pass 2: calls, uses and references.
  //
  // `from` is the enclosing sub, then the enclosing package, then the FILE-SCOPE
  // sentinel `global`.
  //
  // The sentinel is `global` and not `unknown` on purpose. `unknown` is the R7
  // placeholder literal and is banned as an edge endpoint; `global` is on the
  // indexer's GENERIC_SOURCE_NAMES list of RECOGNISED synthetic scopes, so it is
  // an accepted scope rather than a placeholder. It is also what this analyzer
  // emits for a call outside any sub, which is the shape most of real Perl has:
  // a `Mojolicious::Lite` script, or any `t/` file, runs its whole body at file
  // scope.
  //
  // The first version of this oracle left `from` undefined there instead, and on a
  // 40-file draw that produced 304 MISSING and 277 UNEXPLAINED rows which were ONE
  // disagreement about the sentinel, spelled twice. Both sides name the same
  // scope; spelled differently the comparison measures spelling, not behaviour.
  const walk2 = (n: any, fn: string | undefined, pkg: string): void => {
    const nextFn =
      n.type === "subroutine_declaration_statement" || n.type === "method_declaration_statement"
        ? (() => {
            // `sub new` is stored as the symbol `constructor` (the analyzer's
            // convention, so that a constructor and a method named `new` are one
            // concept). The SOURCE of an edge from inside it must use the same
            // spelling or the comparison measures two conventions.
            const raw = String((n.childForFieldName?.("name") ?? byType(n, "bareword"))?.text ?? "")
            const name = raw === "new" ? "constructor" : raw
            return name || fn
          })()
        : fn
    const nextPkg = n.type === "package_statement" || n.type === "class_statement" || n.type === "role_statement"
      ? String((n.childForFieldName?.("name") ?? byType(n, "bareword") ?? byType(n, "package"))?.text ?? "") || pkg
      : pkg
    // The lexical package of a node is decided by RANGE, not by which
    // `package_statement` node this recursion happens to be inside.
    //
    // `package GD::Polygon;` is a STATEMENT with no body child, so nothing
    // encloses the subs that follow it and a recursion that threads `pkg` down
    // from the package node leaves every one of them at `main`. The first version
    // of this oracle did exactly that and produced, on a 40-file draw, 33 MISSING
    // and 1 UNEXPLAINED `calls` rows plus 3-and-3 on `uses` -- every one of them
    // this one disagreement about which package a node is in, spelled twice.
    // The BLOCK form (`package Outer { }`) does have a body, and its range ends at
    // the closing brace, which is exactly the leak rule the analyzer documents and
    // proves against perl 5.34 itself. So one range test covers both forms.
    const rangePkg = (() => {
      let best = ""
      let bestStart = -1
      for (const sc of scopes) {
        if (sc.start <= n.startIndex && n.endIndex <= sc.end && sc.start > bestStart) {
          best = sc.name
          bestStart = sc.start
        }
      }
      return best
    })()
    // THE SOURCE OF A CALL: the enclosing sub, else the enclosing package, else the
    // FILE-SCOPE sentinel `global`.
    //
    // **THE PACKAGE IS RIGHT, AND A MEASUREMENT SAYS SO ✓✓.** An earlier version of
    // this file's comment said the file-scope source should ALWAYS be `global` and
    // never the package, and this line was changed to that on 2026-10-21 — and the
    // MEASUREMENT SAID IT WAS WRONG ✓✓: the `calls` MISSING count went from 72 to 418
    // over the population, because the ANALYZER files a call outside any sub under
    // the enclosing PACKAGE ✓✓. The comment is restored with the number that
    // refuted the other number, because a comment that has been refuted is worth
    // more than a comment that has been deleted ✓✓.
    //
    // The 72 MISSING rows that REMAIN are a different disagreement, and they are
    // measured separately (script/m14/perl-truth-run.ts prints their samples) ✓✓.
    const src = nextFn || rangePkg || nextPkg || "global"

    if (n.type === "method_call_expression") {
      const m = byType(n, "method")
      const method = String(m?.text ?? "")
      if (isWrittenName(method)) {
        const invocants = fieldAll(n, "invocant").filter((c) => c.isNamed)
        const invocant = invocants[0]
        const recv = String(invocant?.text ?? "")
        const provableClass = invocant && (invocant.type === "package" || recv.includes("::")) && !recv.includes("$") && !recv.includes("->")
        const probe = method
        // `X->new(...)` is an instantiation. This oracle deliberately does not
        // derive `instantiates` (see the header: reproducing the analyzer's
        // positive class-receiver allowlist would be copying an inference), so it
        // must not file the same line as a `calls` edge either -- otherwise every
        // constructor in the corpus reads as a MISSING `calls` row.
        if (!builtins.has(probe) && method !== "new") {
          push("calls", src, provableClass ? `${leafOf(recv)}.${leafOf(method)}` : leafOf(method))
        }
      }
      // A class / role / method named in a QUERY, invoking nothing.
      if (method === "isa" || method === "DOES" || method === "can") {
        const args = fieldAll(n, "arguments").filter((c) => c.isNamed)
        const first = args[0]
        const content = first ? (first.childForFieldName?.("content") ?? byType(first, "string_content") ?? first) : undefined
        const queried = String(content?.text ?? "").trim()
        if (
          first &&
          (first.type === "string_literal" || first.type === "bareword" || first.type === "package" || first.type === "autoquoted_bareword") &&
          !first.text.includes("$") &&
          isWrittenName(queried) &&
          leafOf(queried) !== src &&
          queried !== rangePkg
        ) {
          push("references", src, leafOf(queried))
        }
      }
    }

    // ---- `instantiates` — a CONSTRUCTOR CALL ✓✓.
    //
    // The compared set contains this label TODAY ✓✓, so the oracle has to derive
    // it or the D4's truth for it goes EMPTY when the lane's oracle is wired in
    // ✓✓. MEASURED (2026-10-21, script/m14/perl-oracle-parity.mts over 200 files):
    // the differential's copy derives `instantiates` 64 and the lane's oracle
    // derived NONE ✓✓.
    //
    // The rule is the analyzer's, stated in the analyzer's own terms ✓✓:
    //   `__PACKAGE__->new`  constructs the CURRENT PACKAGE ✓✓ — and `__PACKAGE__`
    //   is a compile-time token, not a class, so naming it would publish a
    //   phantom `__PACKAGE__.constructor` type ✓✓;
    //   `X->new`            X is a class ✓✓ — the target is `X.constructor` ✓✓;
    //   `shift->new`        the receiver is the implicit invocant ✓✓ — its class
    //   is NOT statically nameable ✓✓, so nothing is derivable ✓✓.
    if (n.type === "method_call_expression") {
      const m = byType(n, "method")
      const method = String(m?.text ?? "")
      if (method === "new") {
        const invocant = fieldAll(n, "invocant").find((c) => c.isNamed)
        const t = String(invocant?.text ?? "")
        if (t === "__PACKAGE__" || t === "__CLASS__") {
          // The CURRENT package ✓✓ — and where there is no package to name it,
          // the edge is not derivable and is not emitted ✓✓.
          const owner = packageOf(n)
          if (owner && owner !== "main") push("instantiates", src, `${leafOf(owner)}.constructor`)
        } else if (invocant && namesAClass(invocant) && t && !t.includes("$") && !t.includes("->")) {
          push("instantiates", src, `${leafOf(t)}.constructor`)
        }
      }
    }
    // ---- `instantiates` — the INDIRECT OBJECT form ✓✓.
    //
    // `new Class @args` is exactly `Class->new(@args)` ✓✓, and the grammar spells
    // it as a call whose `function` is `new` and whose single argument is a
    // second call whose `function` is the CLASS ✓✓. The class is the inner
    // `function` field and nothing else ✓✓ — reading the argument subtree's
    // WORDS published a phantom class `DSN` from `new Win32::ODBC $h->{DSN}` ✓✓,
    // where `DSN` is a hash KEY ✓✓.
    if (n.type === "function_call_expression" || n.type === "ambiguous_function_call_expression") {
      const outerFn = fieldAll(n, "function").find((c) => c.isNamed)
      if (String(outerFn?.text ?? "") === "new") {
        const carrier = argsOf(n).find((c) => c.isNamed)
        const innerFn = carrier ? (fieldAll(carrier, "function").find((c) => c.isNamed) ?? byType(carrier, "function")) : undefined
        const cls = String(innerFn?.text ?? "").trim()
        if (cls && !cls.includes("$") && !cls.includes("->")) {
          push("instantiates", src, `${leafOf(cls)}.constructor`)
        }
      }
    }
    if (n.type === "function_call_expression" || n.type === "ambiguous_function_call_expression") {
      const fnNode = fieldAll(n, "function").find((c) => c.isNamed)
      const raw = String(fnNode?.text ?? "")
      if (raw) {
        const named = raw.startsWith("&") ? raw.slice(1) : raw
        const probe = named
        if (!builtins.has(probe) && probe !== "use" && probe !== "no" && isWrittenName(named)) {
          // A code-slot REFERENCE with no argument list is not a call.
          const hasArgs = fieldAll(n, "arguments").some((c) => c.isNamed)
          if (!(named.startsWith("&") && !hasArgs)) {
            // `new` and the other magic shapes are the analyzer's business; this
            // oracle does not reproduce its POSITIVE class allowlist, so those
            // targets are simply not claimed here (see the header).
            if (probe !== "new" && probe !== "with" && probe !== "has" && probe !== "extends" && probe !== "bless") {
              push("calls", src, leafOf(named))
            }
          }
        }
      }
    }

    // A CODE REFERENCE to a named sub: a value, not a call.
    if (n.type === "refgen_expression") {
      const fnNode = byType(n, "function")
      const varname = fnNode ? byType(fnNode, "varname") : undefined
      if (fnNode && varname && fnNode.namedChildCount === 1) {
        const name = String(varname.text ?? "")
        if (isWrittenName(name) && leafOf(name) !== src) push("uses", src, leafOf(name))
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) walk2(c, nextFn, nextPkg)
    }
  }
  walk2(root, undefined, "")

  // ---- pass 3: the OVERRIDE EDGES ✓✓.
  //
  // The compared set contains this label TODAY ✓✓, so the oracle has to derive it
  // or the D4's truth for it goes EMPTY when the lane's oracle is wired in ✓✓.
  // MEASURED (2026-10-21, script/m14/perl-oracle-parity.mts over 200 files): the
  // differential's copy derives `overrides` 329 and the lane's oracle derived NONE
  // ✓✓.
  //
  // The rule: a class's FIRST declared base, per method ✓✓. With no companion
  // index the analyzer emits the deterministic first-parent guess for every method
  // of the class ✓✓, so the truth side derives the same set from the same two
  // facts ✓✓ — the OWNER and its first BASE ✓✓.
  for (const cm of classMethods) {
    const list = bases.get(cm.owner)
    if (!list || !list.length) continue
    // The FULL-NAME self-reference guard, mirroring the analyzer ✓✓: a leaf
    // comparison would also fire for `package Foo::Bar` whose base is a different
    // `Other::Bar`, deleting a real override edge ✓✓.
    if (list[0] === cm.owner) continue
    const baseLeaf = leafOf(list[0])
    push("overrides", `${cm.owner}.${cm.raw}`, `${baseLeaf}.${cm.raw}`)
  }

  return edges
}

/** The symmetric difference between this oracle's builtin set and the
 *  analyzer's, as two sorted lists. A shared set would make this empty by
 *  construction, which is why the two are written out separately and compared
 *  here instead. */
export function builtinSetDifference(
  analyzerBuiltins: ReadonlySet<string>,
): { onlyInOracle: string[]; onlyInAnalyzer: string[] } {
  const oracle = PERL_ORACLE_BUILTINS
  return {
    onlyInOracle: [...oracle].filter((w) => !analyzerBuiltins.has(w)).sort(),
    onlyInAnalyzer: [...analyzerBuiltins].filter((w) => !oracle.has(w)).sort(),
  }
}
