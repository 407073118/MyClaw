import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { useAuthStore } from "./stores/auth";
import "./styles/global.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

// Hydrate auth from localStorage before rendering
useAuthStore.getState().hydrateFromStorage();

const root = createRoot(rootEl);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
