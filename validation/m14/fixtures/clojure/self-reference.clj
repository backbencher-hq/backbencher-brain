(ns clj.fixture.selfref
  (:require [clj.fixture.selfref :as self]))

(defn go [] (clj.fixture.selfref/helper 1))
