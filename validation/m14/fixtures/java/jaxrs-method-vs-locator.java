package proof;

import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;

@Path("/root")
class Resource {
    @Path("/sub")
    Object locator() { return new Object(); }

    @GET @Path("/ready")
    String ready() { return "ok"; }

    @GET
    String root() { return "ok"; }
}
