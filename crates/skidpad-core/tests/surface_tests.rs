//! Surface table (ADR-0014): grip scales the friction of both tire models,
//! the world looks contacts up by id, rolling resistance and ploughing drag
//! slow a coasting car, and the reference surface changes nothing.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::telemetry as t;
use skidpad_core::tire::{FeelTireParams, MagicFormulaParams, TireInput, TireModel};
use skidpad_core::validation::{straight_line, StraightLineConfig};
use skidpad_core::vehicle::{WheelContact, FL, FR, RL, RR};
use skidpad_core::world::{HOST_CONTACT_STRIDE, HOST_IN_BODY_LEN, HOST_IN_STRIDE};
use skidpad_core::{Surface, SurfaceTable, VehicleDefinition, VehicleInput, World};

fn ice() -> Surface {
    Surface {
        grip: 0.2,
        rolling_resistance: 0.8,
        drag: 0.0,
    }
}

fn gravel() -> Surface {
    Surface {
        grip: 0.6,
        rolling_resistance: 2.0,
        drag: 0.04,
    }
}

#[test]
fn grip_scales_the_peak_of_both_tire_models() {
    for model in [
        TireModel::Feel(FeelTireParams::default()),
        TireModel::MagicFormula(MagicFormulaParams::default()),
    ] {
        let base = TireInput {
            fz: 4000.0,
            slip_ratio: 0.0,
            slip_angle: 0.2,
            vx: 10.0,
            ..TireInput::default()
        };
        let dry = model.eval(&base);
        let wet = model.eval(&TireInput { grip: 0.5, ..base });
        assert!((wet.fy_max - 0.5 * dry.fy_max).abs() < 1e-9, "{model:?}");
        assert!((wet.fx_max - 0.5 * dry.fx_max).abs() < 1e-9);
        // Past the peak the force follows the friction down.
        assert!(
            wet.fy.abs() < 0.6 * dry.fy.abs(),
            "{} vs {}",
            wet.fy,
            dry.fy
        );
        // The stiffness is untouched: at a tiny slip the forces agree.
        let small = TireInput {
            slip_angle: 1e-4,
            ..base
        };
        let a = model.eval(&small).fy;
        let b = model.eval(&TireInput { grip: 0.5, ..small }).fy;
        assert!((a - b).abs() < 1e-3 * a.abs(), "{a} vs {b}");
        // Rolling resistance scales on its own.
        let rr = model.eval(&TireInput {
            rolling_resistance: 3.0,
            ..base
        });
        assert!((rr.my - 3.0 * dry.my).abs() < 1e-9);
    }
}

#[test]
fn the_reference_table_changes_nothing() {
    let mut a = World::new(1);
    a.add_vehicle(VehicleDefinition::default()).unwrap();
    let mut b = World::new(1);
    b.add_vehicle(VehicleDefinition::default()).unwrap();
    b.set_surfaces(&[Surface::REFERENCE, ice(), gravel()])
        .unwrap();
    let input = VehicleInput {
        steer: 0.3,
        throttle: 0.8,
        ..VehicleInput::default()
    };
    a.set_input(0, input).unwrap();
    b.set_input(0, input).unwrap();
    for _ in 0..300 {
        a.step(0.01);
        b.step(0.01);
    }
    assert_eq!(a.state_hash(0).unwrap(), b.state_hash(0).unwrap());
    assert_eq!(a.telemetry_of(0)[t::SURFACE_ID_FL], 0.0);
    assert_eq!(b.telemetry_of(0)[t::SURFACE_GRIP_RR], 1.0);
}

#[test]
fn braking_on_ice_takes_far_longer_on_both_models() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = VehicleDefinition::default();
        d.simulation.model = model;
        let cfg = StraightLineConfig {
            max_accel_time: 0.0,
            ..StraightLineConfig::default()
        };
        let dry = straight_line::run(&d, &cfg).unwrap();
        let icy = straight_line::run(
            &d,
            &StraightLineConfig {
                surface: ice(),
                ..cfg.clone()
            },
        )
        .unwrap();
        // Sliding friction scales with the grip, so the distance scales
        // inversely, give or take the aero drag and the low-speed tail.
        let ratio = icy.braking_distance / dry.braking_distance;
        assert!(
            ratio > 3.5 && ratio < 6.0,
            "{model:?}: {} m on ice vs {} m dry (ratio {ratio})",
            icy.braking_distance,
            dry.braking_distance
        );
        assert!(icy.wheel_locked);
        assert_eq!(icy.lock_releases, 0, "{model:?}: chatter on ice");
        assert!(icy.settled_speed < 1e-4, "{model:?}: not at rest on ice");
    }
}

