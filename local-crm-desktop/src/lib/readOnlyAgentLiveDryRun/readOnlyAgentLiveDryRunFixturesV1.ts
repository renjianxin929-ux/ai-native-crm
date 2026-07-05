import type { LoadedReadOnlyAgentSnapshot } from '../readOnlySnapshotLoaderReadiness';
import type { ReadOnlyAgentLiveDryRunRequest } from '../readOnlyAgentLiveDryRunReadiness';
import {
  buildAdapterTestLoadedSnapshotV1,
  buildAdapterTestPiiPollutedLoadedSnapshotV1,
} from '../readOnlyAgentSnapshotAdapter/readOnlyAgentSnapshotAdapterFixturesV1';

export function buildLiveDryRunLoadedSnapshotFixtureV1(): LoadedReadOnlyAgentSnapshot {
  const snapshot = rewriteLoadedSnapshotIds(buildAdapterTestLoadedSnapshotV1());
  return tuneForAllReadOnlyAgentIntents(snapshot);
}

export function buildLiveDryRunPiiPollutedLoadedSnapshotFixtureV1(): LoadedReadOnlyAgentSnapshot {
  const snapshot = rewriteLoadedSnapshotIds(buildAdapterTestPiiPollutedLoadedSnapshotV1());
  return tuneForAllReadOnlyAgentIntents(snapshot);
}

export function buildLiveDryRunRequestFixtureV1(
  overrides: Partial<ReadOnlyAgentLiveDryRunRequest> = {},
): ReadOnlyAgentLiveDryRunRequest {
  const loadedSnapshot = overrides.loaded_snapshot ?? buildLiveDryRunLoadedSnapshotFixtureV1();

  return {
    kind: 'READ_ONLY_AGENT_LIVE_DRY_RUN_REQUEST',
    version: 'v1',
    request_id: 'LIVE_DRY_RUN_TEST_REQUEST_A',
    intent: 'evidence_for_customer',
    loaded_snapshot: loadedSnapshot,
    context: loadedSnapshot.context,
    target_customer_id: 'LIVE_DRY_RUN_TEST_CUSTOMER_A',
    target_work_item_id: 'LIVE_DRY_RUN_TEST_WORK_ITEM_A',
    ...overrides,
  };
}

function rewriteLoadedSnapshotIds(snapshot: LoadedReadOnlyAgentSnapshot): LoadedReadOnlyAgentSnapshot {
  const rewritten = JSON.parse(
    JSON.stringify(snapshot)
      .replaceAll('LOADER_TEST_', 'LIVE_DRY_RUN_TEST_')
      .replaceAll('ADAPTER_TEST_', 'LIVE_DRY_RUN_TEST_ADAPTER_')
      .replaceAll('Loader Test', 'Live Dry Run Test')
      .replaceAll('Adapter replay summary', 'Live dry-run replay summary')
      .replaceAll('Adapter capture summary', 'Live dry-run capture summary'),
  ) as LoadedReadOnlyAgentSnapshot;
  return {
    ...rewritten,
    snapshot_id: 'LIVE_DRY_RUN_TEST_SNAPSHOT_A',
    context: {
      active_profile_id: 'LIVE_DRY_RUN_TEST_PROFILE',
      now: '2026-07-05T09:00:00.000Z',
    },
  };
}

function tuneForAllReadOnlyAgentIntents(snapshot: LoadedReadOnlyAgentSnapshot): LoadedReadOnlyAgentSnapshot {
  return {
    ...snapshot,
    work_items: snapshot.work_items.map(item => (
      item.id === 'LIVE_DRY_RUN_TEST_WORK_ITEM_A'
        ? { ...item, updated_at: '2026-06-28T00:00:00.000Z' }
        : item
    )),
    replay_evidence: snapshot.replay_evidence.map(item => (
      item.id === 'LIVE_DRY_RUN_TEST_SYNC_LOG_A'
        ? { ...item, status: 'FAILED', message: 'Live dry-run failed replay evidence' }
        : item
    )),
  };
}
