%% Pins ER-D35, the distinction the FULL 4,326-file corpus draw forced and the
%% 4,000-file stride sample could not see.
%%
%% A macro in REMOTE-MODULE position is not automatically `?MODULE`. Only
%% `?MODULE:f(X)` is this file's module — the idiomatic self-dispatch, pinned in
%% dispatch-er3. Any other macro there (`?FILE_MODULE:read_file_info(Priv)`) is
%% an ordinary preprocessor constant whose value the analyzer does not expand, so
%% no callee is derivable and the honest answer is to emit nothing.
%%
%% The pre-fix branch substituted this file's module for EVERY macro there, which
%% reported `?FILE_MODULE:acceptor(A,B,C,D)` inside httpd_acceptor.erl as
%% `httpd_acceptor:acceptor` — a self-call that appears nowhere in the source.
%% Measured: 922 fabricated edges over the corpus, all in one file, all wrong.
%% dispatch-er3 pins the `?MODULE` half; this fixture pins the other half.
-module(macro_module_er3).

-define(OTHER_MODULE, gen_server).

self_dispatch() ->
    ?MODULE:helper().

foreign_dispatch(State) ->
    ?OTHER_MODULE:start_link(?MODULE, State, []).

fun_value() ->
    fun ?OTHER_MODULE:handle_info/2 end.

helper() ->
    ok.
