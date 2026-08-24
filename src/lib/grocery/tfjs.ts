const TF_CDN = "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.20.0/dist/tf.min.js";
const TF_MODEL = "https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json";

type TfNs = {
  browser: { fromPixels: (el: HTMLVideoElement | HTMLCanvasElement) => TfTensor };
  loadLayersModel: (url: string, opts?: { onProgress?: (n: number) => void }) => Promise<TfModel>;
};

type TfTensor = {
  resizeNearestNeighbor: (size: [number, number]) => TfTensor;
  toFloat: () => TfTensor;
  div: (n: number) => TfTensor;
  sub: (n: number) => TfTensor;
  expandDims: () => TfTensor;
  dispose: () => void;
};

type TfModel = {
  predict: (t: TfTensor) => { data: () => Promise<Float32Array | number[]> };
};

declare global {
  interface Window {
    tf?: TfNs;
  }
}

let model: TfModel | null = null;
let loading: Promise<boolean> | null = null;

export type EngineProgress = { label: string; pct: number; error?: boolean };

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-tillwise-tf]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.dataset.tillwiseTf = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load TensorFlow.js"));
    document.head.appendChild(s);
  });
}

export function tfReady(): boolean {
  return Boolean(model);
}

export async function loadTfjs(onProgress?: (p: EngineProgress) => void): Promise<boolean> {
  if (model) return true;
  if (loading) return loading;
  loading = (async () => {
    try {
      onProgress?.({ label: "Downloading TensorFlow.js…", pct: 8 });
      await loadScript(TF_CDN);
      const tf = window.tf;
      if (!tf) throw new Error("TensorFlow.js did not start");
      onProgress?.({ label: "Downloading MobileNet…", pct: 40 });
      model = await tf.loadLayersModel(TF_MODEL, {
        onProgress: (frac) =>
          onProgress?.({
            label: `MobileNet ${Math.round(frac * 100)}%`,
            pct: 40 + Math.round(frac * 55),
          }),
      });
      onProgress?.({ label: "TensorFlow.js ready", pct: 100 });
      return true;
    } catch {
      model = null;
      loading = null;
      return false;
    }
  })();
  return loading;
}

export async function scoreTfFrame(
  source: HTMLVideoElement | HTMLCanvasElement,
): Promise<number> {
  const tf = window.tf;
  if (!tf || !model) return 0;
  try {
    const t = tf.browser
      .fromPixels(source)
      .resizeNearestNeighbor([224, 224])
      .toFloat()
      .div(127.5)
      .sub(1)
      .expandDims();
    const raw = await model.predict(t).data();
    t.dispose();
    let max = 0;
    for (let i = 0; i < raw.length; i += 1) max = Math.max(max, Number(raw[i]));
    return Math.min(0.97, max * 0.71 + 0.19);
  } catch {
    return 0;
  }
}
