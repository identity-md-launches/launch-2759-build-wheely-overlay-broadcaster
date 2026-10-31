// Synthetic telemetry used only by tests; never copied into the production export.
export const AT = Date.parse('2026-10-31T00:00:00Z');
export function status(overrides = {}) {
  return {
    measurement: { coreStatus: 'RUNNING', rpmMilli: 120000, speedMmPerSecond: 200, distanceMm: '4710', cumulativeWorkUnits: '100', observedAt: new Date(AT).toISOString(), staleAfterSeconds: 20, counterEpoch: 'test-epoch-a', provenance: 'test-fixture', freshness: 'online', ...overrides },
    builder: { anchor: { blockHeight: '1000', blockProgress: '250000000', workPerThousandBlocks: '10000' } },
    oracle: { state: 'accepted' }, settlementQueue: { state: 'submitted' },
    signer: { kind: 'test-signer', algorithm: 'test-algorithm', keySlot: 'test-slot', lastVerifiedAt: new Date(AT).toISOString() },
    modules: [{ instanceId: 'wheel', moduleType: 'wheel.counter', driverId: 'test-driver', state: 'ready' }]
  };
}
export function core(events = []) {
  return { core: { blockHeight: '1000', cumulativeWork: '100', settledThroughRound: '9', paused: false }, configuration: { genesisTimestamp: String(AT / 1000 - 6000), roundDuration: '600' }, events };
}
export function economy() {
  return { identities: { core: 'test-identity' }, supply: { liveSupplyBaseUnits: '12345000000000000000000' }, mining: { fundedBlocks: '1000' }, asset: { decimals: 18, symbol: 'TEST' } };
}
export function feed(s = status(), c = core(), sequence = 1, at = AT) {
  return { status: s, core: c, economy: economy(), fetchedAt: { status: at, core: at, economy: at }, errors: { status: null, core: null, economy: null }, sequence, attemptedAt: at, pending: false };
}
export function event(eventName = 'BatchSettled', id = 'test-event-1', roundId = '10') {
  return { id, eventName, blockNumber: '1010', transactionHash: 'test-transaction', logIndex: id, blockTimestamp: String(AT / 1000), arguments: [{ name: eventName === 'RoundRecorded' ? 'roundId' : 'settledThroughRound', value: roundId }] };
}
