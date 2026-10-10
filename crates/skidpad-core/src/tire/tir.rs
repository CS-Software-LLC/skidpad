//! Parser for Magic Formula `.tir` property files.
//!
//! The format is a sequence of `[SECTION]` headers followed by `KEY = VALUE`
//! lines. Comments start with `$` or `!`. Values are numbers or single-quoted
//! strings. This parser is format-level only; it has no knowledge of any
//! particular vendor's file beyond the public MF-Tyre / PAC2002 key names.

use super::MagicFormulaParams;

#[derive(Clone, Debug, PartialEq)]
pub enum TirValue {
    Number(f64),
    Text(String),
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TirSection {
    pub name: String,
    pub entries: Vec<(String, TirValue)>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct TirFile {
    pub sections: Vec<TirSection>,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TirWarning {
    pub section: String,
    pub key: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct TirImport {
    pub params: MagicFormulaParams,
    pub warnings: Vec<TirWarning>,
}

fn strip_comment(line: &str) -> &str {
    let mut in_quote = false;
    for (i, ch) in line.char_indices() {
        match ch {
            '\'' => in_quote = !in_quote,
            '$' | '!' if !in_quote => return &line[..i],
            _ => {}
        }
    }
    line
}

/// Parse the textual structure. Never fails on unknown content; malformed
/// lines are skipped.
pub fn parse(text: &str) -> TirFile {
    let mut file = TirFile::default();
    let mut current = TirSection {
        name: String::from(""),
        entries: Vec::new(),
    };
    for raw in text.lines() {
        let line = strip_comment(raw).trim();
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix('[') {
            if let Some(end) = rest.find(']') {
                if !current.name.is_empty() || !current.entries.is_empty() {
                    file.sections.push(std::mem::take(&mut current));
                }
                current.name = rest[..end].trim().to_ascii_uppercase();
                continue;
            }
        }
        if let Some((k, v)) = line.split_once('=') {
            let key = k.trim().to_ascii_uppercase();
            let v = v.trim();
            let value = if let Some(s) = v.strip_prefix('\'') {
                TirValue::Text(s.trim_end_matches('\'').to_string())
            } else {
                match v.parse::<f64>() {
                    Ok(n) => TirValue::Number(n),
                    Err(_) => TirValue::Text(v.to_string()),
                }
            };
            current.entries.push((key, value));
        }
    }
    if !current.name.is_empty() || !current.entries.is_empty() {
        file.sections.push(current);
    }
    file
}

/// Sections whose numeric keys feed the Magic Formula parameters.
const COEFFICIENT_SECTIONS: &[&str] = &[
    "DIMENSION",
    "VERTICAL",
    "SCALING_COEFFICIENTS",
    "LONGITUDINAL_COEFFICIENTS",
    "LATERAL_COEFFICIENTS",
    "ALIGNING_COEFFICIENTS",
    "OVERTURNING_COEFFICIENTS",
    "ROLLING_COEFFICIENTS",
    "MODEL",
    "CONTACT_PATCH_TRANSIENT",
];

/// The key the parameter table uses for a `.tir` key. PAC2002 and MF-Tyre
/// files quote the nominal load as `FNOMIN` in `[VERTICAL]`; `FZ0` is
/// accepted as well.
fn canonical_key(key: &str) -> &str {
    match key {
        "FNOMIN" => "FZ0",
        _ => key,
    }
}

/// Build Magic Formula parameters from a parsed file, collecting warnings for
/// every key the subset ignores and for unit declarations that are not SI.
pub fn import(file: &TirFile) -> TirImport {
    let mut params = MagicFormulaParams::default();
    let mut warnings = Vec::new();

    for section in &file.sections {
        match section.name.as_str() {
            "UNITS" => {
                for (k, v) in &section.entries {
                    if let TirValue::Text(t) = v {
                        let t = t.to_ascii_lowercase();
                        let ok = match k.as_str() {
                            "LENGTH" => t == "meter" || t == "metre" || t == "m",
                            "FORCE" => t == "newton" || t == "n",
                            "ANGLE" => t == "radians" || t == "radian" || t == "rad",
                            "MASS" => t == "kg" || t == "kilogram",
                            "TIME" => t == "second" || t == "s" || t == "seconds",
                            _ => true,
                        };
                        if !ok {
                            warnings.push(TirWarning {
                                section: section.name.clone(),
                                key: k.clone(),
                                message: format!(
                                    "unit '{t}' is not SI; values are used as-is without conversion"
                                ),
                            });
                        }
                    }
                }
            }
            name if COEFFICIENT_SECTIONS.contains(&name) => {
                for (k, v) in &section.entries {
                    match v {
                        TirValue::Number(n) => {
                            if !params.set_by_key(canonical_key(k), *n) {
                                warnings.push(TirWarning {
                                    section: section.name.clone(),
                                    key: k.clone(),
                                    message: String::from(
                                        "not part of the supported Magic Formula subset; ignored",
                                    ),
                                });
                            }
                        }
                        TirValue::Text(_) => {}
                    }
                }
            }
            _ => {
                warnings.push(TirWarning {
                    section: section.name.clone(),
                    key: String::new(),
                    message: String::from("section is not used by the supported subset; ignored"),
                });
            }
        }
    }

    let mut errors = Vec::new();
    params.validate("tire", &mut errors);
    for e in errors {
        warnings.push(TirWarning {
            section: String::new(),
            key: String::new(),
            message: e,
        });
    }

    TirImport { params, warnings }
}

/// Convenience: parse and import in one call.
pub fn import_str(text: &str) -> TirImport {
    import(&parse(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sections_and_comments() {
        let f = parse(
            "$ comment\n[MODEL]\nPROPERTY_FILE_FORMAT = 'PAC2002' $ format\n[LATERAL_COEFFICIENTS]\nPKY1 = -21.5 ! stiffness\nPCY1=1.3\nBOGUS = 4\n",
        );
        assert_eq!(f.sections.len(), 2);
        assert_eq!(f.sections[1].name, "LATERAL_COEFFICIENTS");
        assert_eq!(
            f.sections[1].entries[0],
            ("PKY1".to_string(), TirValue::Number(-21.5))
        );
        let imp = import(&f);
        assert_eq!(imp.params.pky1, -21.5);
        assert_eq!(imp.params.pcy1, 1.3);
        assert!(imp.warnings.iter().any(|w| w.key == "BOGUS"));
    }

    #[test]
    fn reads_the_nominal_load_from_fnomin() {
        let imp = import_str("[VERTICAL]\nVERTICAL_STIFFNESS = 280000\nFNOMIN = 4850\n");
        assert_eq!(imp.params.fz0, 4850.0);
        assert!(!imp.warnings.iter().any(|w| w.key == "FNOMIN"));
    }
}
