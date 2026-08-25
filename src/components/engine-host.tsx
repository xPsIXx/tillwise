import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { loadPpocr, ppocrReady } from "@/lib/grocery/ppocr";
import { loadScanSettings } from "@/lib/grocery/settings";
import { loadTfjs, tfReady } from "@/lib/grocery/tfjs";

/** Compile PP-OCR / TF.js once per tab, away from the camera page. */
export function EngineHost() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const cfg = loadScanSettings();
    const needPpocr = cfg.detect === "ppocr" || cfg.read === "ppocr";
    const needTf = cfg.detect === "tensorflow";
    if (!needPpocr && !needTf) return;
    if (pathname.startsWith("/scan")) return;
    const t = window.setTimeout(() => {
      if (needTf && !tfReady()) void loadTfjs();
      if (needPpocr && !ppocrReady()) void loadPpocr();
    }, 300);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return null;
}
