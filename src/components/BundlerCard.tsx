/**
 * Bundler — product tab on the main Kavach dashboard.
 * Presents the Solana Bundler as a downloadable/sellable product; optional link to docs or purchase.
 */

export default function BundlerCard() {
  const productUrl = ""; // Set to your download/sales page or repo when ready
  const docsUrl = "";   // Optional: link to KAVACH.md or full docs

  return (
    <section className="w-full max-w-3xl space-y-4 rounded-2xl border border-border-low bg-card p-6">
      <p className="text-lg font-semibold">Kavach Bundler</p>
      <p className="text-sm text-muted">
        Batch wallets, Jupiter + Jito swaps, optional routing via Kavach router. Run it yourself or host it — no RPC or trading on our side. Sell as download for SOL or USD.
      </p>
      <ul className="list-inside list-disc space-y-1 text-sm text-muted">
        <li>Create/import wallets, fund, sweep</li>
        <li>Buy/sell via Jupiter; bundle via Jito</li>
        <li>Optional: route through Kavach (Core/Stable AMM)</li>
        <li>Dashboard + API; charge once or per trade</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        {productUrl ? (
          <a
            href={productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background hover:opacity-90"
          >
            Get the product
          </a>
        ) : (
          <span className="rounded-lg border border-border-low bg-muted/50 px-4 py-2.5 text-sm text-muted">
            Product link — set when ready
          </span>
        )}
        {docsUrl && (
          <a
            href={docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg border border-border-low px-4 py-2.5 text-sm font-medium hover:bg-cream/20"
          >
            Docs
          </a>
        )}
      </div>
    </section>
  );
}
