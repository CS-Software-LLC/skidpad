# Road load against EPA coast-down targets

2026-11-01. The first check of the longitudinal model (rolling resistance
and aero drag) against measured cars.

## The run

`coastDown` (`crates/skidpad-core/src/validation/coast_down.rs`, exposed as
`runScenario({ scenario: "coastDown" })`) starts the car at 80 mph on flat
ground in neutral and lets it roll to 15 mph, as an EPA coast-down does. The
drive is disconnected (clutch open and neutral for an engine, no
regeneration for a motor). Each 0.1 s host step's deceleration, times the
mass plus the wheels' rotating inertia (`wheelInertia / r²` for each wheel),
gives the road load at that speed. A least-squares fit of
`F = A + B·v + C·v²` over the run gives the coefficients in EPA's form.

With no aero lift and no drivetrain drag the fit is the closed form
`A = Crr·m·g`, `B = 0`, `C = ½·ρ·Cd·A` within 1 %, and each term follows its
own parameter (`crates/skidpad-core/tests/coast_down_tests.rs`).

## The reference cars

The targets are EPA's Test Car List for model year 2025
([Data on Cars used for Testing Fuel Economy](https://www.epa.gov/compliance-and-fuel-economy-data/data-cars-used-testing-fuel-economy),
file `25-testcar-2026-01-21.xlsx`). The columns used are "Target Coef A
(lbf)", "Target Coef B (lbf/mph)", "Target Coef C (lbf/mph**2)" and
"Equivalent Test Weight (lbs.)", taking the first row listed for each
model and drive. These are the makers' coast-down results, used to set the
chassis dynamometer for the fuel-economy tests. They are public-domain US
government data, kept in `tools/validate/src/epaRoadLoad.ts`.

The presets are generic cars, so each is compared with the range of three
or four cars of its class. The kart and the open-wheeler have no EPA
equivalent.

| Preset     | Reference cars (ETW, lb)                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| Hatchback  | Civic 5-door 150 hp (3250), Corolla Hatchback (3375), Golf R AWD (3750)                                  |
| Sports car | Z4 sDrive30i (3625), BRZ manual (3125), Nissan Z (3875), 718 Cayman GTS 4.0 (3625)                       |
| Pickup     | F-150 4WD 325 hp (5250), Silverado 4WD 310 hp (5250), Ram 1500 4x4 305 hp (5500)                         |
| Crossover  | Model Y Long Range AWD (4750), Ioniq 5 AWD (5000), ID.4 AWD Pro (5250), Mach-E Extended Range AWD (5000) |

## Results

Printed by `pnpm validate` and held in the goldens. The forces are the
fitted road load in N. A preset counts as in its class when it is inside
the class range widened by 10 %.

| Preset       | A (lbf) | B (lbf/mph) | C (lbf/mph²) | 50 km/h: sim / class | 100 km/h: sim / class     |
| ------------ | ------- | ----------- | ------------ | -------------------- | ------------------------- |
| Hatchback    | 31.2    | 0.036       | 0.0179       | 221 / 205–292        | 456 / 453–585             |
| Sports car   | 33.4    | 0.112       | 0.0154       | 230 / 241–329        | 444 / 510–641 (3 % below) |
| Pickup       | 40.7    | 0.054       | 0.0351       | 339 / 300–353        | 798 / 781–846             |
| Crossover    | 40.5    | 0.000       | 0.0194       | 263 / 235–258        | 514 / 477–564             |
| Kart         | 5.3     | 0.001       | 0.0149       | 87                   | 279                       |
| Open-wheeler | 11.5    | 0.068       | 0.0247       | 166                  | 494                       |

- **Hatchback and crossover** sit in their classes at both speeds.
- **Pickup** sits in its class at both speeds since the retune below.
  It was high at both (482 N and 1022 N): its tires rolled at `Crr` 0.013,
  about 306 N at 2.4 t, where the EPA trucks' constant term is 110 to
  172 N, and its drag area, `Cd·A` = 0.45 × 3.4 = 1.53 m², gave
  `C` = 0.91 N/(m/s)² against the trucks' 0.72 to 0.76 (about 1.2 to
  1.3 m²).
- **Sports car** is a little low at 100 km/h. Its drag area (0.60 m²) is
  in the class, but the real cars' load grows faster with speed than drag
  alone. Their `B` term is the tires' speed-dependent loss, which the feel
  tire's constant rolling resistance does not have. Its 33.4 lbf constant
  term is inside the class's 27 to 57 lbf.

## What this does and does not show

- EPA's targets include the drivetrain's spin losses in neutral and the
  tires' speed-dependent losses. The core has neither, so its `B` is near
  zero and its `A` and `C` carry everything.
- The masses differ. EPA's equivalent test weight is the curb weight plus
  300 lb, while the presets are curb weight with a driver. Rolling load
  scales with mass, so a lighter preset should sit low in its class.
- Targets are measured once per model by the maker, on a test track,
  corrected to standard conditions. Several trims of the same model differ
  by 10 to 20 % (tires, ride height), which is why each class is a range.

## Pickup retune (2026-11-01)

The pickup now rolls at `Crr` 0.008, as low-rolling-resistance light-truck
tires do, and has `Cd` 0.40 on 3.25 m² (1.30 m² of drag area, at the low
end of the class's 0.40 to 0.47 drag coefficient). That puts it at 339 N
and 798 N, inside the class at both speeds. The rest of the car barely
moves: its understeer gradient goes from 0.93 to 0.91 deg/g (less drag on
the driven wheels in the steady turn), 0–100 km/h from 7.4 s to 7.3 s, and
the no-ABS stop from 49.0 m to 49.1 m. The ABS stop stays at 44.1 m.

The sports car's shortfall at speed is left as it is. It comes from the
feel tire's constant rolling resistance, and a speed term in the tire is
a separate proposal.
