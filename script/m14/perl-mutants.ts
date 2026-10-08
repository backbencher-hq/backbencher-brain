/**
 * PERL MUTANTS — the lane's regression mutants for the M14.0.F4 gate.
 *
 * WHY THIS IS A SEPARATE FILE. `script/m14/mutate-analyzer.ts` is a shared registry
 * that several lanes edit concurrently, and `script/m14/fsharp-mutants.ts` records
 * what happened when a lane's block was written into it: a 259-line block was
 * overwritten within the hour, SILENTLY — the file stayed syntactically valid and the
 * gate kept reporting numbers, with the fsharp mutants simply absent from them. The
 * same registry has already lost perl's differential ORACLE twice
 * (`c7d0bcc56`, `48db8cd91`, `9b6f51285` in this lane's history), so the footprint
 * kept in the shared file is the two wiring lines the master adds, and the work lives
 * here where the lane owns it. A mutant that is not REGISTERED is indistinguishable
 * from a defect class with no mutant, which is the shape the contract's F4 rule exists
 * to prevent.
 *
 * WHAT EACH MUTANT IS. A deliberately injected defect MUST make the suite red. Each
 * entry below is a revert of one defect class this lane MEASURED on real perl, and each
 * names the fixture that catches it.
 *
 * FIVE of the twelve revert classes the ontology wave FIXED, and they are the classes
 * that were invisible to every existing gate — each one produced zero edges, or edges
 * with a target no gate read. Three are guards for mistakes the wave made while fixing
 * them, which is the only kind worth the lines: a rule that was wrong once is free to be
 * wrong again. Four are DEFAULTS, not reverts: a rule that is right has no pre-fix shape
 * to restore, so each states the DEFAULT the analyzer must not adopt — the "silence is
 * guilt" direction, where the mutant makes the lane assert more than the source proves.
 */
import type { Mutant } from "./mutate-analyzer"

const relsOf = (r: any): any[] => (r.relationships ?? []).filter((x: any) => String(x.type) === "imports")
const ofType = (r: any, t: string): any[] => (r.relationships ?? []).filter((x: any) => String(x.type) === t)

