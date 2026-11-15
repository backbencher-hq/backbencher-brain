# Julia fixture — `imports` and `exports` as RELATIONSHIPS, and the selective-import shape.
#
# Both of these types were RULED by this lane and both rulings were wrong. Each named its own
# overturn condition, and each condition was already satisfied by a sibling lane:
#
#   imports — "a julia `imports` relationship row that is not an import-site artifact, a row whose
#             source is the importing declaration rather than the literal `root`". That is
#             `src/ast/real-python-analyzer.ts:979` emitting for `import a.b`, and what the lua,
#             yaml, nim and typescript lanes emit. `RelationshipType.Imports` serializing to
#             `"brain_import"` (`src/ast/types.ts:69`) constrains nobody: every one of those lanes
#             writes through the same string. The ruling mistook a convention for a constraint.
#
#   exports — "an `exports` relationship count above the `ExportInfo` count for the same corpus".
#             Emitting one row per `ExportInfo` entry cannot exceed it, so the condition could only
#             be met by an edge that was WRONG. `src/ast/real-python-analyzer.ts:1166` emits both
#             channels from one `__all__` walk, and this file does the same for `export`.
#
# The object lesson is the SHAPE of those two conditions: each was worded so that doing the right
# thing could not satisfy it. A falsifiable ruling has to name a count that a correct implementation
# would move.
#
# WHY A FIXTURE AND NOT JUST THE CENSUS. The census counts; a fixture ASSERTS. What this file pins
# is the third thing the census cannot see — that the SOURCE of an `imports` edge is the importing
# declaration and not the file root, which is the exact distinction the ruling turned on. Emit both
# ends from `root` and every count in the census stays identical.

module SelectiveImports
# `using Base: isexpr` — the SELECTIVE form. This is julia's most common import shape by a wide
# margin: 583 of the 1,675 `import_statement`/`using_statement` nodes across the 971 admitted
# corpus files have `selected_import` as their ONLY named child. `importTargets` matched neither
# `import_path` nor a bare `identifier` there, so it returned an EMPTY list for every one of them
# and the dependency on `Base` was dropped — silently, because the statement parses without an
# ERROR node and the file still publishes hundreds of symbols.
using Base: isexpr

import StructUtils: lift

using LinearAlgebra

# `using A, B` — TWO MODULES IN ONE STATEMENT, and the defect this lane measured largest.
#
# `importTargets()` walked the named children in order carrying a `pending` variable, and one branch
# read "a bare identifier when something is already pending, with no items yet, and a different name
# — that is an ITEM of the pending target". That branch cannot tell a second MODULE from an item of
# the first, so `using Compat, Logging` published ONE edge and called `Logging` an item of `Compat`.
# Measured over the corpus by `script/m14/oracles/julia-imports.ts`: 167 of 440 derived import
# edges were MISSING on a 200-file draw, 38% of the type, and
# `DataFrames.jl/src/DataFrames.jl:3-19` is one `using` naming SEVENTEEN modules of which one was
# published. The corpus census could not see it: `census.ts` counts FILES carrying the construct
# against files whose edge fired, so a file whose first module produced an edge passed.
using Compat, Logging

# `import A as B` — the RENAMED import. This is Julia 1.6+ syntax and the `import_alias` branch was
# gated on a `pending` that a statement whose ONLY named child is an `import_alias` never had, so
# the whole statement published nothing: measured on
# `StaticArrays.jl/ext/StaticArraysChainRulesCoreExt.jl`, which writes `import ChainRulesCore as CRC`.
# The edge asserts the MODULE, because `as` renames the binding and does not change what is depended
# on — `CRC` is not a module this file depends on.
import ChainRulesCore as CRC

# `public = …` — THE MISPARSE, and it must publish NO export edge.
#
# `public` and `export` are CONTEXTUAL KEYWORDS in julia: keywords only when a name list follows. So
# `public = expr` declares a variable named `public`, and it is not an export of anything.
#
# The production grammar gives it a `public_statement` node anyway, and the analyzer published
# `exports` edges from it — on `Documenter.jl/src/expander_pipeline.jl:632` for the local `fields`,
# the local `private` and a bare `:`, and on `julia/stdlib/REPL/src/docview.jl:408` for `binding`,
# which is a FUNCTION PARAMETER of `summarize`. Four fabricated edges corpus-wide. The refusal is
# "the first NAMED child of the statement is an ERROR", because a real `public X, Y` begins with a
# name and a misparse has no name list to attach — and it is deliberately NOT "contains an ERROR",
# since the 45 ERROR-bearing import statements are legitimate julia the grammar cannot fully parse.
#
# THE RIGHT-HAND SIDE IS NOT ARBITRARY. It carries identifiers on purpose: `exportableName()` returned
# one string per NAMED CHILD of the misparsed statement, so a misparse whose RHS is a bare literal
# published no edges even before the fix and would pin nothing. This is the corpus case's shape —
# `public = get(fields, :Public, true)` — so `fields` and `select_probe` are exactly the two names the
# pre-fix walk published as exports of this module.
public = get(fields, select_probe, true)

# `const`, not a bare `x = 1`: a plain module-level assignment is not a declaration SITE in this
# analyzer (only `const`/`global`/`local` and short-form definitions are), so a bare `fields = 1`
# would leave the name unpublished and the fixture would pin a name that does not exist in the payload.
const fields = 1

function select_probe(x::Int)
    return x
end

# The genuine form, immediately after the misparse, so the refusal cannot be satisfied by refusing
# `public` outright: this one MUST publish an edge.
public documented_publication

function documented_publication(x::Int)
    return x
end

# `export` DECLARES NOTHING: the exported name is a binding whose kind depends on what it turns out
# to be, and julia allows the export to precede the declaration. So this edge asserts no kind, and
# `export_declare` below is deliberately a function while `Exported` is a struct.
export parse_pair, Exported, @exported_macro, export_declare

# Declared AFTER the export that names it, deliberately: julia allows `export X` to precede the
# declaration of `X`, and this walk is single-pass, so an implementation that gated the exports edge
# on "is this name in `symbols` yet" would drop exactly this row. The edge must be emitted from the
# export site and resolve against the file's FINAL symbol table.
struct Exported
    value::Int
end

function parse_pair(s::String)
    return (length(s), s)
end

function export_declare(x::Int)
    return isexpr(:call, :f, x)
end

macro exported_macro(x)
    return x
end

end # module SelectiveImports

# A file-scope `using`, outside any module. 71.9% of corpus files open no module at all, and a
# top-level `using` imports into `Main` — so the source is the FILE's own synthetic scope and not a
# module symbol. Pinned so that the module-scoped row above and this one cannot be swapped.
using Statistics

public top_level_publication

function top_level_publication(x::Int)
    return stdcall_probe(x)
end

stdcall_probe(x::Int) = x + 1