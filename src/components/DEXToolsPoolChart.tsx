/**
 * DEXTools chart iframe for a Solana pool. Use your pool PDA as the pair address.
 * Customizable colors (chart color palette). See CHART-WIDGETS.md.
 * Note: DEXTools may show "no data" until they index Kavach AMM; iframe still embeds for when they do.
 */
import { memo } from "react";

const DEXT_BASE = "https://www.dextools.io/widget-chart/en/solana/pe-light";
const CHART_COLORS = {
  headerColor: "7A2EFF",
  tvPlatformColor: "2d2d2d",
  tvPaneColor: "252530",
};

export interface DEXToolsPoolChartProps {
  /** Pool account address (PDA from getPoolPda(mintA, mintB)) */
  poolAddress: string;
  height?: number | string;
  chartType?: number;
  chartResolution?: string | number;
  /** Override header color (hex without #) */
  headerColor?: string;
  /** Override chart background (hex without #) */
  tvPlatformColor?: string;
  /** Override pane/controls (hex without #) */
  tvPaneColor?: string;
}

function DEXToolsPoolChart({
  poolAddress,
  height = 400,
  chartType = 2,
  chartResolution = 30,
  headerColor = CHART_COLORS.headerColor,
  tvPlatformColor = CHART_COLORS.tvPlatformColor,
  tvPaneColor = CHART_COLORS.tvPaneColor,
}: DEXToolsPoolChartProps) {
  const params = new URLSearchParams({
    theme: "dark",
    chartType: String(chartType),
    chartResolution: String(chartResolution),
    drawingToolbars: "false",
    headerColor,
    tvPlatformColor,
    tvPaneColor,
  });
  const src = `${DEXT_BASE}/${poolAddress}?${params.toString()}`;
  const styleHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div className="rounded-xl overflow-hidden border border-border-low bg-card/30" style={{ minHeight: styleHeight }}>
      <iframe
        title="DEXTools Trading Chart"
        width="100%"
        height={styleHeight}
        src={src}
        className="block w-full"
      />
      <p className="text-xs text-muted px-3 py-1 bg-card/50">
        Chart by DEXTools. Data may appear once the pool is indexed.
      </p>
    </div>
  );
}

export default memo(DEXToolsPoolChart);
