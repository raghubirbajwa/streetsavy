# Open the M6 fixture project in Cursor

Extract this ZIP and open the `clothing-store` folder in Cursor.
Use Node.js 22.16+; Node 24.20.0 and npm 11.19.0 were used for verification.

In Cursor's terminal, from this folder:

```sh
cp .env.example .env.local
npm ci --ignore-scripts --no-audit --no-fund
APP_MODE=fixture npm run prepare:m5
npm run build
npm start
```

Copy the environment example only on a fresh extraction; do not overwrite an existing environment file. Keep APP_MODE=fixture and leave provider secrets unset.
Open http://localhost:3000. At /admin/login, choose Demo owner or Demo staff.
The preparation command creates local demonstration data, including a 14-day sample return policy. Run one app process per fixture database.

This archive includes code, tests, migrations, assets, the lockfile and documentation through M6. It excludes installed dependencies, build output, private environment files, local runtime databases/sessions/uploads and review screenshots. They are not required to recreate a fresh fixture preview. Source fixture seeds and public fixture assets are included.

See M6_READINESS.md and M6_BLOCKED_INPUTS.md for verification results and outstanding gates. The final suite passed 122 tests. Hosted accounts, browser/device checks, approved client content and infrastructure remain blocked. Nothing was deployed. Historical workspace log/localhost links in the milestone notes refer to the original review machine and are not bundled here.
