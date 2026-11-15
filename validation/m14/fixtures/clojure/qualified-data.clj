(ns clj.fixture.qdata
  (:require [clojure.core :as c]))

(defn f []
  (clojure.core/quote (fab1))
  (c/comment (fab2))
  (c/quote (fab3)))
