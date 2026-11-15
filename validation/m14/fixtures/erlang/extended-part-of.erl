%%% ER-D46 fixture — the include directive is FILE INCLUSION (`part_of`).
%%% Two legal forms, a split directive and a conditional region: each must publish
%%% ONE part_of row, sourced to the module, target = the path as written, partRole library.
-module(extended_part_of).

-include("local.hrl").
-include_lib("kernel/include/file.hrl").

%% a split directive: the keyword on 10, the path STRING on 11
-include(
    "split_name.hrl").

%% an include inside a conditional-compilation region
-ifdef(USE_EXTRA).
-include("extra.hrl").
-endif.

-import(lists, [map/2]).

-export([run/1]).

run(X) ->
    lists:map(fun(Y) -> Y end, [X]).
