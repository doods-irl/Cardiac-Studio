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

/// Rasterise SVG to a raw RGBA8 byte buffer (4 bytes per pixel, row-major).
/// Used by both the PNG export path (encodes to PNG) and the PDF export
/// path (composites to RGB).
fn svg_to_rgba(svg: &str, width_px: u32, height_px: u32, project_root: &Path) -> FormatResult<Vec<u8>> {
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

    Ok(pix.data().to_vec())
}

fn svg_to_png(svg: &str, width_px: u32, height_px: u32, project_root: &Path) -> FormatResult<Vec<u8>> {
    let rgba = svg_to_rgba(svg, width_px, height_px, project_root)?;

    let buf: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_raw(width_px, height_px, rgba)
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

/// Composite RGBA pixels onto an opaque white background, returning an
/// RGB8 buffer. Needed for the PDF export path because printpdf 0.7
/// mishandles the alpha channel (it routes alpha into a SoftMask `matte`
/// field that's spec'd as a single colour, not per-pixel data — the
/// resulting PDFs render blank). Flattening to RGB sidesteps the bug
/// entirely; cards designed for print already cover their canvas with
/// a background, so the white fallback is invisible to the user.
fn rgba_to_rgb_on_white(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        let r = px[0] as u32;
        let g = px[1] as u32;
        let b = px[2] as u32;
        let a = px[3] as u32;
        // out = (src * a + 255 * (255 - a)) / 255 — premultiplied composite onto white.
        let inv_a = 255 - a;
        out.push(((r * a + 255 * inv_a) / 255) as u8);
        out.push(((g * a + 255 * inv_a) / 255) as u8);
        out.push(((b * a + 255 * inv_a) / 255) as u8);
    }
    out
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

// ─── PDF sheet export ──────────────────────────────────────────────
//
// Produces a single multi-page PDF with cards laid out in a grid on
// printable sheets. Each card is rasterised through the same resvg
// pipeline as the PNG export, so PDF output matches PNG output. PDF
// pages are assembled with `printpdf` (raster-image-on-page).
//
// Layout: cards sit edge-to-edge inside a per-side margin. Bleed-
// inclusive cards consume more space; bleed extends past the cut
// line and crop marks (when enabled) sit at the inner cut boundary.

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDeckPdfArgs {
    pub project_path: String,
    pub out_path: String,
    pub items: Vec<ExportItem>,
    /// Raster size of each card in pixels (matches PNG export).
    pub width_px: u32,
    pub height_px: u32,
    /// Physical card size on the sheet in mm (bleed-inclusive when bleed is on).
    pub card_width_mm: f32,
    pub card_height_mm: f32,
    /// Sheet (page) size in mm.
    pub page_width_mm: f32,
    pub page_height_mm: f32,
    /// Per-side margin around the card grid in mm.
    pub margin_mm: f32,
    /// Bleed in mm — only used to position crop marks at the cut boundary.
    pub bleed_mm: f32,
    pub crop_marks: bool,
}

#[tauri::command]
pub fn export_deck_pdf(args: ExportDeckPdfArgs) -> FormatResult<String> {
    use printpdf::*;

    let root = PathBuf::from(&args.project_path);
    let dest = PathBuf::from(&args.out_path);

    // Grid layout — how many cards fit per page.
    let usable_w = args.page_width_mm - 2.0 * args.margin_mm;
    let usable_h = args.page_height_mm - 2.0 * args.margin_mm;
    let cols = (usable_w / args.card_width_mm).floor() as usize;
    let rows = (usable_h / args.card_height_mm).floor() as usize;
    if cols == 0 || rows == 0 {
        return Err(FormatError::Other(format!(
            "card {}×{}mm doesn't fit page {}×{}mm with {}mm margin — adjust page size or margin",
            args.card_width_mm, args.card_height_mm,
            args.page_width_mm, args.page_height_mm, args.margin_mm,
        )));
    }
    let per_page = cols * rows;
    let total_items = args.items.len();
    let total_pages = (total_items + per_page - 1) / per_page;

    let (doc, page1_idx, layer1_idx) = PdfDocument::new(
        "Cardiac Deck",
        Mm(args.page_width_mm),
        Mm(args.page_height_mm),
        "Layer 1",
    );

    let mut page_idxs = Vec::with_capacity(total_pages);
    page_idxs.push((page1_idx, layer1_idx));
    for n in 1..total_pages {
        let (p, l) = doc.add_page(
            Mm(args.page_width_mm),
            Mm(args.page_height_mm),
            format!("Page {}", n + 1),
        );
        page_idxs.push((p, l));
    }

    // Place each card. printpdf's coordinate origin is bottom-left of the page,
    // so we flip the row index when computing y.
    for (idx, item) in args.items.iter().enumerate() {
        let page_n = idx / per_page;
        let in_page = idx % per_page;
        let row = in_page / cols;
        let col = in_page % cols;

        let x_mm = args.margin_mm + (col as f32) * args.card_width_mm;
        let y_mm = args.page_height_mm
            - args.margin_mm
            - ((row + 1) as f32) * args.card_height_mm;

        // Build the PDF image directly from raw pixel data. We avoid
        // `Image::from_dynamic_image` because printpdf 0.7 routes the
        // alpha channel through a malformed SoftMask (alpha bytes stuffed
        // into the `matte` field, which by spec is a single colour) — that
        // path produces blank PDFs. Instead, composite onto white here and
        // hand printpdf an opaque RGB image.
        let rgba = svg_to_rgba(&item.svg, args.width_px, args.height_px, &root)?;
        let rgb = rgba_to_rgb_on_white(&rgba);
        let xobj = ImageXObject {
            width:  Px(args.width_px as usize),
            height: Px(args.height_px as usize),
            color_space: ColorSpace::Rgb,
            bits_per_component: ColorBits::Bit8,
            interpolate: true,
            image_data: rgb,
            image_filter: None,
            smask: None,
            clipping_bbox: None,
        };
        let img: Image = xobj.into();

        // Scale: the rasterised PNG has intrinsic size width_px @ 300dpi → so many mm.
        // We want it to display at card_width_mm × card_height_mm.
        let intrinsic_w_mm = (args.width_px as f32 / 300.0) * 25.4;
        let intrinsic_h_mm = (args.height_px as f32 / 300.0) * 25.4;
        let scale_x = args.card_width_mm / intrinsic_w_mm;
        let scale_y = args.card_height_mm / intrinsic_h_mm;

        let (page_idx, layer_idx) = page_idxs[page_n];
        let layer = doc.get_page(page_idx).get_layer(layer_idx);
        img.add_to_layer(
            layer,
            ImageTransform {
                translate_x: Some(Mm(x_mm)),
                translate_y: Some(Mm(y_mm)),
                rotate: None,
                scale_x: Some(scale_x),
                scale_y: Some(scale_y),
                dpi: Some(300.0),
            },
        );
    }

    if args.crop_marks {
        draw_crop_marks(&doc, &page_idxs, &args, cols, per_page, total_items);
    }

    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut writer = std::io::BufWriter::new(std::fs::File::create(&dest)?);
    doc.save(&mut writer)
        .map_err(|e| FormatError::Other(format!("pdf save: {e}")))?;

    Ok(dest.to_string_lossy().into_owned())
}

fn draw_crop_marks(
    doc: &printpdf::PdfDocumentReference,
    page_idxs: &[(printpdf::PdfPageIndex, printpdf::PdfLayerIndex)],
    args: &ExportDeckPdfArgs,
    cols: usize,
    per_page: usize,
    total_items: usize,
) {
    use printpdf::*;
    let mark_len_mm: f32 = 3.0;

    for (page_n, &(page_idx, layer_idx)) in page_idxs.iter().enumerate() {
        let layer = doc.get_page(page_idx).get_layer(layer_idx);
        layer.set_outline_thickness(0.4);
        layer.set_outline_color(Color::Rgb(Rgb::new(0.0, 0.0, 0.0, None)));

        let start_idx = page_n * per_page;
        let end_idx = (start_idx + per_page).min(total_items);

        for item_idx in start_idx..end_idx {
            let in_page = item_idx % per_page;
            let row = in_page / cols;
            let col = in_page % cols;
            let x_mm = args.margin_mm + (col as f32) * args.card_width_mm;
            let y_mm = args.page_height_mm
                - args.margin_mm
                - ((row + 1) as f32) * args.card_height_mm;

            // Cut box (inner rectangle, excluding bleed).
            let cx1 = x_mm + args.bleed_mm;
            let cy1 = y_mm + args.bleed_mm;
            let cx2 = x_mm + args.card_width_mm - args.bleed_mm;
            let cy2 = y_mm + args.card_height_mm - args.bleed_mm;

            // Eight short marks: at each of four corners, one horizontal + one vertical
            // tick extending outward.
            let marks: [((f32, f32), (f32, f32)); 8] = [
                ((cx1 - mark_len_mm, cy2), (cx1, cy2)), // TL horizontal
                ((cx1, cy2), (cx1, cy2 + mark_len_mm)), // TL vertical
                ((cx2, cy2), (cx2 + mark_len_mm, cy2)), // TR horizontal
                ((cx2, cy2), (cx2, cy2 + mark_len_mm)), // TR vertical
                ((cx1 - mark_len_mm, cy1), (cx1, cy1)), // BL horizontal
                ((cx1, cy1 - mark_len_mm), (cx1, cy1)), // BL vertical
                ((cx2, cy1), (cx2 + mark_len_mm, cy1)), // BR horizontal
                ((cx2, cy1 - mark_len_mm), (cx2, cy1)), // BR vertical
            ];
            for ((x1, y1), (x2, y2)) in marks {
                let line = Line {
                    points: vec![
                        (Point::new(Mm(x1), Mm(y1)), false),
                        (Point::new(Mm(x2), Mm(y2)), false),
                    ],
                    is_closed: false,
                };
                layer.add_line(line);
            }
        }
    }
}
