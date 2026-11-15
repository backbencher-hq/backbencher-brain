%% M14.0.F6 erlang coverage (2026-10-08).
%%
%% The lane's completeness spec lists 104 handled_verified node types, and F6
%% requires every one of them to OCCUR in a fixture's parse: "the analyzer can
%% handle it" is not evidence, and neither is reasoning about the grammar. 21 of
%% them were reached by no fixture. Each construct below was located by parsing
%% candidates against the pinned wasm and keeping the source that produced the
%% type:
%%
%%   pp_if / pp_ifndef / pp_elif        the preprocessor conditional chain
%%   replacement_cr_clauses             a -define body that is a CLAUSE LIST
%%   replacement_function_clauses       a -define body that is a NAMED clause list
%%   replacement_guard_and              a -define body that is a GUARD SEQUENCE
%%   macro_string                       the stringify operator ??Arg
%%   fun_type / fun_type_sig            fun((A) -> B) in a type
%%   type_guards                        a `when` on a -spec
%%   range_type                         1..10 in a type
%%   map_comprehension / map_generator  #{K => V || K := V <- M}
%%   catch_expr                         catch Expr
%%   try_stack                          catch Class:Reason:Stack
%%   binary_comprehension               << E || <<E>> <= B >>
%%   b_generator                        <<X>> <= B
%%   block_expr                         begin ... end
%%   bit_type_list / bit_type_unit      <<X:8/integer-unit:1>>
%%   unary_op_expr                      -X, not X, bnot X
%%
%% Three shapes reach the same types and are deliberately NOT used, because each
%% one parses with an ERROR node: a parenthesised clause list
%% (`-define(C, (a -> 1; b -> 2)).`), a `when`-prefixed guard body
%% (`-define(G, when X > 0).`), and a NAMED clause-list macro invoked as a
%% `fun ?M end`. Pinning a shape the parser cannot read would put a broken
%% fixture in the battery in exchange for cover the clean forms already give.
-module(construct_coverage).

-ifndef(CONSTRUCT_COVERAGE_ON).
-define(CONSTRUCT_COVERAGE_ON, true).
-elif(defined(OTHER_BRANCH)).
-else.
-undef(CONSTRUCT_COVERAGE_ON).
-endif.

-if(?CONSTRUCT_COVERAGE_ON).
-export([pick_cr/1, pick_fn/1, pick_name/1, guarded/1, shaped/3]).
-endif.

%% A CLAUSE LIST as a macro body, used inside a `case` — the OTP idiom the type
%% exists for.
-define(PICK_CLAUSES, a -> 1; b -> 2).

%% A NAMED clause list as a macro body, with a guard on the head.
-define(PICK_FN_CLAUSES, foo(Value) when Value > 0, Value < 10 -> ok).

%% A GUARD SEQUENCE as a macro body, used in a `when`.
-define(IN_RANGE(X), X > 0, X < 10).

%% The STRINGIFY operator.
-define(NAME_OF(X), ??X).

-type callback() :: fun((integer()) -> ok).
-type range() :: 1..10.
-spec pick_name(Name) -> string() when Name :: atom().
-spec shaped(callback(), binary(), map()) -> ok.

pick_cr(X) ->
    case X of
        ?PICK_CLAUSES;
        _ -> 0
    end.

pick_fn(X) ->
    case X of
        ?PICK_FN_CLAUSES
    end.

pick_name(Name) ->
    ?NAME_OF(Name).

guarded(X) when ?IN_RANGE(X) -> ok.

shaped(Cb, Bin, Map) ->
    Caught = catch 1 / 0,
    Block = begin 1, 2 end,
    Neg = -1,
    Not = not false,
    Bnot = bnot 1,
    Bits = <<1:8/integer-unit:1>>,
    Bins = << <<Y>> || <<Y>> <= Bin >>,
    List = [Z || <<Z>> <= Bin],
    Built = #{K => V || K := V <- Map},
    try maps:get(a, Built, Cb) of
        R -> {Caught, Block, Neg, Not, Bnot, Bits, Bins, List, R}
    catch
        Class:Reason:Stack -> {Class, Reason, Stack}
    after
        ok
    end.
