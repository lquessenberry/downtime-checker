//! Global Status native globe (alpha).
//!
//! A wgpu-rendered globe inside an eframe/egui window, with catalog pins
//! taken from `downtime-core`. This crate is the product renderer: it has to
//! succeed Cesium in every way (see `docs/rust-native.md`). NASA Blue Marble
//! is on the sphere today; XYZ imagery, terrain, and live layers follow.
//!
//! The same code runs on Linux, macOS and Windows (`main.rs`) and on Android
//! (`android_main` below, built as a `cdylib` with cargo-apk).
//!
//! First-party blast rings live in `downtime-core::blast` (cube-root scaling).
//! That is not the private nuke-sim crate. Release builds still do not enable
//! the empty `nuke-sim` cargo feature.

mod engine;
mod globe_math;
pub mod pins;
mod render;

use crate::engine::{Basemap, ImageryLayer, TerrainKind};
use downtime_core::{blast_card, blast_defcon, blast_rings, builtin_layers, BlastShot, LayerKind, KT_PRESETS};
use eframe::egui;
use glam::Vec3;

use globe_math::{project, OrbitCamera};
use pins::Pin;
use render::{GlobeCallback, GlobeResources};

pub const APP_NAME: &str = "Global Status";

fn viewport() -> egui::ViewportBuilder {
    egui::ViewportBuilder::default()
        .with_title(concat!("Global Status ", env!("CARGO_PKG_VERSION")))
        .with_inner_size([1200.0, 760.0])
}

/// Open the globe window with already-loaded catalog data.
pub fn run(data: pins::PinData, mut options: eframe::NativeOptions) -> eframe::Result<()> {
    options.renderer = eframe::Renderer::Wgpu;
    eframe::run_native(
        APP_NAME,
        options,
        Box::new(move |cc| {
            let state = cc
                .wgpu_render_state
                .as_ref()
                .ok_or("the wgpu renderer is not available")?;
            GlobeResources::install(state);
            Ok(Box::new(GlobeApp::new(data)))
        }),
    )
}

/// Desktop defaults.
pub fn desktop_options() -> eframe::NativeOptions {
    eframe::NativeOptions { viewport: viewport(), ..Default::default() }
}

#[cfg(target_os = "android")]
#[no_mangle]
fn android_main(app: winit::platform::android::activity::AndroidApp) {
    let options = eframe::NativeOptions { android_app: Some(app), ..Default::default() };
    if let Err(e) = run(pins::load_embedded(), options) {
        eprintln!("Global Status: {e}");
    }
}

struct GlobeApp {
    camera: OrbitCamera,
    data: pins::PinData,
    show_pins: bool,
    show_grid: bool,
    selected: Option<usize>,
    nuke_on: bool,
    yield_idx: usize,
    airburst: bool,
    shots: Vec<BlastShot>,
    basemap: Basemap,
    terrain: TerrainKind,
}

impl GlobeApp {
    fn new(data: pins::PinData) -> Self {
        Self {
            camera: OrbitCamera::default(),
            data,
            show_pins: true,
            show_grid: false,
            selected: None,
            nuke_on: false,
            yield_idx: 0,
            airburst: true,
            shots: Vec::new(),
            basemap: Basemap::BlueMarble,
            terrain: TerrainKind::Ellipsoid,
        }
    }

