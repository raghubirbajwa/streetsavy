# M1 catalog fixtures

`catalog.ts` contains the sixteen original demo products and eleven ordered collections from `docs/spec/CONTENT.md`. All amounts are integer paise; all 110 variants have explicit stock with `reserved = 0`. UUIDv5 keys and timestamps are fixed. No fixture data is created at application startup or written to a provider.

The seed includes one sold-out size on product 1, entirely sold-out product 7, the ₹1,699–₹1,799 price range on product 12, and one image on product 15. `longTitleDevelopmentProduct` is a separate wrapping fixture; it does not replace the initial product title. No material claims, discounts, tax rates, real measurements, business addresses or support identity are invented. Demo weights come from the content specification; size guides remain absent until approved measurements are supplied.

`src/lib/catalog/fixture.ts` projects these rows into the same strict public DTO as `public.public_catalog()`. It removes drafts, archived products, disabled variants, unpublished media and inactive categories/collections. Availability is `on_hand > reserved`; exact counts, SKU, weights, tax keys and media staging data remain private.

The neutral local PNGs and their replacement requirements are documented in `public/fixtures/catalog/README.md`. No image represents an actual garment or colour. They have not been uploaded to R2.

To **generate** opt-in SQL, from the project root run:

```sh
node --experimental-strip-types --conditions=react-server --env-file=.env.local scripts/seed-fixtures.ts > fixture-seed.sql
```

This command emits SQL only and refuses `APP_MODE=live`. Apply it only to a fresh isolated fixture/test database after reviewing its target. The SQL additionally requires the database session's `app.environment` to be `fixture` or `test`, rejects existing products/orders, uses a transaction, and has no destructive reset/upsert. Setting the session label is an operator declaration, not proof that an arbitrary remote database is isolated. The automated local database harness creates its own disposable database and uses this same seed function.

Seed generation makes no provider or database connection and is never imported by an application startup mutation path.
