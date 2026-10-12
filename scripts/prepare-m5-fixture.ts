import { join } from 'node:path';
import { createFixtureAdminDatabase } from '../src/lib/admin/db.ts';
import { fixtureCheckoutSql } from '../src/data/fixtures/checkout-seed.ts';

// Explicit, local sample policy for M5 review only. This is not a business policy
// or hosted seed. Stop the server using this embedded database before running.
if (process.env.APP_MODE !== 'fixture') throw new Error('M5 fixture setup requires APP_MODE=fixture.');
const db = await createFixtureAdminDatabase(process.env.FIXTURE_DB_DIR ?? join(process.cwd(), '.fixture/database'));
try {
  await db.exec(fixtureCheckoutSql);
  await db.exec(`update public.store_settings set value=jsonb_set(value,'{returnWindowDays}','14'::jsonb) where key='commerce'`);
  console.log('Prepared labelled local fixture checkout and a 14-day SAMPLE return window. No provider calls; not a hosted business policy.');
} finally { await db.close(); }
