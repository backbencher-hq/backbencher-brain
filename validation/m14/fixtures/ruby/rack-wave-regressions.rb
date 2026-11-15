# frozen_string_literal: true

# RB-A: `Class.new { ... }.new` — the outer `.new` has an expression (block)
# receiver, an ANONYMOUS instantiation. No `calls:new` junk may be emitted
# (rack spec_lock.rb wave: three Global -> new fabrications).
instance = Class.new {
  def initialize; @close_called = false; end
}.new

# RB-B: default-argument VALUE expressions run in the method's scope at call
# time and are real call sites (rack wave: mutex = Mutex.new,
# params = Rack::Utils.default_query_parser, app = @app).
class LockLike
  def initialize(app, mutex = Mutex.new)
    @app = app
    @mutex = mutex
  end

  def context(env, app = @app)
    app.call(env)
  end
end

# RB-C: `class X < Struct.new(...)` — the superclass expression constructs the
# base class, so the `Struct.new` call surfaces as an instantiation of Struct
# (rack directory.rb wave: DirectoryBody).
class BodyLike < Struct.new(:root, :path, :files)
end

# RB-D: spec-DSL member reads with no enclosing def belong to the file-level
# owner (Global) — rack spec_media_type.rb wave (@content_type/@empty_hash).
describe "media" do
  before do
    @empty_hash = {}
  end

  it "reads state" do
    @content_type = "text/html"
    @content_type + @empty_hash.inspect
  end
end

# RB-E: alias_method makes the alias name a callable member of the class —
# calls:local_path with aliasedTo metadata (rack uploaded_file.rb wave).
class UploadedLike
  attr_accessor :original_filename

  alias_method :local_path, :original_filename
end
