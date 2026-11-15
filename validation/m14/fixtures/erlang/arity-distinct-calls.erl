%% Pins ER-D2 (#880 obligation 4): a call's arity is part of its edge
%% identity. go/0 calls pick/1 AND pick/2 — two distinct callees, two distinct
%% call edges (metadata.callArity 1 and 2), never one merged row. The same
%% rule holds for remote targets (ER-D1: io:format keeps its module
%% qualification; io:format/1 and io:format/2 are distinct edges). fold/2
%% calls fold/3 forward, proving arity survives the declared-function
%% prepass for multi-arity groups.
-module(arity_distinct_calls).
-export([go/0, pick/1, pick/2, fold/2, fold/3]).

go() ->
    pick(1),
    pick(1, 2),
    io:format("one~n"),
    io:format("~p~n", [pick(1)]),
    fold(fun(X, Y) -> X + Y end, 0).

pick(X) -> X.
pick(X, Y) -> {X, Y}.
fold(F, Acc) -> fold(F, Acc, []).
fold(F, Acc, List) -> lists:foldl(F, Acc, List).
