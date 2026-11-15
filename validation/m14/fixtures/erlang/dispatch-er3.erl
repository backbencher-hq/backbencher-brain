%% Pins remote-call resolution. `?MODULE:f()` expands to this module, so the call
%% resolves exactly like a module-qualified one. A fun value keeps its module
%% qualification and is a REFERENCE, never a call. A DYNAMIC remote (`M:f(X)`,
%% `erlang:F(X)`) has no statically nameable callee: naming the bare leaf would
%% conflate every module's `f`, so nothing is emitted (ER-D23).
-module(dispatch_er3).
-export([run/1, m/0]).

run(M) ->
    A = M:dyn(1),
    B = erlang:F(2),
    C = lists:map(fun erlang:is_integer/1, [1, 2]),
    D = ?MODULE:m(),
    E = fun dispatch_er3:m/0,
    {A, B, C, D, E}.

m() ->
    ok.
