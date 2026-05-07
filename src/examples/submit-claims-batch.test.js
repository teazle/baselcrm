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

test('parseCliArgs accepts the explicit shadow-fill alias', () => {
  const parsed = parseCliArgs(['--from', '2026-05-01', '--shadow-fill']);

  assert.equal(parsed.mode, 'fill_evidence');
});

test('parseCliArgs blocks draft mode by default', () => {
  assert.throws(
    () => parseCliArgs(['--from', '2026-05-01', '--to', '2026-05-03', '--mode', 'draft']),
    /locked to fill_evidence/
  );
});

test('parseCliArgs blocks submit mode by default before portal interaction', () => {
  assert.throws(
    () => parseCliArgs(['--from', '2026-05-01', '--mode', 'submit']),
    /locked to fill_evidence/
  );
});

test('parseCliArgs blocks deprecated save-as-draft alias by default', () => {
  assert.throws(
    () => parseCliArgs(['--from', '2026-05-01', '--save-as-draft']),
    /locked to fill_evidence/
  );
});

test('parseCliArgs blocks ec2-only shadow fill without EC2 marker', () => {
  const previous = process.env.FLOW3_EC2_RUNNER;
  delete process.env.FLOW3_EC2_RUNNER;
  try {
    assert.throws(
      () => parseCliArgs(['--from', '2026-05-01', '--shadow-fill', '--ec2-only']),
      /FLOW3_EC2_RUNNER=1/
    );
  } finally {
    if (previous === undefined) delete process.env.FLOW3_EC2_RUNNER;
    else process.env.FLOW3_EC2_RUNNER = previous;
  }
});

test('parseCliArgs allows ec2-only shadow fill with EC2 marker', () => {
  const previous = process.env.FLOW3_EC2_RUNNER;
  process.env.FLOW3_EC2_RUNNER = '1';
  try {
    const parsed = parseCliArgs(['--from', '2026-05-01', '--shadow-fill', '--ec2-only']);
    assert.equal(parsed.mode, 'fill_evidence');
    assert.equal(parsed.ec2Only, true);
  } finally {
    if (previous === undefined) delete process.env.FLOW3_EC2_RUNNER;
    else process.env.FLOW3_EC2_RUNNER = previous;
  }
});
