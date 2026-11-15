module Stats

import StdEnv

:: Vec = { x :: Int, y :: Int, z :: Int }

class Summarize a where
    summarize :: a -> Int

instance Summarize Vec where
    summarize v = sum v

sum :: Vec -> Int
sum v = v.x + v.y + v.z

mkVec :: Int -> Vec
mkVec n = { x = n, y = n, z = n }

scale :: Int -> Vec
scale f = { x = f, y = f, z = f }

mag2 :: Vec -> Int
mag2 v = v.x * v.x + v.y * v.y

twice :: (Int -> Int) -> Int -> Int
twice f x = f (f x)

describe :: Int -> String
describe n = toString n

main :: World -> World
main world = startIO world
