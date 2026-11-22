//! Scene modes matching Cesium `SceneMode`.

#![allow(dead_code)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SceneMode {
    Scene3D,
    Scene2D,
    Columbus,
}

impl Default for SceneMode {
    fn default() -> Self {
        Self::Scene3D
    }
}
