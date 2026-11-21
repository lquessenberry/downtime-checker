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
}

impl GlobeResources {
    pub fn install(state: &egui_wgpu::RenderState) {
        let device = &state.device;
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
            entries: &[wgpu::BindGroupLayoutEntry {
                binding: 0,
                visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                ty: wgpu::BindingType::Buffer {
                    ty: wgpu::BufferBindingType::Uniform,
                    has_dynamic_offset: false,
                    min_binding_size: None,
                },
                count: None,
            }],
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("globe"),
            layout: &layout,
            entries: &[wgpu::BindGroupEntry { binding: 0, resource: uniforms.as_entire_binding() }],
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
        });
    }
}

/// One frame's globe draw.
pub struct GlobeCallback {
    pub view_proj: Mat4,
    pub sun: Vec3,
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
                sun: self.sun.normalize_or_zero().extend(0.0).to_array(),
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
