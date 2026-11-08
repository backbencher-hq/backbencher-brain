%% PINS the erlang wave fixture pack (M29 wave 3, language-onboarding protocol).
%% Uniform wave convention: a greeter module with a greet function, exercised
%% in main, plus a named constant whose references must be resolvable.
-module(greeter).
-export([greet/1, main/0]).

-define(GREETING, "hello").

greet(Items) ->
    ?GREETING ++ " " ++ integer_to_list(length(Items)).

main() ->
    io:format("~s~n", [greet(["a", "b"])]),
    io:format("~s~n", [?GREETING]).
