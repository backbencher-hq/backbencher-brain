%% Pins ER-D32's EDGE half, which is a different bug from its ownership half and
%% was found by the corpus rather than by a fixture.
%%
%% Ownership already fell back to the file path (fragment-er3). `currentSource`, the
%% function every file-scope EDGE reads its source from, fell back to the module name
%% alone — and a module-less file has no module name, so the source was `undefined`
%% and `pushRel` silently dropped the edge.
%%
%% The shape is otp/lib/stdlib/test/epp_SUITE_data/mac2.erl: no `-module`, no
%% function anywhere, four `-define` blocks and one expression that USES them at
%% file scope. There is no enclosing declaration for such a use to hang off, which is
%% the only reason the hole existed.
%%
%% The pre-fix output published the four macro constants and their four `contains`
%% edges — it said the macros EXIST — and then published nothing that said they are
%% USED. The worst possible half of a dependency.
-define(ONE, 1).
-define(TWO, 2).

{?ONE, ?TWO}.
