(ns clj.fixture.tostring)

(defn helper [x] x)

(defrecord Impl [x]
  Object
  (toString [this] (helper this)))
