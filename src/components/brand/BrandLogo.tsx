import Image from "next/image";
import Link from "next/link";

import { ROUTES } from "@/config/navigation";

interface BrandLogoProps {
  /** Tailwind width classes for the visible logo, e.g. "w-[207px]". */
  className?: string;
  /** Load eagerly (use for the above-the-fold navbar logo). */
  eager?: boolean;
}

/**
 * TheCashton logo, rendered from the original /images/the-cashton-logo.svg.
 *
 * The SVG has a square 675x675 canvas with the logo artwork in the middle
 * (roughly x 143.75–552, y 267.25–406.75 in SVG units) and a transparent
 * margin around it. The file is used unmodified at its original aspect ratio;
 * this frame (≈ 419 x 151 units) only hides that empty margin so the logo
 * shows at the intended size, with a small safety margin so no part of the
 * artwork is ever clipped.
 *
 * `unoptimized` serves the SVG as-is (Next.js never rasterizes SVGs), so the
 * vector stays sharp at every size and pixel density.
 */
export default function BrandLogo({ className = "", eager = false }: BrandLogoProps) {
  return (
    <Link
      href={ROUTES.home}
      aria-label="TheCashton home"
      className={`relative block aspect-[576/208] shrink-0 overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ${className}`}
    >
      <Image
        src="/images/the-cashton-logo.svg"
        alt="TheCashton"
        width={675}
        height={675}
        unoptimized
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        className="absolute top-[-172.66%] left-[-32.91%] h-auto w-[161.06%] max-w-none"
      />
    </Link>
  );
}
