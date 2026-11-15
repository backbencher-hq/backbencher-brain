%% Pins the TYPE graph: -opaque, -nominal, -spec, -callback and a record field
%% type all contribute type references; a declaration's OWN name never becomes a
%% self-reference; and a RECURSIVE type's self-reference is legal Erlang and IS
%% emitted — those are two different facts, and only the span filter separates
%% them. A record named in a type is a type REFERENCE, never a construction.
-module(types_er3).
-export([run/1, reply/0]).
-export_type([handle/0, tree/0]).

-callback handle(Req :: request()) -> {ok, reply()} | error.
-callback init(term()) -> {ok, term()}.

-type request() :: {atom(), payload()}.
-type payload() :: binary() | undefined.
-opaque token() :: binary().
-nominal ident() :: atom().
-type tree() :: {tree(), leaf()} | leaf().
-type leaf() :: integer().
-type recursive() :: {recursive(), integer()}.
-type wrapped() :: #state{}.
-record(state, {tok :: token(), r :: request()}).
-spec run(request()) -> {ok, reply()}.

run(R) ->
    {ok, R}.

reply() ->
    ok.
