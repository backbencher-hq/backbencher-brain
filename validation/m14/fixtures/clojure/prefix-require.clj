(ns clj.fixture.prefixreq
  (:require [clj.fixture.prefix
             [alpha :as a]
             [beta :as b]]))

(defn go [] (a/one))
