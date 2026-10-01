//! Parked on a slope and at rest on flat ground, for every preset and both
//! vehicle models (ADR-0005, ADR-0010). The criteria are those of the
//! `parked` validation scenario: after a 5 s settle the speed is below
//! 0.1 mm/s, the car drifts less than 1 mm over the next 10 s, and the
//! velocity RMS over the last 5 s is below 0.1 mm/s.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::tire::TireModel;
use skidpad_core::validation::{parked, ParkedConfig, ParkedResult};
use skidpad_core::{VehicleDefinition, GRAVITY};
use skidpad_math as m;

const PRESETS: [(&str, &str); 3] = [
    (
        "hatchbackFwd",
        include_str!("../../../packages/presets/src/vehicles/hatchback-fwd.json"),
    ),
    (
        "sportsRwd",
        include_str!("../../../packages/presets/src/vehicles/sports-rwd.json"),
    ),
    (
        "kart",
        include_str!("../../../packages/presets/src/vehicles/kart.json"),
    ),
];

fn presets() -> Vec<(String, VehicleDefinition)> {
    let mut out = Vec::new();
    for (id, json) in PRESETS {
        let d: VehicleDefinition = serde_json::from_str(json).unwrap();
        assert!(d.validate().is_ok(), "{id}: {:?}", d.validate());
        out.push((id.to_string(), d));
    }
    out.push((String::from("default"), VehicleDefinition::default()));
    out
}

/// A case the brakes can physically hold: the braked axles' torque capacity
/// and tire grip both exceed what the slope demands. Combinations that
/// cannot hold (a kart with no handbrake) are skipped and reported.
fn can_hold(d: &VehicleDefinition, grade: f64, cross: f64, brake: f64, handbrake: f64) -> bool {
    let slope = m::hypot(grade, cross);
    let n = m::sqrt(1.0 + slope * slope);
    let (sin_t, cos_t) = (slope / n, 1.0 / n);
    let demand = d.chassis.mass * GRAVITY * sin_t;
    let mut torque_capacity = 0.0;
    let mut grip = 0.0;
    for (i, axle) in d.axles.iter().enumerate() {
        let r = axle.tire.unloaded_radius();
        let axle_brake = brake * axle.max_brake_torque
            + if i == 1 {
                handbrake * d.brakes.handbrake_torque
            } else {
                0.0
            };
        if axle_brake <= 0.0 {
            continue;
        }
        torque_capacity += axle_brake / r;
        let load = 2.0 * d.static_wheel_load(i) * cos_t;
        let mu = match &axle.tire {
            TireModel::Feel(p) => p.friction_at_load(0.5 * load),
            TireModel::MagicFormula(_) => 1.0,
        };
        grip += mu * load;
    }
    // Keep a margin: a case that holds only just would be sensitive to the
    // load shift on the grade.
    torque_capacity > 1.2 * demand && grip > 1.2 * demand
}

struct Case {
    name: &'static str,
    grade: f64,
    cross: f64,
    brake: f64,
    handbrake: f64,
}

fn cases() -> Vec<Case> {
    let mut v = vec![Case {
        name: "flat ground, no inputs",
        grade: 0.0,
        cross: 0.0,
        brake: 0.0,
        handbrake: 0.0,
    }];
    for grade in [0.1, 0.2, 0.3] {
        v.push(Case {
            name: "grade, service brake",
            grade,
            cross: 0.0,
            brake: 1.0,
            handbrake: 0.0,
        });
        v.push(Case {
            name: "grade, handbrake only",
            grade,
            cross: 0.0,
            brake: 0.0,
            handbrake: 1.0,
        });
    }
    v.push(Case {
        name: "cross slope, brakes held",
        grade: 0.0,
        cross: 0.2,
        brake: 1.0,
        handbrake: 1.0,
    });
    v
}

fn run_case(d: &VehicleDefinition, c: &Case) -> ParkedResult {
    parked::run(
        d,
        &ParkedConfig {
            grade: c.grade,
            cross_slope: c.cross,
            brake: c.brake,
            handbrake: c.handbrake,
            ..ParkedConfig::default()
        },
    )
    .unwrap()
}

