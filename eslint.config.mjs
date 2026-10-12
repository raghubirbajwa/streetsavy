import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  // Omitted rest-object fields and underscore-prefixed interface parameters are intentional.
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }] } },
  globalIgnores(['.next/**', '.fixture/**', 'review/**', 'next-env.d.ts', 'src/lib/supabase/database.types.ts']),
]);
