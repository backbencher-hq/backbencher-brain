// Band C — Scripting & shell (8 families).
//
// Ruby · PHP · Bash · PowerShell · Lua · R · Perl · Groovy
//
// Every claim below is read off the family's own analyzer module
// (`src/ast/real-<lang>-analyzer.ts`) and its contract doc
// (`docs/analyzers/<lang>.md`). The relationship vocabulary each
// family can construct is also carried in `brain-languages.ts` as `emits`; where
// a type is absent from that list the record below says why the FORMAT cannot
// produce it, because a format with no invocation syntax cannot emit an
// invocation edge and calling that a shortfall would be a false one.
//
// See the honesty rules at the top of ./types.ts.

import type { LanguageDepth } from "./types"

export const BAND_DEPTH: Record<string, LanguageDepth> = {
  Bash: {
    headline:
      "A shell script is indexed as a program rather than as a wall of text: the file itself is a module symbol named for its own basename, the functions and variables inside it get identities, and every non-builtin command becomes a call edge carrying the line the command name sits on.",
    agentAsks: [
      "Which functions does this script define, and which one redefines an earlier one?",
      "Which variable does this script read that it never assigns anywhere?",
      "What does this script source, and what does it export to a caller?",
      "Which command does this script run that no function in the repo defines?",
    ],
    limitations: [
      "A command whose name is still an unexpanded expression is not a call. `${dotnetPath} --info` publishes no call edge, because the target would be a string no symbol can have; the variable that decides the command is real and gets a read edge instead. The same rule applies inside a damaged region: nothing is emitted from a name the grammar cannot vouch for.",
      "Three relationship types are absent because the language has no construct that produces them — the pinned grammar yields 164 distinct node types across the corpus and none expresses a type declaration or a constructor. `overrides` IS emitted, for the one thing bash actually has: a function redefined later in the same file, which happens 57 times across 38 of the 2,747 admitted files.",
      "A variable read is classified rather than assumed. `isAssignedInFile` is set only when this file assigns the name, and the flag's absence means the name arrives from the environment or another file rather than that the read was skipped — 19,417 reads classified corpus-wide, 74.9% assigned in the file that reads them.",
    ],
    sample: {
      caption: "A module, a function, an external command, and an export",
      code: `#!/usr/bin/env bash
set -euo pipefail

: "\${DEPLOY_ENV:?DEPLOY_ENV must be set}"    # bb records: a read of DEPLOY_ENV
DEPLOY_ENV=staging                             # bb records: variable DEPLOY_ENV

rollback() {                            # bb records: function rollback on this script
  ./restore.sh --env "$DEPLOY_ENV"      # bb records: calls restore.sh — a binary, not a symbol
}

export -f rollback                      # bb records: exports rollback, with the export form`,
    },
    whereItShowsUp: [
      "The script is the module, extension included: `tools.sh` is the module named `tools.sh`, so a sourced library and the script that sources it are two real owners rather than one anonymous namespace. The previous shape wrote the literal string `global` onto hundreds of edges on the pinned corpus, and no stored symbol can ever resolve that name.",
      "`source` and `.` publish both an import and a reference with the path kept exactly as written, because bash resolves a relative `source` against the working directory at run time. An earlier version resolved it against the sourcing file's directory and was measurably wrong.",
      "Routing covers any extensionless file whose shebang is a shell, which is how nvm, libexec/rbenv and several hundred other entry-point scripts are visible at all.",
    ],
  },

  Ruby: {
    headline:
      "Ruby is indexed as the object model it is: classes, modules and methods each get an identity, `include` and `extend` become composition edges, `require` becomes a reference, and the Rails macros in a model body become properties — so a Rails app's controllers, models and concerns read as one graph rather than a pile of files.",
    agentAsks: [
      "Which classes include this module, and what do they pick up from it?",
      "Which methods call this one, and which method does it override?",
      "Which associations has this ActiveRecord model declared?",
      "Where is this method defined — in the class, in a concern, or at file scope?",
    ],
    limitations: [
      "A Rails association macro publishes a property, not a call, and its argument rule is deliberately stricter than a plain call's. `has_many :lines` emits an edge at confidence 0.8, below the 0.85 evidence cutoff, so it is classed `inferred`; and only a `simple_symbol` or a `string` argument is accepted, because accepting a bare identifier was measured publishing `contains -> role` for a class's own parameter name.",
      "An override is a name match against the declared superclass, so a dynamic superclass has nothing to match. `class Invoice < ApplicationRecord` pairs `save!` with the parent's `save!` at 0.95; `class Body < Struct.new(:a)` gets no `extends` edge at all; and a base this file does not declare produces a 0.5 edge carrying `reasonCode: \"first-parent-guess\"`, so the edge is present and its weakness is readable.",
      "A path assembled at run time is not a reference: `require \"#{dir}/x\"` is skipped — 217 such sites in the sampled corpora, 208 of them in rails — because the target exists only after interpolation. `defined?(bar)`, `undef foo` and `alias a b` are skipped for the same reason of kind: none of them names a callee that can be called.",
    ],
    sample: {
      caption: "A module, a class with a declared superclass, and the macro in its body",
      code: `module Billing                      # bb records: module Billing
  VERSION = "1.4"                      # bb records: constant VERSION on Billing
end

class Invoice < ApplicationRecord     # bb records: class Invoice, extends ApplicationRecord
  has_many :lines                     # bb records: a property plus an inferred use edge
  def save!                           # bb records: method save! on Invoice
    Ledger.post(self.total)           # bb records: calls -> post, target Ledger.post
  end
end`,
    },
    whereItShowsUp: [
      "Rails writes the interesting declarations into the class body — `has_many`, `belongs_to`, `scope`, `validates`, `before_save` — and those become properties on the class rather than call edges, so the model layer is navigable without running it. Thirty-seven macro spellings are held in that list for exactly this reason.",
      "Concerns are modules that get included, which is an edge: a method defined in a concern stays owned by the concern, and the composition edge is what answers who actually picks it up.",
      "Vendored gem sources are `.rb` files too, so a checked-in `vendor/` tree indexes as a second Ruby codebase sitting beside your own.",
    ],
  },

  PHP: {
    headline:
      "PHP is read as the namespaced class diagram it actually is: classes, interfaces, traits, enums and functions each get an identity, `extends`, `implements` and trait `use` resolve between them, and a `use App\\Domain\\Invoice;` at the top of a file is an import edge to a symbol the index already owns.",
    agentAsks: [
      "Which classes implement this interface, and which traits does this class compose?",
      "What does this method call, and who calls it?",
      "Which classes does this namespace declare?",
      "Which method overrides its parent's, and where is the parent declared?",
    ],
    limitations: [
      "A callee named by a variable has no target to resolve to. `$service->$method()` and `$handler('x')` are refused, and a first-class callable written `foo(...)` is recorded as a member read with `isTearOff` rather than as a call, because it names a callable without invoking it. A braced member (`$box->{'quoted'}`) is refused for the same reason — it published a string literal as a symbol name on both ends.",
      "The 218 core global functions are held as a bare-name list and filtered out of call edges, but method calls are not, because `$obj->persist()` is user code. That bare-name test had a measured hole: a fully qualified `\\is_file(...)` did not match the set, and 12 such edges were counted on one phpunit revision before the leaf was taken before the filter rather than after.",
      "`exports` is absent, and the reason is stated rather than assumed — a PHP file has no module surface, measured at 0 exports across the corpora. Separately, a `private` method is never the target of an `overrides` edge; phpunit ships a fixture asserting exactly that rule, because a defect with no corpus footprint is only catchable by hand.",
    ],
    sample: {
      caption: "A namespaced final class, its trait, and the edge its parent call makes",
      code: `<?php
namespace App\\Domain;                             // bb records: namespace App\\Domain

final class Invoice extends Document implements Payable {   // class + extends + implements
    use Money;                            // bb records: trait Money composed into Invoice

    public function settle(): void        // bb records: method settle on Invoice
    {
        $this->ledger->post($this->total);   // bb records: calls -> post, the leaf member name
    }
}`,
    },
    whereItShowsUp: [
      "Composer and PSR-4 put one namespace per directory, so a file's namespace, its class's owner and its path on disk all agree — which is why the import at the top of the file resolves to something the index already owns.",
      "Traits are the interesting half: `use Money;` inside a class body is recorded as composition, so \"which classes get this behaviour\" is answerable while the trait's own methods stay owned by the trait.",
      "Declared types are a graph of their own. A property type, a parameter type, a return type and a typed class constant each publish a reference edge, and the distinction between a declared type and a return type survives in the edge metadata — the primitive types are excluded because they name no declaration.",
    ],
  },

  PowerShell: {
    headline:
      "PowerShell is indexed as a real module system: the file is the module, its functions, classes, enums and variables are recorded, and the commands a script reaches for become edges that carry the line they are written on — with the confidence decided by the shape of the name itself.",
    agentAsks: [
      "Which functions does this module export, and which ones does it import?",
      "What does this function call, and who calls it?",
      "Which class does this method belong to, not just the class it sits inside?",
      "Which variables does this script write that it never declares?",
    ],
    limitations: [
      "A `.psm1` and a `.ps1` of the same base name are two different modules, because the extension is part of the file's identity. The import that joins them is a file-level reference, not a merged namespace, so a function the script uses from the module is connected through the file rather than by becoming one symbol.",
      "`Begin`, `Process`, `End`, `Clean` and `DynamicParam` are named blocks, and the grammar models each one as a command — an edge naming one would be a fabrication by construction, so all five are filtered. The same refusal list carries 44 flow and operator keywords and 17 language keywords, and a class member's `set { }` accessor is treated as a keyword rather than as a cmdlet.",
      "PowerShell has no override keyword, so an `overrides` edge is a name match against the base class's declared members and is classed `inferred`. And the confidence of an ordinary command call is decided by its spelling: a dashed name like `Get-ChildItem` is 0.9, a plain one like `git` is 0.6 — because the shape of the name is the only signal that a bare word is a project function rather than a binary.",
    ],
    sample: {
      caption: "A function, a class and a variable — the three shapes PowerShell records",
      code: `function Get-Release {                  # bb records: function Get-Release
  param([string]$Tag)                     # bb records: variable $Tag
  Write-Output (git describe $Tag)        # a plain command name: 0.6, and no target in the repo
}

class Deployment {                        # bb records: class Deployment
  [string]$Name                           # bb records: property $Name
  Deployment([string]$n) { $this.Name = $n }   # bb records: the symbol is named "constructor"
}`,
    },
    whereItShowsUp: [
      "`.psm1` is a module and `.psd1` is its manifest, while `.ps1` is a script — the distinction is carried in the file's own name rather than inferred, which matters when a repository has both spellings of the same helper.",
      "`Import-Module PoshRSJob` is recorded as an import even though the argument is a bare module name and not a path. A path-shape requirement had been tried and silently dropped every installed module, because that is how PowerShell names them.",
      "Windows administration scripts and CI step definitions are the bulk of it, and both are dominated by calls out to the machine — `Get-ChildItem`, `Invoke-WebRequest`, `Start-Process` — so most edges leave the graph. Thirty-nine automatic variables and thirty type accelerators are held in filter lists so that reads of them do not become undiagnosable edges.",
    ],
  },

  Lua: {
    headline:
      "Lua is read as the table-shaped language it is: functions, the methods hanging off a table, and the locals a chunk declares all get identities, and `require`, `setmetatable` and constructor calls become edges you can walk — with the module surface named only where the chunk actually names it.",
    agentAsks: [
      "Which functions does this module define, and which modules does it require?",
      "Which table do these functions belong to?",
      "Which surface does this chunk return that the index could not name?",
      "Which object does this one inherit from through a metatable?",
    ],
    limitations: [
      "No module symbol is published for the file, so a file-scope declaration's containment edge is sourced from the literal string `global`. Ownership otherwise stops at the head of the receiver path: `function Buffer.meta.index()` files the method under `Buffer`, because `Buffer.meta` is not a name any file publishes, and the full path is kept in metadata instead.",
      "A metatable is a name match, and the payload does not grade it differently. `setmetatable(M, base)` publishes an `extends` edge to whatever `base` names, while every Lua relationship ships confidence 1.0 — so in the stored row a syntactic fact and a name-only inference are indistinguishable, which is a real cost of the flat confidence model rather than a claim that both are equally certain.",
      "A surface the chunk cannot name is disclosed rather than invented. A table returned from `setmetatable`'s first argument, the result of a call, a value literal and an anonymous function each land in `metadata.unpublishedSurface` with a stated reason — \"a value is not a name\", \"an anonymous function has no name\" — so what is missing is on the record rather than implied by an absence.",
    ],
    sample: {
      caption: "A module table, a method on it, and a metatable that extends it",
      code: `local M = {}                          -- bb records: variable M

function M.read(path)                    -- bb records: method read, owned by M
  local handle = io.open(path, "r")      -- bb records: a call edge -> open (receiver io in metadata)
  return handle:read("*a")
end

setmetatable(M, { __index = base })      -- bb records: an extends edge -> base
return M                                 -- what require() gets from this module`,
    },
    whereItShowsUp: [
      "The idiomatic module shape is a table built in a chunk and returned from it — `local M = {}` … `return M` — so `require \"socket.http\"` is an import edge and the methods belong to the table that holds them.",
      "`require` is recorded as an import but the loader's own search path is not evaluated, so a module found through `package.path` at run time connects to nothing the index can see.",
      "Game and plugin trees mix Lua with vendored C headers, and framework detection deliberately refuses to fire on a bare identifier — a claimed framework has to come from a qualified head or from a required module name, because an earlier rule named three frameworks for a file that contained neither.",
    ],
  },

  R: {
    headline:
      "R is indexed including its object systems: S4 sets and generics, R5 and R6 reference classes and S7 generics each record their own members, and a closure's calls are attributed to the nearest enclosing named function with the reason and the reduced confidence written onto the edge.",
    agentAsks: [
      "Which functions does this script define, and what do they call?",
      "Which members of this class are data and which are behaviour?",
      "Which named function does this closure belong to?",
      "Where is the generic for this S4 method declared?",
    ],
    limitations: [
      "Most idiomatic R is closures. A call inside `lapply(x, function(v) f(v))` is attributed to the nearest enclosing named symbol at confidence 0.7, carrying the reason verbatim, and a closure at top level with no enclosing function is counted as unresolved rather than given an invented source. The counters behind that — unresolved scope, calls attributed through a closure, calls to a callee that cannot be named — are published in the file's metadata.",
      "S3 dispatch is a naming convention, not a declaration. An edge from `print.zoo` to `print` is inferred from the `generic.class` spelling at confidence 0.8 with `reasonCode: \"s3_dotted_name_convention\"`, because the generic is not declared in that file. A quoted target cannot take this path: R dispatches on the literal name.",
      "Scope boundaries were measured against R 4.4.3 rather than reasoned. `local({ … })` IS a boundary; a plain brace block, parentheses, a call argument and a subset index are NOT — an earlier revision treated a subset ancestor as a boundary and silently dropped four real bindings. And `->` and `->>` bind the right-hand side, so `e -> 6` correctly publishes nothing.",
    ],
    sample: {
      caption: "An R5 reference class: its data member, its method, and the class they belong to",
      code: `Account <- setRefClass("Account",              # bb records: class Account
  fields  = list(balance = "numeric"),    # bb records: property balance — data, not behaviour
  methods = list(
    deposit = function(amount) {         # bb records: method deposit on Account
      balance <<- balance + amount
    }))`,
    },
    whereItShowsUp: [
      "R's object systems are all plain function calls in the source — `setClass`/`setGeneric` for S4, `setRefClass` for R5 and R6, `S7::method` for S7 — and the members are read out of the lists those calls pass, so a package's API is navigable without loading it.",
      "R6 splits `fields=` from `methods=`, so a data member is recorded as a field rather than as a method; a function stored in the `fields` list is a property by construction, because that is what the list means. S7 properties and methods each carry their own edge kind so the two stay separable.",
      "R Markdown and Quarto keep the R inside fenced code blocks inside a Markdown document. The `.Rmd` indexes as Markdown and the extracted `.R` indexes as R; the two halves do not join into one call graph.",
    ],
  },

  Perl: {
    headline:
      "Perl is read as packages: a `package` statement is the class, its subs are its methods, `use parent` and `with` become inheritance and role edges — and every edge that rests on less than a declaration carries a machine-readable reason, so confirmed and guessed edges can be told apart.",
    agentAsks: [
      "Which packages inherit from this base class?",
      "Which methods does this package define, and which subs are plain functions?",
      "Which call sites could not be resolved to a concrete sub, and why?",
      "Does this method actually override one that its base declares?",
    ],
    limitations: [
      "An override is confirmed against a base the index can see, and the two outcomes are very lopsided: of 8,085 `overrides` edges on the corpus, 1,627 are confirmed at confidence 0.95 and 347 are first-parent guesses at 0.5, with 6,111 withdrawn — 75.6% of the edges the first version published. A guessed edge still names a method that exists, so it is present and marked rather than dropped.",
      "Only the first base is followed. `use parent 'A', 'B'`, an `@ISA` assignment and `use Mojo::Base` each record every parent they name and walk one, and a role composed with `with` becomes an `implements` edge while the methods it supplies are not merged into the consuming package.",
      "The builtins list is derived rather than hand-written: the union of the fixed operator token sets the pinned grammar declares and the named-op entries in perl 5.38's own opcode header. Ten names were missing when it was first built, and `say` and `system` alone produced phantom call edges on one corpus.",
    ],
    sample: {
      caption: "A package, the base it declares, and the calls inside its method",
      code: `package App::Queue;              # bb records: package App::Queue (a class)
use parent 'App::Worker';       # bb records: extends -> App::Worker

sub run {                        # bb records: method run on App::Queue
  my $self = shift;
  $self->{queue}->enqueue(@_);   # bb records: calls -> enqueue
}

# sub new is published under the name "constructor"`,
    },
    whereItShowsUp: [
      "A module's identity is its package name — `package App::Queue;` — the same string `@ISA` and `->isa` speak in, so inheritance is answerable without loading anything.",
      "The block form (`package Outer { … }`) scopes the package to its braces: a sub written after the block is back in the enclosing package, which is how perl itself behaves.",
      "Declarative properties are read from the keyword rather than from an accessor: `has 'name' => (is => 'ro')` publishes a property on the package, and `field $x;` inside a 5.38 class body publishes one too — two spellings of the same declaration that produce one symbol.",
    ],
  },

  Groovy: {
    headline:
      "Groovy is read as the JVM language it compiles to: classes, traits, enums and records all get symbols, their `extends`, `implements` and override edges resolve, and a declared type on a field, a parameter or a `throws` clause becomes a reference — so a build script and the services it names live in one graph.",
    agentAsks: [
      "Which classes implement this trait, and which methods do they override?",
      "What does this class extend, and which methods does it override?",
      "Which constants does this enum declare?",
      "Which types do this method's parameters and return value declare?",
    ],
    limitations: [
      "A trait is published as an interface, not as a trait. `trait Auditable { … }` and `interface Auditable { … }` produce the same symbol kind here, so anything that has to tell them apart has to read the source rather than the index — a deliberate reading of the language rather than an omission.",
      "An import is a reference, and no package symbol is published for it. `import com.acme.Billing` records a reference edge to the full module path at confidence 0.9, so Groovy has no namespace node in the graph and a package's own members cannot be reached by walking into it.",
      "Only fully-qualified names become declared-type references. Fields, parameters, locals, `throws`, `instanceof`, casts and return types all publish, and an unqualified type name is refused, because every row of the lane's hand-audited truth set is qualified — a bare `Name` is a name this file does not spell out. And no synthetic members are recorded: a property's generated getter and setter, the implicit `log` field and a closure's `it` are absent because the source does not write them.",
    ],
    sample: {
      caption: "A trait, a class that implements it, and an enum's constants",
      code: `trait Auditable {                          // bb records: interface Auditable
  String auditTag() { "pay" }          // bb records: method auditTag on Auditable
}

class PaymentService implements Auditable {   // bb records: class PaymentService + implements edge
  Status status                       // bb records: property status on PaymentService
  String auditTag() { "pay-\${status}" }   // bb records: method auditTag on PaymentService
}

enum Status { PENDING, SETTLED }             // bb records: enum Status + members PENDING, SETTLED`,
    },
    whereItShowsUp: [
      "A Jenkinsfile is a `.groovy` file and indexes as one, as does a `buildSrc/` helper written in Groovy — so delivery logic sits in the same graph as the classes it names. Gradle build logic is mostly `.gradle` rather than `.groovy`, so the build script itself is not in this family's file set.",
      "Spock specifications write their test names as strings (`def \"addition works\"() { … }`), and those are recorded as methods on the specification class, so a spec is queryable as a set of test methods.",
      "An anonymous inner class has no spelling, so its body is filed under a synthesized name of the form `anonymous_<Supertype>` carrying `synthesized: true`. That name exists so the members have an owner; it is not a declaration in your source and should not be read as one.",
    ],
  },
}