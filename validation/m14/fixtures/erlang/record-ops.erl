-module(record_ops).
-export([make/0, bump/1, read_id/1]).

-record(state, {id, count = 0, label}).

make() ->
    #state{id = 1, label = new}.

bump(S) ->
    S#state{count = S#state.count + 1}.

read_id(S) ->
    S#state.id.
