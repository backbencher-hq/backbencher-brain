%% Pins the macro surface. A function-like macro's use names the macro through
%% its ATOM child — reading only the `var` child drops every argument-taking use
%% (2,691 of 6,612 per 300 corpus files). A macro body may reference another
%% macro: that is a static dependency and is emitted. A macro body's CALL is
%% template text, not a call site (ER-D11), and a function whose name collides
%% with a macro name is still a Function.
-module(macros_er3).
-define(TIMEOUT, 5000).
-define(RETRY(N), {retry, N, ?TIMEOUT}).
-define(DOUBLE(X), helper(X)).
-define(HEAD(X), X).

-export([run/0, helper/1, HEAD/1]).

run() ->
    A = ?RETRY(3),
    B = ?TIMEOUT,
    C = ?DOUBLE(1),
    D = helper(1),
    {A, B, C, D}.

HEAD(X) ->
    X.

helper(X) ->
    {X, X}.
