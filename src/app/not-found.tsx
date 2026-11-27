import type { Metadata } from "next";
import Link from "next/link";

import { ROUTES } from "@/config/navigation";

export const metadata: Metadata = {
  title: "Page Not Found",
};

/**
 * Branded 404 page. The root not-found handles every unmatched URL and renders
 * inside the root layout, so the shared Navbar stays above it.
 * Kept as a Server Component (no client JS), as Next.js sends it with every route.
 */
export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 md:py-20">
      <section
        aria-labelledby="not-found-title"
        className="w-full max-w-[560px] rounded-3xl border border-brand-ink/10 bg-white px-6 py-10 text-center shadow-[0_8px_24px_-12px_rgb(23_23_23/0.12)] sm:px-10 sm:py-12"
      >
        <p className="inline-flex items-center rounded-full bg-brand-lime px-3.5 py-1 text-sm font-semibold text-brand-ink">
          Error 404
        </p>

        <p aria-hidden="true" className="mt-5 font-heading text-[72px] leading-none font-bold text-brand-ink sm:text-[96px]">
          404
        </p>

        <h1 id="not-found-title" className="mt-4 font-heading text-2xl font-semibold text-brand-ink sm:text-[28px]">
          Page not found
        </h1>

        <p className="mx-auto mt-3 max-w-[400px] text-base leading-relaxed text-brand-ink/70 sm:text-[17px]">
          Sorry, we couldn’t find the page you’re looking for. It may have moved, or it isn’t available yet.
        </p>

        <Link
          href={ROUTES.home}
          className="mt-8 inline-flex h-[52px] items-center justify-center rounded-full bg-brand-lime px-8 text-base font-bold text-brand-ink transition-[filter] duration-150 hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink sm:h-[55px] sm:text-[17px]"
        >
          Back to Home
        </Link>
      </section>
    </main>
  );
}
