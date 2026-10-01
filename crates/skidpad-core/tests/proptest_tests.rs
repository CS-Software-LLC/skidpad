use proptest::prelude::*;
use skidpad_core::tire::{FeelTireParams, TireInput, TireModel};
use skidpad_core::vehicle::BicycleVehicle;
use skidpad_core::{VehicleDefinition, VehicleInput};

fn arb_feel() -> impl Strategy<Value = FeelTireParams> {
    (
        0.2f64..0.5,
        1000.0f64..8000.0,
        0.3f64..1.8,
        0.0f64..0.5,
        0.05f64..0.3,
        3.0f64..15.0,
        5.0f64..40.0,
        5.0f64..40.0,
        0.3f64..1.0,
    )
        .prop_map(
            |(radius, fz0, mu, ls, pk, pa, kx, ky, fall)| FeelTireParams {
                radius,
                nominal_load: fz0,
                peak_friction: mu,
                load_sensitivity: ls,
                peak_slip_ratio: pk,
                peak_slip_angle_deg: pa,
                longitudinal_stiffness: kx,
                cornering_stiffness: ky,
                falloff_long: fall,
                falloff_lat: fall,
                ..FeelTireParams::default()
            },
        )
}

fn arb_def() -> impl Strategy<Value = VehicleDefinition> {
    (
        400.0f64..3000.0,
        1.8f64..4.0,
        0.3f64..0.7,
        0.2f64..0.9,
        arb_feel(),
        arb_feel(),
        500.0f64..6000.0,
        240.0f64..2000.0,
    )
        .prop_map(|(mass, wheelbase, cg_frac, h, ft, rt, torque, rate)| {
            let mut d = VehicleDefinition::default();
            d.chassis.mass = mass;
            d.chassis.yaw_inertia = mass * wheelbase * wheelbase * 0.25;
            d.chassis.wheelbase = wheelbase;
            d.chassis.cg_to_front_axle = wheelbase * cg_frac;
            d.chassis.cg_height = h;
            d.axles[0].tire = TireModel::Feel(ft);
            d.axles[1].tire = TireModel::Feel(rt);
            d.drive.max_wheel_torque = torque;
            d.simulation.substep_rate_hz = rate;
            d
        })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn tire_outputs_are_finite_and_bounded(p in arb_feel(), fz in 0.0f64..12000.0, k in -2.0f64..2.0, a in -1.5f64..1.5, g in -0.2f64..0.2) {
        let m = TireModel::Feel(p);
        let o = m.eval(&TireInput { fz, slip_ratio: k, slip_angle: a, camber: g, vx: 5.0 });
        prop_assert!(o.fx.is_finite() && o.fy.is_finite() && o.mz.is_finite());
        let limit = 1.5 * fz.max(1.0) * 2.0 + 1.0;
        prop_assert!(o.fx.abs() <= limit && o.fy.abs() <= limit);
    }

    #[test]
    fn random_vehicles_with_random_inputs_never_produce_nan_or_runaway(
        d in arb_def(),
        inputs in prop::collection::vec((-1.0f64..1.0, 0.0f64..1.0, 0.0f64..1.0, 0.0f64..1.0), 20..60),
    ) {
        prop_assert!(d.validate().is_ok(), "{:?}", d.validate());
        let mut car = BicycleVehicle::new(d.clone());
        let dt = 1.0 / d.simulation.substep_rate_hz;
        let steps_per_input = (0.25 / dt) as usize;
        for (s, th, br, hb) in inputs {
            let input = VehicleInput { steer: s, throttle: th, brake: br, handbrake: hb };
            for _ in 0..steps_per_input {
                car.substep(dt, &input);
            }
            prop_assert!(car.vx.is_finite() && car.vy.is_finite() && car.yaw_rate.is_finite());
            prop_assert!(car.x.is_finite() && car.y.is_finite());
            // Bounded energy: no vehicle in this range exceeds 120 m/s even
            // with the strongest drive, and yaw rate stays physical.
            prop_assert!(car.speed() < 120.0, "speed {}", car.speed());
            prop_assert!(car.yaw_rate.abs() < 20.0, "yaw rate {}", car.yaw_rate);
            for ax in &car.axles {
                prop_assert!(ax.omega.is_finite() && ax.omega.abs() < 1000.0);
            }
        }
    }
}
