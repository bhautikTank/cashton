# CashTon Project Status & Architecture Ledger

Last Updated: 2026-11-19

---

## 1. Phase Status Overview

| Phase | Description | Status | Verification Summary |
|---|---|:---:|---|
| **Phase 0** | **Environment & Build Foundation** | **COMPLETED** | Next.js 16.4.6, React 19.3.0, Prisma 7.10.1, Supabase Auth (@supabase/ssr), Tailwind CSS v4 via official PostCSS plugin (`postcss.config.mjs`). Build passes cleanly. |
| **Phase 1** | **RBAC and Authorization** | **COMPLETED** | `requireAuth()`, `requireRole()`, `requireAdmin()`, server-verified `UserRole` enum (`USER`, `ADMIN`, `SUPER_ADMIN`). Verified with `/api/admin/check` (HTTP 403 for `USER`). |
| **Phase 2** | **User Profile Management** | **COMPLETED** | `GET` and `PATCH /api/users/profile`. Profile sanitization (suppresses `authUserId` and `passwordHash`). Strict single-field mutation (`name`). P2025 and controlled 500 error handling. |
| **Phase 3** | **Merchant Management** | **COMPLETED** | `Merchant` model and migration applied. Public read APIs, Admin CRUD with soft-deactivation (`isActive = false`), duplicate slug handling (409 Conflict), Zod validation, and full HTTP test suite passed. |
| **User Info & Wallet** | **Mobile, Payout, Cashback & Wallet Foundation** | **COMPLETED** | Compulsory normalized Indian mobile numbers, AES-256-GCM bank details encryption & masking, `Cashback` lifecycle tracking, `Wallet` & append-only `WalletTransaction` ledger, `GET /api/wallet/summary`, responsive dashboard UI (`/dashboard`, `/wallet`), and automated test suite. |
| **Phase 4** | **Deals & Coupons Management** | **COMPLETED** | `Deal` and `Coupon` models with migration deployed, Decimal financial precision, strict Zod validation (`dealPrice <= originalPrice`, `discountValue`, date ranges, usage limits, strict mass-assignment protection), Admin CRUD with soft-deactivation (`isActive = false`), Public listing & slug/id lookup with date validity & inactive merchant cascading suppression, and 36/36 end-to-end integration tests passed. |
| **Phase 5** | **Affiliate Tracking & Redirect Engine** | **COMPLETED** | `AffiliateClick` model and migration deployed (`20261120170000_create_affiliate_click`). CSPRNG opaque tracking IDs (`clk_...`), server-side destination resolution, open-redirect defense, rate limiting, duplicate redirect handling, and Admin analytics & summary endpoints. 33/33 integration tests passed. |
| **Phase 6** | **Affiliate Network Integration & Conversion Tracking** | **COMPLETED** | Multi-network postbacks (`FLIPKART`, `CUELINKS`, `ADMITAD`, `EARNKARO`, `GENERIC`), click attribution, `Conversion` model & migration deployed (`20261123120000_create_conversions`), idempotent deduplication (`@@unique([provider, externalTransactionId])`), lifecycle state machine, atomic wallet crediting on `CONFIRMED`, atomic reversals on `REVERSED`, UNMATCHED conversion manual reconciliation, and 41/41 tests passed. |
| **Phase 7** | **Campaign Engine & Cashback Lifecycle Completion** | **COMPLETED** | Admin Campaign CRUD, deterministic 4-level campaign selection hierarchy (Deal -> Merchant -> Network -> Global), Decimal precision & ROUND_HALF_UP rounding, immutable snapshots in Conversion records, end-to-end cashback lifecycle integration (PENDING -> APPROVED -> CONFIRMED [atomic wallet credit] -> REVERSED [atomic balance reversal]), soft-deactivation protection. 31/31 automated tests passed. |
| **Phase 8** | **Payout Processing Engine** | **PLANNED** | Admin payout queue approval workflows, batch bank transfers, and withdrawal processing. |

---

## 2. Phase: User Information, Cashback Summary & Wallet Foundation

