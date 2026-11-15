% A +pkg FOLDER is MATLAB's namespace mechanism: this file's function is part
% of the mypkg package, and the module exports it under the qualified name.
function r = pkgfunc(x)
    r = x * 2;
end
