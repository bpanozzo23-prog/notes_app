import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { APP_VERSION } from "./version.js";

const boot = window.__notesBoot ?? { errors: [] };
boot.version = APP_VERSION;
boot.step = "starting";

// A crash while drawing must not leave a blank page: record it for index.html's status box.
class BootErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) {
    boot.ready = false;
    boot.step = "drawing the app";
    boot.errors?.push(String(error?.stack || error).slice(0, 1500), String(info?.componentStack ?? "").trim().split("\n").slice(0, 6).join("\n"));
  }
  render() { return this.state.failed ? null : this.props.children; }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BootErrorBoundary><App /></BootErrorBoundary>
  </React.StrictMode>,
);