### A. Database Migration
- **Migration Name:** `20261119110000_wallet_cashback_payout`
- **Migration Path:** `prisma/migrations/20261119110000_wallet_cashback_payout/migration.sql`
- **Deployment Status:** Successfully applied to Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com:5432`) via `npx prisma migrate deploy`.
- **Client Status:** Generated to `src/generated/prisma`.

### B. New Database Models & Extensions
1. **User Model Extension**: Added `mobileNumber String? @unique` (standardized to E.164 e.g. `+919876543210`).
2. **PayoutDetails**:
   - `userId String @unique` (1:1 with User)
   - `method PayoutMethod` (`BANK`, `UPI`)
   - `accountHolderName String?`
   - `bankName String?`
   - `accountNumberEncrypted String?` (AES-256-GCM encrypted format `iv:authTag:ciphertext`)
   - `accountNumberLast4 String?` (for masking e.g. `••••••••1234`)
   - `ifscCode String?` (validated against RBI IFSC regex format)
   - `upiId String?` (validated against VPA regex format `username@bank`)
   - `verificationStatus PayoutVerificationStatus` (`PENDING`, `VERIFIED`, `REJECTED`)
3. **Cashback**:
   - `userId String` (Relation to User)
   - `merchantId String?` (Relation to Merchant)
   - `amount Decimal(10, 2)` (Prisma Decimal, strict precision)
   - `currency String @default("INR")`
   - `status CashbackStatus` (`PENDING`, `APPROVED`, `CONFIRMED`, `REJECTED`, `REVERSED`)
   - `externalReference String?` (Network tracking transaction ID)
   - `estimatedPaymentDate DateTime?`
   - `confirmedAt DateTime?`
4. **Wallet**:
   - `userId String @unique` (1:1 with User)
   - `currency String @default("INR")`
   - `availableBalance Decimal(10, 2) @default(0.00)`
   - `lifetimeEarned Decimal(10, 2) @default(0.00)`
   - `lifetimeWithdrawn Decimal(10, 2) @default(0.00)`
5. **WalletTransaction**:
   - Append-only financial ledger.
   - `walletId String` (Relation to Wallet)
   - `amount Decimal(10, 2)` (Prisma Decimal, strict precision)
   - `type WalletTransactionType` (`CREDIT`, `DEBIT`, `REVERSAL`, `ADJUSTMENT`)
   - `category WalletTransactionCategory` (`CASHBACK_CONFIRMED`, `WITHDRAWAL`, `BONUS`, `MANUAL_CORRECTION`, `REFUND`)
   - `balanceAfter Decimal(10, 2)` (Snapshot of ledger balance post-transaction)
   - `cashbackId String? @unique` (Unique constraint ensures idempotency - single credit per cashback record)
   - `idempotencyKey String? @unique` (Protects against duplicate credit/debit operations)
   - `description String`

### C. Security & Data Protection
- **AES-256-GCM Encryption:** Bank account numbers are encrypted in application code using `crypto.createCipheriv` before database insertion. The DB only ever stores `iv:authTag:ciphertext`.
- **Encryption Key:** Configured via `PAYOUT_ENCRYPTION_KEY` environment variable (32-byte hexadecimal string) with deterministic hash fallback to protect development environments.
- **Account Masking:** API endpoints (`GET /api/users/payout-details`) and UI components never expose plaintext account numbers. Only masked representations (e.g., `••••••••1234`) are returned.
- **E.164 Mobile Normalization:** Validates 10-digit Indian numbers (`[6-9]\d{9}`) and automatically formats them as `+91XXXXXXXXXX`.
- **Financial Precision:** Floating-point numbers are strictly forbidden. All monetary math uses `Prisma.Decimal` and SQL `DECIMAL(10, 2)`.

### D. New & Updated API Endpoints
| Endpoint | Method | Access Level | Description |
|---|:---:|:---:|---|
| `/api/auth/register` | `POST` | Public | Requires compulsory `mobileNumber`. Auto-initializes user `Wallet` and handles duplicate mobile conflicts (409 Conflict). |
| `/api/users/profile` | `GET` / `PATCH` | Authenticated | Exposes and updates `mobileNumber` with E.164 normalization and unique constraint validation. |
| `/api/users/payout-details` | `GET` | Authenticated | Returns masked payout details for the authenticated user. |
| `/api/users/payout-details` | `POST` / `PATCH` | Authenticated | Creates or updates bank/UPI payout details with AES-256-GCM encryption and IFSC/UPI validation. |
| `/api/wallet` | `GET` | Authenticated | Returns user wallet record and paginated append-only transaction history ledger. |
| `/api/wallet/summary` | `GET` | Authenticated | Computes exact lifecycle totals without double-counting: `trackedCashback`, `availableBalance`, `lifetimeEarned`, `lifetimeWithdrawn`, `pendingCashback`, `approvedCashback`, `confirmedCashback`, `rejectedCashback`. |

### E. User Interface
- **`/dashboard`**: Full-featured user dashboard presenting:
  - 6 metric cards: Available Balance, Pending Cashback, Approved Cashback, Lifetime Earned, Total Withdrawn, Rejected Cashback.
  - Payout details status badge (Verified/Pending/Not configured).
  - Payout details management form supporting switching between Bank Transfer and UPI.
  - Recent wallet transaction activity ledger with credit/debit badges and balance snapshots.
- **`/wallet`**: Responsive user-friendly route navigating to wallet activity and summaries.
- **`/` (Landing Page)**: Updated with dynamic quick access to user dashboard.

---

## 3. Quality & Verification Results

| Quality Check | Command | Result |
|---|---|:---:|
| **Prisma Schema Validation** | `npx prisma validate --config prisma7.config.ts` | **PASS** (Exit 0) |
| **Prisma Client Generation** | `npx prisma generate --config prisma7.config.ts` | **PASS** (Exit 0) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS** (0 errors) |
| **ESLint Static Analysis** | `npm run lint` | **PASS** (0 errors, 0 warnings) |
| **Next.js Production Build** | `npm run build` | **PASS** (18/18 routes compiled & prerendered) |
| **Automated End-to-End Test Suite** | `node scripts/test-runner.mjs` | **PASS** (14/14 integration tests passed) |
| **Chaos & Penetration Test Suite** | `node scripts/chaos-security-tester.mjs` | **PASS** (53/53 adversarial attack scenarios passed, 100% resilience) |

### Test Suite Execution Output (`scripts/test-runner.mjs`)
- `[PASS]` Mobile number validation and E.164 normalization (`+919876543210`)
- `[PASS]` Bank account & UPI encryption (AES-256-GCM) and masking (`••••••••9012`, `te••••er@okhdfcbank`)
- `[PASS]` Strict key enforcement: PAYOUT_ENCRYPTION_KEY mandatory in production
- `[PASS]` Registration with required mobile number -> 201 Created
- `[PASS]` Duplicate mobile number registration rejection -> 409 Conflict
- `[PASS]` Login test user -> 200 OK
- `[PASS]` Profile GET & PATCH supports mobile number
- `[PASS]` Payout details storage: Encrypted in DB & Masked in API (`••••••••••1234`)
- `[PASS]` Payout details UPI method update -> 200 OK
- `[PASS]` Unauthenticated requests to wallet & payout APIs -> 401 Unauthorized
- `[PASS]` Wallet summary with zero records returns ₹0.00
- `[PASS]` Wallet calculations: Precision Decimal totals & Ledger balance (Tracked: ₹850.75, Available: ₹400.00, Paid Out: ₹100.00)
- `[PASS]` Ledger idempotency: Duplicate cashback credit rejected by unique constraint
- `[PASS]` Financial integrity: Negative wallet balance prevented atomically

### Adversarial & Chaos Testing Summary (`scripts/chaos-security-tester.mjs`)
- **Category 1 (Authentication Attacks)**: Empty payloads, missing fields, foreign numbers, malformed emails, weak passwords, SQL injection, prototype pollution, duplicate registrations, and invalid credential brute-forcing all properly rejected.
- **Category 2 (RBAC & Privilege Escalation)**: Unauthenticated and standard user access to `/api/admin/check` blocked (401/403). Client header spoofing (`X-User-Role: ADMIN`, `Authorization: fake`) completely ignored.
- **Category 3 (Profile & Mass Assignment)**: Attempts to mutate `role`, `isAdmin`, `id`, or `authUserId` rejected with 400 Bad Request via strict Zod schemas.
- **Category 4 (Merchant Security)**: Pagination limits strictly enforced ($\le 100$). Malicious `javascript:` URI schemes rejected. Inactive merchants strictly suppressed from public read routes. Soft-deactivation verified to never delete PostgreSQL rows.
- **Category 5 (Payout Details Attacks)**: Payout verification status tampering (`status: VERIFIED`) rejected. Format validation for IFSC and UPI VPAs strictly enforced. AES-256-GCM database ciphertext and API masking verified.
- **Category 6 (Financial Ledger Concurrency & Chaos)**: Decimal math verified immune to floating-point rounding errors ($10 \times 0.10 = 1.00$). Simultaneous parallel overdraft debits under high concurrency prevented atomically ($1$ won, $4$ blocked, balance preserved at ₹0.00). Double-credit race conditions blocked by database unique constraint.
- **Category 7 (Protocol & Malformed Payloads)**: Truncated JSON, array/primitive JSON roots, and 100KB string floods handled gracefully without crashing or leaking diagnostics. Database health endpoint verified.

---

## 4. Environment Variables Required

| Variable | Required In | Description |
|---|---|---|
| `DATABASE_URL` | All Environments | PostgreSQL connection string with pgbouncer/pooling. |
| `DIRECT_URL` | All Environments | Direct PostgreSQL connection string for Prisma migrations. |
| `NEXT_PUBLIC_SUPABASE_URL` | All Environments | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | All Environments | Supabase anonymous public key. |
| `PAYOUT_ENCRYPTION_KEY` | Production / Staging | 64-character hex string (32 bytes) strictly mandatory in production and staging for AES-256-GCM payout data encryption. Fails fast if missing. |
| `SMTP_*` / `RESEND_API_KEY` | Optional | For email notifications. Currently abstracted via `email.service.ts` log mock. |

---

## 4. Phase 4: Deals & Coupons Management (Backend)

### A. Database Migration
- **Migration Name:** `20261120140000_create_deals_and_coupons`
- **Migration Path:** `prisma/migrations/20261120140000_create_deals_and_coupons/migration.sql`
- **Deployment Status:** Successfully deployed to Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com:5432`) via `npx prisma migrate deploy`.
- **Client Status:** Generated to `src/generated/prisma`.

