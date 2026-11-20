import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

// Only the documented result is expected to fail. Setup errors and any other
// results still fail CI. Set CRATEFLOW_STRICT_REGRESSIONS=1 to see plain failures.
export function assertRegression(test, actual, expected, { knownResult, reason }) {
  if (process.env.CRATEFLOW_STRICT_REGRESSIONS !== '1' && isDeepStrictEqual(actual, knownResult)) {
    test.todo(reason);
  }
  assert.deepEqual(actual, expected);
}
