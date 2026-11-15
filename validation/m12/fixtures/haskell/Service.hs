module Service
  ( User
  , OrderBook
  , addBid
  , submitOrder
  , lookupUser
  ) where

import qualified Data.Map as M
import Data.List (foldl')

-- A record type with fields, deriving standard classes.
data User = User { name :: String, age :: Int } deriving (Show, Eq)

-- A plain ADT with multiple constructors.
data OrderBook = OrderBook { bids :: [Int], asks :: [Int] }
data Side = Bid | Ask

-- A typeclass with one method.
class Serializable a where
  serialize :: a -> String

-- An instance: implements edge + method.
instance Serializable User where
  serialize u = name u

-- Module-level functions: calls with forward references and qualified targets.
addBid :: OrderBook -> Int -> OrderBook
addBid book price = book { bids = price : bids book }

submitOrder :: OrderBook -> Int -> String
submitOrder book price = describe (addBid book price)

lookupUser :: M.Map String User -> String -> Maybe User
lookupUser db key = M.lookup key db

sumBids :: OrderBook -> Int
sumBids book = foldl' (+) 0 (bids book)

-- Constructor application in body position → instantiates.
makeUser :: String -> Int -> User
makeUser n a = User n a

-- Self-recursion and mutual recursion are real calls.
countDown :: Int -> Int
countDown n = if n <= 0 then 0 else 1 + countDown (n - 1)

mutualA :: Int -> Int
mutualA n = mutualB (n - 1)

mutualB :: Int -> Int
mutualB n = if n <= 0 then 0 else mutualA (n - 1)

describe :: OrderBook -> String
describe book = "bids=" ++ show (length (bids book))
