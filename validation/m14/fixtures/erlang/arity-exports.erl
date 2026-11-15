-module(arity_exports).
-export([pick/0, pick/1]).

pick() -> unit.

pick(0) -> zero;
pick(X) -> X.
