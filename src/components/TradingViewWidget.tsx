/**
 * TradingView advanced chart — dark theme + chart color palette from 126/files/chart color.jpg.
 * Use for crypto/symbol charts (e.g. SOL/USD). See CHART-WIDGETS.md for DEXTools (pool chart) and options.
 */
import { useEffect, useRef, memo } from "react";

const CHART_COLORS = {
  backgroundColor: "#1a1a2e",
  gridColor: "rgba(61, 61, 77, 0.3)",
  headerAccent: "#7A2EFF",
};

export interface TradingViewWidgetProps {
  symbol?: string;
  height?: string | number;
  interval?: string;
}

function TradingViewWidget({
  symbol = "BINANCE:SOLUSDT",
  height = "100%",
  interval = "D",
}: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const script = document.createElement("script");
    script.src =
      "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      allow_symbol_change: true,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: false,
      hide_volume: false,
      hotlist: false,
      interval,
      locale: "en",
      save_image: true,
      style: "1",
      symbol,
      theme: "dark",
      timezone: "Etc/UTC",
      backgroundColor: CHART_COLORS.backgroundColor,
      gridColor: CHART_COLORS.gridColor,
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      studies: [],
      autosize: true,
    });
    container.current.appendChild(script);
    return () => {
      if (container.current && script.parentNode === container.current) {
        container.current.removeChild(script);
      }
    };
  }, [symbol, interval]);

  const styleHeight = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className="tradingview-widget-container"
      ref={container}
      style={{ height: styleHeight, width: "100%" }}
    >
      <div
        className="tradingview-widget-container__widget"
        style={{ height: "calc(100% - 32px)", width: "100%" }}
      />
      <div className="tradingview-widget-copyright text-xs text-muted mt-1">
        <a
          href={`https://www.tradingview.com/symbols/${symbol.replace(":", "-")}/`}
          rel="noopener noreferrer"
          target="_blank"
          className="hover:text-foreground"
        >
          {symbol} chart
        </a>
        <span> by TradingView</span>
      </div>
    </div>
  );
}

export default memo(TradingViewWidget);
