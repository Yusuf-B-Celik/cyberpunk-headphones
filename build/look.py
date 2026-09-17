#!/usr/bin/env python3
"""Quick text-mode look at a render: luminance ramp + structure checks.
Used when no vision model is available, and as a cheap regression check."""
import sys
import numpy as np
from PIL import Image

RAMP = " .:-=+*#%@"


def ascii_view(path, w=104, h=44, gamma=0.55):
    im = Image.open(path).convert("RGB")
    im = im.resize((w, h), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32) / 255.0
    lum = (0.2126 * a[:, :, 0] + 0.7152 * a[:, :, 1] + 0.0722 * a[:, :, 2]) ** gamma
    lo, hi = lum.min(), lum.max()
    n = (lum - lo) / max(1e-6, hi - lo)
    idx = (n * (len(RAMP) - 1)).round().astype(int)
    print(f"== {path}  {im.size[0]}x{im.size[1]}  min={lo:.3f} max={hi:.3f}")
    for row in idx:
        print("".join(RAMP[v] for v in row))


def stats(path):
    a = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0
    h, w, _ = a.shape
    lum = a.max(axis=2)
    print(f"-- stats {path}")
    print(f"   mean RGB {a.mean(axis=(0,1)).round(3)}  p50 {np.percentile(lum,50):.3f} "
          f"p99 {np.percentile(lum,99):.3f}")
    # horizontal mirror symmetry of the front view is a proxy for model symmetry
    d = np.abs(a - a[:, ::-1]).mean()
    print(f"   mirror-diff (0 = perfectly symmetric) {d:.4f}")
    # luminance histograms by band
    for name, y0, y1 in (("top", 0, h // 3), ("mid", h // 3, 2 * h // 3), ("bot", 2 * h // 3, h)):
        band = lum[y0:y1]
        print(f"   band {name:3s} lit>{(band>0.08).mean()*100:5.1f}%  p50 {np.percentile(band,50):.3f}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        stats(p)
        ascii_view(p)
