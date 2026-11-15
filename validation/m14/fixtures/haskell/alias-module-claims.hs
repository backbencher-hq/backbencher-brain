-- HSA2 — A QUALIFIED CALL NAMES ITS MODULE THROUGH THE ALIAS.
--
-- `T.toUpper` is `Data.Text.toUpper`, and the file itself says so: `import qualified Data.Text as T`.
-- Before this rule the row was a bare dotted target with NO reading at all — 25,131 unresolved
-- `calls` over the population, led by `Schema.column` 562 · `Fixture.fixture` 423 · `T.unpack` 336.
--
-- The claim is the fleet's `moduleNamespace`, verified against the PROJECT'S MODULE PATHS (the full
-- path, not the root), and it is fail-closed: a module the project carries demotes to `ext?` and can
-- never refute. MEASURED with the full-path verifier: unresolved 34,038 -> 9,231, verified 27,522 ->
-- 38,872, ext? 13,524, refuted 0.
--
-- The twin is the LOCAL call: `shout` is declared here, so it must carry no claim.

module AliasClaims where

import qualified Data.Text as T
import qualified Data.List as L

shout :: T.Text -> T.Text
shout t = T.toUpper t

sortIt :: [Int] -> [Int]
sortIt xs = L.sort xs

twice :: Int -> Int
twice n = shoutLocal n + shoutLocal n
  where
    shoutLocal x = x + 1

-- TWIN — a call to a function THIS MODULE declares carries no claim.
useLocal :: Int -> Int
useLocal n = twice n

-- HSA6/HSA7/HSA11 — every qualified name in these shapes names its module through the alias.
import qualified Data.Aeson as J
import           Data.Text (Text)

data Payload = Payload Text deriving (J.ToJSON)

type Nickname = T.Text

mkPayload :: Text -> Payload
mkPayload t = Payload t

-- HSA9 — a superclass the module does not declare.
class Show a => Sortable a where
  sortKey :: a -> Int

-- HSA6 — a constructor reached through an alias.
asJson :: T.Text -> J.Value
asJson t = J.String t
