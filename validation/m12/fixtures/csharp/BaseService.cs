using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace Example.Base;

public abstract class BaseService<T> : IRepository<T> where T : BaseService.Entity
{
    protected readonly string prefix = "base";

    public abstract string Format(string value);

    public virtual Task<T> Save(T value)
    {
        return Task.FromResult(value);
    }

    public List<T> FindAll()
    {
        return FindByFilter(null);
    }

    private List<T> FindByFilter(string filter)
    {
        return new List<T>();
    }

    public interface Entity
    {
        string GetId();
        string GetName();
    }
}
