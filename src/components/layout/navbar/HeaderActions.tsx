import Link from "next/link";
import { Wallet } from "lucide-react";

import { ROUTES, prefetchFor } from "@/config/navigation";

const pillBase =
  "inline-flex shrink-0 items-center justify-center gap-2.5 rounded-full font-semibold whitespace-nowrap text-brand-ink lg:font-bold transition-[filter,background-color] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink";

interface ActionProps {
  className?: string;
  onNavigate?: () => void;
}

/**
 * Wallet pill. `compact` hides the label on narrower desktop widths
 * (label stays available to screen readers).
 */
export function WalletLink({ className = "", onNavigate, compact = false }: ActionProps & { compact?: boolean }) {
  return (
    <Link
      href={ROUTES.wallet}
      prefetch={prefetchFor(ROUTES.wallet)}
      onClick={onNavigate}
      className={`${pillBase} bg-brand-section hover:brightness-95 ${className}`}
    >
      <Wallet aria-hidden="true" className="size-[22px] shrink-0" strokeWidth={2} />
      <span className={compact ? "sr-only xl:not-sr-only" : undefined}>Wallet</span>
    </Link>
  );
}

export function AuthLink({ className = "", onNavigate }: ActionProps) {
  return (
    <Link
      href={ROUTES.login}
      prefetch={prefetchFor(ROUTES.login)}
      onClick={onNavigate}
      className={`${pillBase} bg-brand-lime hover:brightness-95 ${className}`}
    >
      Login / Sign up
    </Link>
  );
}
