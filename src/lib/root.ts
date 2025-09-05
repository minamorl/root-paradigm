import { Root, rewrite, Patch } from "../../packages/core/src";

const law = { enforce: (p: Patch) => p };

export function makeRoot(): Root {
  return new Root(rewrite, law);
}

