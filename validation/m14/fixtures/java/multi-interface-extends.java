import java.io.Serializable;
import java.lang.Cloneable;

public interface Repository extends Serializable, Cloneable {
    Object fetch(String id);
}
