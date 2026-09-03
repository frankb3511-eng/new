import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keyless OSINT Workbench",
  description:
    "Local-first, keyless OSINT investigation. Core scans for usernames, domains, emails, IPs and images work with no API keys, no accounts, no paid services.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="wrap topbar-inner">
            <a href="/" className="brand">
              <span className="logo">◈</span> Keyless OSINT
              <span className="brand-tag">local-first workbench</span>
            </a>
            <nav>
              <a href="/">Investigate</a>
              <a href="/image">Image lab</a>
              <a href="/sources">Sources</a>
              <a href="/health">Health</a>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="wrap footer">
          <p>
            Core scans are <strong>keyless and free</strong> — local DNS/WHOIS, RDAP, public registries,
            Certificate Transparency and local image analysis. No API key is required to investigate.
          </p>
          <p className="muted">
            Use responsibly and lawfully. Every source and its automation policy is documented on the{" "}
            <a href="/sources">Sources</a> page. Nothing here bypasses authentication or rate limits.
          </p>
        </footer>
      </body>
    </html>
  );
}
