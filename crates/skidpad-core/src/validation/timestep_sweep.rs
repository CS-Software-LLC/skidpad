//! Timestep sweep (milestone 3): the same manoeuvres at every supported
//! substep rate and host rate. The core promises to stay stable, and to
//! give the same answers up to discretisation, from 250 to 2000 Hz
//! internally and from 30 to 240 Hz host steps. Each cell of the grid runs
//! the understeer gradient (ISO 4138, the handling result), braking from
//! 100 km/h on locked wheels (the stability result) and a parked hold on a
//! 30 % grade (the standstill result); the spreads are taken against a
//! reference cell at the definition's own substep rate and the 100 Hz host
//! step the other scenarios use.

use super::parked::{self, ParkedConfig};
use super::straight_line::{self, StraightLineConfig};
use super::understeer::{self, UndersteerConfig};
use crate::definition::VehicleDefinition;
use skidpad_math as m;

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct TimestepSweepConfig {
    /// Internal substep rates to run, Hz.
    pub substep_rates: Vec<f64>,
    /// Host step rates to run, Hz.
    pub host_rates: Vec<f64>,
    /// Host rate of the reference cell, Hz; its substep rate is the
    /// definition's.
    pub reference_host_rate: f64,
    /// Skidpad radius, m.
    pub radius: f64,
    /// Skidpad speeds, m/s.
    pub speeds: Vec<f64>,
    /// Settle time per skidpad speed, s.
    pub settle_time: f64,
    /// Averaging window per skidpad speed, s.
    pub measure_time: f64,
    /// Speed to brake from, m/s.
    pub braking_speed: f64,
    /// Grade of the parked hold, rise per metre.
    pub grade: f64,
    /// Largest acceptable spread of the understeer gradient across the
    /// grid, deg/g.
    pub gradient_tolerance_deg_per_g: f64,
    /// Largest acceptable relative spread of the braking distance.
    pub braking_tolerance: f64,
}

impl Default for TimestepSweepConfig {
    fn default() -> Self {
        Self {
            substep_rates: vec![250.0, 500.0, 1000.0, 2000.0],
            host_rates: vec![30.0, 60.0, 120.0, 240.0],
            reference_host_rate: 100.0,
            radius: 40.0,
            speeds: vec![4.0, 8.0, 12.0],
            settle_time: 8.0,
            measure_time: 1.0,
            braking_speed: 100.0 / 3.6,
            grade: 0.3,
            gradient_tolerance_deg_per_g: 0.05,
            braking_tolerance: 0.01,
        }
    }
}

