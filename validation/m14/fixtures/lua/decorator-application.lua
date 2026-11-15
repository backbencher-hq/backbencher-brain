-- LUA DECORATES — the decorator idiom is the Python desugaring written out.
--
-- Lua has no annotation syntax, so `decorates` could have been ruled on the
-- annotation count alone (19,082 `---@` comment nodes, zero productions). It was
-- not: the whole-population census found ONE real runtime application to a
-- declaration (redis/deps/lua/test/fib.lua:39), and this fixture pins the
-- construct and every impostor the census separated from it.
--
-- FIRE — `fib = cache(fib)` at CHUNK scope:
--   `fib` is a declared function, `cache` is a declared WRAPPER FACTORY (its body
--   RETURNS a function), and the call's argument IS the name being rebound. The
--   edge is `fib -> cache` — decorated declaration to decorator — and `@cache def
--   fib` in Python compiles to exactly this sequence.
--
-- FORBID 1 — `state = normalize(state)`: a chunk-scope self-application whose
--   transform returns a VALUE. `normalize` is declared, but its body never returns
--   a function, so it is a value transform, not a decorator. This is the class the
--   census counted 185 of.
--
-- FORBID 2 — `work = cache(work)` INSIDE a body: `cache` is a wrapper factory, but
--   an in-function rebinding decorates a local, not a declaration. The census's
--   186 coarse hits are mostly this class (`value = sub(value, ...)`).
--
-- FORBID 3 — `fib2 = cache(fib)`: a chunk-scope wrapper-factory call that is not a
--   SELF-application. The decorated name must be the call's argument; `fib2` is
--   wrapped with `fib`'s value, so no edge between `fib2` and `cache` exists.

function fib(n)
  if n < 2 then return n end
  return fib(n - 1) + fib(n - 2)
end

-- A WRAPPER FACTORY: takes a function and returns a wrapper function. The
-- returned `function_definition` is the structural evidence the next line is a
-- decoration and not a value transform.
function cache(f)
  local stored = {}
  return function(x)
    local hit = stored[x]
    if not hit then
      hit = f(x)
      stored[x] = hit
    end
    return hit
  end
end

-- THE DECORATION SITE.
fib = cache(fib)

-- FORBID 1: the transform returns a value, not a function.
local state = {}
function normalize(t)
  return t
end
state = normalize(state)

-- FORBID 2: a wrapper factory applied INSIDE a body — decorates a local, not a declaration.
function install()
  local function work(x)
    return x
  end
  work = cache(work)
  return work
end

-- FORBID 3: a chunk-scope call that is not a self-application.
function fib2(n)
  return n
end
fib2 = cache(fib)

return { fib = fib, install = install }
