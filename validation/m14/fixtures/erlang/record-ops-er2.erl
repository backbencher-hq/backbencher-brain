%% Pins the ER2 record-member contract (user finding #1, closes ER-G4) and
%% the per-arm complexity ruling (user finding #3, ER-D13). Reads, updates
%% and index reads emit `uses` -> record AND `uses` -> touched field, in
%% evaluation contexts only — the HEAD-pattern shape emits NOTHING (a head
%% is a match, not an evaluation). Record field DEFAULTS (user finding #5,
%% ER-D12) attribute their calls to the RECORD. Per-arm complexity is pinned
%% through expectComplexity (base 1 + arms): transitions = 3 case arms +
%% 2 receive arms + 1 receive_after = 7; guarded = 2 if arms + 1 andalso = 4;
%% heady = 1 (a head pattern is not an arm).
-module(record_ops_er2).
-export([transitions/1, guarded/1, heady/1, get_count/1, idx/0]).

-record(state, {timer = erlang:make_ref(), count = 0, label}).

transitions(State) ->
    case State#state.count of
        0 -> first;
        1 -> second;
        _ -> other
    end,
    receive
        bump -> New = transitions(State#state{count = State#state.count + 1}),
                {ok, New};
        stop -> done
    after 1000 -> timeout
    end.

guarded(S) when S > 0 andalso S < 10 ->
    if
        S == 1 -> one;
        true -> many
    end.

heady(#state{count = C}) -> C.

get_count(S) -> S#state.count.

idx() -> #state.label.
