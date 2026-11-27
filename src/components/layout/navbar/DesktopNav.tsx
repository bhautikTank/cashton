"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV_LINKS, isActivePath, prefetchFor } from "@/config/navigation";
import CategoriesDropdown from "./CategoriesDropdown";

/** Second navbar row (tablet and up). */
export default function DesktopNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="relative hidden md:block">
      <ul className="flex h-12 items-center gap-3 lg:gap-0">
        {NAV_LINKS.map(({ label, href, categoryMenu }) => {
          const active = isActivePath(pathname, href);
          return (
            <li key={href} className={categoryMenu ? "lg:mr-[12px]" : undefined}>
              {categoryMenu ? (
                <CategoriesDropdown label={label} active={active} />
              ) : (
                <Link
                  href={href}
                  prefetch={prefetchFor(href)}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-full px-2.5 py-2 text-[15px] whitespace-nowrap text-brand-ink transition-colors hover:bg-brand-section focus-visible:outline-2 focus-visible:outline-brand-ink lg:px-[18px] lg:text-[17px] lg:font-medium ${active ? "bg-brand-section font-medium" : ""}`}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
