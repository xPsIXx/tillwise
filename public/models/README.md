PP-OCRv6 models
===============

Not committed. When you enable PP-OCR in Settings, Tillwise downloads:

  https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx
  https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx

(inference.onnx + inference.yml), packs them as uncompressed ustar tars, and
caches them in the browser.

To skip the download (offline / air-gapped), drop these files here:

  PP-OCRv6_small_det.tar
  PP-OCRv6_small_rec.tar

Each tar must contain inference.onnx and inference.yml at the root (ustar, not gzip).
