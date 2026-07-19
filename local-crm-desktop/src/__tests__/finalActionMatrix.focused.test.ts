import { describe, expect, it } from 'vitest';
import { FINAL_ACTION_MATRIX_SCENARIOS } from '../lib/salesAgentTools/finalActionMatrix';

describe('final-action-matrix', () => {
  it('binds each of the 44 release scenarios to the real Tauri runner and full acceptance layers', () => {
    expect(FINAL_ACTION_MATRIX_SCENARIOS).toHaveLength(44);
    expect(new Set(FINAL_ACTION_MATRIX_SCENARIOS.map(item => item.scenario_id)).size).toBe(FINAL_ACTION_MATRIX_SCENARIOS.length);
    expect(FINAL_ACTION_MATRIX_SCENARIOS.every(item => item.runner_id === 'real_tauri_e2e')).toBe(true);
    expect(FINAL_ACTION_MATRIX_SCENARIOS.every(item => item.acceptance_layers.includes('real_tauri_ui'))).toBe(true);
    expect(FINAL_ACTION_MATRIX_SCENARIOS.every(item => item.acceptance_layers.includes('controller'))).toBe(true);
    expect(FINAL_ACTION_MATRIX_SCENARIOS.every(item => item.acceptance_layers.includes('repository'))).toBe(true);
    expect(FINAL_ACTION_MATRIX_SCENARIOS.map(item => item.scenario_id)).toEqual(
      Array.from({ length: 44 }, (_, index) => `FAM-${String(index + 1).padStart(3, '0')}`),
    );
  });
});
