/** Buffer polyfill for browser (Solana Keypair, PDA seeds, etc. use Node Buffer) */
import { Buffer } from "buffer";
if (typeof globalThis !== "undefined") (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Providers } from "./providers";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <App />
    </Providers>
  </StrictMode>
);