### B. New Database Models & Relations
1. **DiscountType Enum**: `PERCENTAGE`, `FIXED`.
2. **Deal Model**:
   - `id`: `String @id @default(uuid())`
   - `merchantId`: `String` (foreign key to `Merchant`, `onDelete: Cascade`)
   - `title`: `String`
   - `slug`: `String @unique` (lowercase alphanumeric with single hyphens)
   - `description`: `String?`
   - `imageUrl`: `String?` (valid HTTP/HTTPS URL)
   - `originalPrice`: `Decimal? @db.Decimal(10, 2)`
   - `dealPrice`: `Decimal? @db.Decimal(10, 2)`
   - `affiliateUrl`: `String?` (valid HTTP/HTTPS URL)
   - `startDate`: `DateTime?`
   - `endDate`: `DateTime?`
   - `isActive`: `Boolean @default(true)`
   - Timestamps: `createdAt`, `updatedAt`
   - Indexes: `[merchantId]`, `[isActive]`, `[startDate, endDate]`, `[createdAt]`
3. **Coupon Model**:
   - `id`: `String @id @default(uuid())`
   - `merchantId`: `String` (foreign key to `Merchant`, `onDelete: Cascade`)
   - `title`: `String`
   - `code`: `String` (automatically normalized to uppercase)
   - `description`: `String?`
   - `discountType`: `DiscountType` (`PERCENTAGE`, `FIXED`)
   - `discountValue`: `Decimal @db.Decimal(10, 2)`
   - `minimumPurchase`: `Decimal? @db.Decimal(10, 2)`
   - `maximumDiscount`: `Decimal? @db.Decimal(10, 2)`
   - `usageLimit`: `Int?`
   - `startDate`: `DateTime?`
   - `endDate`: `DateTime?`
   - `isActive`: `Boolean @default(true)`
   - Timestamps: `createdAt`, `updatedAt`
   - Constraints & Indexes: `@@unique([merchantId, code])`, `[code]`, `[merchantId]`, `[isActive]`, `[startDate, endDate]`, `[createdAt]`

