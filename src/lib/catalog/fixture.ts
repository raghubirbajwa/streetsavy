import "server-only";
import { fixtureCatalogSeedRows } from "../../data/fixtures/catalog.ts";
import { projectPublicCatalog } from "./projection.ts";
import { createCatalogRepository } from "./repository.ts";

export const fixtureCatalogSnapshot = projectPublicCatalog(fixtureCatalogSeedRows);
export const fixtureCatalogRepository = createCatalogRepository(fixtureCatalogSnapshot);
