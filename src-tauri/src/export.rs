//! Deterministic SVG → PNG rasterisation using resvg.
//!
//! The frontend serialises a card to a self-contained SVG string (all
//! image hrefs resolved to `file://` URLs inside the project folder, all
//! text spans using family names already registered) and hands it over
//! with a target DPI. We load all fonts from `assets/fonts/` so rendering
//! matches the on-screen preview as closely as possible.

use crate::format::*;
use image::{ImageBuffer, ImageEncoder, Rgba};
use resvg::tiny_skia;
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};

fn build_font_db(project_root: &Path) -> usvg::fontdb::Database {
    let mut db = usvg::fontdb::Database::new();
    db.load_system_fonts();
    let fonts_dir = project_root.join("assets/fonts");
    if fonts_dir.exists() {
        db.load_fonts_dir(&fonts_dir);
    }
    db
}

fn svg_to_png(svg: &str, width_px: u32, height_px: u32, project_root: &Path) -> FormatResult<Vec<u8>> {
    let db = build_font_db(project_root);
    let opts = usvg::Options {
        resources_dir: Some(project_root.to_path_buf()),
        fontdb: std::sync::Arc::new(db),
        ..usvg::Options::default()
    };

    let tree = usvg::Tree::from_str(svg, &opts)
        .map_err(|e| FormatError::Other(format!("svg parse: {e}")))?;

    let size = tree.size();
    let sx = width_px as f32 / size.width();
    let sy = height_px as f32 / size.height();
    let mut pix = tiny_skia::Pixmap::new(width_px, height_px)
        .ok_or_else(|| FormatError::Other("pixmap alloc failed".into()))?;
    let transform = tiny_skia::Transform::from_scale(sx, sy);
    resvg::render(&tree, transform, &mut pix.as_mut());

    let buf: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width_px, height_px, pix.data().to_vec())
            .ok_or_else(|| FormatError::Other("image buffer conversion failed".into()))?;

    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new(&mut out)
        .write_image(
            buf.as_raw(),
            width_px,
            height_px,
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|e| FormatError::Other(format!("png encode: {e}")))?;
    Ok(out)
}

// ────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCardArgs {
    pub project_path: String,
    pub out_path: String,
    pub svg: String,
    pub width_px: u32,
    pub height_px: u32,
}

#[tauri::command]
pub fn export_card_png(args: ExportCardArgs) -> FormatResult<String> {
    let root = PathBuf::from(&args.project_path);
    let bytes = svg_to_png(&args.svg, args.width_px, args.height_px, &root)?;
    let dest = PathBuf::from(&args.out_path);
    if let Some(parent) = dest.parent() { fs::create_dir_all(parent)?; }
    fs::write(&dest, &bytes)?;
    Ok(dest.to_string_lossy().into_owned())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDeckArgs {
    pub project_path: String,
    pub out_dir: String,
    pub items: Vec<ExportItem>,
    pub width_px: u32,
    pub height_px: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportItem {
    pub filename: String,  // e.g. "01-goblin.png"
    pub svg: String,
}

#[tauri::command]
pub fn export_deck_pngs(args: ExportDeckArgs) -> FormatResult<Vec<String>> {
    let root = PathBuf::from(&args.project_path);
    let dir = PathBuf::from(&args.out_dir);
    fs::create_dir_all(&dir)?;
    let mut written = Vec::new();
    for item in &args.items {
        let bytes = svg_to_png(&item.svg, args.width_px, args.height_px, &root)?;
        let dest = dir.join(&item.filename);
        fs::write(&dest, &bytes)?;
        written.push(dest.to_string_lossy().into_owned());
    }
    Ok(written)
}
