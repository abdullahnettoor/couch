// The Worker entry. Only a default export here: workerd treats named exports as entrypoints.
// The logic (and what it does and does not store) is in demand.ts.
import { handle } from "./demand.ts";

export default { fetch: handle };
