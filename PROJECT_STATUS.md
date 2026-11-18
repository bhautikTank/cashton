# CashTon Project Status & Architecture Ledger

Last Updated: 2026-11-18

---

## 1. Phase Status Overview

| Phase | Description | Status | Verification Summary |
|---|---|:---:|---|
| **Phase 0** | **Environment & Build Foundation** | **COMPLETED** | Next.js 16.4.6, React 19.3.0, Prisma 7.10.1, Supabase Auth (@supabase/ssr), Tailwind CSS v4 via official PostCSS plugin (`postcss.config.mjs`). Build passes cleanly in 198ms. |
| **Phase 1** | **RBAC and Authorization** | **COMPLETED** | `requireAuth()`, `requireRole()`, `requireAdmin()`, server-verified `UserRole` enum (`USER`, `ADMIN`, `SUPER_ADMIN`). Verified with `/api/admin/check` (HTTP 403 for `USER`). |
| **Phase 2** | **User Profile Management** | **COMPLETED** | `GET` and `PATCH /api/users/profile`. Profile sanitization (suppresses `authUserId` and `passwordHash`). Strict single-field mutation (`name`). P2025 and controlled 500 error handling. |
| **Phase 3** | **Merchant Management** | **COMPLETED** | `Merchant` model and migration applied. Public read APIs, Admin CRUD with soft-deactivation (`isActive = false`), duplicate slug handling (409 Conflict), Zod validation, and full HTTP test suite passed. |
| **Phase 4** | **Deals & Coupons Management** | **PLANNED** | Models and endpoints for store deals, coupon codes, expiry dates, and public feeds. |
| **Phase 5** | **Affiliate Tracking & Redirect Engine** | **PLANNED** | `ClickRecord` tracking, sub-ID generation, dynamic redirects, and click logging. |
| **Phase 6** | **Cashback Ledger & Postbacks** | **PLANNED** | `CashbackTransaction` financial ledger, affiliate network postback receivers. |
| **Phase 7** | **Wallet & Payouts** | **PLANNED** | User balances, UPI/Bank payout requests, admin approval workflows. |

---

## 2. Phase 3 Details: Merchant Management

### A. Database Migration
- **Migration Name:** `20261118165700_create_merchant`
- **Migration Path:** `prisma/migrations/20261118165700_create_merchant/migration.sql`
- **Deployment Status:** Successfully applied to Supabase PostgreSQL (`aws-1-ap-northeast-1.pooler.supabase.com:5432`) via `npx prisma migrate deploy`.
- **Client Status:** Generated to `src/generated/prisma`.

### B. New Database Model
```prisma
model Merchant {
  id          String   @id @default(uuid())
  name        String
  slug        String   @unique
  description String?
  websiteUrl  String?
  logoUrl     String?
  isActive    Boolean  @default(true)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([isActive])
  @@index([createdAt])
}
```

### C. Validation & Service Files
- **Validation Schemas:** `src/lib/validations/merchant.schema.ts`
  - `createMerchantSchema`: Strict validation for `name`, URL-safe `slug`, optional `description`, `websiteUrl`, `logoUrl`, `isActive`.
  - `updateMerchantSchema`: Partial update schema with strict field rejection.
  - `merchantQuerySchema`: Pagination (`page`, `limit` up to 100), `search`.
- **Service Layer:** `src/modules/merchants/merchant.service.ts`
  - `getMerchants()`: Paginated active merchants with case-insensitive name search.
  - `getMerchantByIdOrSlug()`: Public retrieval by UUID or slug (active only).
  - `createMerchant()`: Admin creation.
  - `updateMerchant()`: Admin partial update.
  - `deactivateMerchant()`: Soft deactivation (`isActive = false`).

### D. New API Endpoints
| Endpoint | Method | Access Level | Description |
|---|:---:|:---:|---|
| `/api/merchants` | `GET` | Public | Paginated directory of active merchants with search. |
| `/api/merchants/[id]` | `GET` | Public | Get single active merchant by UUID or slug. Returns 404 if missing or inactive. |
| `/api/admin/merchants` | `POST` | Admin (`ADMIN`, `SUPER_ADMIN`) | Create merchant. Returns 201 on success, 409 on duplicate slug. |
| `/api/admin/merchants/[id]` | `PATCH` | Admin (`ADMIN`, `SUPER_ADMIN`) | Update merchant. Returns 200 on success, 404 if not found, 409 on slug conflict. |
| `/api/admin/merchants/[id]` | `DELETE` | Admin (`ADMIN`, `SUPER_ADMIN`) | Soft-deactivate merchant (`isActive = false`). Never hard-deletes. |

---

## 3. Quality & Verification Results

| Quality Check | Command | Result |
|---|---|:---:|
| **Prisma Schema Validation** | `npx prisma validate --config prisma7.config.ts` | **PASS** (Exit 0) |
| **Prisma Client Generation** | `npx prisma generate --config prisma7.config.ts` | **PASS** (Exit 0) |
| **TypeScript Typecheck** | `npx tsc --noEmit` | **PASS** (0 errors) |
| **ESLint Static Analysis** | `npm run lint` | **PASS** (0 errors, 0 warnings) |
| **Next.js Production Build** | `npm run build` | **PASS** (13/13 routes compiled & prerendered in 198ms) |
| **Integration Test Suite** | HTTP test suite across all 21 test scenarios | **PASS** (21/21 passed) |

---

## 4. Known Limitations & Future Considerations
1. **Unaccented Search:** Current merchant name search uses PostgreSQL `mode: "insensitive"`. When scaling to thousands of merchants, PostgreSQL `pg_trgm` or full-text search indexes (`tsvector`) should be introduced.
2. **Logo Asset Uploads:** Current implementation takes direct `logoUrl` strings. Direct S3/Supabase Storage bucket upload integration will be added in future assets sprint.
3. **Soft Deactivation Cascade:** Soft deactivating a merchant currently sets `isActive = false`. When `Deal` records are implemented in Phase 4, deactivating a merchant should automatically suppress its associated active deals from public feeds.

---

## 5. Recommended Next Phase
- **Phase 4: Deals & Coupons Management**
  - Implement `Deal` and `Coupon` models with foreign key `merchantId -> Merchant.id` (`onDelete: Restrict`).
  - Public deals catalog with filtering by merchant slug, category, and expiry date.
  - Admin CRUD endpoints for store promotions and discount codes.
