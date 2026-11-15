# Managed-OO payload fixture (ruby wave). Pins the analyzer's relationship
# + payload surface on real Ruby architecture: modules as namespaces, class
# inheritance, module mixins (include/extend), attr accessors, instance-var
# member READS (uses - writes excluded), calls (builtin-filtered), per-symbol
# complexity, and evidence tiers.

require File.expand_path("../helper", __FILE__)

# GAD2 twin pin (groovy wave): top-level edges share ONE sentinel ("Global")
# across all edge kinds. The require below adds a second references edge whose
# source MUST be "Global" (the pre-fix analyzer emitted "root" here).
require "rake/tasklib"

# Top-level member call on a constant receiver (RHS of an assignment):
# tree-sitter parses `File.expand_path(...)` as a `call` under `assignment`;
# the analyzer must still surface it even at program level.
DEFAULT_GATEWAY = File.expand_path("gateway")

module Payments
  class Gateway
    attr_reader :name

    def initialize(name)
      @name = name
    end

    def charge(amount)
      raise ArgumentError, "amount must be positive" if amount <= 0
      amount
    end
  end

  class BaseService
    def health
      "ok"
    end
  end

  class Service < BaseService
    include Loggable

    MAX_RETRIES = 3

    attr_accessor :balance

    def initialize(gateway)
      @gateway = gateway
      @balance = 0.0
    end

    def authorize(amount)
      return false if amount <= 0
      return false if amount > @balance
      retries = 0
      while retries < MAX_RETRIES
        retries += 1
      end
      @balance -= amount
      amount > 0 && @balance >= 0
    end

    def refund(amount)
      @balance += amount
      log("refund #{amount}")
      true
    end

    def self.create(name)
      new(Gateway.new(name))
    end
  end

  module Loggable
    def log(message)
      puts message
    end
  end

  class OrderService
    include Loggable

    def process(order)
      log("processing #{order}")
      service = Service.create("main")
      service.authorize(10.0)
    end

    # Ruby 3 pattern matching (RUBYG1): `in [a, b]` binds a/b as LOCALS of
    # the match scope — the analyzer must NOT emit calls:a / calls:b either
    # in the pattern or in the match body.
    def unpack(pair)
      case pair
      in [a, b]
        a + b
      else
        0
      end
    end

    # Hash destructure: `{amount:}` binds amount; `{code:, details: msg}`
    # binds code and msg.
    def amount_of(result)
      case result
      in {amount:}
        amount
      in {code:, details: msg}
        log(msg)
        0
      end
    end
  end
end

# F6 coverage (2026-09-02): the long tail of handled_verified ruby node types,
# probe-verified against the pinned grammar. Waves 1-9 consolidated.
class F6Base
  def initialize(total = 0, *rest, label: "x", **opts, &blk)
    @total = total
    @@registry ||= []
    $f6_global = :ok
    @@registry << label
    blk&.call(opts["k"])
  end

  def self.registry
    @@registry
  end

  class << self
    def singleton_helper
      F6Base::registry.size
    end
  end

  def process(items)
    items.each_with_index do |(item, idx), _|
      @total += item.to_i * idx
    rescue StandardError => e
      warn(e.message)
    end
    items.map { |x| x }
    items.each { yield if block_given? }
    lambda { |a, b = 2, *c, d:, e: 5, **f, &g| [a, b, c, d, e, f, g] }
    ->(x) { x ** 2 }
  end

  def flow(flags)
    result = []
    for flag in flags do
      result << flag
    end
    unless result.empty?
      result << :unless
    end
    result << :modifier unless flags.empty?
    while flags.any?
      flags.pop
      break if result.size > 3
      next if flags.size == 2
    end
    until flags.empty?
      flags.pop
    end
    flags.each { result << :while_mod } while flags.any?
    begin
      result << :begin
    ensure
      result << :ensure
    end
    case result.size
    when 1, 2 then result << :when
    when Integer then result << :int_case
    else result << :else
    end
    result
  end
end

