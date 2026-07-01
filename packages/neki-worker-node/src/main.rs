use std::sync::Arc;

use anyhow::Result;
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

mod api;
mod config;
mod config_gen;
mod models;
mod reconcile;
mod storage;
mod workerd;

use api::ApiState;
use config::parse;
use models::LoadedState;
use reconcile::Reconciler;
use storage::RustfsDownloader;
use workerd::WorkerdProcess;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let cfg = parse()?;
    tracing::info!(
        pool_id = %cfg.pool_id,
        node_id = %cfg.node_id,
        state_dir = %cfg.state_dir.display(),
        manifest_listen = %cfg.manifest_listen,
        workerd_listen = %cfg.workerd_listen,
        "starting neki-worker-node supervisor"
    );

    // Ensure state directory exists
    tokio::fs::create_dir_all(&cfg.state_dir).await.ok();
    tokio::fs::create_dir_all(cfg.workers_dir()).await.ok();

    // Shared state
    let state = Arc::new(RwLock::new(LoadedState::default()));

    // Start manifest API
    let api_state = ApiState {
        state: state.clone(),
        pool_id: cfg.pool_id.clone(),
        node_id: cfg.node_id.clone(),
    };
    let api_router = api::router(api_state);
    let manifest_listen = cfg.manifest_listen.clone();
    let api_handle = tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(&manifest_listen)
            .await
            .expect("failed to bind manifest API");
        tracing::info!(listen = %manifest_listen, "manifest API listening");
        axum::serve(listener, api_router)
            .await
            .expect("manifest API server error");
    });

    // Create RustFS downloader
    let downloader = RustfsDownloader::new(&cfg.rustfs).await;
    let reconciler = Reconciler::new(cfg.clone(), downloader, state.clone());
    let interval_secs = cfg.reconcile_interval_secs;
    let mut workerd: Option<WorkerdProcess> = None;

    // Initial reconcile
    tracing::info!("running initial reconcile");
    if let Err(e) = reconciler.reconcile(&mut workerd).await {
        tracing::error!(error = %e, "initial reconcile failed");
    }

    // Reconcile loop
    let reconcile_loop = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(interval_secs)).await;

            // Check if workerd is still alive
            if let Some(ref mut proc) = workerd {
                if !proc.is_running() {
                    tracing::error!("workerd process exited unexpectedly, will restart on next reconcile");
                    workerd = None;
                }
            }

            tracing::debug!("running reconcile tick");
            if let Err(e) = reconciler.reconcile(&mut workerd).await {
                tracing::error!(error = %e, "reconcile failed");
            }
        }
    });

    // Wait for shutdown signal
    tokio::signal::ctrl_c().await.ok();
    tracing::info!("received shutdown signal");

    reconcile_loop.abort();
    api_handle.abort();

    Ok(())
}
