%% The negative half of ER-D34, and the half that is easy to get wrong in the
%% other direction. `-define(BAD, atom_to_list(x)).` does not expand to an atom,
%% so resolving it needs the preprocessor. The analyzer does not run one, so the
%% module name stays UNKNOWN — and the honest representation of an unknown module
%% name is no module symbol at all, with the file owned by its path (ER-D32).
%% Synthesising a module name from the filename would put a module in the store
%% that no compile of this file can ever produce.
-define(BAD, atom_to_list(nope)).

-module(?BAD).

-export([helper/0]).

helper() ->
    ok.
