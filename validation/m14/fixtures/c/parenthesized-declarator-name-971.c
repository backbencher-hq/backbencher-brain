/* #971: a parenthesised declarator name is a DECLARATION, not a read of itself.

   Wrapping a declarator in parentheses is legal C and means nothing but grouping
   (`6.7.6.3` — parentheses around a declarator change no semantics), yet the
   grammar gives the grouping its own node, so the name sits under
   `parenthesized_declarator`:

     void (grouped_name)(int n) { return n + 1; }

   parses as

     function_definition
       primitive_type      "void"
       function_declarator
         parenthesized_declarator
           identifier "grouped_name"     <- the DECLARED name
         parameter_list     "(int n)"
       compound_statement  "{ return n + 1; }"

   Before #971 `parenthesized_declarator` was missing from the declaration-parent
   list, so the declared name was classified as a READ of itself and published as
   `uses global -> grouped_name` -- while the very same occurrence also emitted
   the `grouped_name` function symbol. The edge was both wrong (a declaration is
   not a read) and redundant.

   Measured: 109 spurious `uses` edges removed across the 2,498-file corpus.

   The three declarations below are the shapes that must stay silent. The reads
   that follow them are the control: a genuine read of the same names inside the
   bodies must STILL be published, or the fix has simply moved the gate. */

int (grouped_scalar)(int n);
int (*(grouped_pointer))(int n);
void (grouped_void_return)(void);

/* Reads of the declared names: these ARE value reads and must survive. */
int uses_the_names(void) {
    int total = grouped_scalar(1);
    int (*fp)(int) = grouped_pointer;
    total += fp(2);
    grouped_void_return();
    return total;
}

/* A parenthesised name on a PROTOTYPE is the same shape as on a definition --
   measured in the corpus at redis/deps/lua/src/lauxlib.c:229

     LUALIB_API void (luaL_register) (lua_State *L, const char *libname, ...);

   which fabricated `uses global -> luaL_register` from the declaration heading. */
int (prototyped)(int a, int b);