### C. Validation & Service Rules
- **Strict Zod Schemas**: `.strict()` ensures mass-assignment attacks and unrecognized payload properties are rejected with 400 Bad Request.
- **Deal Pricing Rule**: Strictly enforces `dealPrice <= originalPrice`.
- **Discount Value Bounds**: Enforces `0 < discountValue <= 100` for `PERCENTAGE` discounts, and `discountValue > 0` for `FIXED` discounts.
- **Usage Limits**: Enforces `usageLimit >= 1` integer.
- **Date Range Sanity**: Enforces `endDate >= startDate`.
- **Public Visibility Filtering**:
  - `isActive === true` strictly required.
  - Merchant status cascade: `merchant: { isActive: true }` strictly required. Offers belonging to inactive merchants are concealed.
  - Date validity window: `(startDate === null || startDate <= now) && (endDate === null || endDate >= now)` strictly required. Expired and future offers are concealed.
  - Direct detail route (`/api/deals/[slug]` and `/api/coupons/[id]`): returns 404 for inactive, expired, future, or inactive-merchant offers.
- **Admin Full Oversight**:
  - Requires `requireAdmin()`.
  - Admin list and detail endpoints can retrieve all offers (active, inactive, expired, and future).
  - Admin `DELETE` performs soft-deactivation (`isActive = false`), never hard-deleting records.

### D. Implemented API Endpoints
| Endpoint | Method | Access Level | Description |
|---|:---:|:---:|---|
| `/api/admin/deals` | `GET` | Admin | Lists all deals (active, inactive, all date ranges) with filtering by merchant, status, and search query. |
| `/api/admin/deals` | `POST` | Admin | Creates a new store deal with strict validation and 409 conflict detection for duplicate slugs. |
| `/api/admin/deals/[id]` | `GET` | Admin | Fetches deal details for any deal by ID. |
| `/api/admin/deals/[id]` | `PATCH` | Admin | Updates deal fields with cross-field price/date sanity validation against existing values. |
| `/api/admin/deals/[id]` | `DELETE` | Admin | Soft-deactivates deal (`isActive = false`). |
| `/api/admin/coupons` | `GET` | Admin | Lists all coupons with discount type, merchant, and status filtering. |
| `/api/admin/coupons` | `POST` | Admin | Creates a new coupon with uppercase normalization and per-merchant uniqueness (409 conflict). |
| `/api/admin/coupons/[id]` | `GET` | Admin | Fetches coupon details for any coupon by ID. |
| `/api/admin/coupons/[id]` | `PATCH` | Admin | Updates coupon fields with cross-field discount sanity validation against existing values. |
| `/api/admin/coupons/[id]` | `DELETE` | Admin | Soft-deactivates coupon (`isActive = false`). |
| `/api/deals` | `GET` | Public | Lists active, current deals from active merchants. Supports pagination, search, merchant filter, and sorting. |
| `/api/deals/[slug]` | `GET` | Public | Retrieves active, unexpired deal by unique slug with active merchant. Returns 404 for expired/inactive. |
| `/api/coupons` | `GET` | Public | Lists active, current coupons from active merchants. Supports pagination, search, discountType, and sorting. |
| `/api/coupons/[id]` | `GET` | Public | Retrieves active, unexpired coupon by ID with active merchant. Returns 404 for expired/inactive. |

