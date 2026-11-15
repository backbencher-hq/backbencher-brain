/*
** task-152: THE EXPORT ATTRIBUTE BEHIND A PREPROCESSOR GUARD.
**
** `sqlite/src/test_loadext.c:94-98` writes the Windows export boundary the way the whole C world
** writes it --
**     #ifdef _WIN32
**     __declspec(dllexport)
**     #endif
**     int testloadext_init(sqlite3 *db, ...) { ... }
** -- and the analyzer published NOTHING for it. The marker is in no node: the grammar keeps only
** `#ifdef` / `_WIN32` / `#endif` inside the `preproc_ifdef` (measured on that file), and
** `engine.ts` blanks `__declspec(…)` out of the text the PARSER sees, space for space, so the
** preproc block's own node text carries 21 spaces where the marker is.
**
** TWO ROWS MUST COME OUT of the guarded forms below, and `plain_internal` must produce NONE -- the
** unguarded control is what fails if the adjacency rule is ever loosened.
*/

#ifdef _WIN32
__declspec(dllexport)
#endif
int guarded_entry(void)
{
  return 0;
}

#ifdef _WIN32
__declspec(dllexport)
#endif
void guarded_prototype(void);

/* THE CONTROL: a plain declaration with no guard and no attribute. Exporting this would be the
   false positive the adjacency rule exists to prevent. */
int plain_internal(void)
{
  return 1;
}
