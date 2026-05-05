import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCliArgs } from './submit-claims-batch.js';

test('parseCliArgs accepts a positive processing limit', () => {
  const parsed = parseCliArgs([
    '--from',
    '2026-05-01',
    '--to',
    '2026-05-03',
    '--portal-targets',
    'FULLERTON',
    '--limit',
    '3',
  ]);

  assert.equal(parsed.limit, 3);
});

test('parseCliArgs rejects a non-positive processing limit', () => {
  assert.throws(
    () => parseCliArgs(['--from', '2026-05-01', '--to', '2026-05-03', '--limit', '0']),
    /Invalid --limit value/
  );
});
