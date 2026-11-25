-- Migration: Lock down all existing public tables from Supabase PostgREST Data API (anon/authenticated)
--
-- STANDING REQUIREMENT FOR ALL FUTURE MIGRATIONS:
-- PostgreSQL RLS does NOT automatically apply to newly created tables. Any future migration
-- that executes `CREATE TABLE "public"."<NewTable>" ...` MUST ALSO include:
--   1. `ALTER TABLE "public"."<NewTable>" ENABLE ROW LEVEL SECURITY;`
--   2. `REVOKE ALL ON TABLE "public"."<NewTable>" FROM anon, authenticated;` (if roles exist)
--   3. An explicit `RESTRICTIVE` deny-all policy for `anon, authenticated` (unless intentionally exposed via PostgREST).
-- Note: `postgres` and `service_role` retain `rolbypassrls = true` and full privileges; Supabase Studio and server-side Prisma remain unaffected.

-- 1. Enable Row Level Security on all 14 current public tables (deny-by-default for non-BYPASSRLS roles)
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."PayoutDetails" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Merchant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Deal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Coupon" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."AffiliateClick" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Campaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Conversion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Cashback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Wallet" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CashbackDebt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."WalletTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Payout" ENABLE ROW LEVEL SECURITY;

-- 2. Revoke Supabase PostgREST Data API privileges (anon, authenticated) and attach explicit deny-all policies.
-- Guarded on pg_roles existence so migrations remain portable on standard local/CI PostgreSQL.
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    '_prisma_migrations',
    'User',
    'PayoutDetails',
    'Merchant',
    'Deal',
    'Coupon',
    'AffiliateClick',
    'Campaign',
    'Conversion',
    'Cashback',
    'Wallet',
    'CashbackDebt',
    'WalletTransaction',
    'Payout'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('anon', 'authenticated')) THEN
    REVOKE ALL ON SCHEMA "public" FROM anon, authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "public" FROM anon, authenticated;

    ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

    FOREACH tbl IN ARRAY tables LOOP
      EXECUTE format('REVOKE ALL ON TABLE "public".%I FROM anon, authenticated', tbl);
      EXECUTE format('DROP POLICY IF EXISTS "deny_all_postgrest_roles" ON "public".%I', tbl);
      EXECUTE format(
        'CREATE POLICY "deny_all_postgrest_roles" ON "public".%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        tbl
      );
    END LOOP;
  END IF;
END $$;
