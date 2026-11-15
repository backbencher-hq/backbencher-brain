%% Pins the ATTRIBUTE surface. -nifs/-on_load ANNOTATE the declared function
%% instead of minting a second symbol — the pre-ER3 branch was dead twice over:
%% `attr_name.text` is `-nifs`, and the entries are binary_op_expr, not `fa`.
%% -export_type lands as a typed export, -optional_callbacks records on the
%% module, -import is an EXTERNAL dependency, and -compile stays silent.
-module(attrs_er3).
-compile([{inline, [helper/1]}]).
-compile(export_all).
-nifs([native/1, native2/2]).
-on_load([boot/0]).
-optional_callbacks([handle_info/2]).
-import(lists, [seq/2]).
-include("local.hrl").
-include_lib("kernel/include/file.hrl").
-export([helper/1, native/1, native2/2, boot/0, run/0]).
-export_type([t/0]).

-record(state, {a}).
-callback handle_info(term(), term()) -> term().
-type t() :: integer().

helper(X) ->
    X.

native(X) ->
    X.

native2(X, Y) ->
    {X, Y}.

boot() ->
    ok.

run() ->
    helper(lists:seq(1, 3)),
    native(1),
    native2(1, 2),
    self().
