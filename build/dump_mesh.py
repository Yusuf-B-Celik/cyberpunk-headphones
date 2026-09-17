#!/usr/bin/env python3
"""Dump the built model as flat triangle arrays for offline (numpy) QA."""
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_model as B  # noqa: E402

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv and len(sys.argv) > sys.argv.index("--") + 1 else "/tmp/mesh.npz"

objs = B.build_all()
tris = []
mats = []
names = []
for o in objs:
    me = o.data
    v = np.array([tuple(o.matrix_world @ x.co) for x in me.vertices], dtype=np.float64)
    mi = np.array([p.material_index for p in me.polygons], dtype=np.int32)
    for p, idx in enumerate(me.polygons):
        vi = list(idx.vertices)
        for k in range(1, len(vi) - 1):
            tris.append((v[vi[0]], v[vi[k]], v[vi[k + 1]]))
            mats.append(mi[p])
            names.append(o.name)
tris = np.array(tris, dtype=np.float64)
mats = np.array(mats, dtype=np.int32)
np.savez_compressed(OUT, tris=tris, mats=mats, mats_order=np.array(B.MAT_ORDER),
                    names=np.array(names))
print("DUMP", OUT, tris.shape, "bbox",
      tris.reshape(-1, 3).min(axis=0).round(4), tris.reshape(-1, 3).max(axis=0).round(4))
