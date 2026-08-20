# API extraction verification

The NestJS API owns the HTTP compatibility boundary. Root-owned database
integration tests retain persistence coverage without importing framework
handlers into the storefront project.

## Transitional-handler assertion parity

| Removed direct-handler assertion | Retained replacement |
| --- | --- |
| Catalogue count and physical-copy mapping | `tests/integration/titles.test.ts`; complete HTTP payload in `apps/api-e2e/src/titles.spec.ts` |
| Rental creation status and summary | `tests/integration/rentals.test.ts`; 201 contract in `apps/api-e2e/src/rentals.spec.ts` |
| Active-rental listing | `tests/integration/rentals.test.ts`; exact HTTP contract in `apps/api-e2e/src/rentals.spec.ts` |
| Return persistence and restored availability | `tests/integration/rentals.test.ts`; HTTP return flow in `apps/api-e2e/src/rentals.spec.ts` |
| Unknown-title response | Database result in `tests/integration/rentals.test.ts`; 404 envelope in `apps/api-e2e/src/rentals.spec.ts` |
| No available copy | Database result in `tests/integration/rentals.test.ts`; 409 envelope in `apps/api-e2e/src/rentals.spec.ts` |
| Unknown rental | Database result in `tests/integration/rentals.test.ts`; 404 envelope in `apps/api-e2e/src/rentals.spec.ts` |
| Repeated return | Database result in `tests/integration/rentals.test.ts`; 409 envelope in `apps/api-e2e/src/rentals.spec.ts` |

The API HTTP suite additionally retains validation, malformed-JSON, detail,
and CORS behavior that the removed handlers did not exercise directly.

## Contract contraction gate

Title responses expose grouped `availability` for current consumers and retain
the deprecated flat copy-count fields for deployed consumers. The flat fields
may be removed only after deployment inventory or telemetry proves that no
supported old consumer remains. A source-code migration alone is not evidence
that deployed consumers have disappeared.