---

## 5. Quality & Verification Results

| Quality Check | Command | Result |
|---|---|:---:|
| **Prisma Schema Validation** | `npx prisma validate --config prisma7.config.ts` | **PASS** (Exit 0) |
| **Prisma Client Generation** | `npx prisma generate --config prisma7.config.ts` | **PASS** (Exit 0) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS** (0 errors) |
| **ESLint Static Analysis** | `npm run lint` | **PASS** (0 errors, 0 warnings) |
| **Next.js Production Build** | `npx next build --webpack` | **PASS** (22/22 routes compiled & verified) |
| **Phase 4 End-to-End Suite** | `node scripts/test-phase4.mjs` | **PASS** (36/36 tests passed, 100%) |
| **Wallet & Cashback Regression Suite** | `node scripts/test-runner.mjs` | **PASS** (15/15 tests passed, 100%) |
| **Adversarial & Chaos Security Suite** | `node scripts/chaos-security-tester.mjs` | **PASS** (55/55 scenarios passed, 100% resilience) |

---

## 5. Phase 5: Affiliate Click Tracking & Secure Redirect Engine (Backend Only)

### A. Database Migration
- **Migration Name:** `20261120170000_create_affiliate_click`
- **Migration Path:** `prisma/migrations/20261120170000_create_affiliate_click/migration.sql`
- **Deployment Status:** Successfully deployed to Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com:5432`) via `npx prisma migrate deploy`.
- **Client Status:** Generated to `src/generated/prisma`.

### B. New Database Models & Enums
1. **ClickStatus Enum**: `TRACKED`, `REDIRECTED`, `FAILED`.
2. **AffiliateClick Model**:
   - `id`: `String @id @default(uuid())`
   - `clickId`: `String @unique` (CSPRNG 192-bit entropy opaque token with `clk_` prefix)
   - `userId`: `String?` (Relation to `User`, `onDelete: SetNull` to preserve historical clicks upon user account deletion)
   - `dealId`: `String` (Relation to `Deal`, `onDelete: Cascade`)
   - `merchantId`: `String` (Relation to `Merchant`, `onDelete: Cascade`)
   - `clickedAt`: `DateTime @default(now())`
   - `source`: `String?` (Sanitized traffic source identifier, max 50 chars)
   - `landingDestination`: `String` (Server-side resolved trusted destination URL)
   - `status`: `ClickStatus @default(TRACKED)`
   - Timestamps: `createdAt`, `updatedAt`
   - Performance Indexes: `[clickId]`, `[userId, clickedAt]`, `[dealId, clickedAt]`, `[merchantId, clickedAt]`, `[status, clickedAt]`

### C. Security Controls & Architectural Guarantees
- **Opaque CSPRNG Tracking Tokens**: 24 bytes of cryptographically secure random bytes (`crypto.randomBytes(24).toString("hex")`) prefixed with `clk_`. Completely unpredictable, collision-resistant, and immune to enumeration/sequential ID guessing attacks.
- **Server-Side Attribution**: Client requests can never supply or spoof `userId`, `merchantId`, or `clickId`. User identity is extracted strictly from the verified HTTP-only Supabase session cookie (`getCurrentUser()`). Anonymous clicks have `userId: null`.
- **Zero Open-Redirect Vulnerability**: Destination URLs are resolved exclusively from trusted database fields (`Deal.affiliateUrl` or `Merchant.websiteUrl`). Query parameter redirect overrides (`?url=...`, `?dest=...`) are completely ignored.
- **Strict Protocol & Scheme Whitelisting**: Only `http:` and `https:` schemes are allowed. Unsafe schemes (`javascript:`, `data:`, `file:`, `vbscript:`, `blob:`) are rejected immediately. Malformed hostnames, whitespace, control characters, and backslashes (`\`) are blocked.
- **In-Memory Rate Limiting**: Token-bucket sliding window rate limiter protects `POST /api/deals/[slug]/click` against scraping and click-flooding (60 requests/minute per client).
- **Cache-Control & Security Headers**: Redirection responses (`GET /api/go/[clickId]`) emit `Cache-Control: no-store, no-cache, must-revalidate`, `Pragma: no-cache`, `Expires: 0`, and `X-Content-Type-Options: nosniff`.
- **Idempotent Duplicate Redirect Handling**: Re-accessing an already redirected click ID continues to redirect smoothly without throwing server errors, while preserving audit status.
- **Historical Audit Trail Integrity**: Deactivating deals or updating merchant information preserves all historical click records. User deletion cascades to `SetNull` without destroying analytics history.
- **RBAC Enforcement**: Admin analytics endpoints strictly require `ADMIN` or `SUPER_ADMIN` roles (`requireAdmin()`). Public access and standard user attempts receive 401 Unauthorized / 403 Forbidden.

### D. Implemented API Endpoints
| Endpoint | Method | Access Level | Description |
|---|:---:|:---:|---|
| `/api/deals/[slug]/click` | `POST` | Public / Authenticated | Records an affiliate click for a deal (supports lookup by deal UUID or deal slug). Returns `clickId` and `redirectUrl`. Rate-limited. |
| `/api/go/[clickId]` | `GET` | Public | Resolves click tracking ID, verifies offer eligibility, transitions status to `REDIRECTED`, and performs secure HTTP 307 redirect to approved destination. |
| `/api/admin/affiliate-clicks` | `GET` | Admin | Paginated list of affiliate clicks with date range, merchant, deal, and status filtering. Sanitizes relations (excludes sensitive user fields). |
| `/api/admin/affiliate-clicks/summary` | `GET` | Admin | Aggregated analytics summary: total clicks, redirected, failed, tracked, distribution by top merchants, top deals, and daily click counts. |

---

## 6. Phase 6: Affiliate Network Integration & Conversion Tracking

### A. Database Migration
- **Migration Name:** `20261123120000_create_conversions`
- **Migration Path:** `prisma/migrations/20261123120000_create_conversions/migration.sql`
- **Deployment Status:** Successfully deployed to Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com:5432`) via `npx prisma migrate deploy`.
- **Client Status:** Generated to `src/generated/prisma`.

