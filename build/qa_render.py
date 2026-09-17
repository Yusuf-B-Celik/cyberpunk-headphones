#!/usr/bin/env python3
"""
Offline QA renderer: rasterises the dumped model with numpy and prints ASCII
shaded views (silhouette + form + panel-line edges) so the geometry can be
inspected without a GPU render or a vision model.

usage: python3 build/qa_render.py /tmp/mesh.npz [front|side|iso|all]
"""
import sys

import numpy as np

RAMP = " .:-=+*#%@"


def load(path):
    d = np.load(path, allow_pickle=True)
    return d["tris"], d["mats"], list(d["mats_order"])


def render(tris, size=(150, 62), view="front", fov=0.36, margin=1.18):
    """Orthographic-ish projection with a perspective divide; z-buffered."""
    W, H = size
    c = (tris.reshape(-1, 3).min(axis=0) + tris.reshape(-1, 3).max(axis=0)) / 2
    radius = np.linalg.norm(tris.reshape(-1, 3) - c, axis=1).max()
    dist = radius / np.tan(fov / 2) * margin
    if view == "front":
        eye, up = np.array([0, -1, 0.06]), np.array([0, 0, 1])
    elif view == "side":
        eye, up = np.array([1, -0.02, 0.04]), np.array([0, 0, 1])
    elif view == "iso":
        eye, up = np.array([0.8, -0.9, 0.42]), np.array([0, 0, 1])
    elif view == "top":
        eye, up = np.array([0.0, -0.15, 1.0]), np.array([0, 1, 0])
    else:
        eye, up = np.array([0, -1, 0]), np.array([0, 0, 1])
    eye = eye / np.linalg.norm(eye)
    fwd = -eye
    right = np.cross(fwd, up)
    right /= np.linalg.norm(right)
    upv = np.cross(right, fwd)

    p = tris - c + eye * dist          # camera at origin looking along -fwd
    x = p @ right
    y = p @ upv
    z = p @ (-fwd)                     # depth, positive in front
    z = np.maximum(z, 1e-6)
    # cell aspect: ASCII characters are ~2x taller than wide
    px = (W / 2) / np.tan(fov / 2)
    sx = (x / z) * px + W / 2
    sy = -(y / z) * px * 0.5 + H / 2

    zbuf = np.full((H, W), 1e9)
    shade = np.zeros((H, W))
    # lambert shading from two fixed lights in view space
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    nl = np.linalg.norm(n, axis=1)
    nl[nl == 0] = 1
    n = n / nl[:, None]
    l1 = np.array([-0.45, -0.75, 0.5]); l1 /= np.linalg.norm(l1)
    l2 = np.array([0.6, 0.35, 0.55]); l2 /= np.linalg.norm(l2)
    lit = 0.16 + 0.72 * np.abs(n @ l1) + 0.34 * np.abs(n @ l2)
    lit = np.clip(lit, 0, 1.3)

    for i in range(len(tris)):
        x0, x1 = int(np.floor(sx[i].min())), int(np.ceil(sx[i].max()))
        y0, y1 = int(np.floor(sy[i].min())), int(np.ceil(sy[i].max()))
        if x1 < 0 or y1 < 0 or x0 >= W or y0 >= H:
            continue
        x0, x1 = max(x0, 0), min(x1, W - 1)
        y0, y1 = max(y0, 0), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        ax, ay = sx[i, 0], sy[i, 0]
        bx, by = sx[i, 1], sy[i, 1]
        cx, cy = sx[i, 2], sy[i, 2]
        d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(d) < 1e-12:
            continue
        w0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / d
        w1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / d
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not m.any():
            continue
        zi = w0 * z[i, 0] + w1 * z[i, 1] + w2 * z[i, 2]
        sub = zbuf[y0:y1 + 1, x0:x1 + 1]
        upd = m & (zi < sub)
        sub[upd] = zi[upd]
        shade[y0:y1 + 1, x0:x1 + 1][upd] = lit[i]

    # depth-discontinuity edges = silhouette / panel lines read as line work
    gz = np.zeros_like(shade)
    gz[:-1, :] += np.abs(np.diff(np.where(zbuf > 1e8, 0, zbuf), axis=0))
    gz[:, :-1] += np.abs(np.diff(np.where(zbuf > 1e8, 0, zbuf), axis=1))
    holes = zbuf > 1e8
    gz[holes] = 0
    return shade, gz, holes


def to_ascii(shade, holes, edges=True, gz=None):
    s = shade.copy()
    if edges and gz is not None:
        e = gz > (np.percentile(gz[gz > 0], 55) if (gz > 0).any() else 1e9)
        s = np.where(e, 0.0, s)
    s = np.where(holes, np.nan, s)
    lines = []
    for row in s:
        out = ""
        for v in row:
            if np.isnan(v):
                out += " "
            else:
                out += RAMP[min(len(RAMP) - 1, int(np.clip(v, 0, 1) * (len(RAMP) - 1)))]
        lines.append(out)
    return "\n".join(lines)


def checks(tris):
    """Numeric sanity checks that do not need eyes."""
    P = tris.reshape(-1, 3)
    lo, hi = P.min(axis=0), P.max(axis=0)
    print(f"bbox  x[{lo[0]:+.3f},{hi[0]:+.3f}] y[{lo[1]:+.3f},{hi[1]:+.3f}] z[{lo[2]:+.3f},{hi[2]:+.3f}]")
    print(f"size  w={hi[0]-lo[0]:.3f} h={hi[2]-lo[2]:.3f} d={hi[1]-lo[1]:.3f} m")
    # mirror symmetry of the point cloud across X = 0
    q = np.round(P, 4)
    qm = q.copy()
    qm[:, 0] *= -1
    a = set(map(tuple, q))
    b = set(map(tuple, qm))
    only_a = len(a - b)
    print(f"verts {len(P)}  mirror: {len(a & b)}/{len(a)} matched  ({only_a} unmatched)")
    # degenerate triangles
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    area = np.linalg.norm(n, axis=1) / 2
    print(f"triangles {len(tris)}  min area {area.min():.3e}  degenerate(<1e-9) {(area<1e-9).sum()}")


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/mesh.npz"
    views = sys.argv[2] if len(sys.argv) > 2 else "all"
    tris, mats, order = load(path)
    checks(tris)
    for v in (["front", "side", "iso", "top"] if views == "all" else [views]):
        s, gz, h = render(tris, (150, 60), v)
        print(f"\n===== {v} =====")
        print(to_ascii(s, h, True, gz))
