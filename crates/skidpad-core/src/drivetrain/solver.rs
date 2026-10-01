//! A tiny dense constrained-velocity solver (ADR-0011): at most five
//! unknowns (four wheels and a power unit) and eight bounded velocity
//! constraints, solved by projected Gauss-Seidel on the impulses with the
//! exact inverse mass matrix. Fixed sizes, fixed iteration count, no
//! allocation.

// The index loops mirror the matrix algebra and walk several arrays in
// lock step; iterator forms would obscure them.
#![allow(clippy::needless_range_loop)]

use skidpad_math as m;

pub const MAX_DOF: usize = 5;
pub const MAX_CONSTRAINTS: usize = 8;

/// One bounded velocity constraint `J · v → 0` with impulse bounds.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Constraint {
    pub j: [f64; MAX_DOF],
    pub lo: f64,
    pub hi: f64,
    /// Accumulated impulse (N·m·s), the solution.
    pub lambda: f64,
    /// `M⁻¹ Jᵀ`, filled by [`System::prepare`].
    pub w: [f64; MAX_DOF],
    /// `J M⁻¹ Jᵀ`, the inverse effective mass.
    pub d: f64,
}

impl Constraint {
    pub fn new(j: [f64; MAX_DOF], lo: f64, hi: f64) -> Self {
        Self {
            j,
            lo,
            hi,
            lambda: 0.0,
            w: [0.0; MAX_DOF],
            d: 0.0,
        }
    }

    /// Torque equivalent of the impulse over a step.
    #[inline]
    pub fn torque(&self, dt: f64) -> f64 {
        self.lambda / dt
    }
}

/// The mass matrix, its inverse and the velocity vector.
#[derive(Clone, Debug, PartialEq)]
pub struct System {
    pub n: usize,
    pub mass: [[f64; MAX_DOF]; MAX_DOF],
    pub inv: [[f64; MAX_DOF]; MAX_DOF],
    pub v: [f64; MAX_DOF],
}

impl System {
    pub fn new(n: usize) -> Self {
        Self {
            n,
            mass: [[0.0; MAX_DOF]; MAX_DOF],
            inv: [[0.0; MAX_DOF]; MAX_DOF],
            v: [0.0; MAX_DOF],
        }
    }

    /// Invert the mass matrix (Gauss-Jordan with partial pivoting). The
    /// matrix is symmetric positive definite whenever every inertia is
    /// positive, so this cannot fail on valid input; a singular matrix
    /// leaves the inverse as the identity and returns `false`.
    pub fn invert(&mut self) -> bool {
        let n = self.n;
        let mut a = self.mass;
        let mut inv = [[0.0; MAX_DOF]; MAX_DOF];
        for i in 0..n {
            inv[i][i] = 1.0;
        }
        for col in 0..n {
            let mut pivot = col;
            let mut best = m::abs(a[col][col]);
            for r in col + 1..n {
                let v = m::abs(a[r][col]);
                if v > best {
                    best = v;
                    pivot = r;
                }
            }
            if !(best > 1e-300) {
                self.inv = [[0.0; MAX_DOF]; MAX_DOF];
                for i in 0..n {
                    self.inv[i][i] = 1.0;
                }
                return false;
            }
            if pivot != col {
                a.swap(pivot, col);
                inv.swap(pivot, col);
            }
            let p = 1.0 / a[col][col];
            for k in 0..n {
                a[col][k] *= p;
                inv[col][k] *= p;
            }
            for r in 0..n {
                if r == col {
                    continue;
                }
                let f = a[r][col];
                if f == 0.0 {
                    continue;
                }
                for k in 0..n {
                    a[r][k] -= f * a[col][k];
                    inv[r][k] -= f * inv[col][k];
                }
            }
        }
        self.inv = inv;
        true
    }

    /// `v += M⁻¹ q · dt` for a generalised force vector `q`.
    pub fn apply_forces(&mut self, q: &[f64; MAX_DOF], dt: f64) {
        let n = self.n;
        let mut dv = [0.0; MAX_DOF];
        for i in 0..n {
            let mut s = 0.0;
            for j in 0..n {
                s += self.inv[i][j] * q[j];
            }
            dv[i] = s * dt;
        }
        for i in 0..n {
            self.v[i] += dv[i];
        }
    }