fn check_all(model: VehicleModelKind) {
    let mut failures = Vec::new();
    for (id, mut d) in presets() {
        d.simulation.model = model;
        for c in cases() {
            let holds_physically = c.grade == 0.0 && c.cross == 0.0
                || can_hold(&d, c.grade, c.cross, c.brake, c.handbrake);
            if !holds_physically {
                println!(
                    "skip {id} {:?}: {} ({:.0} % grade, {:.0} % cross) cannot hold physically",
                    model,
                    c.name,
                    100.0 * c.grade,
                    100.0 * c.cross
                );
                continue;
            }
            let r = run_case(&d, &c);
            println!(
                "{id} {:?}: {} grade {:.0} % cross {:.0} %: settle speed {:.2e} m/s, creep {:.2e} m/s ({:.3} mm over the hold), rms {:.2e} m/s, max {:.2e} m/s -> {}",
                model,
                c.name,
                100.0 * c.grade,
                100.0 * c.cross,
                r.settle_speed,
                r.creep_speed,
                1e3 * r.drift,
                r.velocity_rms,
                r.max_speed,
                if r.holds { "holds" } else { "FAILS" }
            );
            if !r.holds {
                failures.push(format!(
                    "{id} {:?} {} ({:.0} % / {:.0} %): creep {:.2e} m/s, drift {:.3} mm, rms {:.2e} m/s",
                    model,
                    c.name,
                    100.0 * c.grade,
                    100.0 * c.cross,
                    r.creep_speed,
                    1e3 * r.drift,
                    r.velocity_rms
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "parked cars move:\n{}",
        failures.join("\n")
    );
}

#[test]
fn four_wheel_cars_stay_parked_on_slopes_and_at_rest() {
    check_all(VehicleModelKind::FourWheel);
}

#[test]
fn single_track_cars_stay_parked_on_slopes_and_at_rest() {
    check_all(VehicleModelKind::SingleTrack);
}

#[test]
fn a_car_with_no_brakes_rolls_down_the_slope() {
    // The scenario must be able to fail: free wheels on a grade roll.
    let d = VehicleDefinition::default();
    let r = parked::run(
        &d,
        &ParkedConfig {
            grade: 0.1,
            settle_time: 1.0,
            hold_time: 2.0,
            rms_window: 1.0,
            ..ParkedConfig::default()
        },
    )
    .unwrap();
    assert!(!r.holds);
    assert!(r.drift > 0.5, "drift {}", r.drift);
    // Facing uphill on a positive grade, a free car rolls backward (−x).
    let mut car = skidpad_core::VehicleModel::new(d);
    car.set_ground_slope(0.1, 0.0);
    for _ in 0..2000 {
        car.substep(0.001, &skidpad_core::VehicleInput::default());
    }
    assert!(car.pose2d().0 < -0.1, "x {}", car.pose2d().0);
    assert!(car.vx() < 0.0);
}

#[test]
fn slope_scales_the_wheel_loads_by_cos_theta() {
    let d = VehicleDefinition::default();
    let mut car = skidpad_core::VehicleModel::new(d.clone());
    car.set_ground_slope(0.3, 0.0);
    let input = skidpad_core::VehicleInput {
        brake: 1.0,
        ..Default::default()
    };
    for _ in 0..3000 {
        car.substep(0.001, &input);
    }
    let four = car.as_four_wheel().unwrap();
    let total: f64 = four.wheels.iter().map(|w| w.load).sum();
    let want = d.chassis.mass * GRAVITY / m::sqrt(1.0 + 0.09);
    assert!(
        (total - want).abs() < 0.01 * want,
        "total load {total} vs {want}"
    );
    // Facing uphill the rear carries more than its level share.
    let rear = four.wheels[2].load + four.wheels[3].load;
    assert!(rear > 2.0 * d.static_wheel_load(1));
}
