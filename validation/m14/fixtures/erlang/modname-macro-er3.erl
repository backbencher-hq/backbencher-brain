%% Pins ER-D34: a module can NAME ITSELF THROUGH A MACRO. Common Test suites
%% do this by convention — otp/lib/kernel/test/file_SUITE.erl is the only such
%% file in the 4,326-file corpus, and it failed silently and totally: the reader
%% required an `atom` under `-module(...)`, the attribute carries a
%% macro_call_expr, so NO module symbol was emitted at all and the file fell
%% back to being owned by its PATH. The whole file's ownership, exports and
%% cross-module identity were then wrong with nothing to show for it.
%%
%% The negative half matters as much as the positive: a macro whose body is not
%% a bare atom (`modname_bad` below) is NOT expandable without running the
%% preprocessor, so the module name stays unknown and the file is owned by its
%% path. Guessing would be a fabrication.
-define(MODNAME, modname_macro_er3).

-module(?MODNAME).

-define(PREFIXED, modname).

-export([owner/0]).

owner() ->
    ?PREFIXED.
