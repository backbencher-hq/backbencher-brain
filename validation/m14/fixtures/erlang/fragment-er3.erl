%% An INCLUDE FRAGMENT, not a module: the `-module` line is commented out,
%% exactly as OTP's own merl examples are written ("Tests - for including in
%% another module"). Pinned because the 400-file corpus draw found that a
%% module-less file is a real, recurring shape — and because the honest owner of
%% its members is then the only identity the file has: the path. Fabricating a
%% module name here would invent a module that does not exist.
-define(FRAGMENT_MACRO, ok).

fragment_helper(X) ->
    {?FRAGMENT_MACRO, X}.
