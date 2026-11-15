%% Pins the three public-surface facts the ontology audit found were never emitted.
%%
%% ER-D39: a function-like macro takes parameters, so it is kind=macro, not
%%   constant (the C analyzer's own split, real-c-analyzer.ts:3989). An
%%   object-like -define is still a compile-time constant.
%% ER-D40: `-export([f/1])` states the module's interface. `contains` states that
%%   f/1 is a member; `exports` states that it is public. Different facts.
%% ER-D41: `-import(Mod, [f/a])` emits `imports` (the dependency the module pass
%%   reads) alongside the `references` mention.
-module(export_import_macro_er3).

-define(LIMIT, 100).
-define(SCALE(X), X * 2).

-export([run/0, helper/1]).
-export_type([state/0]).

-import(lists, [map/2]).

-type state() :: {ok, term()} | error.

run() ->
    lists:map(fun helper/1, [1, 2]),
    ?SCALE(?LIMIT).

helper(N) ->
    N.