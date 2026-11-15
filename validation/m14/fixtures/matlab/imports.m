% Import directives are COMMAND statements in MATLAB, not function calls.
% The name after `import` is a name-resolution target, never a call site.
function imports()
    import mypkg.f
    import mypkg.*
    import helper
    clear all
end
