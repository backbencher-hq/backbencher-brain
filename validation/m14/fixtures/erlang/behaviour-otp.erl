-module(behaviour_otp).
-behaviour(gen_server).

-export([init/1, handle_req/2]).

init(_Args) ->
    {ok, no_state}.

handle_req({call, Who}, State) ->
    gen_server:reply(Who, ok),
    {noreply, State};
handle_req({notify, _Who}, State) ->
    {noreply, State}.

helper() ->
    self().
