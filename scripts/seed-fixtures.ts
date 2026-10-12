import { readEnvironment } from "../src/config/env.ts";
import { createFixtureSeedSql } from "../src/data/fixtures/seed-sql.ts";

// This command only writes guarded SQL to stdout. No credentials or remote calls.
try {
  process.stdout.write(createFixtureSeedSql(readEnvironment().APP_MODE));
} catch {
  process.stderr.write("Fixture SQL generation refused: use explicit fixture/test mode and an isolated test database.\n");
  process.exitCode = 1;
}
