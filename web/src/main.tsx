import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "./globals.css";
import { BuilderApp } from "@/components/builder-app";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BuilderApp />
  </StrictMode>
);
