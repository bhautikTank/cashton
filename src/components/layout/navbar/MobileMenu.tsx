"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, X } from "lucide-react";

import { CATEGORY_MENU, CATEGORY_MENU_FOOTER, NAV_LINKS, isActivePath, prefetchFor } from "@/config/navigation";
import { AuthLink, WalletLink } from "./HeaderActions";

/**
 * Mobile hamburger + slide-down panel (below md).
 * The panel is positioned against the nearest positioned ancestor (the <header>).
 */
export default function MobileMenu() {
  const [open, setOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const categoriesId = useId();
  const pathname = usePathname();

  const close = () => {
    setOpen(false);
    setCategoriesOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const closeMenu = () => {
      setOpen(false);
      setCategoriesOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
        toggleRef.current?.focus();
      }
    };
    // Tap/click outside the panel closes it (the toggle button handles its own clicks).
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !toggleRef.current?.contains(target)) closeMenu();
    };
    // The panel is hidden from md up; close it there so the scroll lock can't get stuck.
    const desktopQuery = window.matchMedia("(min-width: 48rem)");
    const onBreakpoint = (event: MediaQueryListEvent) => {
      if (event.matches) closeMenu();
    };

    // Lock background scrolling while the menu is open; restore the previous value on close.
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    desktopQuery.addEventListener("change", onBreakpoint);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      desktopQuery.removeEventListener("change", onBreakpoint);
      root.style.overflow = previousOverflow;
    };
  }, [open]);

  const linkClass =
    "flex items-center justify-between rounded-xl px-3 py-3 text-base text-brand-ink transition-colors hover:bg-brand-section focus-visible:outline-2 focus-visible:outline-brand-ink";

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-section text-brand-ink transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink md:hidden"
      >
        {open ? (
          <X aria-hidden="true" className="size-[22px]" strokeWidth={2.25} />
        ) : (
          <Menu aria-hidden="true" className="size-[22px]" strokeWidth={2.25} />
        )}
      </button>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-100%)] overflow-y-auto border-t border-brand-section bg-brand-bg px-4 pt-3 pb-5 shadow-[0_16px_24px_-16px_rgb(23_23_23/0.25)] md:hidden"
      >
        <nav aria-label="Mobile">
          <ul className="flex flex-col gap-0.5">
            {NAV_LINKS.map(({ label, href, categoryMenu }) => {
              const active = isActivePath(pathname, href);

              if (categoryMenu) {
                return (
                  <li key={href}>
                    <button
                      type="button"
                      aria-expanded={categoriesOpen}
                      aria-controls={categoriesId}
                      onClick={() => setCategoriesOpen((value) => !value)}
                      className={`${linkClass} w-full font-semibold ${active ? "bg-brand-section" : ""}`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Menu aria-hidden="true" className="size-[18px]" strokeWidth={2.5} />
                        {label}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className={`size-5 transition-transform duration-150 ${categoriesOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    <div id={categoriesId} hidden={!categoriesOpen} className="mt-1 mb-2 rounded-2xl border border-brand-ink/10 bg-white px-4 pt-4 pb-3">
                      <div className="flex flex-col gap-5">
                        {CATEGORY_MENU.map(({ title, links }, index) => (
                          <section key={title} aria-labelledby={`${categoriesId}-col-${index}`}>
                            <h3
                              id={`${categoriesId}-col-${index}`}
                              className="font-heading text-xs font-semibold tracking-wide text-brand-ink/65 uppercase"
                            >
                              {title}
                            </h3>
                            <ul className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
                              {links.map(({ label: linkLabel, href: linkHref }) => (
                                <li key={linkHref} className="min-w-0">
                                  <Link
                                    href={linkHref}
                                    prefetch={prefetchFor(linkHref)}
                                    onClick={close}
                                    className="-mx-2 block rounded-lg px-2 py-2 text-[15px] text-brand-ink transition-colors hover:bg-brand-section focus-visible:outline-2 focus-visible:outline-brand-ink"
                                  >
                                    {linkLabel}
                                  </Link>
                                </li>
                              ))}
                            </ul>
                          </section>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-brand-ink/10 pt-3">
                        {CATEGORY_MENU_FOOTER.map(({ label: linkLabel, href: linkHref }) => (
                          <Link
                            key={linkHref}
                            href={linkHref}
                            prefetch={prefetchFor(linkHref)}
                            onClick={close}
                            className="rounded-md py-1.5 text-[15px] font-bold text-brand-ink underline decoration-brand-lime decoration-2 underline-offset-4 focus-visible:outline-2 focus-visible:outline-brand-ink"
                          >
                            {linkLabel}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </li>
                );
              }

              return (
                <li key={href}>
                  <Link
                    href={href}
                    prefetch={prefetchFor(href)}
                    onClick={close}
                    aria-current={active ? "page" : undefined}
                    className={`${linkClass} ${active ? "bg-brand-section font-medium" : ""}`}
                  >
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-brand-section pt-4">
          <WalletLink onNavigate={close} className="h-12 text-[15px]" />
          <AuthLink onNavigate={close} className="h-12 text-[15px]" />
        </div>
      </div>
    </>
  );
}
