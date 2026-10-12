import { join } from "node:path";
import { createFixtureAdminDatabase } from "../src/lib/admin/db.ts";
import { fixtureCheckoutSql } from "../src/data/fixtures/checkout-seed.ts";
if(process.env.APP_MODE!=="fixture")throw new Error("Fixture setup requires APP_MODE=fixture.");
const db=await createFixtureAdminDatabase(process.env.FIXTURE_DB_DIR??join(process.cwd(),".fixture/database"));
try{await db.exec(fixtureCheckoutSql);console.log("Prepared labelled fixture warehouse, parcel compatibility and zero sample tax only where configuration was absent. No provider calls.");}finally{await db.close();}
