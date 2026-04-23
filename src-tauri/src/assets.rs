//! Asset import: content-addressed copy into the project, plus listing
//! and removal. Images are decoded to pull width/height; fonts store only
//! filename + family hint (the frontend supplies `family`/`weight`).

use crate::format::*;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::{Path, PathBuf};

fn sha1_file(path: &Path) -> FormatResult<String> {
    let bytes = fs::read(path)?;
    let mut h = Sha1::new();
    h.update(&bytes);
    Ok(hex::encode(h.finalize()))
}

fn slugify(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAsset {
    pub id: String,
    pub kind: String,
    pub path: String,             // relative to project root
    pub original_name: String,
    pub hash: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub family: Option<String>,
    pub weight: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportImageArgs {
    pub project_path: String,
    pub source_path: String,
}

#[tauri::command]
pub fn import_image(args: ImportImageArgs) -> FormatResult<ImportedAsset> {
    let src = PathBuf::from(&args.source_path);
    if !src.is_file() {
        return Err(FormatError::Other(format!(
            "source file not found: {}",
            args.source_path
        )));
    }

    let hash = sha1_file(&src)?;
    let orig = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("asset")
        .to_string();
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin")
        .to_lowercase();
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("asset");
    let filename = format!("{}_{}.{}", &hash[..10], slugify(stem), ext);
    let dest_dir = PathBuf::from(&args.project_path).join("assets/images");
    fs::create_dir_all(&dest_dir)?;
    let dest = dest_dir.join(&filename);
    if !dest.exists() {
        fs::copy(&src, &dest)?;
    }

    let (width, height) = match image::image_dimensions(&dest) {
        Ok((w, h)) => (Some(w), Some(h)),
        Err(_) => (None, None),
    };

    Ok(ImportedAsset {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "image".into(),
        path: format!("assets/images/{filename}"),
        original_name: orig,
        hash,
        width,
        height,
        family: None,
        weight: None,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFontArgs {
    pub project_path: String,
    pub source_path: String,
    pub family: String,
    pub weight: Option<u32>,
}

#[tauri::command]
pub fn import_font(args: ImportFontArgs) -> FormatResult<ImportedAsset> {
    let src = PathBuf::from(&args.source_path);
    if !src.is_file() {
        return Err(FormatError::Other(format!(
            "source font not found: {}",
            args.source_path
        )));
    }
    let hash = sha1_file(&src)?;
    let orig = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("font")
        .to_string();
    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("ttf")
        .to_lowercase();
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("font");
    let filename = format!("{}_{}.{}", &hash[..10], slugify(stem), ext);
    let dest_dir = PathBuf::from(&args.project_path).join("assets/fonts");
    fs::create_dir_all(&dest_dir)?;
    let dest = dest_dir.join(&filename);
    if !dest.exists() {
        fs::copy(&src, &dest)?;
    }

    Ok(ImportedAsset {
        id: uuid::Uuid::new_v4().to_string(),
        kind: "font".into(),
        path: format!("assets/fonts/{filename}"),
        original_name: orig,
        hash,
        width: None,
        height: None,
        family: Some(args.family),
        weight: args.weight,
    })
}

#[tauri::command]
pub fn list_assets(project_path: String) -> FormatResult<Vec<ImportedAsset>> {
    let root = PathBuf::from(&project_path);
    let mut out = Vec::new();
    for (kind, sub) in [("image", "assets/images"), ("font", "assets/fonts"), ("icon", "assets/icons")] {
        let dir = root.join(sub);
        if !dir.exists() { continue; }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let p = entry.path();
            if !p.is_file() { continue; }
            let rel = format!("{sub}/{}", entry.file_name().to_string_lossy());
            let hash = sha1_file(&p).unwrap_or_default();
            let (w, h) = if kind == "image" {
                image::image_dimensions(&p).map(|(w,h)|(Some(w),Some(h))).unwrap_or((None,None))
            } else { (None,None) };
            out.push(ImportedAsset {
                id: uuid::Uuid::new_v4().to_string(),
                kind: kind.into(),
                path: rel,
                original_name: entry.file_name().to_string_lossy().into_owned(),
                hash,
                width: w,
                height: h,
                family: None,
                weight: None,
            });
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveAssetArgs {
    pub project_path: String,
    pub relative_path: String,
}

#[tauri::command]
pub fn remove_asset(args: RemoveAssetArgs) -> FormatResult<()> {
    let root = PathBuf::from(&args.project_path);
    let full = root.join(&args.relative_path);
    // Safety: require path is inside project root.
    let canon_root = fs::canonicalize(&root)?;
    let canon_full = fs::canonicalize(&full).unwrap_or_else(|_| full.clone());
    if !canon_full.starts_with(&canon_root) {
        return Err(FormatError::Other("refusing to delete outside project".into()));
    }
    if full.is_file() {
        fs::remove_file(&full)?;
    }
    Ok(())
}
