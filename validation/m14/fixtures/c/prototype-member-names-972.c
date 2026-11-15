/* #972: the analyzer's name maps must not inherit Object.prototype.

   Four records keyed by arbitrary C identifiers -- structs, globalVars, unions,
   enums -- were plain `{}`. Every lookup of a name that happens to be an
   Object.prototype member therefore returned a truthy INHERITED value:

     structs["constructor"] === Object          -> truthy
     structs["toString"]     === function       -> truthy
     globalVars["valueOf"]   === function       -> truthy

   `isResolvableUseTarget` ends with a plain truthiness test over all four, so any
   identifier with such a name passed the resolvability gate and got published as a
   `uses` edge whether or not anything in the file declared it. `constructor` is the
   rare name; `toString` and `valueOf` are ORDINARY C identifiers, so this is a live
   class rather than a curiosity.

   Measured, zig/lib/libc/mingw/winpthreads/thread.c:92

     static void __attribute__((constructor))
     ctor (void)

   `constructor` is a gcc attribute token declared NOWHERE, and the analyzer
   published `uses ctor -> constructor` -- a dangling edge to a name with no symbol,
   the same defect class #962 was created to remove. The diagnostic that identified
   it: all four maps claimed the name at once (globalVars=true structs=true
   unions=true enums=true), which is the signature of an inherited lookup rather than
   a declaration.

   Every name below is an Object.prototype member, so every read of one used to
   resolve. Each must now be silent -- and the two controls must still publish, or
   the fix has simply broken resolution. */

int toString(int n);
int valueOf(int n);
int hasOwnProperty(int n);
int propertyIsEnumerable(int n);
int isPrototypeOf(int n);

static int real_global = 7;
static int real_function(int n) { return n; }

/* CONTROLS: ordinary names, declared normally. These MUST keep their edges -- a fix
   that made the maps refuse to answer would pass every case above by refusing to
   answer anything. */
int controls(void) {
    int total = toString(1);
    total += valueOf(2);
    total = real_global;          /* a genuine read of a file-scope variable */
    total += real_function(3);    /* a genuine call */
    return total;
}

/* The corpus shape itself: a gcc attribute token that is not, and never was, a name. */
static void __attribute__((constructor))
attributed_init(void)
{
    real_global = 1;
}