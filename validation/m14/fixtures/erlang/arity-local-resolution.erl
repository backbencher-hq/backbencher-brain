-module(arity_local_resolution).
-export([go/1, get/2, emit/4]).

%% ER-D45: a local call resolves against the file's declared NAME/ARITY pairs, never
%% against the bare name. `get/1` is the process-dictionary auto-import, `setelement/3`
%% and `binary_part/3` are BIFs — this file declares `get/2` and no `setelement` at
%% all, so the two `get` call sites have OPPOSITE answers and a name-only gate gives
%% them the same one.
go(D) ->
    A = get(key, D),
    B = get(D),
    C = setelement(1, D, x),
    E = emit("x"),
    emit(G, T, Def, V),
    {A, B, C, E}.

get(Key, Env) ->
    {Key, Env}.

emit(Gen, Type, Default, Value) ->
    {Gen, Type, Default, Value}.
