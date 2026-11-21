//! Downtime native globe (skeleton).
//!
//! A wgpu-rendered globe inside an eframe/egui window, with catalog pins
//! taken from `downtime-core`. This is the start of the native path in
//! `docs/rust-native.md`: imagery tiles, terrain, live layers and instanced
//! aircraft/ship rendering come in later phases.
//!
//! `downtime-globe --summary` prints the loaded catalog without opening a
//! window (useful on headless CI).

mod globe_math;
mod pins;
mod render;

use std::path::PathBuf;

use eframe::egui;
use glam::Vec3;

use globe_math::{project, OrbitCamera};
use pins::Pin;
use render::{GlobeCallback, GlobeResources};

fn main() -> eframe::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let root = arg_value(&args, "--root").map(PathBuf::from);
    let data = pins::load(root.as_deref());

    if args.iter().any(|a| a == "--summary") {
        println!("{}", data.summary());
        return Ok(());
    }

    let options = eframe::NativeOptions {
        renderer: eframe::Renderer::Wgpu,
        viewport: egui::ViewportBuilder::default()
            .with_title("Downtime Globe (native)")
            .with_inner_size([1200.0, 760.0]),
        ..Default::default()
    };
    eframe::run_native(
        "Downtime Globe",
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

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

struct GlobeApp {
    camera: OrbitCamera,
    data: pins::PinData,
    show_pins: bool,
    selected: Option<usize>,
}

impl GlobeApp {
    fn new(data: pins::PinData) -> Self {
        Self { camera: OrbitCamera::default(), data, show_pins: true, selected: None }
    }

    fn side_panel(&mut self, ctx: &egui::Context) {
        egui::SidePanel::left("layers").resizable(true).default_width(260.0).show(ctx, |ui| {
            ui.heading("Downtime");
            ui.label(egui::RichText::new("Native globe skeleton").weak());
            ui.separator();
            ui.label(&self.data.status);
            ui.checkbox(&mut self.show_pins, format!("Capital pins ({})", self.data.pins.len()));
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
            GlobeCallback { view_proj, sun },
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
