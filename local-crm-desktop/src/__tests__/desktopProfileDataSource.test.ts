import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  __setDesktopDataSourceCommandInvokeForTests,
  createDesktopProfile,
  createSelectedProfileDatabase,
  getDesktopDataSource,
  listDesktopProfiles,
  selectDesktopProfile,
} from '../lib/desktopDataSource';
import {
  __setDatabaseLoaderForTests,
  __setDbInstanceForTests,
  getDb,
} from '../lib/db';

afterEach(() => {
  __setDesktopDataSourceCommandInvokeForTests(null);
  __setDatabaseLoaderForTests(null);
  __setDbInstanceForTests(null);
});

describe('desktop profile data source boundary', () => {
  it('keeps an absent Desktop selection on LEGACY for first-upgrade compatibility', async () => {
    await expect(getDesktopDataSource()).resolves.toEqual({ mode: 'LEGACY' });
  });

  it('sends only profileName while creating or selecting a Desktop profile', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    __setDesktopDataSourceCommandInvokeForTests(async (command, args) => {
      calls.push({ command, args });
      if (command === 'desktop_list_profiles') return ['demo'];
      if (command === 'desktop_data_source_status') return { mode: 'LEGACY' };
      return { mode: 'PROFILE', profileName: 'demo' };
    });

    await expect(listDesktopProfiles()).resolves.toEqual(['demo']);
    await expect(createDesktopProfile('demo')).resolves.toEqual({ mode: 'PROFILE', profileName: 'demo' });
    await expect(selectDesktopProfile('demo')).resolves.toEqual({ mode: 'PROFILE', profileName: 'demo' });

    expect(calls).toEqual([
      { command: 'desktop_list_profiles', args: {} },
      { command: 'desktop_create_profile', args: { profileName: 'demo' } },
      { command: 'desktop_select_profile', args: { profileName: 'demo' } },
    ]);
    for (const { args } of calls) {
      expect(args).not.toHaveProperty('dbPath');
      expect(args).not.toHaveProperty('databasePath');
      expect(args).not.toHaveProperty('sqliteUri');
      expect(args).not.toHaveProperty('file');
    }
  });

  it('routes all PROFILE getDb initialization and queries through Rust without a legacy fallback', async () => {
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    __setDesktopDataSourceCommandInvokeForTests(async (command, args) => {
      calls.push({ command, args });
      if (command === 'desktop_data_source_status') return { mode: 'PROFILE', profileName: 'demo' };
      if (command === 'desktop_profile_database_execute') return { rowsAffected: 1 };
      if (command === 'desktop_profile_database_select') return [];
      throw new Error(`unexpected command ${command}`);
    });

    const db = await getDb();
    await expect(db.select('SELECT id FROM customers WHERE name = ?', ['广州星河科技'])).resolves.toEqual([]);

    expect(calls[0]).toEqual({ command: 'desktop_data_source_status', args: {} });
    expect(calls.some(call => call.command === 'desktop_profile_database_execute')).toBe(true);
    expect(calls.at(-1)).toEqual({
      command: 'desktop_profile_database_select',
      args: { sql: 'SELECT id FROM customers WHERE name = ?', bindings: ['广州星河科技'] },
    });
    for (const { command, args } of calls) {
      expect(command).not.toContain('personal-crm');
      expect(JSON.stringify(args)).not.toContain('personal-crm');
      expect(JSON.stringify(args)).not.toContain('sqlite:');
    }
  });

  it('fails closed if a selected profile cannot open, even when the test memory fallback is enabled', async () => {
    const calls: string[] = [];
    __setDesktopDataSourceCommandInvokeForTests(async (command) => {
      calls.push(command);
      if (command === 'desktop_data_source_status') return { mode: 'PROFILE', profileName: 'demo' };
      if (command === 'desktop_profile_database_execute') throw new Error('profile database unavailable');
      throw new Error(`unexpected command ${command}`);
    });

    await expect(getDb()).rejects.toThrow('数据库初始化失败: profile database unavailable');
    expect(calls).toEqual(['desktop_data_source_status', 'desktop_profile_database_execute']);
  });

  it('keeps the profile database bridge pathless after selection', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'desktop_profile_database_execute') return { rowsAffected: 3 };
      return [{ id: 'customer-1' }];
    });
    __setDesktopDataSourceCommandInvokeForTests(invoke);
    const db = createSelectedProfileDatabase();

    await expect(db.execute('UPDATE customers SET name = ? WHERE id = ?', ['广州星河科技', 'customer-1']))
      .resolves.toEqual({ rowsAffected: 3 });
    await expect(db.select<{ id: string }>('SELECT id FROM customers')).resolves.toEqual([{ id: 'customer-1' }]);

    expect(invoke).toHaveBeenNthCalledWith(1, 'desktop_profile_database_execute', {
      sql: 'UPDATE customers SET name = ? WHERE id = ?',
      bindings: ['广州星河科技', 'customer-1'],
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'desktop_profile_database_select', {
      sql: 'SELECT id FROM customers',
      bindings: [],
    });
  });

  it('keeps profile selection metadata and backup/restore routing out of the legacy business database', () => {
    const repoRoot = resolve(import.meta.dirname, '../..');
    const adapter = readFileSync(resolve(repoRoot, 'src/lib/desktopDataSource.ts'), 'utf8');
    const lifecycle = readFileSync(resolve(repoRoot, 'src-tauri/src/crm_lifecycle.rs'), 'utf8');
    const settings = readFileSync(resolve(repoRoot, 'src/pages/SettingsPage.tsx'), 'utf8');

    expect(adapter).not.toContain('sqlite:');
    expect(adapter).not.toContain('dbPath');
    expect(adapter).toContain("'desktop_data_source_status'");
    expect(lifecycle).toContain('desktop_profile::resolve_active_database_path');
    expect(lifecycle).not.toContain('personal-crm.db');
    expect(settings).toContain('Desktop Profile 数据源');
    expect(settings).toContain('创建并切换');
    expect(settings).not.toContain('accept=".sqlite"');
    expect(settings).not.toContain('accept=".exe"');
  });
});