### B. New Database Models & Enums
1. **AffiliateProvider Enum**: `FLIPKART`, `CUELINKS`, `ADMITAD`, `EARNKARO`, `GENERIC`.
2. **ConversionStatus Enum**: `PENDING`, `APPROVED`, `CONFIRMED`, `REJECTED`, `REVERSED`, `UNMATCHED`.
3. **Conversion Model**:
   - `id String @id @default(uuid())`
   - `provider AffiliateProvider`
   - `externalTransactionId String`
   - `affiliateClickId String?` (Relation to `AffiliateClick`, onDelete: `SetNull`)
   - `userId String?` (Relation to `User`, onDelete: `SetNull`)
   - `merchantId String?` (Relation to `Merchant`, onDelete: `SetNull`)
   - `dealId String?` (Relation to `Deal`, onDelete: `SetNull`)
   - `cashbackId String? @unique` (1:1 Relation to `Cashback`, onDelete: `SetNull`)
   - `orderAmount Decimal(10, 2)` (Total purchase order volume)
   - `commissionAmount Decimal(10, 2)` (Commission paid to CashTon by network)
   - `cashbackAmount Decimal(10, 2) @default(0.00)` (Calculated 70% user cashback share)
   - `currency String @default("INR")`
   - `status ConversionStatus @default(PENDING)`
   - `convertedAt DateTime @default(now())`
   - `rawPayload Json?` (Full network postback payload for non-repudiation)
   - `reconciliationNotes String?` (Audit commentary and reconciliation logs)
   - `createdAt DateTime @default(now())`
   - `updatedAt DateTime @updatedAt`
   - **Constraints & Indexes**:
     - `@@unique([provider, externalTransactionId])` (Strict database-level postback idempotency)
     - `@@index([provider, externalTransactionId])`
     - `@@index([affiliateClickId])`, `@@index([userId])`, `@@index([merchantId])`, `@@index([dealId])`
     - `@@index([status])`, `@@index([createdAt])`

### C. Architecture & Business Rules
- **Multi-Network Adapter Pattern**: Modular network adapters (`FlipkartAdapter`, `CuelinksAdapter`, `AdmitadAdapter`, `EarnKaroAdapter`, `GenericAdapter`) implement the common `AffiliateNetworkAdapter` interface.
- **Timing-Safe HMAC Verification**: Webhook secret tokens and signatures (`X-Flipkart-Signature`, `X-Flipkart-Token`, `X-Cuelinks-Token`, etc.) are authenticated using constant-time `crypto.timingSafeEqual`.
- **Accurate Click Extraction**: Accurately extracts CashTon 48-hex CSPRNG click tokens (`clk_[a-f0-9]{48}`) from complex network sub-id structures (e.g. Flipkart composite parameters: `543212_136_{tid}_source`) without swallowing delimiters or trailing parameters.
- **Strict Postback Idempotency**: Duplicate webhook deliveries are detected via `@@unique([provider, externalTransactionId])` and return HTTP 200 with `isDuplicate: true`, preventing duplicate conversions, duplicate cashback records, and double wallet crediting.
- **Cashback Lifecycle Synchronization**:
  - `PENDING` / `APPROVED` postbacks create or transition `Cashback` records without prematurely crediting the wallet.
  - `CONFIRMED` postbacks atomically credit the user's `Wallet` using `creditCashbackToWallet` inside a Prisma transaction and create an immutable `WalletTransaction` of type `CREDIT`.
  - Duplicate `CONFIRMED` postbacks are strictly no-ops (protected by `WalletTransaction.cashbackId @unique`).
  - `REVERSED` postbacks on confirmed orders atomically decrement the user wallet and record a `WalletTransaction` of type `REVERSAL`.
  - `REJECTED` postbacks safely transition the cashback to `REJECTED` with the network rejection reason.
