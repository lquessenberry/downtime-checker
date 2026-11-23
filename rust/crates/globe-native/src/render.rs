//! wgpu globe pass drawn inside egui through an `egui_wgpu` paint callback.

use eframe::egui_wgpu::{self, wgpu, wgpu::util::DeviceExt};
use glam::{Mat4, Vec3};

use crate::globe_math::{sphere_mesh, Vertex};

#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
struct Globals {
    view_proj: [[f32; 4]; 4],
    sun: [f32; 4],
}

/// GPU objects kept in egui's callback resources for the app's lifetime.
pub struct GlobeResources {
    pipeline: wgpu::RenderPipeline,
    bind_group: wgpu::BindGroup,
    uniforms: wgpu::Buffer,
    vertices: wgpu::Buffer,
    indices: wgpu::Buffer,
    index_count: u32,
    earth: wgpu::Texture,
    earth_width: u32,
    earth_height: u32,
}

fn load_earth_rgba() -> (u32, u32, Vec<u8>) {
    let jpeg = include_bytes!("../assets/earth.jpg");
    let img = image::load_from_memory(jpeg).expect("earth.jpg is a valid NASA Blue Marble JPEG");
    let rgba = img.to_rgba8();
    (rgba.width(), rgba.height(), rgba.into_raw())
}

fn earth_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
) -> (wgpu::Texture, wgpu::TextureView, wgpu::Sampler, u32, u32) {
    let (width, height, pixels) = load_earth_rgba();
    let size = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("quietearth"),
        size,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &pixels,
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(4 * width),
            rows_per_image: Some(height),
        },
        size,
    );
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
    let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some("quietearth"),
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        address_mode_u: wgpu::AddressMode::Repeat,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        ..Default::default()
    });
    (texture, view, sampler, width, height)
}

impl GlobeResources {
    pub fn install(state: &egui_wgpu::RenderState) {
        let device = &state.device;
        let (earth, earth_view, earth_samp, earth_width, earth_height) =
            earth_texture(device, &state.queue);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("globe"),
            source: wgpu::ShaderSource::Wgsl(include_str!("globe.wgsl").into()),
        });
        let uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("globe globals"),
            size: std::mem::size_of::<Globals>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("globe"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globe"),
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: uniforms.as_entire_binding() },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&earth_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&earth_samp),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("globe"),
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("globe"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Vertex>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &wgpu::vertex_attr_array![0 => Float32x3, 1 => Float32x2],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(state.target_format.into())],
            }),
            // egui's pass has no depth buffer; a convex sphere only needs back-face culling.
            primitive: wgpu::PrimitiveState {
                front_face: wgpu::FrontFace::Cw,
                cull_mode: Some(wgpu::Face::Back),
                ..Default::default()
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });
        let (mesh_vertices, mesh_indices) = sphere_mesh(96, 192);
        let vertices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("globe vertices"),
            contents: bytemuck::cast_slice(&mesh_vertices),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let indices = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("globe indices"),
            contents: bytemuck::cast_slice(&mesh_indices),
            usage: wgpu::BufferUsages::INDEX,
        });
        state.renderer.write().callback_resources.insert(GlobeResources {
            pipeline,
            bind_group,
            uniforms,
            vertices,
            indices,
            index_count: mesh_indices.len() as u32,
            earth,
            earth_width,
            earth_height,
        });
    }

    /// Replace the albedo (must be the same size as the compiled Blue Marble).
    pub fn write_albedo(&self, queue: &wgpu::Queue, pixels: &[u8], width: u32, height: u32) {
        if width != self.earth_width || height != self.earth_height {
            return;
        }
        if pixels.len() != (width * height * 4) as usize {
            return;
        }
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.earth,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(4 * width),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
    }

}

pub fn marble_rgba() -> (u32, u32, Vec<u8>) {
    load_earth_rgba()
}

/// One frame's globe draw.
pub struct GlobeCallback {
    pub view_proj: Mat4,
    pub sun: Vec3,
    pub grid: f32,
}

impl egui_wgpu::CallbackTrait for GlobeCallback {
    fn prepare(
        &self,
        _device: &wgpu::Device,
        queue: &wgpu::Queue,
        _screen: &egui_wgpu::ScreenDescriptor,
        _encoder: &mut wgpu::CommandEncoder,
        resources: &mut egui_wgpu::CallbackResources,
    ) -> Vec<wgpu::CommandBuffer> {
        if let Some(res) = resources.get::<GlobeResources>() {
            let globals = Globals {
                view_proj: self.view_proj.to_cols_array_2d(),
                sun: self.sun.normalize_or_zero().extend(self.grid).to_array(),
            };
            queue.write_buffer(&res.uniforms, 0, bytemuck::bytes_of(&globals));
        }
        Vec::new()
    }

    fn paint(
        &self,
        _info: eframe::egui::PaintCallbackInfo,
        pass: &mut wgpu::RenderPass<'static>,
        resources: &egui_wgpu::CallbackResources,
    ) {
        let Some(res) = resources.get::<GlobeResources>() else { return };
        pass.set_pipeline(&res.pipeline);
        pass.set_bind_group(0, &res.bind_group, &[]);
        pass.set_vertex_buffer(0, res.vertices.slice(..));
        pass.set_index_buffer(res.indices.slice(..), wgpu::IndexFormat::Uint32);
        pass.draw_indexed(0..res.index_count, 0, 0..1);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn earth_texture_is_equirectangular() {
        let jpeg = include_bytes!("../assets/earth.jpg");
        let img = image::load_from_memory(jpeg).unwrap();
        assert_eq!(img.width(), 2048);
        assert_eq!(img.height(), 1024);
    }
}
