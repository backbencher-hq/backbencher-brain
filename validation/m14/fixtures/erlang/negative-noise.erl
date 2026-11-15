-module(negative_noise).
%% Nothing in this file may emit a call or instantiation edge:
%% BIFs are not calls, send is not a call, spawn/length are BIFs,
%% and the record literal sits in worker's HEAD — pattern position.
-export([run/1]).

run(Msg) ->
    Pid = spawn(fun worker/0),
    Pid ! Msg,
    length([1, 2, 3]).

worker(#unused{a = 1}) ->
    ok.