- **Guest Click Attribution**: Clicks generated by anonymous visitors create conversions with `userId: null` and `cashbackId: null` for platform commission auditing.
- **Unmatched Postback Handling**: Postbacks with missing or unknown click IDs are safely recorded with status `UNMATCHED` and flagged for manual administration.
- **Admin Manual Reconciliation**: Dedicated reconciliation endpoint allows administrators to attach a valid `clickId` to an `UNMATCHED` conversion, automatically generating user cashback and synchronizing ledger state.

### D. Implemented API Endpoints
| Endpoint | Method | Access Level | Description |
|---|:---:|:---:|---|
| `/api/webhooks/flipkart` | `POST` / `GET` | Public (Authenticated via Secret/HMAC) | Ingests Flipkart conversion postbacks. Parses `affExtParam2`, validates HMAC signature, and synchronizes cashback. |
| `/api/webhooks/cuelinks` | `POST` / `GET` | Public (Authenticated via Secret/Token) | Ingests Cuelinks conversion postbacks with `subid` click attribution. |
| `/api/webhooks/admitad` | `POST` / `GET` | Public (Authenticated via Secret/Token) | Ingests Admitad conversion postbacks with `subid` click attribution. |
| `/api/webhooks/earnkaro` | `POST` / `GET` | Public (Authenticated via Secret/Token) | Ingests EarnKaro conversion postbacks with `subid` click attribution. |
| `/api/webhooks/generic` | `POST` / `GET` | Public (Authenticated via Secret/Token) | Universal webhook endpoint for generic affiliate network postbacks. |
| `/api/admin/conversions` | `GET` | Admin | Paginated list of conversions with provider, status, date, and user filtering, plus full relational details. |
| `/api/admin/conversions/[id]` | `GET` | Admin | Full conversion details including raw JSON audit payload and linked cashback/wallet transactions. |
| `/api/admin/conversions/summary` | `GET` | Admin | Aggregated metrics: total conversions, order volume, commissions, user cashback, and provider breakdown. |
| `/api/admin/conversions/[id]/reconcile` | `POST` | Admin | Reconciles unmatched or misattributed conversions by attaching a click ID or user ID and creating cashback. |

---

## 7. Phase 7: Campaign Engine & Cashback Lifecycle Completion

