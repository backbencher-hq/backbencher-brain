%% Pins the M59 name-vs-construct line rule on `contains`, which the 400-file
%% corpus draw found and the 150-file draw missed: a multi-line `-define(` puts
%% the macro's NAME one line below the keyword, and `contains` must carry the
%% NAME's line. Measured on otp/lib/snmp/src/manager/snmpm_net_if.erl, whose two
%% conditional-compilation branches each define `worker/4` — the analyzer said
%% 208 and 219 (the `-define(` lines) where the name is on 209 and 220.
-module(line_owner_er3).
-export([go/0]).

-define(
   plain_macro,
   1).

-define(FUNNY(X),
   {X, ?plain_macro}).

-record(
   spread,
   {f}).

-type
   spread_type() :: integer().

go() ->
    {?FUNNY(1), #spread{}, spread_type()}.
