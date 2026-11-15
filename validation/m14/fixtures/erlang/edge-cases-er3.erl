%% Pins three adjudicated edge cases. A QUALIFIED type keeps its module, so a
%% record field's type names `cowboy_middleware:env` and never the bare module
%% atom. A module that both DECLARES a callback and DEFINES it — a behaviour with
%% a default implementation, the `tftp_logger` shape — yields ONE symbol whose
%% kind is the DEFINITION and whose line is the definition's, with the contract
%% kept in metadata. And `?MODULE()` is a function head: the OTP test-suite
%% idiom, whose real function name is the module's own.
-module(edge_cases_er3).
-behaviour(my_behaviour).
-export([logger/2]).
-export([?MODULE/0]).

-callback logger(io:format(), [term()]) -> ok.
-record(opts, {env :: cowboy_middleware:env(), n :: non_neg_integer()}).

logger(Format, Args) ->
    io:format(Format, Args).

?MODULE() ->
    logger("hi", []).
