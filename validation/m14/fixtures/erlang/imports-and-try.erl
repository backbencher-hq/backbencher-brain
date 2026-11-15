%% Pins the node types the erlang lane REFERENCES with no fixture (measured by
%% the F6 coverage gate after the lane was enrolled, 2026-09-25):
%%   import_attribute   `-import(lists, [map/2, foldl/3])`
%%   pp_include_lib     `-include_lib("kernel/include/file.hrl")` — the
%%                      include_lib form of the path, not the plain `-include`
%%                      that callsite-lines-825 already pins
%%   wild_attribute     `-nifs([...])` — the wildcard attribute shape
%%   attr_name          its `-nifs` head, whose atom decides the attribute
%%   try_expr           `try ... catch ... after ... end` and its arms
%% The negatives matter as much as the positives: `risky/1` and `cleanup/0`
%% are NOT declared in this module, so the declared-name/arity gate must emit no
%% call for either, and the `after` block is not an arm.
-module(imports_and_try).
-include_lib("kernel/include/file.hrl").
-import(lists, [map/2, foldl/3]).
-export([run/1, guarded/1]).
-nifs([nif_one/0, nif_two/1]).
-on_load(init/0).

run(X) ->
    lists:map(fun(Y) -> Y + 1 end, [X]).

guarded(X) ->
    try
        risky(X)
    catch
        error:Reason -> {error, Reason};
        _:_ -> unknown
    after
        cleanup
    end.

init() -> ok.