    fn side_panel(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("layers").resizable(true).default_width(260.0).show(ctx, |ui| {
            ui.heading("Global Status");
            ui.label(egui::RichText::new(concat!("Native globe alpha ", env!("CARGO_PKG_VERSION"))).weak());
            ui.separator();
            ui.label(&self.data.status);
            ui.label(ImageryLayer::for_basemap(self.basemap).credit);
            ui.label("Basemap (free only)");
            egui::ComboBox::from_id_salt("basemap")
                .selected_text(self.basemap.label())
                .show_ui(ui, |ui| {
                    for b in Basemap::ALL {
                        ui.selectable_value(&mut self.basemap, b, b.label());
                    }
                });
            ui.label("Terrain");
            egui::ComboBox::from_id_salt("terrain")
                .selected_text(self.terrain.label())
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.terrain, TerrainKind::Ellipsoid, TerrainKind::Ellipsoid.label());
                    ui.selectable_value(&mut self.terrain, TerrainKind::Terrarium, TerrainKind::Terrarium.label());
                });
            ui.checkbox(&mut self.show_pins, format!("Capital pins ({})", self.data.pins.len()));
            ui.checkbox(&mut self.show_grid, "Graticule");
            ui.separator();
            ui.heading("NUCLEAR");
            ui.label(egui::RichText::new(format!("DEFCON {}", blast_defcon(&self.shots))).strong());
            ui.checkbox(&mut self.nuke_on, "Arm (one thumb)");
            ui.add(egui::Slider::new(&mut self.yield_idx, 0..=KT_PRESETS.len() - 1).text("yield step"));
            ui.label(format!("{:.0} kt", KT_PRESETS[self.yield_idx.min(KT_PRESETS.len() - 1)]));
            ui.checkbox(&mut self.airburst, "Airburst");
            if ui.add_sized([ui.available_width(), 44.0], egui::Button::new("FIRE")).clicked() && self.nuke_on {
                self.shots.push(BlastShot {
                    lat: f64::from(self.camera.lat),
                    lon: f64::from(self.camera.lon),
                    yield_kt: KT_PRESETS[self.yield_idx.min(KT_PRESETS.len() - 1)],
                    airburst: self.airburst,
                });
            }
            if ui.button("Clear shots").clicked() {
                self.shots.clear();
            }
            if let Some(shot) = self.shots.last() {
                ui.label(blast_card(*shot));
            }
            ui.separator();
            ui.label("Layers (Cesium parity)");
            egui::ScrollArea::vertical().id_salt("layer-stubs").max_height(160.0).show(ui, |ui| {
                for layer in builtin_layers() {
                    let mark = match layer.kind {
                        LayerKind::Active => "on",
                        LayerKind::Stub => "soon",
                    };
                    ui.label(format!("{mark}  {}", layer.title));
                }
            });
            ui.separator();
            ui.label("Camera");
            ui.add(egui::Slider::new(&mut self.camera.lat, -85.0..=85.0).text("lat"));
            ui.add(egui::Slider::new(&mut self.camera.lon, -180.0..=180.0).text("lon"));
            ui.add(egui::Slider::new(&mut self.camera.distance, 1.15..=12.0).text("distance"));
            if ui.button("Reset view").clicked() {
                self.camera = OrbitCamera::default();
            }
            ui.separator();
            ui.label("Searches (from downtime-core)");
            egui::ScrollArea::vertical().show(ui, |ui| {
                for s in &self.data.searches {
                    ui.label(format!("{}  {}", s.count, s.label));
                }
            });
        });
    }

    fn globe(&mut self, ui: &mut egui::Ui) {
        let (rect, response) = ui.allocate_exact_size(ui.available_size(), egui::Sense::click_and_drag());
        if response.dragged() {
            let d = response.drag_delta();
            self.camera.drag(d.x, d.y);
        }
        if response.hovered() {
            let scroll = ui.input(|i| i.smooth_scroll_delta.y);
            if scroll != 0.0 {
                self.camera.zoom(scroll);
            }
        }
        let aspect = rect.width() / rect.height().max(1.0);
        let view_proj = self.camera.view_proj(aspect);
        let sun = self.camera.eye() + Vec3::new(0.0, 1.5, 0.0);
        ui.painter().add(eframe::egui_wgpu::Callback::new_paint_callback(
            rect,
            GlobeCallback { view_proj, sun, grid: if self.show_grid { 1.0 } else { 0.0 } },
        ));

        let painter = ui.painter_at(rect);
        self.paint_blast_rings(&painter, rect, view_proj);
        if !self.show_pins {
            return;
        }
        let hover = response.hover_pos();
        let mut hovered: Option<(usize, egui::Pos2)> = None;
        for (i, pin) in self.data.pins.iter().enumerate() {
            let p = pin.unit();
            if !self.camera.sees(p) {
                continue;
            }
            let Some([x, y]) = project(view_proj, p, [rect.width(), rect.height()]) else { continue };
            let pos = rect.min + egui::vec2(x, y);
            let color = if self.selected == Some(i) { egui::Color32::GOLD } else { egui::Color32::from_rgb(80, 220, 120) };
            painter.circle_filled(pos, 3.5, color);
            if hover.is_some_and(|h| h.distance(pos) < 8.0) {
                hovered = Some((i, pos));
            }
        }
        if let Some((i, pos)) = hovered {
            let pin: &Pin = &self.data.pins[i];
            painter.text(pos + egui::vec2(8.0, -8.0), egui::Align2::LEFT_BOTTOM, &pin.label, egui::FontId::proportional(14.0), egui::Color32::WHITE);
            if response.clicked() {
                self.selected = Some(i);
            }
        }
    }

    fn paint_blast_rings(&self, painter: &egui::Painter, rect: egui::Rect, view_proj: glam::Mat4) {
        const EARTH_M: f64 = 6_371_000.0;
        for shot in &self.shots {
            let r = blast_rings(shot.yield_kt, shot.airburst);
            let radii = [r.fireball_m, r.heavy_m, r.medium_m, r.light_m, r.thermal_m];
            let colors = [
                egui::Color32::from_rgb(255, 220, 80),
                egui::Color32::from_rgb(220, 40, 30),
                egui::Color32::from_rgb(230, 120, 40),
                egui::Color32::from_rgb(80, 180, 90),
                egui::Color32::from_rgb(255, 160, 60),
            ];
            for (meters, color) in radii.into_iter().zip(colors) {
                let ang = (meters / EARTH_M).to_degrees();
                let mut pts = Vec::new();
                for i in 0..48 {
                    let t = (i as f64) * std::f64::consts::TAU / 48.0;
                    let lat = shot.lat + ang * t.cos();
                    let lon = shot.lon + ang * t.sin() / lat.to_radians().cos().max(0.2);
                    let p = globe_math::lat_lon_to_unit(lat, lon);
                    if !self.camera.sees(p) {
                        continue;
                    }
                    if let Some([x, y]) = project(view_proj, p, [rect.width(), rect.height()]) {
                        pts.push(rect.min + egui::vec2(x, y));
                    }
                }
                if pts.len() > 2 {
                    painter.add(egui::Shape::closed_line(pts, egui::Stroke::new(1.5, color)));
                }
            }
        }
    }
}

impl eframe::App for GlobeApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.side_panel(ctx);
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(egui::Color32::from_rgb(7, 11, 16)))
            .show(ctx, |ui| self.globe(ui));
    }
}
