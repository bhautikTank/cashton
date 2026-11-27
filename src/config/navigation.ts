/**
 * Central route map for the navbar.
 *
 * NOTE: Only the homepage is implemented so far. The other routes are placeholders
 * and show the branded TheCashton 404 page (src/app/not-found.tsx) until each page is built.
 */
export const ROUTES = {
  home: "/",
  search: "/search",
  categories: "/categories",
  stores: "/stores",
  deals: "/deals",
  howItWorks: "/how-it-works",
  howCashbackWorks: "/how-cashback-works",
  help: "/help",
  wallet: "/wallet",
  login: "/login",
  coupons: "/coupons",
  about: "/about",
  contact: "/contact",
  terms: "/terms",
  privacy: "/privacy",
} as const;

export const storeHref = (slug: string) => `${ROUTES.stores}/${slug}`;

/**
 * Routes that have a real page. Add a route here once its page is built.
 * Links to any other route skip prefetching, so placeholder routes don't
 * trigger background 404 requests (and console errors) on every page load.
 */
const IMPLEMENTED_ROUTES: ReadonlySet<string> = new Set([ROUTES.home]);

/** `prefetch` prop value for a <Link>: default for built pages, off for placeholders. */
export const prefetchFor = (href: string): false | undefined =>
  IMPLEMENTED_ROUTES.has(href.split("?")[0]) ? undefined : false;

export interface NavLink {
  label: string;
  href: string;
  /** Render as the Categories menu (dropdown on desktop, accordion on mobile). */
  categoryMenu?: boolean;
}

/** Main navigation, in display order. Shared by the desktop row and the mobile menu. */
export const NAV_LINKS: readonly NavLink[] = [
  { label: "Categories", href: ROUTES.categories, categoryMenu: true },
  { label: "Stores", href: ROUTES.stores },
  { label: "Deals", href: ROUTES.deals },
  { label: "How It Works", href: ROUTES.howItWorks },
  { label: "How Cashback Works", href: ROUTES.howCashbackWorks },
  { label: "Help", href: ROUTES.help },
];

/** True when `pathname` is `href` or a page below it ("/" only matches itself). */
export const isActivePath = (pathname: string, href: string): boolean =>
  href === ROUTES.home ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

export const categoryHref = (slug: string) => `${ROUTES.categories}/${slug}`;

/** Deals listing filtered by product type (uses the existing /deals route). */
export const productDealsHref = (slug: string) => `${ROUTES.deals}?category=${slug}`;

export interface MenuColumn {
  title: string;
  links: readonly NavLink[];
}

/**
 * Categories mega menu content, shared by the desktop dropdown and the mobile menu.
 * All links are placeholder routes until their pages are built.
 */
export const CATEGORY_MENU: readonly MenuColumn[] = [
  {
    title: "Categories",
    links: [
      { label: "Fashion", href: categoryHref("fashion") },
      { label: "Electronics", href: categoryHref("electronics") },
      { label: "Beauty", href: categoryHref("beauty") },
      { label: "Travel", href: categoryHref("travel") },
      { label: "Home & Kitchen", href: categoryHref("home-kitchen") },
      { label: "Grocery", href: categoryHref("food-grocery") },
    ],
  },
  {
    title: "Popular stores",
    links: [
      { label: "Myntra", href: storeHref("myntra") },
      { label: "Amazon", href: storeHref("amazon") },
      { label: "Flipkart", href: storeHref("flipkart") },
      { label: "Nykaa", href: storeHref("nykaa") },
      { label: "Ajio", href: storeHref("ajio") },
      { label: "Croma", href: storeHref("croma") },
    ],
  },
  {
    title: "Top product deals",
    links: [
      { label: "Mobiles", href: productDealsHref("mobiles") },
      { label: "Headphones", href: productDealsHref("headphones") },
      { label: "Laptops", href: productDealsHref("laptops") },
      { label: "Men’s fashion", href: productDealsHref("mens-fashion") },
      { label: "Women’s fashion", href: productDealsHref("womens-fashion") },
      { label: "Beauty", href: productDealsHref("beauty") },
    ],
  },
];

/** Footer links of the Categories mega menu. */
export const CATEGORY_MENU_FOOTER: readonly NavLink[] = [
  { label: "See all categories", href: ROUTES.categories },
  { label: "All stores", href: ROUTES.stores },
];
