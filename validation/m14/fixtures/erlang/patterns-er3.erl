%% Pins the four PATTERN-POSITION classes. Each shape decided a different bug,
%% and every one of them was found by the corpus dual lens, not by reading:
%%   a GUARD computes; a generator's left side binds; a case arm's match is a
%%   pattern; a body match is a construction.
-module(patterns_er3).
-export([guard_read/1, gen/1, arm/1, body/1, comp/0]).

-record(r, {f = 0, g}).

guard_read(X) when X#r.f > 0 ->
    ok.

gen(L) ->
    [N || #r{f = N} <- L].

arm(X) ->
    case X of
        Y = #r{} -> Y;
        _ -> none
    end.

body() ->
    A = #r{},
    B = A#r{g = 1},
    {A, B, #r.f}.

comp() ->
    [X || X <- [1, 2, 3], X > 1].
