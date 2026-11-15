module Math where

add :: Int -> Int -> Int
add a b = a + b

factorial :: Int -> Int
factorial 0 = 1
factorial n = n * factorial (n - 1)
