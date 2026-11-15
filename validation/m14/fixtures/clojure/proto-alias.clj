(ns clj.fixture.protoalias
  (:require [clj.fixture.proto :as toString]
            [clj.fixture.other :as valueOf]))

(defn f [] (toString/helper))

(defn g [] (valueOf/other))
