"use client";

import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import Link from "next/link";
import { Menu, Triangle } from "lucide-react";

import { CATEGORY_MENU, CATEGORY_MENU_FOOTER, prefetchFor } from "@/config/navigation";

interface CategoriesDropdownProps {
  label?: string;
  /** Highlight the trigger when the current page is a category page. */
  active?: boolean;
}

/**
 * Desktop "Categories" trigger with a click-to-open, three-column mega menu.
 *
 * Positioning: from xl up the 888px panel opens under the trigger. Below xl
 * (tablet / small laptop) the wrapper is `static`, so the panel anchors to the
 * `relative` <nav> in DesktopNav and never runs off-screen.
 */
export default function CategoriesDropdown({ label = "Categories", active = false }: CategoriesDropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  // Keyboard users: close when focus moves to an element outside the menu (e.g. tabbing past its last link).
  // relatedTarget is null for clicks on non-focusable areas inside the panel, so those keep it open.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !containerRef.current?.contains(next)) setOpen(false);
  };

  return (
    <div ref={containerRef} onBlur={onBlur} className="static xl:relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={`-ml-3 flex items-center gap-2 rounded-full px-3 py-2 text-base font-semibold whitespace-nowrap text-brand-ink transition-colors hover:bg-brand-section focus-visible:outline-2 focus-visible:outline-brand-ink lg:-ml-2.5 lg:text-[17px] lg:font-bold ${open || active ? "bg-brand-section" : ""}`}
      >
        <Menu aria-hidden="true" className="size-4" strokeWidth={2.75} />
        <span>{label}</span>
        <Triangle
          aria-hidden="true"
          className={`ml-px size-2 fill-current transition-transform duration-150 ${open ? "rotate-0" : "rotate-180"}`}
          strokeWidth={0}
        />
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute top-full left-0 z-50 mt-2 w-full max-w-[888px] rounded-2xl xl:w-[888px] border border-brand-ink/10 bg-white pt-[22px] pr-[22px] pb-8 pl-[18px] shadow-[0_8px_24px_-12px_rgb(23_23_23/0.12)]"
      >
        <div className="grid grid-cols-3 gap-x-[25px]">
          {CATEGORY_MENU.map(({ title, links }, index) => (
            <section key={title} aria-labelledby={`${panelId}-col-${index}`}>
              <h3
                id={`${panelId}-col-${index}`}
                className="font-sans text-base leading-5 font-normal text-brand-ink/65"
              >
                {title}
              </h3>
              <ul className="mt-2.5 flex flex-col">
                {links.map(({ label: linkLabel, href }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      prefetch={prefetchFor(href)}
                      onClick={close}
                      className="-mx-2.5 block rounded-lg px-2.5 py-2 text-[17px] leading-[25px] text-brand-ink transition-colors hover:bg-brand-section focus-visible:outline-2 focus-visible:outline-brand-ink"
                    >
                      {linkLabel}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-[30px] gap-y-2 border-t border-brand-ink/10 pt-6">
          {CATEGORY_MENU_FOOTER.map(({ label: linkLabel, href }) => (
            <Link
              key={href}
              href={href}
              prefetch={prefetchFor(href)}
              onClick={close}
              className="rounded-md text-[17px] leading-6 font-bold text-brand-ink underline-offset-4 transition-colors hover:underline hover:decoration-brand-lime hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink"
            >
              {linkLabel}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
