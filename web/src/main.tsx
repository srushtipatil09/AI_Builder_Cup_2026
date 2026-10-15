import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { listenForInstall } from "./install";
import "./styles.css";

listenForInstall();

// Chrome installs only with a service worker. On the dev server it passes requests through, so Vite reloads stay fresh.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register(import.meta.env.PROD ? "/sw.js" : "/sw.js?mode=dev");
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
