/* #916: a BARE macro between a type and its declarator.
 *
 * Every shape below is taken from the measured sqlite sites, not invented. The
 * macros are deliberately NOT defined here — in the real files they come from
 * headers (sqlite3.h), and the parse is the same either way.
 *
 * The four sub-classes, each with its own control on the next line:
 *   A  static BtShared *SQLITE_WSD sqlite3SharedCacheList = 0;   src/btree.c:87
 *   B  static void SQLITE_NOINLINE btreeLockCarefully(Btree *p);  src/btmutex.c:53
 *   C  SQLITE_API void (SQLITE_CDECL *sqlite3IoTrace)(...)=0;     src/main.c:138
 *   D  JNIEXPORT void JNICALL                                     ext/jni/.../sqlite3-jni.c:6244
 *      Java_...(JniArgsEnvClass){ ... }
 *
 * The shaping rule for the controls: a control must be the SAME declaration with
 * the macro removed, so a fix that simply dropped the enclosing construct would
 * fail here. `helper_defined` and `helperTarget` exist so the D body has a call
 * to attribute — pre-fix that call was attributed to FILE SCOPE, because the
 * function it belongs to did not exist.
 */

typedef struct BtShared BtShared;
typedef struct Btree Btree;
typedef struct JniArgsEnvClass JniArgsEnvClass;

void helperTarget(void);

/* A: a file-scope OBJECT whose declarator the macro truncates away. */
static BtShared *SQLITE_WSD sqlite3SharedCacheList = 0;
static BtShared *plainControl = 0;

/* B: a PROTOTYPE whose declarator is truncation collateral. */
static void SQLITE_NOINLINE btreeLockCarefully(Btree *p);
static void plainProto(Btree *p);

/* C: a function POINTER with the macro INSIDE the declarator — here the phantom
 * took the real symbol's place rather than merely accompanying it. */
SQLITE_API void (SQLITE_CDECL *sqlite3IoTrace)(const char*, ...) = 0;
void (*plainTrace)(const char*, ...) = 0;

/* D: a macro-decorated DEFINITION whose return type the truncation ate — the
 * node arrives with the NAME in its type field and the PARAMETER LIST in its
 * declarator. */
JNIEXPORT void JNICALL
Java_entry(JniArgsEnvClass)
{
  helperTarget();
}

JNIEXPORT void plainEntry(int x)
{
  helperTarget();
  (void)x;
}

void helper_defined(void)
{
  sqlite3SharedCacheList = 0;
  btreeLockCarefully(0);
  plainTrace = plainTrace;
}
