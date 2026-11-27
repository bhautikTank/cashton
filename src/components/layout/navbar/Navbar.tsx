import BrandLogo from "@/components/brand/BrandLogo";
import DesktopNav from "./DesktopNav";
import { AuthLink, WalletLink } from "./HeaderActions";
import MobileMenu from "./MobileMenu";
import SearchBar from "./SearchBar";

/**
 * Site header: row 1 = logo / search / actions, row 2 = main navigation.
 * Mobile (<768px): logo + hamburger, full-width search below, links in a menu.
 */
export default function Navbar() {
  return (
    <header className="relative z-40 bg-brand-bg font-sans text-brand-ink">
      <div className="mx-auto w-full max-w-[1920px] px-4 sm:px-6 lg:pr-[89px] lg:pl-[73px]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pt-3 pb-3 md:flex-nowrap md:gap-x-5 md:pb-1 lg:gap-x-[38px] lg:pb-5">
          {/* lg:-ml-[3px] offsets the logo SVG's ~3px transparent edge so the visible artwork starts exactly at the left padding edge. */}
          <BrandLogo eager className="w-[165px] md:w-[180px] lg:-ml-[3px] lg:w-[207px]" />

          {/* Desktop search: up to 730px wide; lg:ml-[59px] + the 38px row gap puts it 100px after the
              visible logo artwork (the logo frame has ~3px of transparent edge), matching the CashKaro reference. */}
          <SearchBar className="order-last w-full md:order-none md:w-auto md:max-w-[775px] md:flex-1 lg:mr-auto lg:ml-[59px] lg:max-w-none lg:flex-[0_1_730px]" />

          <div className="ml-auto flex items-center lg:ml-0">
            <div className="hidden items-center gap-3 md:flex lg:gap-[13px]">
              <WalletLink
                compact
                className="h-[52px] w-[52px] text-[17px] lg:h-[55px] lg:w-[55px] xl:w-auto xl:pr-[19px] xl:pl-[21px]"
              />
              <AuthLink className="h-[52px] px-5 text-[15px] lg:h-[55px] lg:px-[26px] lg:text-[17px]" />
            </div>
            <MobileMenu />
          </div>
        </div>

        <DesktopNav />
      </div>
    </header>
  );
}