module F6Literals
  SYMS = [:bare, :"delimited space"]
  IARR = %i[sym1 sym2]
  SARR = %w[w1 w2]
  HSH = { a: 1, "b" => 2, c: 3.5 }
  NILV = nil
  RGX = /f6-[a-z]+/i
  RNG = (1..10)
  CHR = ?a
  CMPLX = 1i
  RATNL = 1r
  CHAIN = "chain1" \
          "chain2"
  BARE_STR = <<~HEREDOC.upcase
    heredoc line one
    line two #{SYMS.first}
  HEREDOC
  SUBOUT = `echo hi`

  def self.dump(src)
    pairs = { key => val }
    cond = src.nil? ? :nil_case : :some
    op = (src || "") + ""
    alias my_dump dump
    puts "#{SYMS.first}\n\t"
    [RNG, CHR, CMPLX, RATNL, CHAIN, BARE_STR, SUBOUT, pairs, cond, op, NILV]
  end
end

class F6Patterns
  def match_all(value)
    case value
    in [Integer => whole, *rest] if whole > 0
      whole
    in { name: String => n, **everything }
      n
    in String | Symbol => tagged
      tagged
    in { status: "ok" } if !value.nil?
      :ok
    in Array[a, *] then a
    else
      :none
    end
  end

  # F6: Ruby 3.1 one-line rightward pattern match (`subject => pattern`)
  # — the pinned grammar's ONLY clean parse shape for match_pattern
  # (multi-line `case/in` parses as in_clause, bare `1 => x` at top level).
  def destructure_payload(payload)
    payload => { host:, port: }
    [host, port]
  end
end

class F6Wave3 < F6Base
  def old_api(*a, **k, &blk)
    a.each { |x| blk&.call(x) }
  end

  def forward_them(...)
    old_api(...)
  end

  def splat_call(*args, **kw)
    old_api(*args, **kw)
    old_api(1, 2, b: 3)
  end

  def block_caller
    yielder { |x| x }
    yielder do |y|
      y
    end
  end

  def yielder
    yield 1 if block_given?
  end

  def setter=(value)
    @value = value
  end

  def check(flags)
    if flags.nil?
      :nil
    elsif flags.empty?
      :empty
    else
      :full
    end
  end

  def super_things(x)
    super
    super(x)
    super()
  end

  def misc
    right, left = [1, 2]
    starred = [3, 4]
    _lead, *mid = starred
    a_val, = starred
    :ok until false
    :rescued rescue nil
    op_result = 2 ** 3
    [right, left, starred, mid, a_val, op_result]
  end
end

class F6Wave8
  BOUND = 5

  def pin_tops(v, other)
    x = 1
    case v
    in ^x
      :pinned_local
    in ^other
      :pinned_param
    else
      :none
    end
  end

  def ops(a, b)
    [a + b, a - b, a * b, a / b, a % b, a**b, -a, +b, !a, ~b, a & b, a | b, a ^ b, a << 1, a >> 1, a == b, a != b, a < b]
  end
end

# F6 final wave (2026-09-02): the last 14 shapes, probe-verified.
class F6Final
  def self.scope_recv
    ::F6Base.new
  end

  def blk_arg(items, &blk)
    items.each(&blk)
  end

  def assign_shapes(src)
    right, left = src
    (g_one, g_two) = src
    [right, left, g_one, g_two]
  end

  def loop_labels
    catch(:done) do
      loop do
        redo if false
        retry if false
        throw(:done)
      end
    end
  end

  def nil_body
    ;
  end

  def op_defs
    :ops
  end

  def +(other)
    other
  end

  def [](idx)
    idx
  end

  def guard_match(v)
    case v
    in x unless x.nil?
      x
    in [*, y, *] => all_items
      all_items
    in (Integer | String) => pv
      pv
    else
      nil
    end
  end

  undef nil_body if false
end

# F6 closure (2026-09-02): the last three shapes, probe-verified.
class F6Closure
  def multi_rhs
    r, l = 1, 2
    [r, l]
  end

  def expr_pin(v)
    probe = 7
    case v
    in ^(probe)
      :matched
    else
      :none
    end
  end
end
