# frozen_string_literal: true

# M14 master-review wave (2026-09): pins the analyzer contracts that were
# either violated or missing before this wave, all verified on rake + rack at
# 100%/0/0.
#
# RUBD12: hash/argument PAIR VALUES are real expressions — `{ key: fetch_key }`
# (colon), `{ pair => fetch_val }` (rocket), `store.write(cache: build_entry)`
# (keyword argument) must surface their method calls. Previously the `pair`
# skip-parent suppressed every one on BOTH the analyzer and the oracle — a
# shared blind spot F5 cannot see. Local values (`{ z: local_val }`) stay
# silent.
class StatelessHelper
  def compute
    local_val = 1
    opts = { key: fetch_key, pair => fetch_val, z: local_val }
    store.write(cache: build_entry)
  end

  def fetch_key
    :k
  end

  def fetch_val
    1
  end

  def build_entry
    { status: "ok" }
  end
end

# Dynamic superclass (call expression): RB-C ruling — NO extends edge to the
# expression text; the `Struct.new` declaration-time call DOES surface as an
# instantiation of Struct.
class Tuple < Struct.new(:a, :b)
end

# Static superclass: extends is emitted.
class Base
end

class Child < Base
end

# Keyword `alias` at declaration scope is the twin of alias_method (RB-E
# contract): the alias name becomes a callable member — calls:copy with
# aliasedTo: original.
class Api
  alias copy original

  def original
    true
  end
end

# RUBD14 (rake helper.rb shape): the superclass is EXTERNAL but leaf-
# collapses to the declaring class's own leaf (`class Rake::TestCase <
# Test::Unit::TestCase`). A class can never extend itself — the override pass
# must NOT fabricate VERIFIED (0.95) self-overrides for its methods; only the
# honest 0.5 first-parent guess may exist.
class Parser::Tok < Tok
  def read
  end
end

# Reopen identity (RUBD13): `class M::Inner` in this file must carry the SAME
# symbol identity as the nested declaration above it (name Inner, owner M), so
# cross-file reopen spellings unify instead of fragmenting the graph into
# `Inner@M` + bare `M::Inner`.
module M
  class Inner
    def go
    end
  end
end

class M::Inner
  def stop
  end
end
