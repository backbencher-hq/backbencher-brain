% References are names read WITHOUT being invoked: a function handle (@name)
% and a metaclass object (?Name). The handle of a locally declared function is
% provable, so its evidence class is structural; a name the file cannot resolve
% stays inferred.
function references()
    h = @helper;
    q = ?Widget;
    p = @pkg.f;
    helper();
end

function y = helper()
    y = 1;
end
