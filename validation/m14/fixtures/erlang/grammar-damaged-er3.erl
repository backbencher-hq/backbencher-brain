%% Pins the WHOLE-FILE GRAMMAR DAMAGE boundary: a file with NO recoverable
%% declaration of any kind yields NO symbols and NO relationships, and says why
%% through its error count.
%%
%% The shape is real, not invented. wx's `api_gen` sources are code-GENERATION
%% TEMPLATES whose body is markup — `<<EXPORT:SortItems sortItems/2 SortItems:EXPORT>>`
%% — which the Erlang grammar cannot read at all. otp/lib/wx/api_gen/wx_extra/
%% wxListCtrl.erl comes back with 32 top-level ERROR nodes, loose `call`/`atom`/
%% `ann_type` fragments between them, and not one `fun_decl` in the file.
%%
%% Every edge recoverable from those fragments is fabricated. Before this ruling,
%% and only because ER-D32's file-path fallback stopped `currentSource` returning
%% undefined, the analyzer emitted `calls wxe_util:get_cbId@31` and thirty more from
%% the wreckage — lines and nesting that are whatever error recovery happened to
%% produce, pointing at structure the source does not have. The corpus dual lens
%% caught it as 55 analyzer-only edges.
%%
%% The boundary is deliberately narrow, and the negative half is the point: a file
%% with no functions and no `-module` but with `-define` blocks IS derived normally.
%% `epp_SUITE_data/mac2.erl` is exactly that — four `-define`s and one
%% `-plupp({?p, ?'p', ?P, ?'P'})`, no module, no function — and it yields four macro
%% constants, four `contains` edges AND the four file-scope macro references.
%% modname-unresolvable-er3 and fragment-er3 pin that side of the same line.
<<EXPORT:not_a_function not_a_function/0 not_a_function:EXPORT>>

not_a_function() ->
    some_module:some_function(1, 2).
