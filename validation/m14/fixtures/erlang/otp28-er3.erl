%% Pins OTP 28's `maybe … else … end` (ER-D19) — a construct the pre-ER3 model
%% did not know existed. Its `else` arms are cr_clauses and count as branches,
%% and `Pattern ?= Expr` is a match whose left side is a PATTERN, so a record
%% there is a match rather than a construction.
-module(otp28_er3).
-export([pick/1, walk/1]).

-record(box, {v = 0 :: integer()}).

pick(X) ->
    maybe
        {ok, V} ?= X,
        erlang:is_integer(V),
        {ok, V}
    else
        false -> zero;
        _ -> other
    end.

walk(L) ->
    [N || #box{v = N} <- L].