#[test]
fn the_world_looks_contacts_up_by_id_from_the_host() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_surfaces(&[Surface::REFERENCE, ice()]).unwrap();
    w.set_host_mode(0, skidpad_core::vehicle::HostMode::External)
        .unwrap();
    let d = VehicleDefinition::default();
    // Level ground under all wheels, the left side on ice.
    let rec = w.host_in_mut();
    rec[2] = d.chassis.cg_height;
    for wheel in 0..4 {
        let o = HOST_IN_BODY_LEN + wheel * HOST_CONTACT_STRIDE;
        rec[o] = 1.0;
        rec[o + 6] = 1.0;
        rec[o + 10] = if wheel % 2 == 0 { 1.0 } else { 0.0 };
    }
    assert_eq!(rec.len(), HOST_IN_STRIDE);
    w.set_input(
        0,
        VehicleInput {
            throttle: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    // The external host owns the pose; keep handing the same state back
    // so the car stays level and only the wheels spin up.
    for _ in 0..50 {
        w.step(0.01);
    }
    let v = w.telemetry_of(0);
    assert_eq!(v[t::SURFACE_ID_FL], 1.0);
    assert_eq!(v[t::SURFACE_ID_RR], 0.0);
    assert_eq!(v[t::SURFACE_GRIP_FL], 0.2);
    assert_eq!(v[t::SURFACE_GRIP_RR], 1.0);
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert_eq!(car.contacts[FL].surface_id, 1);
    assert_eq!(car.contacts[RR].surface_id, 0);
    // An unknown id reads as the first surface rather than failing.
    let rec = w.host_in_mut();
    rec[HOST_IN_BODY_LEN + 10] = 9.0;
    w.step(0.01);
    assert_eq!(w.telemetry_of(0)[t::SURFACE_GRIP_FL], 1.0);
}

#[test]
fn builtin_ground_surface_follows_the_vehicle_through_resets() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_surfaces(&[Surface::REFERENCE, gravel()]).unwrap();
    w.set_surface(0, 1).unwrap();
    w.step(0.01);
    assert_eq!(w.telemetry_of(0)[t::SURFACE_GRIP_FL], 0.6);
    w.reset_vehicle(0, 5.0, 0.0, 0.0).unwrap();
    w.step(0.01);
    assert_eq!(w.telemetry_of(0)[t::SURFACE_ID_RR], 1.0);
    assert_eq!(w.telemetry_of(0)[t::SURFACE_GRIP_RR], 0.6);
    let car = w.vehicle(0).unwrap().model.as_four_wheel().unwrap();
    assert_eq!(car.contacts[FL], {
        let mut c = WheelContact::flat_ground();
        c.surface_id = 1;
        c
    });
}

#[test]
fn rolling_resistance_and_ploughing_slow_a_coasting_car() {
    let coast = |surface: Surface, model: VehicleModelKind| {
        let mut d = VehicleDefinition::default();
        d.simulation.model = model;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.set_surfaces(&[surface]).unwrap();
        w.vehicle_mut(0).unwrap().model.set_speed(20.0);
        for _ in 0..500 {
            w.step(0.01);
        }
        w.telemetry_of(0)[t::SPEED]
    };
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let dry = coast(Surface::REFERENCE, model);
        let rough = coast(
            Surface {
                grip: 1.0,
                rolling_resistance: 3.0,
                drag: 0.0,
            },
            model,
        );
        let soft = coast(gravel(), model);
        assert!(rough < dry - 0.5, "{model:?}: {rough} vs {dry}");
        assert!(soft < rough - 0.5, "{model:?}: {soft} vs {rough}");
    }
}

#[test]
fn a_parked_car_on_gravel_stays_put() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_surfaces(&[gravel()]).unwrap();
    w.set_ground_slope(0, 0.2, 0.0).unwrap();
    w.set_input(
        0,
        VehicleInput {
            brake: 1.0,
            ..VehicleInput::default()
        },
    )
    .unwrap();
    for _ in 0..1000 {
        w.step(0.01);
    }
    let v = w.telemetry_of(0);
    assert!(v[t::SPEED] < 1e-4, "creeps at {} m/s", v[t::SPEED]);
    assert!(v[t::POS_X].abs() < 0.01, "slid {} m", v[t::POS_X]);
}

#[test]
fn bad_surfaces_are_rejected_and_the_table_is_bounded() {
    let mut w = World::new(1);
    assert!(w
        .set_surfaces(&[Surface {
            grip: -1.0,
            ..Surface::REFERENCE
        }])
        .is_err());
    assert!(w
        .set_surfaces(&[Surface {
            drag: 2.0,
            ..Surface::REFERENCE
        }])
        .is_err());
    assert!(w
        .set_surfaces(&vec![
            Surface::REFERENCE;
            skidpad_core::surface::MAX_SURFACES + 1
        ])
        .is_err());
    assert_eq!(w.surfaces(), &SurfaceTable::REFERENCE);
    assert!(w
        .set_surfaces(&vec![ice(); skidpad_core::surface::MAX_SURFACES])
        .is_ok());
    assert_eq!(w.surfaces().len(), skidpad_core::surface::MAX_SURFACES);
}

