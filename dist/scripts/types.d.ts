type Counter = string | number;
interface Measurement {
  coreStatus: string;
  rpmMilli: number;
  speedMmPerSecond: number;
  distanceMm: Counter;
  cumulativeWorkUnits: Counter;
  observedAt: string;
  staleAfterSeconds: number;
  counterEpoch: string;
  provenance: string;
  freshness: string;
}
interface StatusData {
  measurement: Measurement;
  builder: { anchor: { blockHeight: Counter; blockProgress: Counter; workPerThousandBlocks: Counter } };
  oracle: { state: string };
  settlementQueue: { state: string };
  signer: { kind: string; algorithm: string; keySlot: string; lastVerifiedAt: string };
  modules: { instanceId: string; moduleType: string; driverId: string; state: string }[];
}
interface ChainEvent {
  id?: string;
  eventName?: string;
  name?: string;
  blockNumber: Counter;
  transactionHash: string;
  blockTimestamp: Counter;
  logIndex?: Counter;
  roundId?: Counter;
  args?: Record<string, Counter>;
  arguments?: { name: string; value: Counter }[];
}
interface CoreData {
  core: { blockHeight: Counter; cumulativeWork: Counter; settledThroughRound: Counter; paused: boolean };
  configuration: { roundDuration: Counter; genesisTimestamp: Counter };
  events: ChainEvent[];
}
interface EconomyData {
  identities: Record<string, unknown>;
  supply: { liveSupplyBaseUnits?: Counter; totalMintedBaseUnits?: Counter };
  mining: { fundedBlocks?: Counter; processedThroughRound?: Counter };
  asset?: { symbol: string; decimals: number };
}
type Endpoint = 'status' | 'core' | 'economy';
interface Feed {
  status: StatusData | null;
  core: CoreData | null;
  economy: EconomyData | null;
  fetchedAt: Record<Endpoint, number>;
  errors: Record<Endpoint, string | null>;
  attemptedAt: number;
  sequence: number;
  pending: boolean;
}
interface OverlayOptions {
  side: 'left' | 'right'; scale: number; theme: 'dark' | 'light'; accent: string;
  hideWhenIdle: boolean; circumferenceMm: number;
}
