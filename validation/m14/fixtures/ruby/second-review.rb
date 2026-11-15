# RB-F..RB-J (ruby second review): constructs the first review missed
# because lanes agree by silence (uses uncompared nowhere here — every
# label below IS compared) or by shared junk.
#
# RB-F: endless method bodies are walked (`def fetch = client.get` was
# entirely invisible while the oracle derived calls->get).
def double(x) = x * 2

class Client
  def fetch = @client.get
end

# RB-G: `defined?` is unevaluated and `undef` names removals — neither
# reads nor calls (`defined?(other)` leaked calls->other; `defined?(@cfg)`
# would leak uses->@cfg; `undef helper` leaked calls->helper).
class Probe
  def check(x)
    return 1 if defined?(Limit)
    return 2 if defined?(other)
    return 3 if defined?(@cfg)
    undef helper
    0
  end
end
end

# RB-H: attr string names declare properties (`attr_reader "name"` was
# dropped; only simple_symbol args registered).
class Account
  attr_reader "name", :age

  def label = name
end

# RB-I: dynamic class creation defines navigable types (`Point =
# Struct.new` left no symbol; callers of Point.new resolved against
# nothing).
Point = Struct.new(:x, :y)
Cfg = Data.define(:host, :port)

# RB-J: autoload records the file it loads (`autoload :JsonParser,
# "json/parser"` recorded nothing at all).
autoload :JsonParser, "json/parser"

# RB-K: nested singleton defs — the def NAME never reads (name-field
# match, not positional: receivers precede it), a bound local receiver
# never reads, an instance-variable receiver does (`def @cfg.memo`
# evaluates @cfg at definition time).
class Watcher
  def hook(obj)
    def obj.cached
      1
    end
    def @cfg.memo
      2
    end
    obj
  end
end
