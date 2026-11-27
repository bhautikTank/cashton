# TheCashton

Frontend for [thecashton.com](https://thecashton.com), a cashback, coupons and deals website where users discover stores, explore deals and coupons, shop online and earn cashback.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack)
- React 19 and TypeScript
- Tailwind CSS v4
- [lucide-react](https://lucide.dev) icons
- Fonts: DM Sans (body) and Poppins (headings), loaded with `next/font`

## Getting started

Requires Node.js and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Scripts

| Command             | What it does                                    |
| ------------------- | ----------------------------------------------- |
| `npm run dev`       | Start the development server                    |
| `npm run build`     | Create a production build                       |
| `npm run start`     | Serve the production build                      |
| `npm run lint`      | Run ESLint                                      |
| `npm run typecheck` | Generate Next.js route types and run TypeScript |

## Project structure

```
public/images/            Brand logo (the-cashton-logo.svg)
src/app/                  Root layout, pages, 404 page, global styles, favicon and app icons
src/components/brand/     BrandLogo
src/components/layout/    Navbar (desktop nav, Categories mega menu, mobile menu, search, header actions)
src/config/navigation.ts  Routes, navigation links and Categories menu content
```

## Status

The responsive Navbar, Categories mega menu, search, Wallet and Login / Sign up buttons and the branded 404 page are built. The homepage is intentionally blank for now, and the other routes are placeholders that show the 404 page until their pages are built.
