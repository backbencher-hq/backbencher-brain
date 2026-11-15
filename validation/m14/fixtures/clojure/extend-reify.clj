(ns clj.fixture.extend
  (:require [clj.fixture.protos :as p]))

(defprotocol Ext (ex [this]))

(extend-protocol Ext
  String
  (ex [_] "s"))

(reify Ext
  (ex [_] nil))

(defn build []
  (reify p/Ext
    (ex [_] :built)))
