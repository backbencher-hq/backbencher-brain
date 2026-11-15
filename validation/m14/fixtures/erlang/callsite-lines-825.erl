%% Pins the M59 (#825) line contract for erlang, ER1 wave: the line belongs to
%% the NAME-BEARING node — the callee atom (local calls), the function atom
%% (the remote leaf), the behaviour atom, the include path string, the record
%% name, and the member declaration (pinned through contains). Constructs are
%% split across lines so each pin is a DIFFERENT line and the construct's
%% opening line is a distinguishable wrong answer.
-module(callsite_lines).
-include(
    "path.hrl"
).
-behaviour(
    gen_server
).
-export([run/0, target/0, handle_call/3]).

-record(state, {
    count,
    label
}).

run() ->
    target(),
    target(),
    target(),
    target(),
    gen_server:reply(
        self(), ok
    ),
    #state{
        count = 1,
        label = a
    },
    ok.

target() -> ok.

handle_call(_Req, _From, State) ->
    {reply, ok, State}.
