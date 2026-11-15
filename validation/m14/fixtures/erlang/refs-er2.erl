%% Pins the ER2 reference surface (user findings #2/#4/#6, closes ER-G1/G2/
%% G5): macro uses (references -> the constant, per-site), fun-value
%% references (internal_fun/external_fun), type->type references from
%% -type/-opaque, -callback Method symbols (HS-D8 parity), the ?MODULE
%% remote-module expansion (ER-D14), and the DECL-ONLY silence of type
%% syntax (a callback's state() is not a call).
-module(refs_er2).
-behaviour(gen_server).
-callback handle(state()) -> {reply, term(), state()}.
-define(TIMEOUT, 5000).
-type maybe(T) :: T | undefined.
-opaque token() :: binary().
-record(ctx, {server}).
-export([go/1, run/1]).

go(X) ->
    F = fun run/1,
    G = fun lists:map/2,
    ?MODULE:run(X),
    ?TIMEOUT,
    lists:foreach(F, [X]),
    {G, ?SERVER_HEADER}.

run(X) -> {X, ?TIMEOUT}.

%% ER3 (2026-09-25, from the M12 differential): a type dependency is an APPLIED
%% name, and only an applied name. A bare unquoted atom in type syntax is the
%% atom LITERAL of that name (`monday` is the atom monday, never a type named
%% monday; writing `integer` without parens is the atom integer, not the type
%% integer()), a map/record field key is a DECLARATION, a record type names its
%% record, and a remote type keeps its qualification (ER-D1). The ER2 authoring
%% counted every bare atom and fabricated `job -> id` / `job -> kind` out of the
%% map keys of #{id := job_id()} on the M12 fixtures.
-type day() :: monday | tuesday.
-type job() :: #{id := binary(), kind := atom(), payload := term()}.
-type ctx_rec() :: #ctx{server :: pid()}.
-type ext() :: dict:dict().
