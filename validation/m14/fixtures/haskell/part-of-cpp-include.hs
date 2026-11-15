-- Fixture: part_of from a CPP `#include` — Haskell's one textual file inclusion.
--
-- Haskell has no textual include of its own: `import Module` is a MODULE LOAD
-- (it creates binding scope and is resolvable as `Module.item`), which is the
-- OPPOSITE of a fragment. Under `{-# LANGUAGE CPP #-}` the C preprocessor's
-- `#include "x.h"` splices the named file's text into this module BEFORE
-- parsing, it shares this module's single scope, and it has no module identity
-- — exactly the `part_of` contract. `cpp` is a named node type of the served
-- grammar, so this is R3 on an existing node and no grammar change is needed.
--
-- THE TARGET IS THE PART'S MODULE SYMBOL (the file STEM), and the written path
-- is kept in `metadata.partPath`: the arbiter resolves target strings against
-- symbol NAMES and has no space for a path, while the contract permits either
-- ("the part's file OR ITS MODULE SYMBOL").
--
-- FIRE (two rows, one per specifier shape):
--   1. `#include "MachDeps.h"`  -> part_of to `MachDeps`, partPath "MachDeps.h".
--   2. `#include "Local/WidgetConfig.h"` -> part_of to `WidgetConfig` (the
--      DIRECTORY is stripped: the stem is the symbol), partPath keeps the path.
--
-- FORBID (each is an impostor the census measured in the real corpus):
--   A. a STRING-BUILT directive line `["#include \"" ++ hdr ++ "\""]` — the
--      text of a directive inside a string is data, not a directive.
--   B. the `-#include` GHC FLAG as a string literal.
--   C. a Haddock comment mentioning the flag (`@ghc -#include@`).
--   D. a JSON quasiquote carrying the text `#include <unix.h>` — quasiquote
--      bodies are opaque text, so an angle include there is not a directive.

{-# LANGUAGE CPP #-}
{-# LANGUAGE QuasiQuotes #-}

module PartOfIncludes
  ( dirs
  , flags
  , payload
  ) where

-- FIRE (1) and (2): real preprocessor directives naming part files.
#include "MachDeps.h"
#include "Local/WidgetConfig.h"

-- FORBID (A): building a directive line in a string.
dirs :: [String]
dirs = ["#include \"" ++ header ++ "\"" | header <- headers]

headers :: [String]
headers = ["A.h", "B.h"]

-- FORBID (B): the ghc flag as a string literal.
flags :: [String]
flags = ["-#include", "--make"]

-- FORBID (C): a Haddock mention of the flag — @ghc -#include@ is prose.
--
-- FORBID (D): a quasiquote body carrying the text of an include.
payload :: String
payload = [json|{"file":"#include <unix.h>"}|]
