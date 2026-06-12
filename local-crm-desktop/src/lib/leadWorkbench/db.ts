import type { DatabaseLike } from '../db';
import { LEAD_WORKBENCH_INDEX_SQL, LEAD_WORKBENCH_TABLE_SQL } from './schema';

export async function ensureLeadWorkbenchSchema(db: DatabaseLike): Promise<void> {
  for (const sql of LEAD_WORKBENCH_TABLE_SQL) {
    await db.execute(sql);
  }

  for (const sql of LEAD_WORKBENCH_INDEX_SQL) {
    await db.execute(sql);
  }
}
