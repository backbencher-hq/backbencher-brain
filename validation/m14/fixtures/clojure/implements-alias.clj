(ns clj.fixture.impl
  (:require [clj.fixture.protos :as p]))

(defrecord Impl [x]
  p/Proto
  (px [_] x))