export const PERL_MUTANTS: Mutant[] = [
  /* ------------------------------------------------------------------ *
   * The four labels this wave added. Each reverts ONE construct rule.
   * ------------------------------------------------------------------ */
  {
    id: "perl/ontology-imports-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: the `imports` EDGE, not the `imports` payload. The lane recorded every module load as an `ImportInfo` row and ZERO relationships, and payload is not an edge — `parallel-indexer` writes `result.imports` into the `brain_import` TABLE and only `result.relationships` into `brain_relationship`, which is the table `bb_graph` reads. So for perl the module dependency graph had no edges to traverse: a file's dependencies existed and nothing could ask for them. Measured on mojo: 1,287 `imports` edges over 274 files. Caught by perl/ontology-imports, which pins seven of them including the heritage pragma, the runtime `require` and the in-sub-body `use`.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type) !== "imports") }),
  },
  {
    id: "perl/ontology-exports-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: the `exports` EDGE. Same shape as the imports defect on the other half of the module surface — 2,170 export names as `ExportInfo` payload, zero relationships — and `bb_graph --mode usages` reads `relationship_type IN ('imports','exports')`, so a perl module's exported API was in the store and in no graph. Measured on mojo: 84 `exports` edges over 274 files. Caught by perl/ontology-exports, which pins all three Exporter surfaces: `@EXPORT`, the optional `@EXPORT_OK`, and the `%EXPORT_TAGS` KEYS.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type) !== "exports") }),
  },
  {
    id: "perl/ontology-uses-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: the `uses` EDGE. A CODE-SLOT REFERENCE (`\\&sub`, `\\&Class::method`) and a qualified VARIABLE READ (`$Foo::bar`) both name a declaration the file depends on and invoke nothing — go's definition of the label. The pre-fix lane emitted exactly ONE such edge on mojo's first 40 files, the unqualified `\\&SIGINT`, so the count read as a working rule rather than as a rule that could only fire on the one shape that had no `::`. Measured: 54 `uses` edges on mojo's 274 files after the fix. Caught by perl/ontology-uses.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type) !== "uses") }),
  },
  {
    id: "perl/ontology-references-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: the `references` EDGE, and perl's declared-TYPE positions. `bless $r, 'Class'` binds a reference to a named class — the analogue of java's `instanceof` — and `$o->isa('C')`, `$o->DOES('R')` and `ref($x) eq 'C'` test one. None can be a `calls` edge: `bless`, `ref` and `isa` are in `PERL_BUILTINS` and are suppressed as call targets. Measured on mojo: 19 `references` edges over 274 files. Caught by perl/ontology-references, which pins all four constructs and forbids six fabrications.",
    transform: (r: any) => ({ ...r, relationships: (r.relationships ?? []).filter((x: any) => String(x.type) !== "references") }),
  },

  /* ------------------------------------------------------------------ *
   * The five defects the wave found WHILE adding them. Each was invisible
   * to every existing gate, which is the reason each is registered.
   * ------------------------------------------------------------------ */
  {
    id: "perl/ontology-uses-owner-member-rewrite",
    language: "perl",
    defectClass: "wrong-relationship",
    description:
      "PERL-ONTOLOGY: the `Owner.member` rewrite of a `uses` target, which was DEAD BY CONSTRUCTION. `qualifiedTarget` rewrote `\\&Mojo::Util::decode` to `Util.decode`, and `isWrittenCalleeName` refuses a `.` — so the rewrite could only ever produce a target the very next line rejected. Every qualified perl name in the corpus was therefore DROPPED, and because the edge was dropped rather than published wrong, no count, no differential row and no fixture could see it: the lane reported 1 `uses` edge and read that as a working rule. The independent oracle reproduced the same `.decode` string verbatim, which is the cleanest statement available of what a shared convention is worth — two implementations agreeing on a question about SPELLING, where the question was never about the grammar. Caught by perl/ontology-uses, whose target rows are the names AS WRITTEN and whose forbid rows name the rewrite's output.",
    // A faithful revert: replace the LAST `::` of every `uses` target with `.`,
    // which is what `qualifiedTarget` produced. Every qualified target therefore
    // names a class no declaration carries, which is the forbid-row shape.
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).map((x: any) => {
        if (String(x.type) !== "uses") return x
        const t = String(x.target ?? "")
        const cut = t.lastIndexOf("::")
        if (cut <= 0) return x
        return { ...x, target: t.slice(0, cut) + "." + t.slice(cut + 2) }
      }),
    }),
  },
  {
    id: "perl/ontology-uses-owner-trailing-separator",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: the qualified-VARIABLE-READ branch tested the OWNER half WITH its trailing `::`, and `isWrittenPackageName(\"Config::\")` is false by construction — a package name that ends where a segment must begin is not one. So `$Config::SSL_ERROR`, `@Some::Module::LIST` and `%Foo::Bar::MAP` produced no edge at all. Same shape of error as the rewrite above, one function over, and it was equally invisible: `uses` measured 1 edge and the one was the unqualified `\\&SIGINT`. Caught by perl/ontology-uses, whose three `qualified-variable-read` rows carry the full qualification.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "uses" && String(x.metadata?.reasonCode) === "qualified-variable-read")),
    }),
  },
  {
    id: "perl/ontology-bless-list-payload-unread",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: `arguments` is a SINGLE field on an `ambiguous_function_call_expression`, so `bless $self, 'Class'` hands the literal reader one `list_expression` node — not a literal — and `writtenLiteralName` returns undefined for it. The construct the whole `references` label rests on produced NO edge. The discriminant is not subtle; it is that `bless` is a builtin and is suppressed as a call target, so there was no other edge for the file to carry and no count anywhere that moved. Caught by perl/ontology-references, whose first row is the `bless` literal.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "references" && String(x.metadata?.reasonCode) === "bless-class-literal")),
    }),
  },
  {
    id: "perl/ontology-codeslot-reference-read-as-a-call",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: a code-slot REFERENCE written where the grammar types a CALL. `defined &builtin::is_bool` parses as `func1op_call_expression(defined, function_call_expression(&builtin::is_bool))` — there is no `refgen_expression` in it at all, so a `refgen_expression`-only branch cannot see perl's most idiomatic conditional probe. The discriminator is the ARGUMENT LIST and never the leading `&`, because `&foo(@args)` is perl's explicit-call syntax; suppressing on the `&` alone cost 323 truth rows across perl5 when the lane tried it the other way. Caught by perl/ontology-uses, whose third row is a bare `&` reference and whose last forbid row is the same spelling WITH an argument list.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "uses" && String(x.target ?? "").includes("::") && !String(x.target ?? "").includes("$"))),
    }),
  },
  {
    id: "perl/ontology-require-and-use-inside-a-sub",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: a perl `use` is LEXICALLY SCOPED, so a pragma is very often written inside a sub body — mojo's lib/Mojo/Util.pm says `use integer;` at lines 263, 296 and 492, all inside subs, and lib/Mojo/Base.pm does `require Mojo::Promise;` inside a sub. Reading either construct only at file scope publishes a dependency graph with those loads missing, and the numbers barely move (4 of 253 on mojo's 60-file draw), which is how it stayed invisible. Caught by perl/ontology-imports, whose `Runtime::Inside` and `integer` rows are both inside sub bodies.",
    // Reverted by TARGET, not by source, and the reason is a fact about the lane's
    // own design: a module dependency is `fileLevel`, so its source is the PACKAGE
    // (`global` in a file with no `package` statement) whatever sub body wrote it —
    // the indexer maps `source_external` to the importing FILE. So the in-sub-body
    // distinction is carried by the LINE, and these are the two rows whose line is
    // inside a sub body. Before this rule the two were absent entirely.
    transform: (r: any) => {
      const inSubBody = new Set(["Runtime::Inside", "integer"])
      const kept = (r.relationships ?? []).filter((x: any) => !(String(x.type) === "imports" && inSubBody.has(String(x.target ?? ""))))
      if (kept.length === (r.relationships ?? []).length) return r
      return { ...r, relationships: kept }
    },
  },

  /* ------------------------------------------------------------------ *
   * Defaults, not reverts. Each mutant makes the lane assert MORE than
   * the source proves; a rule with no pre-fix shape still needs one, or
   * "the analyzer was silent" and "the analyzer invented an edge" are the
   * same state in the suite.
   * ------------------------------------------------------------------ */
  {
    id: "perl/ontology-pragma-dropped-from-imports",
    language: "perl",
    defectClass: "false-negative",
    description:
      "PERL-ONTOLOGY, the DEFAULT this lane refuses: a PRAGMA is emitted as an `imports` edge and TAGGED (`meta.isPragma`) rather than dropped. `strict` in particular is a hard prerequisite for the file to compile at all, each pragma is a real module the file genuinely loads, and — the load-bearing reason — the `ImportInfo` PAYLOAD already carries every `use`, so an edge set that quietly omitted the pragmas would disagree with the payload it is derived from. Two answers to one question is the defect the ontology workstream is about. A consumer that wants the module graph without pragmas reads `isPragma`, which is one column rather than a second, disagreeing answer. Caught by perl/ontology-imports, whose `strict` and `integer` rows pin `meta.isPragma: true`.",
    transform: (r: any) => ({
      ...r,
      relationships: relsOf(r)
        .filter((x: any) => x.metadata?.isPragma !== true)
        .concat(relsOf(r).filter((x: any) => x.metadata?.isPragma === true)),
    }),
  },
  {
    id: "perl/ontology-require-version-becomes-a-module",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY, the DEFAULT this lane refuses: `use 5.010` and `require 5.010` are a LANGUAGE VERSION requirement — `require_version_expression` is a different node type, and the `use` form goes to `metadata.perlVersion` — and neither becomes an `imports` edge. An import named `5.010` puts a fake module in the dependency graph and in every unused-import report. Caught by perl/ontology-imports, whose forbid rows name `5.010` on both the payload and the edge.",
    transform: (r: any) => ({
      ...r,
      relationships: relsOf(r).concat(
        relsOf(r).length > 0 ? [{ source: "global", target: "5.010", type: "imports", confidence: 1, metadata: { reasonCode: "use-module-load" } }] : [],
      ),
    }),
  },
  {
    id: "perl/ontology-internal-ref-type-published-as-a-class",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY, the DEFAULT this lane refuses: `ref($x) eq 'ARRAY'` names perl's OWN type vocabulary, not a class, and there is no declaration anywhere named `ARRAY`. Measured on mojo: `ref(...) eq 'X'` occurs 67 times and 66 of them are `ARRAY` (30), `HASH` (23) or `CODE` (13); exactly one is a class. A rule written from the SHAPE rather than the ROLE would therefore have been 98.5% fabricated — the same failure the ontology gate's own header records for a bash probe that matched `class voice` inside a telnet IAC word list. The internal names are DERIVED, not hand-listed, the same way `PERL_BUILTINS` is. Caught by perl/ontology-references, whose `ARRAY` and `HASH` forbid rows are the control.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).flatMap((x: any) => {
        if (String(x.type) !== "references" || String(x.metadata?.reasonCode) !== "ref-class-comparison") return [x]
        return [x, { ...x, target: "ARRAY" }]
      }),
    }),
  },
  {
    id: "perl/ontology-isa-published-as-a-call",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY, the DEFAULT this lane refuses: `$obj->isa('My::Class')` invokes `isa` — a UNIVERSAL builtin no project declares — and it NAMES `My::Class`, which is a `references` edge. The pre-fix lane produced `calls -> isa`, naming a method nothing defines. Measured on mojo's first 40 files: 22 `calls -> isa` edges, and all 22 are `isa`. `DOES` is deliberately NOT in the same class: Moose::Object declares it, so a class really can override it and the `calls` edge is true — which is why the rule tests the METHOD name, never the shape of the edge. Caught by perl/ontology-references, whose last forbid row is `calls -> isa`.",
    transform: (r: any) => {
      if (ofType(r, "calls").some((x: any) => String(x.target) === "isa")) return r
      return { ...r, relationships: (r.relationships ?? []).concat([{ source: "tested", target: "isa", type: "calls", confidence: 0.9, metadata: { reasonCode: "dynamic-receiver" } }]) }
    },
  },
  {
    id: "perl/ontology-computed-class-published",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY, the DEFAULT this lane refuses: a class name that is COMPUTED is not a name. `bless $self, $class` is perl's commonest `bless` and names a variable; `\"${class}::ISA\"` computes its package half at runtime; `$obj->isa($class)` names a variable. A target that is not written cannot be verified, so publishing one is a fabricated claim rather than a weak one — and a fabricated edge is counted as `unexplained` and poisons `bb_graph`, `bb_impact` and `bb_migrate`. The internal-ref-type list is DERIVED from what a perl 5.34 interpreter itself prints for an unblessed reference, not hand-listed. Caught by perl/ontology-references, whose three computed-name forbid rows are the control.",
    transform: (r: any) => ({
      ...r,
      relationships: ofType(r, "references").concat(
        ofType(r, "references").length > 0
          ? [
              { source: "runtime", target: "Dynamic", type: "references", confidence: 0.9, metadata: { reasonCode: "bless-class-literal" } },
              { source: "dynamic", target: "Dynamic", type: "references", confidence: 0.9, metadata: { reasonCode: "isa-class-literal" } },
              { source: "computed", target: "Dynamic", type: "references", confidence: 0.9, metadata: { reasonCode: "ref-class-comparison" } },
            ]
          : [],
      ),
    }),
  },
  {
    id: "perl/ontology-composition-publishes-modifier-names",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY: a role composition is a NAME LIST, and Moose/Moo write it in four shapes that look alike. Reading every word of the argument list published the fat-comma SLOT names as roles. Measured on Moose-2.4000: `t/roles/role_conflict_detection.t:139` produced `implements My::Test8 -> -alias` and `t/roles/more_alias_and_exclude.t:47` produced `-> excludes`, beside the real roles; and the fat-comma SPECIFICATION form (`with \'A\' => {...}, \'B\' => {...}`) put the roles in the KEYS with the modifiers one level deeper in the values. This is PERL-MR4's rule — a fat-comma key names a SLOT, not a declaration — stated for composition, and the independent oracle made the SAME mistake before the fix, which is why no differential could see it. Caught by perl/ontology-composition, whose six forbid rows are the modifier names.",
    transform: (r: any) => ({
      ...r,
      relationships: ofType(r, "implements").flatMap((x: any) => {
        const t = String(x.target ?? "")
        if (t === "excludes" || t === "alias" || t === "gone" || t === "new") return [x]
        return [x, { ...x, target: "-excludes" }, { ...x, target: "excludes" }, { ...x, target: "-alias" }, { ...x, target: "alias" }, { ...x, target: "gone" }]
      }),
    }),
  },
  {
    id: "perl/ontology-composition-drops-later-roles",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: `with qw(RoleA RoleB)` and `extends qw(BaseA BaseB)` are ONE `quoted_word_list` node, so reading only its first word published the first role or base and dropped the rest. Measured on moo: 6 of 94 `implements` rows and 5 of 109 `extends` rows over 142 files, every one a real composition the file writes. Caught by perl/ontology-composition, whose `Role::Two` row is the second name of the same node on the same line.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => {
        const t = String(x.type)
        if (t !== "implements" && t !== "extends") return true
        const tgt = String(x.target ?? "")
        return tgt !== "Two" && tgt !== "Four" && tgt !== "Six"
      }),
    }),
  },
  {
    id: "perl/ontology-has-option-key-published-as-a-property",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY: a `has` SPECIFICATION\'s fat-comma keys are OPTION names, not attributes. `has $_ => (@params, clearer => 1, predicate => 1)` published a `property` symbol and a `contains` edge named `clearer` — measured on moo `t/accessor-pred-clear.t:13`. The same reader also TRUNCATED a name that is not an identifier: `has \'has spaces\'` became the property `has`, which is worse than publishing nothing because `has` is a real perl function and a `bb_impact` on it reaches every Moose class (measured on Moose-2.4000 `t/attributes/non_alpha_attr_names.t:25`, the file that exists to test that name). Caught by perl/ontology-composition, whose `has spaces` row pins the verbatim name and whose forbid rows name the option keys.",
    transform: (r: any) => ({
      ...r,
      relationships: ofType(r, "contains").flatMap((x: any) => {
        const t = String(x.target ?? "")
        if (t === "clearer" || t === "predicate") return [x]
        if (t === "has spaces") return [{ ...x, target: "has" }]
        return [x]
      }),
    }),
  },
  {
    id: "perl/ontology-use-statement-hides-its-own-argument-list",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY: the `use_statement` case ended in `return`, which skips the CHILD WALK — and a `use` statement can carry a declaration in its argument list. `use if (not our $__mx_is_compiled), \'Moose::Meta::Class\'` is Moose\'s conditional-load idiom; measured on Moose-2.4000 `lib/Moose/Object.pm:15-16`, both `our` globals were absent from the symbol table, so nothing that reads `__mx_is_compiled` could find it. The identical early return had already cost this lane\'s ORACLE 47 inheritance rows on mojo in an earlier wave, and the lane\'s own truth module documents it. A `break` is the fix and it moves nothing else: the fixture suite is unchanged. Caught by perl/ontology-imports, whose `Runtime::Inside` row is a `require` reached only because the walk descends.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "imports" && String(x.target ?? "") === "Runtime::Inside")),
    }),
  },
  {
    id: "perl/ontology-sigil-sigil-call-target-published",
    language: "perl",
    defectClass: "wrong-relationship",
    description:
      "PERL-ONTOLOGY, the DEFAULT this lane refuses: a published call TARGET carries no sigil. `&use_module(\'X\')` is perl\'s EXPLICIT-CALL syntax, so the edge is right — but a target spelled `&use_module` names a symbol no declaration carries and no resolver can match. Measured on Moose-2.4000 `lib/Moose/Util.pm`: 2 edges at lines 147 and 349. The `&` is stripped AFTER the two tests that need the source spelling (the builtin probe and `hasArgumentSyntax`), because both are about how the file wrote it. Caught by the differential rather than by a fixture, which is stated here rather than implied: this class has no fixture because no perl fixture in the lane calls a sub through `&`.",
    // A faithful revert: prefix EVERY `calls` target with `&`, which is what the
    // pre-fix publisher did — it handed `addCall` the callee's source spelling and
    // `addCall` published it unchanged.
    transform: (r: any) => ({
      ...r,
      relationships: ofType(r, "calls").map((x: any) => (String(x.target ?? "").charAt(0) === "&" ? x : { ...x, target: "&" + String(x.target ?? "") })),
    }),
  },
  {
    id: "perl/ontology-require-path-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY part 3: `require` with a FILENAME specifier. `require_expression`'s only child in the path form is a `string_literal`, so the lane's whole read — `findChildByType(node, \"bareword\")` — found nothing and 912 dependencies over 5,913 files vanished with no trace. No count moved because `imports` was already non-zero from the `use Module` form. The construct IS a dependency and the path IS written, which is what makes it an edge rather than an inference. Caught by perl/ontology-require-and-universal, whose `require_file` row is the path form.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "imports" && x.metadata?.relationshipType === "require_file")),
    }),
  },
  {
    id: "perl/ontology-interpolated-require-published",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY part 3, the DEFAULT this lane refuses: an INTERPOLATED specifier is computed at runtime. `require \"./lib/Late$stage.pm\"` and `require \"File/Spec/$module.pm\"` name a different file on every run, so an edge to the written text is a fabrication. The rule is the ABSENCE OF A `$`, not the absence of a `./`, and it has to be stated because a path-shaped require is the shape that most invites the shortcut. Caught by perl/ontology-require-and-universal, whose first forbid row is the interpolated specifier.",
    // The mutant ADDS the fabricated edge instead of rewriting an existing one,
    // and the difference is not style: the analyzer publishes NO edge for an
    // interpolated specifier, so a transform that only rewrites what is already
    // there has nothing to act on and SURVIVES. The first version of this mutant
    // did exactly that and the runner reported it, which is the F4 rule working:
    // a "default the lane must not adopt" mutant has to manufacture the
    // fabrication, not wait for it.
    transform: (r: any) => ({
      ...r,
      relationships: ofType(r, "imports").concat(
        ofType(r, "imports").length > 0
          ? [
              { source: "global", target: "./lib/Late$stage.pm", type: "imports", confidence: 0.9, metadata: { reasonCode: "runtime-require-path", relationshipType: "require_file", specifier: "path" } },
              { source: "global", target: "$computed", type: "imports", confidence: 0.9, metadata: { reasonCode: "runtime-require-path", relationshipType: "require_file", specifier: "path" } },
            ]
          : [],
      ),
    }),
  },
  {
    id: "perl/ontology-universal-isa-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY part 3: `UNIVERSAL::isa($obj, 'Class')` — the FUNCTION spelling of the type test. The grammar types it as an ordinary call, so the `method_call_expression` branch cannot see it, and `addCall` refuses it as a target because `isa` is a builtin. 157 corpus sites against 497 method-form sites, and the label it belonged to was already non-zero, so no count moved. Caught by perl/ontology-require-and-universal, whose first row is the function spelling and whose third row is the method spelling beside it.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "references" && String(x.metadata?.reasonCode) === "universal-isa-literal")),
    }),
  },
  {
    id: "perl/ontology-universal-can-published-as-a-type",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY part 3, the DEFAULT this lane refuses: `can` is a PROBE, not a type test. `UNIVERSAL::can($obj, 'maybe')` names a method that may not exist, and `$obj->can(...)` is refused on the method side for the same reason; reading the function spelling as a `references` edge would carry a conditional probe into `bb_impact` as a real dependency. The two functions are one word apart and the argument is in the same position, so the refusal needs its own mutant. Caught by perl/ontology-require-and-universal, whose last forbid row is the probe.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).flatMap((x: any) => {
        const t = String(x.target ?? "")
        if (String(x.type) === "calls" && t === "can") return [{ ...x, type: "references", target: "maybe", metadata: { ...(x.metadata ?? {}), reasonCode: "universal-isa-literal" } }]
        return [x]
      }),
    }),
  },
  {
    id: "perl/ontology-export-push-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY part 3: `push @EXPORT_OK, qw(a b)` — the Exporter's other declaration API, and the lane read only the assignment spelling. Measured: 11 `push @EXPORT*` sites in 8 corpus files, 6 of which carry literal names. A module's exported API was silently half of what it is, with no count to show it. Caught by perl/ontology-push-declarations, whose `pushed_one`/`pushed_two` rows are the word list and whose `pushed_three` row is the fat-comma spelling.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "exports" && String(x.metadata?.reasonCode) === "exporter-array-push")),
    }),
  },
  {
    id: "perl/ontology-export-push-reads-a-variable",
    language: "perl",
    defectClass: "false-positive",
    description:
      "PERL-ONTOLOGY part 3, the DEFAULT this lane refuses: `push @EXPORT_OK, @Other::EXPORT_OK` pushes a NAME READ, not names, and publishing it as `exports` would put a variable in an exported API. 3 of the 11 corpus `push @EXPORT*` sites push something that is not a name — the other two are an indirect `@{ $EXPORT_TAGS{Parse} }` and a `\@ISA` ref push — so a rule written from the SHAPE (`push`, then harvest words) fabricates three edges for every real one. Caught by perl/ontology-push-declarations, whose first forbid row is the pushed variable, and whose `uses` edge for the same read is the label that IS right.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).flatMap((x: any) => {
        const t = String(x.target ?? "")
        if (String(x.type) === "uses" && /EXPORT/.test(t)) return [{ ...x, type: "exports", metadata: { ...(x.metadata ?? {}), reasonCode: "exporter-array-push" } }]
        return [x]
      }),
    }),
  },
  {
    id: "perl/ontology-isa-push-edge-absent",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY part 3: `push @ISA, \'Base\'` — inheritance by push. The lane read `our @ISA = (...)` and nothing else, so 9 real sites carrying 10 base names over 5,913 files declared no inheritance at all (perl5\'s DB_File, Digest::SHA twice, Syslog, MakeMaker::version, Myconst2perl, Attribute::Handlers, CPAN::Shell, pkg_gen.t). It is worse than a missing `extends` edge: `packageBases` is what the OVERRIDE resolver reads, so those classes\' methods had no base to resolve against either. Caught by perl/ontology-push-declarations, whose three `extends` rows are the three forms — two names in one push, the fat-comma spelling, and the qualified array.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "extends" && String(x.metadata?.reasonCode) === "isa-array-push")),
    }),
  },
  {
    id: "perl/ontology-isa-push-qualified-owner-lost",
    language: "perl",
    defectClass: "wrong-relationship",
    description:
      "PERL-ONTOLOGY part 3: a QUALIFIED `@Foo::ISA` belongs to `Foo`, not to the package the file happens to be in. Attributing it to the enclosing package invents an inheritance edge for a class that never declared one, and the corpus has the shapes where the two differ — `push @UNIVERSAL::ISA, \'...\'` in perl5\'s Attribute::Handlers, `push @CPAN::Shell::ISA, \'CPAN::WAIT\'` in CPAN, `push @version::ISA, \"...\"` in MakeMaker. Caught by perl/ontology-push-declarations, whose third `extends` row is inside a `package` BLOCK (so the lexical package is only inside the braces) and whose forbid row names the file-scope owner the edge must not land on.",
    transform: (r: any) => ({
      ...r,
      relationships: ofType(r, "extends").map((x: any) =>
        String(x.metadata?.reasonCode) === "isa-array-push" ? { ...x, source: "global" } : x,
      ),
    }),
  },
  {
    id: "perl/ontology-module-named-constant-refused",
    language: "perl",
    defectClass: "edge-absence",
    description:
      "PERL-ONTOLOGY part 3: `constant` is the name of CPAN's own module. The lane refused ANY dependency whose module name was `constant`, because `use constant NAME => v` is a DECLARATION rather than a dependency -- and that refusal was REDUNDANT for the `use` form, which the `use_statement` case handles as a declaration and breaks on before reaching it. So the guard only ever dropped real loads: perl5's `cpan/Scalar-List-Utils/t/dualvar.t:76` writes `require constant; import constant HAVE_THREADS => 1;`. The differential reported it as the single MISSING truth row in a 685-row file, and a guard whose stated reason does not apply to its own call site is the kind of rule that keeps costing. Caught by perl/ontology-require-and-universal, whose `constant` row is the load.",
    transform: (r: any) => ({
      ...r,
      relationships: (r.relationships ?? []).filter((x: any) => !(String(x.type) === "imports" && String(x.target ?? "") === "constant")),
    }),
  },
]
