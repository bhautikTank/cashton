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
| **Phase 4** | **Deals & Coupons Management** | **PLANNED** | Models and endpoints for store deals, coupon codes, expiry dates, and public feeds. |
| **Phase 5** | **Affiliate Tracking & Redirect Engine** | **PLANNED** | `ClickRecord` tracking, sub-ID generation, dynamic redirects, and click logging. |
| **Phase 6** | **Cashback Network Postbacks** | **PLANNED** | Affiliate network postback receivers to automatically ingest tracked sales into `Cashback`. |
| **Phase 7** | **Payout Processing Engine** | **PLANNED** | Admin payout queue approval workflows, batch bank transfers, and withdrawal processing. |

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

## 5. Recommended Next Phase
- **Phase 4: Deals & Coupons Management**
  - Implement `Deal` and `Coupon` models with foreign key `merchantId -> Merchant.id` (`onDelete: Restrict`).
  - Public deals catalog with filtering by merchant slug, category, and expiry date.
  - Admin CRUD endpoints for store promotions and discount codes.
