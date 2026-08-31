import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { loadPpocr, ppocrReady } from "@/lib/grocery/ppocr";
import { loadScanSettings } from "@/lib/grocery/settings";

/** Compile PP-OCR once per tab, away from the camera page. */
export function EngineHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const cfg = loadScanSettings();
    if (cfg.read !== "ppocr") return;
    if (pathname.startsWith("/scan")) return;
    const t = window.setTimeout(() => {
      if (!ppocrReady()) void loadPpocr();
    }, 300);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return null;
}
