//! Project load / save / autosave / backup recovery.
//!
//! A project is a folder:
//!
//! ```text
//! Foo.cardiac/
//! ├── manifest.json
//! ├── project.json
//! ├── data/<datasetId>.json
//! ├── assets/{images,fonts,icons}/
//! ├── backups/
//! └── previews/
//! ```
//!
//! Writes are atomic (write `*.tmp` → fsync → rename) and the last 10
//! autosaves are retained in `backups/`.

use crate::format::*;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const BACKUP_KEEP: usize = 10;

fn manifest_path(root: &Path) -> PathBuf { root.join("manifest.json") }
fn project_path(root: &Path) -> PathBuf { root.join("project.json") }
fn data_dir(root: &Path) -> PathBuf { root.join("data") }
fn backups_dir(root: &Path) -> PathBuf { root.join("backups") }

fn write_atomic(target: &Path, bytes: &[u8]) -> FormatResult<()> {
    let tmp = target.with_extension(format!(
        "{}.tmp",
        target.extension().and_then(|s| s.to_str()).unwrap_or("tmp")
    ));
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, target)?;
    Ok(())
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

fn ensure_project_skeleton(root: &Path) -> FormatResult<()> {
    fs::create_dir_all(root)?;
    fs::create_dir_all(root.join("assets/images"))?;
    fs::create_dir_all(root.join("assets/fonts"))?;
    fs::create_dir_all(root.join("assets/icons"))?;
    fs::create_dir_all(data_dir(root))?;
    fs::create_dir_all(backups_dir(root))?;
    fs::create_dir_all(root.join("previews"))?;
    Ok(())
}

// ────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProjectArgs {
    pub path: String,
    pub name: String,
}

#[tauri::command]
pub fn new_project(args: NewProjectArgs) -> FormatResult<LoadedProject> {
    let root = PathBuf::from(&args.path);
    if root.exists() && root.read_dir().map(|mut r| r.next().is_some()).unwrap_or(false) {
        return Err(FormatError::Other(format!(
            "target folder {} already exists and is not empty",
            args.path
        )));
    }
    ensure_project_skeleton(&root)?;

    let now = Utc::now().to_rfc3339();
    let project_id = uuid::Uuid::new_v4().to_string();

    // A minimal but valid starting project.
    let project = json!({
        "meta": {
            "name": args.name,
            "description": "",
            "author": ""
        },
        "canvasDefaults": {
            "widthMm": 63.5,
            "heightMm": 88.9,
            "dpi": 300,
            "bleedMm": 3,
            "marginMm": 3,
            "safeAreaMm": 5
        },
        "templates": [],
        "styles": [],
        "palette": [
            { "id": "col-bg", "name": "Card BG",  "hex": "#1a1a1a" },
            { "id": "col-fg", "name": "Card FG",  "hex": "#ffffff" },
            { "id": "col-ac", "name": "Accent",   "hex": "#ffb84d" }
        ],
        "datasets": [],
        "fonts": [],
        "assets": [],
        "variables": [],
        "icons": [],
        "exportProfiles": [
            { "id": "exp-default", "name": "PNG 300dpi", "format": "png", "dpi": 300, "bleed": true }
        ]
    });

    let project_bytes = serde_json::to_vec_pretty(&project)?;
    write_atomic(&project_path(&root), &project_bytes)?;

    let manifest = Manifest {
        format: "cardiac".into(),
        schema_version: CURRENT_SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        project_id,
        created: now.clone(),
        modified: now,
        name: args.name,
        integrity: Some(Integrity {
            project_json_sha1: sha1_hex(&project_bytes),
            asset_manifest: None,
        }),
    };
    write_atomic(
        &manifest_path(&root),
        &serde_json::to_vec_pretty(&manifest)?,
    )?;

    Ok(LoadedProject {
        path: root.to_string_lossy().into_owned(),
        manifest,
        project,
        records: HashMap::new(),
    })
}

