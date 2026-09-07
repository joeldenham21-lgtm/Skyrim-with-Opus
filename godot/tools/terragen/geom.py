"""Polyline geometry for the terrain generator: smoothing, densifying, and fast distance fields on the grid."""
import numpy as np
from scipy.spatial import cKDTree


def catmull_rom(pts, spacing=1.0, tension=0.5):
    """Centripetal-ish Catmull-Rom through the control points, resampled at about `spacing` metres."""
    P = np.asarray(pts, dtype=np.float64)
    if len(P) < 3:
        return densify(P, spacing)
    ext = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        seg = np.linalg.norm(p2 - p1)
        n = max(2, int(np.ceil(seg / spacing)))
        t = np.linspace(0.0, 1.0, n, endpoint=False)[:, None]
        t2 = t * t; t3 = t2 * t
        a = -tension * p0 + (2 - tension) * p1 + (tension - 2) * p2 + tension * p3
        b = 2 * tension * p0 + (tension - 3) * p1 + (3 - 2 * tension) * p2 - tension * p3
        c = -tension * p0 + tension * p2
        d = p1
        out.append(a * t3 + b * t2 + c * t + d)
    out.append(P[-1:])
    return np.vstack(out)


def densify(pts, spacing=1.0):
    P = np.asarray(pts, dtype=np.float64)
    out = []
    for i in range(len(P) - 1):
        seg = np.linalg.norm(P[i + 1] - P[i])
        n = max(1, int(np.ceil(seg / spacing)))
        t = np.linspace(0.0, 1.0, n, endpoint=False)[:, None]
        out.append(P[i] + (P[i + 1] - P[i]) * t)
    out.append(P[-1:])
    return np.vstack(out)


