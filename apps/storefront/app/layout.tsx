import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "@fontsource/archivo-black/400.css";
import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import { BrandLogo } from "@madeup-video/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Made Up Video",
  description: "A friendly neighbourhood video rental shop.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <header className="site-header">
          <div className="container header-inner">
            <Link className="brand-link" href="/" aria-label="Made Up Video home">
              <BrandLogo variant="full" />
            </Link>
            <nav aria-label="Main navigation">
              <ul className="site-nav">
                <li>
                  <Link href="/">Browse</Link>
                </li>
                <li>
                  <Link href="/rentals">My rentals</Link>
                </li>
              </ul>
            </nav>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="site-footer">
          <div className="container footer-inner">
            <BrandLogo variant="icon" label="Made Up Video" />
            <p>Independent films, friendly service, physical copies.</p>
            <p>Be kind. Rewind when the label asks.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
