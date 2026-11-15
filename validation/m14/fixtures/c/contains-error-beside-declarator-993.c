/* #993: an ERROR node is not a declarator, and a name read out of one is not a member.
 *
 * Found by the D4 whole-repo differential arm on sqlite (the lane's own oracle
 * over 315 .c files): the analyzer published
 *
 *     contains sqlite3_kvvfs_methods -> sqlite3_vfs      src/os_kv.c:341
 *     contains sqlite3_kvvfs_methods -> sqlite3_io_methods  :342
 *     contains sqlite3_kvvfs_methods -> sqlite3_io_methods  :343
 *
 * BESIDE the real members `pVfs`, `pIoDb`, `pIoJrnl`. The source is
 *
 *     MAYBE_CONST sqlite3_vfs * pVfs;
 *
 * where MAYBE_CONST is a file macro the parser cannot see, so recovery parses
 *
 *     field_declaration
 *       type_identifier "MAYBE_CONST"        <- unknown macro read as a type
 *       ERROR "sqlite3_vfs"                  <- the REAL TYPE, displaced
 *         field_identifier "sqlite3_vfs"
 *       pointer_declarator "* pVfs"          <- the real declarator
 *
 * The member walk treats every child that is not a known type/punctuation node as
 * a DECLARATOR, so it descended into the ERROR and published the TYPE as a member.
 * That is the #932/#985/#990 fabrication family, on the one walk that did not
 * carry the file's own "never read a declared name out of an ERROR" rule.
 *
 * The real members must survive: a fix that dropped every child beside an ERROR
 * would lose pVfs/pIoDb/pIoJrnl, which are the whole point of the struct.
 */
#define MAYBE_CONST const

struct kvvfs_methods {
  const int nBufferSize;
  MAYBE_CONST sqlite3_vfs * pVfs;
  MAYBE_CONST sqlite3_io_methods *pIoDb;
  MAYBE_CONST sqlite3_io_methods *pIoJrnl;
};
