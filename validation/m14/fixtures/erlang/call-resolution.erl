-module(call_resolution).
-export([run/0, step_two/1]).

%% forward reference: run calls step_one, declared below
run() ->
    step_one().

step_one() ->
    step_two(1).

step_two(X) ->
    X + 1.
