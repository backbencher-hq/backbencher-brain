%% Pins the two RULED relationship types, and pins WHY each is ruled with a
%% measurement rather than with prose. `docs/analyzers/ONTOLOGY-WORKSTREAM.md`
%% exists because `overrides` was missing from Bash for a whole wave behind a prose
%% justification and the differential stayed green: the analyzer omitted it, the
%% oracle was written after the ruling, and nothing agrees with nothing. So every
%% construct a probe MEASURED on the corpus as the nearest thing to `extends` /
%% `overrides` appears below, and every one of them must produce NO edge.
%%
%% MEASURED over 3,939 corpus files (otp 36e371a4 + elixir 73b3325, one parse each,
%% script/m60/erlang-construct-probe.ts):
%%
%%   extends   instrument A — the pinned wasm's own table defines 137 named node
%%             types (132 distinct), declares 0 abstract supertype/subtype edges,
%%             and names 52 fields. 0 of 23 inheritance-shaped node types and 0 of
%%             the 52 fields is in either. Instrument B — 0 inheritance-shaped
%%             attributes (`-extends`/`-inherits`/`-parent`/…) in 3,939 files.
%%             2,992 type declarations APPLY another type this file declares, which
%%             is the nearest spelling Erlang has, and every one of them is a
%%             `references` dependency (the shape below).
%%
%%   overrides 0 attributes publishing a definition as replaceable (no
%%             `defoverridable` in 3,939 files); 0 node types whose name carries
%%             `overrid`/`replace` other than OTP's binary `ssr_*` compile
%%             directives; 87 sites where one (name, arity) is declared in more
%%             than one preprocessor region, ALL of them mutually exclusive
%%             `-ifdef`/`-else` branches, 0 unconditional redefinitions; and 33
%%             sites where a `-callback` and a definition of the same identity share
%%             a file — which the analyzer deliberately merges into ONE symbol
%%             (ER-D30), so the edge would be `f -> f`.
%%
%% The cross-file shape IS real and IS measured: 378 `-callback` declarations from 79
%% modules, 572 `-behaviour(B)` sites, and 2,548 callback identities an
%% implementing module supplies by exact name AND arity. It is not published as
%% `overrides` because the cross-file resolution channels this repository ships
%% (`AnalyzeContext.overrideCompanion` and `AnalyzeContext.projectIndex`) both
%% carry a `Set<string>` of bare NAMES — src/ast/override-context.ts:85 and
%% src/ast/project-index.ts:313 — and Erlang's callback identity is name AND
%% arity, so a name-only match would publish `code_change/2` as implementing
%% `code_change/3`. Reported, not fabricated.
-module(ontology_no_inheritance).

-behaviour(sample_behaviour).

-export([impl/1, alt/0, own/0]).

-export_type([state/0]).

-callback own() -> ok.

-callback needed(Arg :: term()) -> term().

-type state() :: {ok, term()} | error.

%% A `-callback` AND a definition of the same identity in ONE file. The two declare
%% one thing, so the analyzer publishes ONE symbol carrying both facts
%% (`meta.isCallback`, `meta.callbackLine`) and there is no second member for an
%% edge to point at.
-spec own() -> ok.
own() ->
    ok.

%% `-behaviour(B)` names a contract whose callbacks live in ANOTHER file, and this
%% module supplies one of them by exact name and arity. The MODULE-level fact is
%% `implements`; there is no in-file contract to point a member-level edge at.
-spec impl(term()) -> term().
impl(Arg) ->
    needed(Arg).

needed(Arg) ->
    Arg.

%% One (name, arity) declared in two MUTUALLY EXCLUSIVE preprocessor branches.
%% Exactly one body survives preprocessing; neither replaces the other, and the
%% analyzer publishes ONE `alt/0` symbol whose `meta.clauseCount` is 2 — so the
%% multiplicity is recorded rather than turned into an edge to nowhere.
-ifdef(ONTO_ALT).
alt() ->
    one.
-else.
alt() ->
    two.
-endif.
