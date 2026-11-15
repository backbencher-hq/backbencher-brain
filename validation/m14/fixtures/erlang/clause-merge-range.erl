%% Pins ER-D44 for the MERGE path, which `erlang/arity-distinct-calls` does not reach.
%%
%% That fixture pins a single-clause function's range, and a single-clause function's
%% range comes from the symbol's CONSTRUCTION (`nodeToRange(declNode)`) rather than from
%% the merge. On this pinned grammar a `;`-separated clause gets its OWN `fun_decl` and
%% the `;` is a child of the earlier one — `pick(0) -> zero;` is `fun_decl` [32,48) and
%% `pick(X) -> X.` is `fun_decl` [49,62) — so every multi-clause function IS the merge
%% path, and the earlier fix's second half had no fixture at all.
%%
%% Erlang has ONE function per (name, arity) (ER-D26), so `pick/1` is one symbol whose
%% range spans BOTH clauses and ends on the grammar's `fun_decl` [32,62), i.e. ON the
%% final `.`. Reverting the merge to the `function_clause` yields [32,61) and
%% `source.slice(startIndex, endIndex)` — the text a consumer reads back for the symbol —
%% comes back one character short.
-module(clause_merge_range).
-export([pick/1, head/1, wide/2]).

pick(0) ->
    zero;
pick(X) ->
    {X}.

%% Two clauses with the same arity AND a trailing comment, so the range has to survive a
%% clause whose last line is not its terminator.
head([H | _]) ->
    H;
head(_) ->
    undefined.

%% Three clauses: the range must span the first to the third, not the first to the second.
wide(a, _) ->
    one;
wide(_, b) ->
    two;
wide(b, c) ->
    {b, c}.
