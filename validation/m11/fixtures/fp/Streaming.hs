module Streaming
  ( Stream
  , run
  , pipe
  , mapS
  ) where

import Data.List (foldl')
import Data.Maybe (fromMaybe)

data Stream a = Stream { run :: IO a, buffer :: [a] } deriving (Show, Eq)

newtype Sink a = Sink { feed :: a -> IO () }

class Semigroup s => Mergeable s where
  merge :: s -> s -> s

instance Mergeable (Stream a) where
  merge (Stream io1 _) (Stream io2 _) = Stream (io1 >> io2) []

pipe :: (a -> b) -> Stream a -> Stream b
pipe f (Stream io buf) = Stream io (map f buf)

mapS :: (a -> b) -> Stream a -> Stream b
mapS f stream = pipe f stream

foldS :: (b -> a -> b) -> b -> Stream a -> IO b
foldS step init stream = foldl' step init <$> run stream

consume :: Sink a -> Stream a -> IO ()
consume (Sink feedFn) (Stream io _) = do
  value <- io
  feedFn value

lookupDefault :: (Eq k) => v -> k -> [(k, v)] -> v
lookupDefault fallback key pairs = fromMaybe fallback (lookup key pairs)
  where lookup _ [] = Nothing
        lookup k ((k', v) : rest)
          | k == k' = Just v
          | otherwise = lookup k rest

classify :: Int -> String
classify n
  | n < 0 = "negative"
  | n == 0 = "zero"
  | otherwise = "positive"

data Tree a = Leaf | Node (Tree a) a (Tree a)

depth :: Tree a -> Int
depth Leaf = 0
depth (Node l _ r) = 1 + max (depth l) (depth r)
