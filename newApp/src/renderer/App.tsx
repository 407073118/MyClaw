import React from "react";
import { HashRouter } from "react-router-dom";

import { ErrorBoundary } from "./components/ErrorBoundary";
import { AppRoutes } from "./router";

export default function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </ErrorBoundary>
  );
}
