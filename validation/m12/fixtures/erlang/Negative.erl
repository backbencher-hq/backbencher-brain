-module(negative).
-export([builtin_only/1, member_access/1, head_pattern/1, sends/1, spawns/0, uses_import/1]).
-import(lists, [map/2]).

builtin_only(List) ->
    length(List),
    element(1, List),
    self(),
    hd(List).

member_access(Job) ->
    Job#job.id,
    Job#job.kind.

head_pattern(#state{q = Q}) ->
    Q.

sends(Pid) ->
    Pid ! hello.

spawns() ->
    spawn(fun() -> ok end),
    spawn_link(negative, spawns, []).

uses_import(List) ->
    map(fun(X) -> X end, List).