#[tauri::command]
pub fn open_project(path: String) -> FormatResult<LoadedProject> {
    let root = PathBuf::from(&path);
    let manifest_raw = fs::read(manifest_path(&root))
        .map_err(|_| FormatError::NotAProject(path.clone()))?;
    let manifest: Manifest = serde_json::from_slice(&manifest_raw)?;

    let project_raw = fs::read(project_path(&root))?;
    let project_value: Value = serde_json::from_slice(&project_raw)?;
    let project_value = migrate(project_value, manifest.schema_version)?;

    let mut records: HashMap<String, Value> = HashMap::new();
    let dd = data_dir(&root);
    if dd.exists() {
        for entry in fs::read_dir(&dd)? {
            let entry = entry?;
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) == Some("json") {
                let bytes = fs::read(&p)?;
                let stem = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                if stem.is_empty() { continue; }
                let v: Value = serde_json::from_slice(&bytes)?;
                records.insert(stem, v);
            }
        }
    }

    Ok(LoadedProject {
        path,
        manifest,
        project: project_value,
        records,
    })
}

#[tauri::command]
pub fn save_project(req: SaveRequest) -> FormatResult<Manifest> {
    write_full(&req, false)
}

#[tauri::command]
pub fn autosave_project(req: SaveRequest) -> FormatResult<Manifest> {
    write_full(&req, true)
}

fn write_full(req: &SaveRequest, autosave: bool) -> FormatResult<Manifest> {
    let root = PathBuf::from(&req.path);
    ensure_project_skeleton(&root)?;

    let project_bytes = serde_json::to_vec_pretty(&req.project)?;
    write_atomic(&project_path(&root), &project_bytes)?;

    for (id, rows) in &req.records {
        let data_bytes = serde_json::to_vec_pretty(rows)?;
        write_atomic(&data_dir(&root).join(format!("{id}.json")), &data_bytes)?;
    }

    let mut manifest = req.manifest.clone();
    manifest.modified = Utc::now().to_rfc3339();
    manifest.schema_version = CURRENT_SCHEMA_VERSION;
    manifest.integrity = Some(Integrity {
        project_json_sha1: sha1_hex(&project_bytes),
        asset_manifest: None,
    });
    write_atomic(
        &manifest_path(&root),
        &serde_json::to_vec_pretty(&manifest)?,
    )?;

    if autosave {
        let stamp = Utc::now().format("%Y%m%dT%H%M%S").to_string();
        let dest = backups_dir(&root).join(format!("autosave-{stamp}.json"));
        write_atomic(&dest, &project_bytes)?;
        prune_backups(&backups_dir(&root))?;
    }

    Ok(manifest)
}

fn prune_backups(dir: &Path) -> FormatResult<()> {
    if !dir.exists() { return Ok(()); }
    let mut entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(Result::ok)
        .filter(|e| {
            e.file_name()
                .to_str()
                .map(|n| n.starts_with("autosave-"))
                .unwrap_or(false)
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());
    while entries.len() > BACKUP_KEEP {
        let oldest = entries.remove(0);
        let _ = fs::remove_file(oldest.path());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub name: String,
    pub path: String,
    pub modified: String,
}

#[tauri::command]
pub fn list_backups(path: String) -> FormatResult<Vec<BackupEntry>> {
    let root = PathBuf::from(&path);
    let dir = backups_dir(&root);
    if !dir.exists() { return Ok(vec![]); }
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let meta = entry.metadata()?;
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                let secs = d.as_secs() as i64;
                chrono::DateTime::<Utc>::from_timestamp(secs, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            })
            .unwrap_or_default();
        out.push(BackupEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            modified,
        });
    }
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

#[tauri::command]
pub fn restore_backup(project_path_: String, backup_path: String) -> FormatResult<()> {
    let root = PathBuf::from(&project_path_);
    let bytes = fs::read(&backup_path)?;
    // Preserve previous project.json under a rescue name before overwriting.
    let prev = project_path(&root);
    if prev.exists() {
        let stamp = Utc::now().format("%Y%m%dT%H%M%S").to_string();
        let rescue = backups_dir(&root).join(format!("replaced-{stamp}.json"));
        let _ = fs::copy(&prev, rescue);
    }
    write_atomic(&prev, &bytes)?;
    Ok(())
}
