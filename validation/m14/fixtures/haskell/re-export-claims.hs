-- HSA4 — A RE-EXPORT NAMES A DEPENDENCY THE MODULE DOES NOT DECLARE.
--
-- `module M (intercalate, …)` re-exports a name imported from elsewhere. The export row's target is
-- the bare name, and when no corpus file declares it the row said NOTHING about where it comes from.
-- MEASURED over the whole population: 985 unresolved `exports` rows.
--
-- The claim is the same bare `externalTarget` HSA1 uses and is safe for the same reason — the arbiter
-- consults a claim only where the name model has nothing, so a re-export of a PROJECT name keeps its
-- resolved answer. The guard is the file's own declaration table plus the module's own name.
--
-- The twin is `declared`: exported from this module, so it must carry no claim.

module ReExportClaims (declared, intercalate) where

import Data.List (intercalate)

declared :: Int
declared = 1

usesImported :: [String] -> String
usesImported = intercalate ","
