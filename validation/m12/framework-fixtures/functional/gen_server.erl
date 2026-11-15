-module(counter).
-behaviour(gen_server).
-export([start_link/0, init/1, handle_call/3, handle_cast/2]).

start_link() ->
    gen_server:start_link(?MODULE, [], []).

init([]) ->
    {ok, 0}.

handle_call(get_count, _From, Count) ->
    {reply, Count, Count}.

handle_cast({increment, N}, Count) ->
    {noreply, Count + N}.
