use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Json;
use axum::routing::get;
use axum::Router;
use serde_json::{Value, json};
use tokio::sync::RwLock;

use crate::models::{LoadedState, Manifest, ManifestRoute, ManifestWorker};

#[derive(Clone)]
pub struct ApiState {
    pub state: Arc<RwLock<LoadedState>>,
    pub pool_id: String,
    pub node_id: String,
}

pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .route("/manifest", get(get_manifest))
        .route("/workers", get(get_workers))
        .with_state(state)
}

async fn healthz() -> (StatusCode, &'static str) {
    (StatusCode::OK, "ok")
}

async fn readyz(State(s): State<ApiState>) -> (StatusCode, String) {
    let st = s.state.read().await;
    let ready = !st.loaded_workers.is_empty();
    let code = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    (code, if ready { "ready".into() } else { "no workers loaded".into() })
}

async fn get_manifest(State(s): State<ApiState>) -> Json<Value> {
    let st = s.state.read().await;
    Json(json!(build_manifest(&st, &s.pool_id, &s.node_id)))
}

async fn get_workers(State(s): State<ApiState>) -> Json<Value> {
    let st = s.state.read().await;
    let workers: Vec<ManifestWorker> = st
        .loaded_workers
        .values()
        .map(|w| ManifestWorker {
            worker_id: w.worker_id.clone(),
            version: w.version.clone(),
            sha256: w.sha256.clone(),
            binding: w.binding.clone(),
            loaded: w.loaded,
        })
        .collect();
    Json(json!({
        "generation": st.generation,
        "node_id": s.node_id,
        "pool_id": s.pool_id,
        "workers": workers,
    }))
}

pub fn build_manifest(st: &LoadedState, pool_id: &str, node_id: &str) -> Manifest {
    let routes: Vec<ManifestRoute> = st
        .routes
        .iter()
        .filter_map(|r| {
            st.loaded_workers.get(&r.worker_id).map(|w| ManifestRoute {
                host: r.host.clone(),
                path_prefix: r.path_prefix.clone(),
                methods: r.methods.clone(),
                binding: worker_binding(&w.worker_id),
                worker_id: w.worker_id.clone(),
                worker_version: w.version.clone(),
            })
        })
        .collect();

    let workers: Vec<ManifestWorker> = st
        .loaded_workers
        .values()
        .map(|w| ManifestWorker {
            worker_id: w.worker_id.clone(),
            version: w.version.clone(),
            sha256: w.sha256.clone(),
            binding: w.binding.clone(),
            loaded: w.loaded,
        })
        .collect();

    Manifest {
        generation: st.generation.clone(),
        node_id: node_id.to_string(),
        pool_id: pool_id.to_string(),
        routes,
        workers,
    }
}

use crate::models::worker_binding;
