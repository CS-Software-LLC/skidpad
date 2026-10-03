//! Suspension geometry that changes with travel (ADR-0025): the definition
//! format and its validation.

use skidpad_core::kinematics::{KinematicsDef, TravelCurve};
use skidpad_core::VehicleDefinition;

const CASES: &str = include_str!("fixtures/kinematics_validation.json");

fn kinematics_errors(d: &VehicleDefinition) -> Vec<String> {
    match d.validate() {
        Ok(()) => Vec::new(),
        Err(e) => e.into_iter().filter(|m| m.contains("kinematics")).collect(),
    }
}

/// The same cases and messages as `packages/core/test/kinematics.test.ts`.
#[test]
fn validation_matches_the_shared_cases() {
    let cases: serde_json::Value = serde_json::from_str(CASES).unwrap();
    for case in cases["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let axle = case["axle"].as_u64().unwrap() as usize;
        let mut d = serde_json::to_value(VehicleDefinition::default()).unwrap();
        let a = &mut d["axles"][axle];
        if let Some(fields) = case.get("axleFields").and_then(|f| f.as_object()) {
            for (k, v) in fields {
                a[k] = v.clone();
            }
        }
        if let Some(fields) = case.get("suspensionFields").and_then(|f| f.as_object()) {
            for (k, v) in fields {
                a["suspension"][k] = v.clone();
            }
        }
        let d: VehicleDefinition = serde_json::from_value(d).unwrap();
        let expected: Vec<String> = case["errors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e.as_str().unwrap().to_string())
            .collect();
        assert_eq!(kinematics_errors(&d), expected, "case {name}");
    }
}

#[test]
fn the_block_is_optional_and_left_out_when_absent() {
    let d = VehicleDefinition::default();
    assert!(d.axles.iter().all(|a| a.suspension.kinematics.is_none()));
    let json = serde_json::to_string(&d).unwrap();
    assert!(!json.contains("kinematics"));
}

#[test]
fn curves_round_trip_through_json() {
    let mut d = VehicleDefinition::default();
    d.axles[0].suspension.kinematics = Some(KinematicsDef {
        toe_deg: Some(TravelCurve::new(&[[-0.08, 0.3], [0.0, 0.0], [0.08, -0.4]])),
        roll_center_height: Some(TravelCurve::new(&[[-0.1, 0.05], [0.1, -0.05]])),
        ..KinematicsDef::default()
    });
    d.axles[1].suspension.kinematics = Some(KinematicsDef::default());
    let json = serde_json::to_string(&d).unwrap();
    assert!(json.contains(r#""toeDeg":[[-0.08,0.3],[0.0,0.0],[0.08,-0.4]]"#));
    assert!(!json.contains("camberDeg"));
    let back: VehicleDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(back, d);
    assert!(back.axles[1]
        .suspension
        .kinematics
        .as_ref()
        .unwrap()
        .is_empty());
}
