"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { ROUTES } from "@/config/navigation";

const PLACEHOLDER = "Search for any brand or product";

interface SearchBarProps {
  className?: string;
}

/**
 * Header search. Submits to the /search placeholder route as ?q=<query>.
 * Works without JavaScript too (plain GET form fallback).
 */
export default function SearchBar({ className = "" }: SearchBarProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    router.push(`${ROUTES.search}?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <form
      role="search"
      action={ROUTES.search}
      method="get"
      onSubmit={handleSubmit}
      className={`flex h-12 min-w-0 items-center rounded-[14px] bg-brand-section pr-1.5 pl-4 transition-shadow focus-within:ring-2 focus-within:ring-brand-ink/15 md:h-[52px] lg:h-16 lg:rounded-2xl lg:pr-2 lg:pl-[22px] ${className}`}
    >
      <label htmlFor="site-search" className="sr-only">
        {PLACEHOLDER}
      </label>
      <Search aria-hidden="true" className="size-[18px] shrink-0 text-brand-ink/65" strokeWidth={2} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={PLACEHOLDER}
        autoComplete="off"
        enterKeyHint="search"
        className="h-full min-w-0 flex-1 truncate bg-transparent px-3 text-[15px] text-brand-ink outline-none placeholder:text-brand-ink/65 lg:text-lg [&::-webkit-search-cancel-button]:appearance-none"
      />
      <button
        type="submit"
        className="h-9 shrink-0 rounded-[10px] bg-brand-lime px-4 text-[15px] font-semibold text-brand-ink transition-[filter] lg:font-bold hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink md:h-10 md:px-5 lg:h-12 lg:w-[105px] lg:px-0 lg:text-[17px]"
      >
        Search
      </button>
    </form>
  );
}
