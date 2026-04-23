//! Wire-format types that mirror the TypeScript document model.
//!
//! The Rust side is intentionally permissive — it validates structure
//! (schema version, required top-level keys, known field shapes for
//! datasets) but the canonical schema lives in
//! `src/schemas/project.schema.json` and is enforced by the frontend.
//!
//! Migrations between `schema_version` values are applied on load.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CURRENT_SCHEMA_VERSION: u32 = 1;
pub const PROJECT_EXTENSION: &str = "cardiac";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub schema_version: u32,
    pub app_version: String,
    pub project_id: String,
    pub created: String,
    pub modified: String,
    pub name: String,
    #[serde(default)]
    pub integrity: Option<Integrity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Integrity {
    pub project_json_sha1: String,
    #[serde(default)]
    pub asset_manifest: Option<String>,
}

/// A loaded project bundles the manifest, parsed project.json, and each
/// dataset's records as raw JSON so the frontend owns the domain shape.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedProject {
    pub path: String,
    pub manifest: Manifest,
    pub project: Value,
    pub records: std::collections::HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub path: String,
    pub manifest: Manifest,
    pub project: Value,
    pub records: std::collections::HashMap<String, Value>,
}

#[derive(Debug, thiserror::Error, Serialize)]
pub enum FormatError {
    #[error("I/O error: {0}")]
    Io(String),
    #[error("JSON error: {0}")]
    Json(String),
    #[error("schema version {0} is newer than supported {1}")]
    VersionTooNew(u32, u32),
    #[error("not a Cardiac project at {0}")]
    NotAProject(String),
    #[error("{0}")]
    Other(String),
}

impl From<std::io::Error> for FormatError {
    fn from(e: std::io::Error) -> Self { FormatError::Io(e.to_string()) }
}
impl From<serde_json::Error> for FormatError {
    fn from(e: serde_json::Error) -> Self { FormatError::Json(e.to_string()) }
}
impl From<anyhow::Error> for FormatError {
    fn from(e: anyhow::Error) -> Self { FormatError::Other(e.to_string()) }
}

pub type FormatResult<T> = Result<T, FormatError>;

/// Forward-migrate a `project.json` value through all registered migrations
/// until it reaches `CURRENT_SCHEMA_VERSION`.
pub fn migrate(mut project: Value, from: u32) -> FormatResult<Value> {
    if from > CURRENT_SCHEMA_VERSION {
        return Err(FormatError::VersionTooNew(from, CURRENT_SCHEMA_VERSION));
    }
    let mut v = from;
    while v < CURRENT_SCHEMA_VERSION {
        project = match v {
            // placeholder: when we bump to 2, implement `migrate_v1_to_v2`
            _ => project,
        };
        v += 1;
    }
    Ok(project)
}