#[test]
fn builtin_ground_takes_a_surface_per_wheel() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = VehicleDefinition::default();
        d.simulation.model = model;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.set_surfaces(&[Surface::REFERENCE, gravel(), ice()])
            .unwrap();
        // Two wheels on the gravel at the left, one on the ice.
        w.set_wheel_surface(0, FL, 1).unwrap();
        w.set_wheel_surface(0, RL, 1).unwrap();
        w.set_wheel_surface(0, RR, 2).unwrap();
        assert!(w.set_wheel_surface(0, 4, 1).is_err());
        w.step(0.01);
        let v = w.telemetry_of(0);
        assert_eq!(
            [
                v[t::SURFACE_ID_FL],
                v[t::SURFACE_ID_FR],
                v[t::SURFACE_ID_RL],
                v[t::SURFACE_ID_RR]
            ],
            [1.0, 0.0, 1.0, 2.0],
            "{model:?}"
        );
        assert_eq!(v[t::SURFACE_GRIP_FL], 0.6);
        assert_eq!(v[t::SURFACE_GRIP_FR], 1.0);
        assert_eq!(v[t::SURFACE_GRIP_RR], 0.2);
        // A reset keeps each wheel's surface, and a whole-car id overrides them.
        w.reset_vehicle(0, 0.0, 0.0, 0.0).unwrap();
        w.step(0.01);
        assert_eq!(w.telemetry_of(0)[t::SURFACE_ID_RR], 2.0);
        w.set_surface(0, 1).unwrap();
        w.step(0.01);
        assert_eq!(w.telemetry_of(0)[t::SURFACE_ID_FR], 1.0);
        assert_eq!(w.telemetry_of(0)[t::SURFACE_ID_RR], 1.0);
    }
}

#[test]
fn per_wheel_surfaces_survive_a_change_of_model() {
    let mut w = World::new(1);
    w.add_vehicle(VehicleDefinition::default()).unwrap();
    w.set_surfaces(&[Surface::REFERENCE, gravel()]).unwrap();
    w.set_wheel_surface(0, FR, 1).unwrap();
    w.set_lod(0, skidpad_core::world::Lod::SingleTrack, 0.0)
        .unwrap();
    w.set_lod(0, skidpad_core::world::Lod::Full, 0.0).unwrap();
    w.step(0.01);
    assert_eq!(w.telemetry_of(0)[t::SURFACE_ID_FR], 1.0);
    assert_eq!(w.telemetry_of(0)[t::SURFACE_ID_FL], 0.0);
}

#[test]
fn equal_wheel_surfaces_drive_exactly_like_one_vehicle_surface() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let run = |per_wheel: bool| {
            let mut d = VehicleDefinition::default();
            d.simulation.model = model;
            let mut w = World::new(1);
            w.add_vehicle(d).unwrap();
            w.set_surfaces(&[Surface::REFERENCE, gravel()]).unwrap();
            if per_wheel {
                for wheel in [FL, FR, RL, RR] {
                    w.set_wheel_surface(0, wheel, 1).unwrap();
                }
            } else {
                w.set_surface(0, 1).unwrap();
            }
            w.set_input(
                0,
                VehicleInput {
                    throttle: 0.8,
                    steer: 0.3,
                    ..VehicleInput::default()
                },
            )
            .unwrap();
            for _ in 0..300 {
                w.step(1.0 / 60.0);
            }
            w.world_hash()
        };
        assert_eq!(run(true), run(false), "{model:?}");
    }
}

#[test]
fn grip_channels_report_each_tire_limit_and_its_use() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut d = VehicleDefinition::default();
        d.simulation.model = model;
        let mut w = World::new(1);
        w.add_vehicle(d).unwrap();
        w.set_surfaces(&[Surface::REFERENCE, ice()]).unwrap();
        w.set_input(
            0,
            VehicleInput {
                throttle: 0.3,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        for _ in 0..120 {
            w.step(1.0 / 60.0);
        }
        let v = w.telemetry_of(0).to_vec();
        // Per-wheel limits add up to the axle channels.
        let front = v[t::TIRE_FMAX_FL] + v[t::TIRE_FMAX_FR];
        assert!((front - v[t::FMAX_F]).abs() < 1e-9 * front, "{model:?}");
        for i in 0..4 {
            let u = v[t::PEAK_SLIP_FL + i];
            assert!(u > 0.0 && u < 1.0, "{model:?} wheel {i}: {u}");
        }
        // Full throttle on ice spins the driven wheels at the limit.
        w.set_surface(0, 1).unwrap();
        w.set_input(
            0,
            VehicleInput {
                throttle: 1.0,
                ..VehicleInput::default()
            },
        )
        .unwrap();
        for _ in 0..30 {
            w.step(1.0 / 60.0);
        }
        let v = w.telemetry_of(0);
        let driven = most_slip(v);
        assert!(driven > 1.5, "{model:?}: {driven}");
        assert!(v[t::TIRE_FMAX_FL] < 0.3 * front / 2.0 * 1.5, "{model:?}");
    }
}

/// Largest slip past the peak of any wheel.
fn most_slip(v: &[f64]) -> f64 {
    (0..4).map(|i| v[t::PEAK_SLIP_FL + i]).fold(0.0, f64::max)
}
