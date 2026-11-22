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
//! The nuclear-effects simulator is not part of this crate. It stays private
//! until its authors say it is ready, and would only ever be compiled with the
//! non-default `nuke-sim` feature, which release builds never enable.

mod engine;
mod globe_math;
pub mod pins;
mod render;

use downtime_core::{builtin_layers, LayerKind};
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
}

impl GlobeApp {
    fn new(data: pins::PinData) -> Self {
        Self {
            camera: OrbitCamera::default(),
            data,
            show_pins: true,
            show_grid: false,
            selected: None,
        }
    }

    fn side_panel(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("layers").resizable(true).default_width(260.0).show(ctx, |ui| {
            ui.heading("Global Status");
            ui.label(egui::RichText::new(concat!("Native globe alpha ", env!("CARGO_PKG_VERSION"))).weak());
            ui.separator();
            ui.label(&self.data.status);
            ui.label("Earth: NASA Blue Marble (public domain)");
            ui.checkbox(&mut self.show_pins, format!("Capital pins ({})", self.data.pins.len()));
            ui.checkbox(&mut self.show_grid, "Graticule");
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

        if !self.show_pins {
            return;
        }
        let painter = ui.painter_at(rect);
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
}

impl eframe::App for GlobeApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.side_panel(ctx);
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(egui::Color32::from_rgb(7, 11, 16)))
            .show(ctx, |ui| self.globe(ui));
    }
}