    /// Compute `w = M⁻¹ Jᵀ` and `d = J w` for each constraint.
    pub fn prepare(&self, constraints: &mut [Constraint]) {
        let n = self.n;
        for c in constraints.iter_mut() {
            let mut d = 0.0;
            for i in 0..n {
                let mut s = 0.0;
                for j in 0..n {
                    s += self.inv[i][j] * c.j[j];
                }
                c.w[i] = s;
                d += c.j[i] * s;
            }
            c.d = d;
        }
    }

    /// Solve the bounded constraints by a projected block method: every
    /// constraint not at a bound is solved jointly and exactly (the active
    /// set), the impulses that land outside their bounds are clamped and
    /// held, and the block is re-solved, for at most `max_iters` rounds.
    /// `update_bounds` runs before each round with the current impulses, for
    /// bounds that depend on them (torque-sensing differentials). Rigid
    /// couplings coupled through large reflected inertias therefore converge
    /// in one round, where Gauss-Seidel sweeps would need hundreds.
    ///
    /// `self.v` must hold the free velocities on entry and holds the
    /// constrained velocities on exit; `prepare` must have run.
    pub fn solve(
        &mut self,
        cs: &mut [Constraint],
        mut update_bounds: impl FnMut(&mut [Constraint]),
        max_iters: usize,
    ) {
        let n = self.n;
        let m = cs.len();
        if m == 0 {
            return;
        }
        // Gram matrix G = J M⁻¹ Jᵀ and the free relative speeds.
        let mut g = [[0.0; MAX_CONSTRAINTS]; MAX_CONSTRAINTS];
        let mut rel0 = [0.0; MAX_CONSTRAINTS];
        for k in 0..m {
            rel0[k] = self.relative_speed(&cs[k]);
            for l in k..m {
                let mut acc = 0.0;
                for i in 0..n {
                    acc += cs[k].j[i] * cs[l].w[i];
                }
                g[k][l] = acc;
                g[l][k] = acc;
            }
        }
        let mut scale: f64 = 0.0;
        for k in 0..m {
            scale = m::max(scale, g[k][k]);
            cs[k].lambda = 0.0;
        }
        let mut saturated = [false; MAX_CONSTRAINTS];
        for _ in 0..max_iters {
            update_bounds(cs);
            // Zero-capacity constraints carry nothing.
            for k in 0..m {
                if !(cs[k].hi > cs[k].lo) {
                    cs[k].lambda = m::clamp(0.0, cs[k].lo, cs[k].hi);
                    saturated[k] = true;
                }
            }
            // Active set as equalities, saturated impulses on the right side.
            let mut index = [0usize; MAX_CONSTRAINTS];
            let mut na = 0;
            for k in 0..m {
                if !saturated[k] {
                    index[na] = k;
                    na += 1;
                }
            }
            let mut changed = false;
            if na > 0 {
                // S λ = rhs for the active set. Dependent constraints (a
                // locked differential under two locked brakes) make S
                // singular; the solve is regularised and refined so it
                // returns the minimum-norm solution, which shares the impulse
                // between the dependent constraints and keeps independent
                // ones exact to rounding.
                let mut sm = [[0.0; MAX_CONSTRAINTS]; MAX_CONSTRAINTS];
                let mut rhs = [0.0; MAX_CONSTRAINTS];
                for p in 0..na {
                    let k = index[p];
                    let mut r = -rel0[k];
                    for l in 0..m {
                        if saturated[l] {
                            r -= g[k][l] * cs[l].lambda;
                        }
                    }
                    rhs[p] = r;
                    for q in 0..na {
                        sm[p][q] = g[k][index[q]];
                    }
                }
                let eps = 1e-8 * scale;
                let mut b = solve_regularised(&sm, &rhs, na, eps);
                for _ in 0..2 {
                    let mut residual = [0.0; MAX_CONSTRAINTS];
                    for p in 0..na {
                        let mut r = rhs[p];
                        for q in 0..na {
                            r -= sm[p][q] * b[q];
                        }
                        residual[p] = r;
                    }
                    let delta = solve_regularised(&sm, &residual, na, eps);
                    for p in 0..na {
                        b[p] += delta[p];
                    }
                }
                for p in 0..na {
                    let k = index[p];
                    let c = &mut cs[k];
                    if b[p] > c.hi {
                        c.lambda = c.hi;
                        saturated[k] = true;
                        changed = true;
                    } else if b[p] < c.lo {
                        c.lambda = c.lo;
                        saturated[k] = true;
                        changed = true;
                    } else {
                        c.lambda = b[p];
                    }
                }
            }
            // A held constraint whose relative speed now points back inside
            // its bound, or whose bound has grown past its impulse, rejoins
            // the active set.
            for k in 0..m {
                if !saturated[k] || !(cs[k].hi > cs[k].lo) {
                    continue;
                }
                let mut rel = rel0[k];
                for l in 0..m {
                    rel += g[k][l] * cs[l].lambda;
                }
                let c = &cs[k];
                let inside = c.lambda > c.lo && c.lambda < c.hi;
                if inside || (c.lambda >= c.hi && rel > 1e-9) || (c.lambda <= c.lo && rel < -1e-9) {
                    saturated[k] = false;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for k in 0..m {
            let lambda = cs[k].lambda;
            if lambda != 0.0 {
                for i in 0..n {
                    self.v[i] += cs[k].w[i] * lambda;
                }
            }
        }
    }

    /// Relative speed `J · v` of a constraint at the current velocities.
    pub fn relative_speed(&self, c: &Constraint) -> f64 {
        let mut rel = 0.0;
        for i in 0..self.n {
            rel += c.j[i] * self.v[i];
        }
        rel
    }
}

/// Solve `(S + ε I) x = rhs` by Gaussian elimination with partial pivoting,
/// `m ≤ MAX_CONSTRAINTS`. Fixed storage, no allocation.
fn solve_regularised(
    s: &[[f64; MAX_CONSTRAINTS]; MAX_CONSTRAINTS],
    rhs: &[f64; MAX_CONSTRAINTS],
    m: usize,
    eps: f64,
) -> [f64; MAX_CONSTRAINTS] {
    let mut a = *s;
    let mut b = *rhs;
    for i in 0..m {
        a[i][i] += eps;
    }
    for col in 0..m {
        let mut pivot = col;
        let mut best = m::abs(a[col][col]);
        for r in col + 1..m {
            let v = m::abs(a[r][col]);
            if v > best {
                best = v;
                pivot = r;
            }
        }
        if !(best > 0.0) {
            b[col] = 0.0;
            continue;
        }
        if pivot != col {
            a.swap(pivot, col);
            b.swap(pivot, col);
        }
        let inv = 1.0 / a[col][col];
        for r in col + 1..m {
            let f = a[r][col] * inv;
            if f == 0.0 {
                continue;
            }
            for k in col..m {
                a[r][k] -= f * a[col][k];
            }
            b[r] -= f * b[col];
        }
    }
    for col in (0..m).rev() {
        let mut acc = b[col];
        for k in col + 1..m {
            acc -= a[col][k] * b[k];
        }
        b[col] = if a[col][col] != 0.0 {
            acc / a[col][col]
        } else {
            0.0
        };
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inverse_of_a_coupled_matrix() {
        let mut s = System::new(3);
        s.mass = [
            [2.0, 0.5, 0.0, 0.0, 0.0],
            [0.5, 3.0, 0.5, 0.0, 0.0],
            [0.0, 0.5, 1.0, 0.0, 0.0],
            [0.0; 5],
            [0.0; 5],
        ];
        assert!(s.invert());
        for i in 0..3 {
            for j in 0..3 {
                let mut p = 0.0;
                for k in 0..3 {
                    p += s.mass[i][k] * s.inv[k][j];
                }
                let want = if i == j { 1.0 } else { 0.0 };
                assert!((p - want).abs() < 1e-12, "({i},{j}) = {p}");
            }
        }
    }

    #[test]
    fn a_rigid_constraint_equalises_two_inertias_by_momentum() {
        let mut s = System::new(2);
        s.mass[0][0] = 1.0;
        s.mass[1][1] = 3.0;
        s.invert();
        s.v = [4.0, 0.0, 0.0, 0.0, 0.0];
        let mut c = [Constraint::new(
            [1.0, -1.0, 0.0, 0.0, 0.0],
            f64::NEG_INFINITY,
            f64::INFINITY,
        )];
        s.prepare(&mut c);
        s.solve(&mut c, |_| {}, 4);
        assert!((s.v[0] - 1.0).abs() < 1e-12 && (s.v[1] - 1.0).abs() < 1e-12);
        assert!((c[0].lambda + 3.0).abs() < 1e-12);
    }

    #[test]
    fn a_bounded_constraint_saturates() {
        let mut s = System::new(2);
        s.mass[0][0] = 1.0;
        s.mass[1][1] = 1.0;
        s.invert();
        s.v = [4.0, 0.0, 0.0, 0.0, 0.0];
        let mut c = [Constraint::new([1.0, -1.0, 0.0, 0.0, 0.0], -1.0, 1.0)];
        s.prepare(&mut c);
        s.solve(&mut c, |_| {}, 4);
        assert_eq!(c[0].lambda, -1.0);
        assert!((s.v[0] - 3.0).abs() < 1e-12 && (s.v[1] - 1.0).abs() < 1e-12);
    }
}

#[cfg(test)]
mod block_tests {
    use super::*;

    /// Two rigid constraints coupled through a heavy reflected inertia: a
    /// locked clutch (engine to carrier) and a locked centre differential.
    #[test]
    fn coupled_rigid_constraints_are_exact_in_one_round() {
        let mut s = System::new(5);
        let i_up = 30.0;
        let a = [0.2, 0.2, 0.3, 0.3];
        for i in 0..4 {
            for j in 0..4 {
                s.mass[i][j] = i_up * a[i] * a[j];
            }
            s.mass[i][i] += 1.5;
        }
        s.mass[4][4] = 0.25;
        s.invert();
        s.v = [10.0, 10.0, 12.0, 12.0, 500.0];
        let r = 12.0;
        let mut cs = [
            Constraint::new(
                [r * a[0], r * a[1], r * a[2], r * a[3], -1.0],
                f64::NEG_INFINITY,
                f64::INFINITY,
            ),
            Constraint::new(
                [0.5, 0.5, -0.5, -0.5, 0.0],
                f64::NEG_INFINITY,
                f64::INFINITY,
            ),
        ];
        s.prepare(&mut cs);
        s.solve(&mut cs, |_| {}, 1);
        let rel0 = s.relative_speed(&cs[0]);
        let rel1 = s.relative_speed(&cs[1]);
        assert!(rel0.abs() < 1e-9 && rel1.abs() < 1e-9, "{rel0} {rel1}");
    }

    #[test]
    fn a_saturated_constraint_is_held_and_the_rest_re_solved() {
        let mut s = System::new(3);
        for i in 0..3 {
            s.mass[i][i] = 1.0;
        }
        s.invert();
        s.v = [10.0, 0.0, 0.0, 0.0, 0.0];
        let mut cs = [
            // Weak coupling 0–1, rigid coupling 1–2.
            Constraint::new([1.0, -1.0, 0.0, 0.0, 0.0], -1.0, 1.0),
            Constraint::new([0.0, 1.0, -1.0, 0.0, 0.0], f64::NEG_INFINITY, f64::INFINITY),
        ];
        s.prepare(&mut cs);
        s.solve(&mut cs, |_| {}, 8);
        assert_eq!(cs[0].lambda, -1.0);
        assert!((s.v[0] - 9.0).abs() < 1e-12);
        assert!((s.v[1] - 0.5).abs() < 1e-12 && (s.v[2] - 0.5).abs() < 1e-12);
    }
}

#[cfg(test)]
mod dependent_tests {
    use super::*;

    /// A locked differential under two brakes: three constraints on two
    /// wheels. The brakes must share the stop and the lock carry nothing.
    #[test]
    fn dependent_constraints_share_the_impulse() {
        let mut s = System::new(2);
        s.mass[0][0] = 0.12;
        s.mass[1][1] = 0.12;
        s.invert();
        s.v = [198.0, 198.0, 0.0, 0.0, 0.0];
        let dt = 0.004;
        let mut cs = [
            Constraint::new([1.0, -1.0, 0.0, 0.0, 0.0], f64::NEG_INFINITY, f64::INFINITY),
            Constraint::new([1.0, 0.0, 0.0, 0.0, 0.0], -160.0 * dt, 160.0 * dt),
            Constraint::new([0.0, 1.0, 0.0, 0.0, 0.0], -160.0 * dt, 160.0 * dt),
        ];
        s.prepare(&mut cs);
        s.solve(&mut cs, |_| {}, 8);
        assert!(cs[0].lambda.abs() < 1e-9, "lock {}", cs[0].lambda);
        assert_eq!(cs[1].lambda, -160.0 * dt);
        assert_eq!(cs[2].lambda, -160.0 * dt);
        let expect = 198.0 - 160.0 * dt / 0.12;
        assert!((s.v[0] - expect).abs() < 1e-9 && (s.v[1] - expect).abs() < 1e-9);
    }
}
