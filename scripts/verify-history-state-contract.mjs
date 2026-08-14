/**
 * Regression contract for preserving the Next.js App Router history payload.
 * Run with: node --experimental-strip-types scripts/verify-history-state-contract.mjs
 */

import assert from "node:assert/strict";
import { mergeStepHistoryState } from "../lib/history-state.ts";

const nextState = {
  __NA: true,
  __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}],
  custom: "keep-me",
};
const tagged = mergeStepHistoryState(nextState, "connect", 2);

assert.equal(tagged.__NA, true);
assert.deepEqual(tagged.__PRIVATE_NEXTJS_INTERNALS_TREE, ["", {}]);
assert.equal(tagged.custom, "keep-me");
assert.equal(tagged.rtr, true);
assert.equal(tagged.stepId, "connect");
assert.equal(tagged.depth, 2);
assert.deepEqual(mergeStepHistoryState(null, "welcome", 0), {
  rtr: true,
  stepId: "welcome",
  depth: 0,
});

console.log("history state contract: pass");