### A. Database Migration
- **Migration Name:** `20261123170000_campaign_engine_and_snapshots`
- **Migration Path:** `prisma/migrations/20261123170000_campaign_engine_and_snapshots/migration.sql`
- **Deployment Status:** Successfully applied to Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com:5432`) via `npx prisma migrate deploy`.
- **Prisma Client Status:** Generated via `npx prisma generate --config prisma7.config.ts`.
- **Migration Count:** 10 applied migrations, 0 schema drift, schema up to date.

### B. Database Schema Enhancements
1. **Campaign Model Enhancement**:
   - Added `description String?` to `model Campaign` to allow administrative campaign documentation and notes.
   - Leveraged existing `model Campaign` schema containing `merchantId`, `dealId`, `network` (`AffiliateProvider`), `cashbackRate`, `cashbackType` (`PERCENTAGE`, `FIXED`), `minOrderAmount`, `maxCashbackPerOrder`, `maxCashbackPerUser`, `maxCampaignBudget`, `totalCashbackPaid`, `priority`, `startDate`, `endDate`, and `isActive`.
2. **Conversion Model Enhancement**:
   - Added `campaignSnapshot Json?` to `model Conversion` storing an immutable audit record of the campaign configuration at the exact moment conversion was ingested.
   - Retained relational fields `campaignId String?`, `shareType CashbackShareType?`, `userShareValue Decimal(10, 2)?`.

### C. Campaign Engine Architecture & Rules
- **Deterministic 4-Level Selection Hierarchy**:
  - **Level 4 (Most Specific):** Deal-Specific (`dealId === params.dealId`).
  - **Level 3:** Merchant-Specific (`merchantId === params.merchantId && !dealId`).
  - **Level 2:** Network-Specific (`network === params.network && !merchantId && !dealId`).
  - **Level 1 (Fallback):** Global Platform Default (`!merchantId && !dealId && !network`).
  - **Deterministic Tie-Breaking:** `priority DESC`, `createdAt DESC`, `id ASC`.
- **Eligibility Constraints**:
  - `isActive === true`.
  - Date bounds: `(startDate === null || startDate <= now) && (endDate === null || endDate >= now)`.
  - Minimum order: `orderAmount >= minOrderAmount` (if configured).
  - Campaign budget cap: `(totalCashbackPaid + cashbackAmount) <= maxCampaignBudget` (if configured).
  - Per-user cap: `(userLifetimeCashbackInCampaign + cashbackAmount) <= maxCashbackPerUser` (if configured).
- **Financial Precision & Rounding Policy**:
  - Zero floating-point operations. All financial math is computed via `Prisma.Decimal`.
  - Rounding Mode: `ROUND_HALF_UP` strictly rounded to 2 decimal places (`toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)`).
  - Formula (PERCENTAGE): `cashbackAmount = min(round_half_up(orderAmount * (cashbackRate / 100)), maxCashbackPerOrder)`.
  - Formula (FIXED): `cashbackAmount = min(cashbackRate, maxCashbackPerOrder)`.
- **Immutable Campaign Snapshot**:
  - Serialized at conversion ingestion: `{ campaignId, campaignName, cashbackType, cashbackRate, priority, level, minOrderAmount, maxCashbackPerOrder, calculatedCashback, orderAmount, calculatedAt }`.
  - Subsequent admin changes to campaigns (rates, caps, status) cannot alter historical conversion economics or ledger totals.
- **Conversion Lifecycle Integration**:
  - Ingestion calculates cashback from matched campaign rule and creates `Cashback` in `PENDING` status.
  - Updates to `APPROVED` synchronize `Cashback` to `APPROVED`.
  - Network `CONFIRMED` atomically transitions `Cashback` to `CONFIRMED`, credits the user's `Wallet` ledger with `CREDIT` transaction, and increments `Campaign.totalCashbackPaid`.
  - Duplicate `CONFIRMED` postbacks are strictly idempotent no-ops (protected by `WalletTransaction.cashbackId @unique`).
  - Network `REVERSED` postbacks atomically decrement user wallet balance, create a `REVERSAL` ledger record, and decrement `Campaign.totalCashbackPaid`.
- **Soft-Deactivation Protection**:
  - Admin `DELETE /api/admin/campaigns/[id]` checks for linked conversions. If conversions exist, campaign is soft-deactivated (`isActive = false`) to preserve foreign key integrity. If no conversions exist, row is deleted.

### D. Implemented API Endpoints
| Endpoint | Method | Access Level | Description |
|---|:---:|:---:|---|
| `/api/admin/campaigns` | `GET` | Admin | Paginated list of campaigns with status, merchant, network, and search filters. |
| `/api/admin/campaigns` | `POST` | Admin | Creates a campaign with strict Zod validation (rate bounds, date validation, priority). |
| `/api/admin/campaigns/[id]` | `GET` | Admin | Retrieves complete campaign details including relations and total paid cashback. |
| `/api/admin/campaigns/[id]` | `PATCH` | Admin | Updates campaign parameters with validation. |
| `/api/admin/campaigns/[id]` | `DELETE` | Admin | Soft-deactivates campaign (`isActive = false`) if conversions exist, or hard-deletes if unused. |

---

## 8. Comprehensive Test Results Matrix

| Quality / Test Suite | Command | Result | Pass Rate |
|---|---|:---:|:---:|
| **Prisma Schema Validation** | `npx prisma validate --config prisma7.config.ts` | **PASS** (Exit 0) | 100% |
| **Prisma Client Generation** | `npx prisma generate --config prisma7.config.ts` | **PASS** (Exit 0) | 100% |
| **Prisma Migration Status** | `npx prisma migrate status --config prisma7.config.ts` | **PASS** (10 applied, 0 drift) | 100% |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS** (0 errors) | 100% |
| **ESLint Static Analysis** | `npm run lint` | **PASS** (0 errors, 0 warnings) | 100% |
| **Next.js Production Build** | `npx next build --webpack` | **PASS** (31/31 routes compiled) | 100% |
| **Phase 7 Campaign & Lifecycle Suite** | `node scripts/test-phase7.mjs` | **PASS** (31/31 scenarios passed) | **100%** |
| **Phase 6 Network & Conversion Suite** | `node scripts/test-phase6.mjs` | **PASS** (41/41 scenarios passed) | **100%** |
| **Phase 5 Click & Redirect Suite** | `node scripts/test-phase5.mjs` | **PASS** (33/33 scenarios passed) | **100%** |
| **Phase 4 Deals & Coupons Suite** | `node scripts/test-phase4.mjs` | **PASS** (36/36 scenarios passed) | **100%** |
| **Security & Concurrency Audit Suite** | `node scripts/comprehensive-security-audit.mjs` | **PASS** (52/52 scenarios passed) | **100%** |
| **Combined Regression Matrix** | **Full System Verification** | **PASS** (**193 / 193 tests passed**) | **100%** |

---

## 9. Remaining Limitations & Next Phase Dependencies
- **Automated Network Pull/Feed Sync**: Webhook ingestion operates cleanly in real time. Batch conversion report polling (CSV/API feeds) is managed via cron/scheduled automations.
- **Automated Payout Disbursements**: While confirmed cashback credits the wallet, actual bank payout processing, withdrawal request approvals, and payment gateway transfers are owned by Phase 8.
- **Frontend Campaign & Conversion Views**: Campaign management and detailed conversion analytics are fully operational via Admin APIs and User Wallet Summaries; dedicated administrative UI tables will be completed in Phase 11.

---

## 10. Recommended Next Phase
- **Phase 8: Payout Processing Engine**
  - User withdrawal request workflows.
  - Minimum withdrawal limits and payout verification.
  - Bank and UPI payout disbursement queue.
  - Batch payout file generation or automated payment gateway integration.