/// One cell of the grid.
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct SweepCell {
    pub substep_rate_hz: f64,
    pub host_rate_hz: f64,
    /// Understeer gradient, deg/g.
    pub gradient_deg_per_g: f64,
    /// Braking distance from `braking_speed`, m.
    pub braking_distance: f64,
    /// Lock chatter events during braking.
    pub lock_releases: u32,
    /// Speed two seconds after the stop, m/s.
    pub settled_speed: f64,
    /// Creep speed of the parked hold, m/s.
    pub parked_creep_speed: f64,
    pub parked_holds: bool,
    /// Every number in this cell is finite.
    pub finite: bool,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TimestepSweepResult {
    pub reference: SweepCell,
    pub cells: Vec<SweepCell>,
    /// Largest `|cell − reference|` of the understeer gradient, deg/g.
    pub gradient_spread_deg_per_g: f64,
    /// Largest `|cell − reference| / reference` of the braking distance.
    pub braking_distance_spread: f64,
    /// Every cell finite.
    pub all_finite: bool,
    /// Every cell parked without creep.
    pub all_hold: bool,
    /// No cell chattered its brakes, and every cell came to rest after the
    /// stop.
    pub clean_stops: bool,
    /// All of the above and both spreads within tolerance.
    pub stable: bool,
}

fn run_cell(
    def: &VehicleDefinition,
    cfg: &TimestepSweepConfig,
    substep_rate_hz: f64,
    host_rate_hz: f64,
) -> Result<SweepCell, String> {
    let mut d = def.clone();
    d.simulation.substep_rate_hz = substep_rate_hz;
    let host_dt = 1.0 / host_rate_hz;
    let us = understeer::run(
        &d,
        &UndersteerConfig {
            radius: cfg.radius,
            speeds: cfg.speeds.clone(),
            settle_time: cfg.settle_time,
            measure_time: cfg.measure_time,
            host_dt,
        },
    )?;
    let sl = straight_line::run(
        &d,
        &StraightLineConfig {
            target_speed: cfg.braking_speed,
            max_accel_time: 0.0,
            host_dt,
            ..StraightLineConfig::default()
        },
    )?;
    let pk = parked::run(
        &d,
        &ParkedConfig {
            grade: cfg.grade,
            brake: 1.0,
            host_dt,
            ..ParkedConfig::default()
        },
    )?;
    let finite = us.gradient_deg_per_g.is_finite()
        && us.points.iter().all(|p| {
            p.speed.is_finite()
                && p.steer_angle.is_finite()
                && p.lat_accel.is_finite()
                && p.yaw_rate.is_finite()
        })
        && sl.braking_distance.is_finite()
        && sl.settled_speed.is_finite()
        && pk.creep_speed.is_finite()
        && pk.velocity_rms.is_finite();
    Ok(SweepCell {
        substep_rate_hz,
        host_rate_hz,
        gradient_deg_per_g: us.gradient_deg_per_g,
        braking_distance: sl.braking_distance,
        lock_releases: sl.lock_releases,
        settled_speed: sl.settled_speed,
        parked_creep_speed: pk.creep_speed,
        parked_holds: pk.holds,
        finite,
    })
}

pub fn run(
    def: &VehicleDefinition,
    cfg: &TimestepSweepConfig,
) -> Result<TimestepSweepResult, String> {
    def.validate().map_err(|e| e.join("; "))?;
    if cfg.substep_rates.is_empty() || cfg.host_rates.is_empty() {
        return Err(String::from("timestep sweep: rates must not be empty"));
    }
    for &r in cfg.substep_rates.iter().chain(&cfg.host_rates) {
        if !(r > 0.0) || !r.is_finite() {
            return Err(format!("timestep sweep: rate {r} is not positive"));
        }
    }
    if !(cfg.reference_host_rate > 0.0) {
        return Err(String::from(
            "timestep sweep: reference host rate must be positive",
        ));
    }
    let reference = run_cell(
        def,
        cfg,
        def.simulation.substep_rate_hz,
        cfg.reference_host_rate,
    )?;
    let mut cells = Vec::with_capacity(cfg.substep_rates.len() * cfg.host_rates.len());
    for &sub in &cfg.substep_rates {
        for &host in &cfg.host_rates {
            cells.push(run_cell(def, cfg, sub, host)?);
        }
    }
    let mut gradient_spread: f64 = 0.0;
    let mut braking_spread: f64 = 0.0;
    let mut all_finite = reference.finite;
    let mut all_hold = reference.parked_holds;
    let mut clean_stops =
        reference.lock_releases == 0 && reference.settled_speed < parked::SETTLE_SPEED_LIMIT;
    for c in &cells {
        all_finite &= c.finite;
        all_hold &= c.parked_holds;
        clean_stops &= c.lock_releases == 0 && c.settled_speed < parked::SETTLE_SPEED_LIMIT;
        gradient_spread = m::max(
            gradient_spread,
            m::abs(c.gradient_deg_per_g - reference.gradient_deg_per_g),
        );
        if reference.braking_distance > 0.0 {
            braking_spread = m::max(
                braking_spread,
                m::abs(c.braking_distance - reference.braking_distance)
                    / reference.braking_distance,
            );
        }
    }
    let stable = all_finite
        && all_hold
        && clean_stops
        && gradient_spread <= cfg.gradient_tolerance_deg_per_g
        && braking_spread <= cfg.braking_tolerance;
    Ok(TimestepSweepResult {
        reference,
        cells,
        gradient_spread_deg_per_g: gradient_spread,
        braking_distance_spread: braking_spread,
        all_finite,
        all_hold,
        clean_stops,
        stable,
    })
}
