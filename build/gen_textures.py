#!/usr/bin/env python3
"""
Procedural texture generator for the cyberpunk headphone model.

Outputs (all tileable, 1024x1024 unless noted):
  carbon_normal.png      normal map, 2/2 twill weave matte carbon fiber
  carbon_rough.png       roughness map matching the weave
  carbon_base.png        base colour (very dark, slight fibre variation)
  leather_normal.png     normal map, soft-grain leather
  leather_rough.png      roughness map for the leather
  leather_base.png       base colour (near-black warm charcoal, subtle mottle)
  grille_alpha.png       perforation alpha for the driver grille
"""
import os
import numpy as np
from PIL import Image

S = 1024
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "textures")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20260917)


# ----------------------------------------------------------------- helpers
def to_tile(img, w, h):
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((w, h), Image.LANCZOS)


def save(name, arr, size=(S, S), jpg=False):
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=-1)
    im = to_tile(arr, *size)
    if jpg:
        name = os.path.splitext(name)[0] + ".jpg"
        im.convert("RGB").save(os.path.join(OUT, name), quality=93, optimize=True, subsampling=0)
    else:
        im.save(os.path.join(OUT, name), optimize=True)
    print("wrote", name)


def pnoise(shape, cutoff, rng=rng, octaves=1, persistence=0.5):
    """Periodic band-limited noise: white noise low-passed in the frequency
    domain, so the result tiles seamlessly by construction."""
    out = np.zeros(shape, dtype=np.float64)
    amp = 1.0
    for o in range(octaves):
        f = cutoff * (2 ** o)
        w = rng.standard_normal(shape)
        W = np.fft.fft2(w)
        fy = np.fft.fftfreq(shape[0])[:, None]
        fx = np.fft.fftfreq(shape[1])[None, :]
        r = np.sqrt(fy ** 2 + fx ** 2)
        lp = np.exp(-(r / f) ** 4)  # hard-ish Gaussian-ish low pass
        n = np.real(np.fft.ifft2(W * lp))
        n = (n - n.mean()) / (n.std() + 1e-9)
        out += amp * n
        amp *= persistence
    out = (out - out.mean()) / (out.std() + 1e-9)
    return out


def height_to_normal(h, strength=1.0, up="y"):
    """Sobel height -> tangent space normal map (0..255)."""
    gy, gx = np.gradient(h)
    nx = -gx * strength
    ny = -gy * strength
    nz = np.ones_like(h)
    ln = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2)
    nx, ny, nz = nx / ln, ny / ln, nz / ln
    if up == "y":
        # OpenGL / Blender convention: +Y is up in the texture
        return np.stack([(nx * 0.5 + 0.5) * 255, (ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255], axis=-1)
    # DirectX: flip green
    return np.stack([(nx * 0.5 + 0.5) * 255, (-ny * 0.5 + 0.5) * 255, (nz * 0.5 + 0.5) * 255], axis=-1)


def gray(v):
    return np.full((S, S), float(v))


# ------------------------------------------------------------ carbon fiber
def build_carbon():
    """2/2 twill weave. The height field is the sum of the two tow families;
    whichever family is on top at a given cell contributes its crown."""
    threads = 32                      # tows across the tile
    cell = S // threads
    Y, X = np.mgrid[0:S, 0:S]
    ii, jj = X // cell, Y // cell
    U = (X % cell) / cell
    V = (Y % cell) / cell

    # rounded tow cross sections
    def crown(t, p=0.5):
        return np.sin(np.pi * t) ** p

    warp = crown(U)                   # warps run along Y
    weft = crown(V)                   # wefts run along X

    # per-tow amplitude variation, periodic -> stays tileable
    ta = rng.normal(1.0, 0.05, size=threads)
    tb = rng.normal(1.0, 0.05, size=threads)
    warpn = warp * ta[ii]
    weftn = weft * tb[jj]

    warp_top = ((ii + jj) % 4) < 2    # 2/2 twill
    h = np.where(warp_top, warpn - 0.45 * weftn, weftn - 0.45 * warpn)
    h -= h.mean()

    # faint resin surface ripples + micro speckle so it reads as matte resin
    h += 0.02 * pnoise((S, S), 0.05)
    h += 0.006 * pnoise((S, S), 0.35)

    h = h / (np.abs(h).max() + 1e-9)
    save("carbon_normal.png", height_to_normal(h, strength=1.15))

    # roughness: tow crowns a touch glossier, valleys/resin a touch rougher
    r = 0.46 + 0.10 * (1.0 - h) + 0.03 * pnoise((S, S), 0.08)
    save("carbon_rough.png", np.clip(r, 0.30, 0.72) * 255, size=(256, 256), jpg=True)

    # base colour: near-black graphite with a whisper of fibre variation
    c = 26 + 10 * h + 2.5 * pnoise((S, S), 0.12)
    base = np.stack([c * 0.92, c * 0.97, c * 1.06], axis=-1)
    save("carbon_base.png", base, jpg=True)


# ---------------------------------------------------------------- leather
def build_leather():
    """Soft leather: broad soft mottle, cracked creases, and fine pores."""
    mottle = pnoise((S, S), 0.02, octaves=3, persistence=0.55)

    mid = pnoise((S, S), 0.09, octaves=2, persistence=0.5)
    creases = 1.0 - np.abs(pnoise((S, S), 0.07, octaves=3, persistence=0.6))
    creases = creases ** 6                       # thin ridged crease network

    pores = pnoise((S, S), 0.42, octaves=2, persistence=0.5)
    pores = np.clip(pores, 0, None) ** 2         # sparse pebbled grain
    pores -= 0.35 * (pnoise((S, S), 0.45) ** 3)  # a few open pits

    h = (0.55 * mottle + 0.30 * mid + 0.85 * creases * 0.45 + 0.22 * pores)
    h = (h - h.mean()) / (h.std() + 1e-9)
    save("leather_normal.png", height_to_normal(h, strength=1.5), size=(512, 512))

    # creases catch a touch more sheen than the flat grain
    r = 0.74 - 0.10 * creases + 0.035 * pnoise((S, S), 0.10)
    save("leather_rough.png", np.clip(r, 0.52, 0.92) * 255, size=(256, 256), jpg=True)

    # dark warm charcoal with mottling, softly lit by the grain
    c = 30 + 7.0 * mottle + 5.0 * pores - 4.0 * creases
    base = np.stack([c * 1.10, c * 0.98, c * 0.95], axis=-1)
    save("leather_base.png", base, size=(512, 512), jpg=True)


# ---------------------------------------------------------------- grille
def build_grille():
    """Alpha-only perforation pattern (plus a normal map for depth)."""
    Y, X = np.mgrid[0:S, 0:S]
    pitch = 32
    cx = ((X + pitch // 2) // pitch) * pitch
    cy = ((Y + pitch // 2) // pitch) * pitch
    # hexagonal offset rows
    row = (Y // pitch) % 2
    cx = (((X + pitch // 2) // pitch) * pitch + row * pitch // 2)
    d = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    radius = pitch * 0.30
    hole = np.clip((radius - d) / 1.5, 0, 1)          # 1 inside the hole
    save("grille_alpha.png", (1.0 - hole) * 255)
    h = (1.0 - hole) * 0.6 - hole * 0.6
    save("grille_normal.png", height_to_normal(h, strength=1.2))


if __name__ == "__main__":
    build_carbon()
    build_leather()
    build_grille()
    print("textures ->", os.path.normpath(OUT))
