//! Shared test vehicles. Each integration test compiles this module on its
//! own and uses only part of it.
#![allow(dead_code)]

use skidpad_core::kinematics::{KinematicsDef, TravelCurve};
use skidpad_core::VehicleDefinition;

/// A three-point curve through zero: `droop` at full droop (−0.1 m),
/// `bump` at full bump (+0.1 m).
pub fn curve(droop: f64, bump: f64) -> TravelCurve {
    TravelCurve::new(&[[-0.1, droop], [0.0, 0.0], [0.1, bump]])
}

/// Steep but valid travel curves (ADR-0026) on both axles: well beyond a
/// road car's bump steer, camber gain, roll-centre migration and anti
/// change, to check the stability suite holds with them. Every value is
/// inside its bound with the static values the definition carries.
pub fn with_steep_curves(mut d: VehicleDefinition) -> VehicleDefinition {
    for (i, a) in d.axles.iter_mut().enumerate() {
        let s = &mut a.suspension;
        let solid = s.kind == skidpad_core::definition::SuspensionKind::Solid;
        // Toe out in bump at the front, in at the rear (roll understeer).
        let toe = if i == 0 {
            curve(1.0, -1.0)
        } else {
            curve(-0.6, 0.6)
        };
        s.kinematics = Some(KinematicsDef {
            toe_deg: (!solid).then_some(toe),
            camber_deg: (!solid).then(|| curve(2.5, -2.5)),
            roll_center_height: Some(curve(0.15, -0.15)),
            anti_brake: Some(curve(-0.3, 0.3)),
            anti_drive: Some(curve(0.3, -0.3)),
        });
    }
    let errors = d.validate();
    assert!(errors.is_ok(), "{errors:?}");
    d
}
