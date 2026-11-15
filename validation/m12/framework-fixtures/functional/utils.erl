-module(utils).
-export([add/2, factorial/1]).

add(A, B) ->
    A + B.

factorial(0) -> 1;
factorial(N) when N > 0 ->
    N * factorial(N - 1).
