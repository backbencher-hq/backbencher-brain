// Tool registry — imports all tool modules to register them
// Each tool module calls registerTool() on import

import "./read-tools.js"

// Write tools will be imported in M7:
// import "./write-tools.js"

export { getTools } from "../server.js"
