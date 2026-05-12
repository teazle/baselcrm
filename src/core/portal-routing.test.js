import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describePortalRouting,
  getPortalScopeOrFilter,
  normalizeFlow3PortalTarget,
  resolveFlow3PortalTarget,
} from '../../apps/crm/src/lib/rpa/portals.shared.js';

test('portal routing follows explicit Clinic Assist tags from the TPA guide', () => {
  const cases = [
    ['MHC', 'MHC'],
    ['AVIVA', 'MHC'],
    ['NTUC_IM', 'MHC'],
    ['FULLERT', 'FULLERTON'],
    ['AONCARE', 'FULLERTON'],
    ['ALL', 'IXCHANGE'],
    ['ALL_PW', 'IXCHANGE'],
    ['PARKWAY', 'IXCHANGE'],
    ['ALLIANC', 'ALLIANCE_MEDINET'],
    ['ALLSING', 'ALLIANCE_MEDINET'],
    ['AXAMED', 'ALLIANCE_MEDINET'],
    ['ALLIMED', 'ALLIANCE_MEDINET'],
    ['HSBCLIFE', 'ALLIANCE_MEDINET'],
    ['PRUDEN', 'ALLIANCE_MEDINET'],
    ['TOKIOM', 'ALLIANCE_MEDINET'],
    ['GE', 'GE_NTUC'],
    ['IHP', 'IHP'],
    ['ALLIANZ', 'ALLIANZ'],
  ];

  for (const [payType, target] of cases) {
    assert.equal(resolveFlow3PortalTarget(payType, 'Patient', null), target, payType);
    assert.equal(describePortalRouting(payType, 'Patient', null).portalTarget, target, payType);
  }
});

test('ambiguous insurer-only names do not route without an explicit CA tag', () => {
  for (const payType of ['AIA', 'SINGLIFE', 'GREAT EASTERN', 'PRUDENTIAL']) {
    const routing = describePortalRouting(payType, 'Patient', null);
    assert.equal(routing.portalTarget, null, payType);
    assert.equal(routing.reason, 'ambiguous_insurer_name');
  }
});

test('portal routing exposes source and tag metadata for submission metadata', () => {
  const routing = describePortalRouting('ALLIMED', 'Patient', null);

  assert.equal(routing.portalTarget, 'ALLIANCE_MEDINET');
  assert.equal(routing.portalTag, 'ALLIMED');
  assert.equal(routing.portalRoutingSource, 'tpa_user_interface_guide');
  assert.equal(normalizeFlow3PortalTarget('ALLIMED'), 'ALLIANCE_MEDINET');
});

test('portal scope filter includes all explicit guide tags', () => {
  const filter = getPortalScopeOrFilter();
  for (const tag of ['AONCARE', 'ALL_PW', 'HSBCLIFE', 'ALLIMED']) {
    assert.match(filter, new RegExp(tag));
  }
});
