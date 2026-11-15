module Service

import StdEnv
import qualified Data.Map as M

// A record type with fields — type + property symbols.
:: User = { name :: String, age :: Int }

// A plain ADT with multiple constructors.
:: OrderBook = Book [Int] [Int]
:: Side = Bid | Ask

// A class with one method — interface + method symbols.
class Serializable a where
    serialize :: a -> String

// An instance: implements edge + method.
instance Serializable User where
    serialize u = u.name

// Module-level functions: calls with forward references and qualified targets.
addBid :: OrderBook Int -> OrderBook
addBid (Book bids asks) price = Book [price : bids] asks

submitOrder :: OrderBook Int -> String
submitOrder book price = describe (addBid book price)

lookupUser :: (M.Map String User) String -> Maybe User
lookupUser db key = M.lookup key db

// Constructor application in body position -> instantiates.
makeUser :: String Int -> User
makeUser n a = User n a

// Self-recursion and mutual recursion are real calls.
countDown :: Int -> Int
countDown n = if (n <= 0) 0 (1 + countDown (n - 1))

mutualA :: Int -> Int
mutualA n = mutualB (n - 1)

mutualB :: Int -> Int
mutualB n = if (n <= 0) 0 (mutualA (n - 1))

describe :: OrderBook -> String
describe book = toString (length (bids book))
where
    bids (Book bs _) = bs