def fillet(pts, radius=10.0, spacing=1.0):
    """Polyline with corners rounded by circular arcs of up to `radius` (limited to 45% of the adjacent
    segment lengths) so the carved road stays within a metre of the design polyline except at bends."""
    P = np.asarray(pts, dtype=np.float64)
    if len(P) < 3:
        return densify(P, spacing)
    out = [P[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1 = a - b; d2 = c - b
        l1 = np.linalg.norm(d1); l2 = np.linalg.norm(d2)
        if l1 < 1e-6 or l2 < 1e-6:
            out.append(b); continue
        u1 = d1 / l1; u2 = d2 / l2
        cosang = np.clip(np.dot(u1, u2), -1.0, 1.0)
        ang = np.arccos(cosang)                      # interior angle at b
        if ang > np.pi - 0.05:
            out.append(b); continue
        r = min(radius, 0.45 * l1 / max(1e-6, np.tan((np.pi - ang) / 2)) * np.tan((np.pi - ang) / 2), 0.45 * l2)
        # tangent distance from the corner along each leg
        tdist = r / np.tan(ang / 2)
        tdist = min(tdist, 0.45 * l1, 0.45 * l2)
        r = tdist * np.tan(ang / 2)
        p1 = b + u1 * tdist; p2 = b + u2 * tdist
        bis = u1 + u2; bis /= np.linalg.norm(bis)
        centre = b + bis * (r / np.sin(ang / 2))
        a0 = np.arctan2(p1[1] - centre[1], p1[0] - centre[0]); a1 = np.arctan2(p2[1] - centre[1], p2[0] - centre[0])
        da = a1 - a0
        while da > np.pi: da -= 2 * np.pi
        while da < -np.pi: da += 2 * np.pi
        n = max(3, int(np.ceil(abs(da) * r / spacing)))
        ang_s = a0 + da * np.linspace(0.0, 1.0, n)
        arc = np.stack([centre[0] + r * np.cos(ang_s), centre[1] + r * np.sin(ang_s)], axis=1)
        out.append(p1); out.extend(arc[1:-1]); out.append(p2)
    out.append(P[-1])
    return densify(np.array(out), spacing)


class PolyField:
    """Distance field of a dense polyline on a grid: distance, arc-length parameter, side and tangent.

    query(gx, gz) works on flattened arrays; the caller restricts to a bounding box for speed.
    """

    def __init__(self, dense_pts):
        self.P = np.asarray(dense_pts, dtype=np.float64)
        seg = np.diff(self.P, axis=0)
        seglen = np.linalg.norm(seg, axis=1)
        self.s = np.concatenate([[0.0], np.cumsum(seglen)])
        self.length = float(self.s[-1])
        tang = np.vstack([seg, seg[-1:]])
        tl = np.linalg.norm(tang, axis=1); tl[tl == 0] = 1.0
        self.tangent = tang / tl[:, None]
        # signed curvature (left turn positive), smoothed over ~10 samples
        ang = np.arctan2(self.tangent[:, 1], self.tangent[:, 0])
        dang = np.diff(np.unwrap(ang), prepend=ang[0])
        k = dang / np.maximum(seglen.mean(), 1e-6)
        kernel = np.ones(15) / 15.0
        self.curv = np.convolve(k, kernel, mode='same')
        self.tree = cKDTree(self.P)

    def query(self, gx, gz):
        """Returns (d, s, side, idx): distance, arc length at the nearest point, side (+1 left of travel)."""
        Q = np.stack([gx, gz], axis=1)
        _, idx = self.tree.query(Q, k=1, workers=-1)
        n = len(self.P)
        best_d = np.full(len(Q), np.inf); best_s = np.zeros(len(Q)); best_side = np.zeros(len(Q))
        for off in (-1, 0):
            i0 = np.clip(idx + off, 0, n - 2); i1 = i0 + 1
            A = self.P[i0]; B = self.P[i1]
            AB = B - A; L2 = np.maximum((AB * AB).sum(1), 1e-9)
            t = np.clip(((Q - A) * AB).sum(1) / L2, 0.0, 1.0)
            C = A + AB * t[:, None]
            dvec = Q - C
            d = np.sqrt((dvec * dvec).sum(1))
            better = d < best_d
            best_d = np.where(better, d, best_d)
            best_s = np.where(better, self.s[i0] + t * np.sqrt(L2), best_s)
            cross = AB[:, 0] * dvec[:, 1] - AB[:, 1] * dvec[:, 0]
            best_side = np.where(better, np.sign(cross), best_side)
        return best_d, best_s, best_side, idx

    def height_along(self, s_query, s_ctrl, h_ctrl):
        return np.interp(s_query, s_ctrl, h_ctrl)

    def s_at(self, x, z):
        """Arc-length parameter of the point on the line nearest to (x, z)."""
        d, s, _, _ = self.query(np.array([x], dtype=np.float64), np.array([z], dtype=np.float64))
        return float(s[0])


def bbox_slices(pts, margin, half, N):
    """Grid index slices covering the polyline's bounding box expanded by margin (grid is 1 m, origin -half)."""
    P = np.asarray(pts)
    x0 = int(np.floor(P[:, 0].min() - margin + half)); x1 = int(np.ceil(P[:, 0].max() + margin + half)) + 1
    z0 = int(np.floor(P[:, 1].min() - margin + half)); z1 = int(np.ceil(P[:, 1].max() + margin + half)) + 1
    x0 = max(0, x0); z0 = max(0, z0); x1 = min(N + 1, x1); z1 = min(N + 1, z1)
    return slice(z0, z1), slice(x0, x1)


def seg_intersections(pa, pb):
    """All intersection points of two open polylines (lists of [x, z])."""
    out = []
    A = np.asarray(pa, dtype=np.float64); B = np.asarray(pb, dtype=np.float64)
    for i in range(len(A) - 1):
        p = A[i]; r = A[i + 1] - A[i]
        for j in range(len(B) - 1):
            q = B[j]; s = B[j + 1] - B[j]
            den = r[0] * s[1] - r[1] * s[0]
            if abs(den) < 1e-9:
                continue
            qp = q - p
            t = (qp[0] * s[1] - qp[1] * s[0]) / den
            u = (qp[0] * r[1] - qp[1] * r[0]) / den
            if 0 <= t <= 1 and 0 <= u <= 1:
                out.append((p + r * t, r / np.linalg.norm(r), s / np.linalg.norm(s)))
    return out
