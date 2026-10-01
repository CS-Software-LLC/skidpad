//! Aero lift and the drag line of action (ADR-0015): downforce loads the
//! tires at speed on both models, lift unloads them, the loads go through
//! the springs on the four-wheel model, drag above the centre of mass
//! moves load rearward, and zero coefficients change nothing.

use skidpad_core::definition::VehicleModelKind;
use skidpad_core::telemetry as t;
use skidpad_core::validation::{understeer, UndersteerConfig};
use skidpad_core::{VehicleDefinition, VehicleInput, World};

fn at_speed(d: VehicleDefinition, speed: f64) -> Vec<f64> {
    let mut w = World::new(1);
    w.add_vehicle(d).unwrap();
    w.vehicle_mut(0).unwrap().model.set_speed(speed);
    // Hold the speed on the throttle for three seconds so the springs settle.
    let mut integral = 0.0;
    for _ in 0..300 {
        let v = w.telemetry_of(0)[t::SPEED];
        integral += 0.4 * (speed - v) * 0.01;
        w.set_input(
            0,
            VehicleInput {
                throttle: (0.6 * (speed - v) + integral).clamp(0.0, 1.0),
                brake: (-(0.6 * (speed - v) + integral)).clamp(0.0, 1.0),
                ..VehicleInput::default()
            },
        )
        .unwrap();
        w.step(0.01);
    }
    w.telemetry_of(0).to_vec()
}

#[test]
fn downforce_adds_load_and_lift_removes_it_on_both_models() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut base = VehicleDefinition::default();
        base.simulation.model = model;
        let plain = at_speed(base.clone(), 40.0);
        let mut winged = base.clone();
        winged.aero.lift_coefficient_front = -1.0;
        winged.aero.lift_coefficient_rear = -1.5;
        let down = at_speed(winged.clone(), 40.0);
        // The speed controller lands within a few tenths of 40 m/s; use the
        // speed it held.
        let vx = down[t::VEL_X];
        assert!((vx - 40.0).abs() < 0.5, "{model:?}: held {vx} m/s");
        let q = 0.5 * 1.225 * 2.2 * vx * vx;
        let expected_f = -q;
        let expected_r = -1.5 * q;
        assert!(
            (down[t::AERO_LIFT_F] - expected_f).abs() < 0.02 * q,
            "{model:?}: front lift {} vs {expected_f}",
            down[t::AERO_LIFT_F]
        );
        assert!(
            (down[t::AERO_LIFT_R] - expected_r).abs() < 0.02 * q,
            "{model:?}: rear lift {} vs {expected_r}",
            down[t::AERO_LIFT_R]
        );
        // The whole downforce reaches the tires.
        let gained = (down[t::LOAD_F] + down[t::LOAD_R]) - (plain[t::LOAD_F] + plain[t::LOAD_R]);
        assert!(
            (gained - 2.5 * q).abs() < 0.05 * 2.5 * q,
            "{model:?}: tires gained {gained} N of {} N downforce",
            2.5 * q
        );
        assert!(down[t::LOAD_R] - plain[t::LOAD_R] > down[t::LOAD_F] - plain[t::LOAD_F]);
        let mut lifting = base.clone();
        lifting.aero.lift_coefficient_front = 0.3;
        let up = at_speed(lifting, 40.0);
        assert!(up[t::LOAD_F] < plain[t::LOAD_F] - 0.25 * q);
        assert!((up[t::LOAD_R] - plain[t::LOAD_R]).abs() < 0.05 * q);
        // Zero coefficients are exactly the old physics.
        assert_eq!(plain[t::AERO_LIFT_F], 0.0);
        assert_eq!(plain[t::AERO_LIFT_R], 0.0);
    }
}

#[test]
fn downforce_compresses_the_springs_on_the_four_wheel_model() {
    let plain = at_speed(VehicleDefinition::default(), 40.0);
    let mut winged = VehicleDefinition::default();
    winged.aero.lift_coefficient_front = -1.0;
    winged.aero.lift_coefficient_rear = -1.0;
    let down = at_speed(winged.clone(), 40.0);
    let q = 0.5 * 1.225 * 2.2 * 40.0 * 40.0;
    let k = winged.axles[0].suspension.spring_rate;
    let expected_travel = 0.5 * q / k;
    let travel = down[t::SUSP_TRAVEL_FL] - plain[t::SUSP_TRAVEL_FL];
    assert!(
        (travel - expected_travel).abs() < 0.15 * expected_travel,
        "front travel {travel} m vs {expected_travel} m"
    );
    assert!(down[t::POS_Z] < plain[t::POS_Z] - 0.5 * expected_travel);
}

#[test]
fn drag_above_the_centre_of_mass_moves_load_rearward() {
    for model in [VehicleModelKind::FourWheel, VehicleModelKind::SingleTrack] {
        let mut base = VehicleDefinition::default();
        base.simulation.model = model;
        base.aero.drag_coefficient = 0.6;
        let low = at_speed(base.clone(), 40.0);
        let mut high = base.clone();
        high.aero.drag_height_above_cg = 0.4;
        let tall = at_speed(high, 40.0);
        let drag = tall[t::DRAG_FORCE];
        assert!(drag > 500.0, "drag {drag}");
        let expected = drag * 0.4 / base.chassis.wheelbase;
        let shift = tall[t::LOAD_R] - low[t::LOAD_R];
        assert!(
            (shift - expected).abs() < 0.2 * expected,
            "{model:?}: rear gained {shift} N, expected {expected} N"
        );
        assert!(tall[t::LOAD_F] < low[t::LOAD_F]);
    }
}

#[test]
fn rear_downforce_adds_understeer_at_speed() {
    // A rear wing loads the rear tires, which raises their cornering
    // stiffness and pushes the balance toward understeer; the skidpad run
    // at higher speeds sees it.
    let mut d = VehicleDefinition::default();
    let cfg = UndersteerConfig {
        speeds: vec![10.0, 15.0, 20.0, 25.0],
        radius: 80.0,
        ..UndersteerConfig::default()
    };
    let plain = understeer::run(&d, &cfg).unwrap();
    d.aero.lift_coefficient_rear = -2.0;
    let winged = understeer::run(&d, &cfg).unwrap();
    assert!(
        winged.gradient_deg_per_g > plain.gradient_deg_per_g + 0.1,
        "winged {} vs plain {} deg/g",
        winged.gradient_deg_per_g,
        plain.gradient_deg_per_g
    );
}

#[test]
fn bad_aero_values_are_rejected() {
    let mut d = VehicleDefinition::default();
    d.aero.lift_coefficient_front = 20.0;
    assert!(d.validate().is_err());
    let mut d = VehicleDefinition::default();
    d.aero.drag_height_above_cg = f64::NAN;
    assert!(d.validate().is_err());
}
