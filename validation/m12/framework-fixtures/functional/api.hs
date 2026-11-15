{-# LANGUAGE DataKinds #-}
{-# LANGUAGE TypeOperators #-}

module Api where

import Servant
import Data.Aeson

data User = User { userId :: Int, userName :: String }

type Api = "user" :> Get '[JSON] User

server :: Server Api
server = pure (User 1 "alice")
