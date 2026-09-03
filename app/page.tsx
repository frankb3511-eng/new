import Investigate from "./Investigate";

export default function HomePage() {
  return (
    <>
      <h1>Investigate</h1>
      <p className="subtitle">
        Keyless OSINT across usernames, domains, emails and IP addresses. Every core source below works
        <strong> without an API key, account, or payment</strong> — DNS/WHOIS run locally, everything else
        uses documented public endpoints.
      </p>
      <div className="tier-banner">
        <span className="tier ok">✓ CORE — KEYLESS (default)</span>
        <span className="tier opt">○ Optional API key (never required)</span>
        <span className="tier paid">○ Paid (documented only)</span>
      </div>
      <Investigate />
    </>
  );
}
