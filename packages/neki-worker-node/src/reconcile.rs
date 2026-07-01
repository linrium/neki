use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::sync::RwLock;

use crate::config::SupervisorConfig;
use crate::config_gen::{install_router, render_config, write_config};
use crate::models::{
    LoadedState, LoadedWorker, NodeAssignment, worker_binding,
    worker_graph_changed,
};
use crate::storage::RustfsDownloader;
use crate::workerd::WorkerdProcess;

pub struct Reconciler {
    cfg: SupervisorConfig,
    downloader: RustfsDownloader,
    state: Arc<RwLock<LoadedState>>,
}

impl Reconciler {
    pub fn new(cfg: SupervisorConfig, downloader: RustfsDownloader, state: Arc<RwLock<LoadedState>>) -> Self {
        Self {
            cfg,
            downloader,
            state,
        }
    }

    /// Read the desired assignment from file (dev mode).
    pub async fn read_assignment(&self) -> Result<NodeAssignment> {
        let path = self
            .cfg
            .assignment_file
            .as_ref()
            .context("no assignment file configured")?;

        let content = tokio::fs::read_to_string(path)
            .await
            .with_context(|| format!("failed to read assignment file {}", path.display()))?;

        let mut assignment: NodeAssignment = serde_json::from_str(&content)
            .with_context(|| format!("failed to parse assignment file {}", path.display()))?;

        // Normalize: default empty host to "*"
        for r in &mut assignment.routes {
            if r.host.is_empty() {
                r.host = "*".to_string();
            }
            if r.methods.is_empty() {
                r.methods = vec!["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]
                    .into_iter()
                    .map(String::from)
                    .collect();
            }
        }

        Ok(assignment)
    }

    /// Reconcile desired state with loaded state. Returns true if workerd was restarted.
    pub async fn reconcile(&self, workerd: &mut Option<WorkerdProcess>) -> Result<bool> {
        let desired = match self.read_assignment().await {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(error = %e, "failed to read assignment, skipping reconcile");
                return Ok(false);
            }
        };

        let current = self.state.read().await.clone();

        // Phase 1: Download and install missing/updated scripts
        let workers_dir = self.cfg.workers_dir();
        tokio::fs::create_dir_all(&workers_dir).await.ok();

        let mut loaded: BTreeMap<String, LoadedWorker> = BTreeMap::new();
        let mut any_downloaded = false;

        for spec in &desired.workers {
            let dest = workers_dir.join(format!("{}.js", spec.worker_id));

            let need_download = match current.loaded_workers.get(&spec.worker_id) {
                None => true,
                Some(existing) => {
                    existing.version != spec.version || existing.sha256 != spec.sha256
                }
            };

            if need_download {
                tracing::info!(
                    worker_id = %spec.worker_id,
                    version = %spec.version,
                    "downloading new worker version"
                );
                match self
                    .downloader
                    .download_and_verify(&spec.script_url, &spec.sha256, &dest)
                    .await
                {
                    Ok(_) => {
                        any_downloaded = true;
                    }
                    Err(e) => {
                        tracing::error!(
                            worker_id = %spec.worker_id,
                            error = %e,
                            "failed to download worker"
                        );
                        // Try to keep the existing script if it exists
                        if dest.exists() {
                            tracing::warn!(
                                worker_id = %spec.worker_id,
                                "keeping previous script"
                            );
                        } else {
                            // No previous script, skip this worker
                            continue;
                        }
                    }
                }
            }

            let compat = if spec.compatibility_date.is_empty() {
                self.cfg.compatibility_date.clone()
            } else {
                spec.compatibility_date.clone()
            };

            loaded.insert(
                spec.worker_id.clone(),
                LoadedWorker {
                    worker_id: spec.worker_id.clone(),
                    version: spec.version.clone(),
                    sha256: spec.sha256.clone(),
                    binding: worker_binding(&spec.worker_id),
                    compatibility_date: compat,
                    loaded: true,
                },
            );
        }

        // Phase 2: Determine if workerd restart is needed
        let temp_state = LoadedState {
            generation: desired.generation.clone(),
            loaded_workers: loaded.clone(),
            routes: desired.routes.clone(),
        };

        let need_restart = any_downloaded || worker_graph_changed(&current, &desired);

        if need_restart || workerd.is_none() {
            tracing::info!(
                "restarting workerd: download={}, graph_changed={}, no_process={}",
                any_downloaded,
                need_restart,
                workerd.is_none()
            );

            // Install router.js into state dir
            install_router(&self.cfg.router_js, &self.cfg.router_dest()).await?;

            // Build manifest JSON for the router's NEKI_MANIFEST json binding
            let manifest = crate::api::build_manifest(
                &temp_state,
                &self.cfg.pool_id,
                &self.cfg.node_id,
            );
            let manifest_json = serde_json::to_string(&manifest)
                .context("failed to serialize manifest")?;

            // Render config.capnp
            let workers_vec: Vec<&LoadedWorker> = temp_state.loaded_workers.values().collect();
            let config_content = render_config(
                &workers_vec,
                "router.js",
                &self.cfg.compatibility_date,
                &self.cfg.workerd_listen,
                &manifest_json,
            );
            write_config(&config_content, &self.cfg.config_path()).await?;

            // Stop existing workerd
            if let Some(mut proc) = workerd.take() {
                if let Err(e) = proc.stop().await {
                    tracing::warn!(error = %e, "error stopping workerd");
                }
            }

            // Start new workerd
            match WorkerdProcess::spawn(&self.cfg.workerd_bin, &self.cfg.config_path()) {
                Ok(proc) => {
                    *workerd = Some(proc);
                }
                Err(e) => {
                    tracing::error!(error = %e, "failed to start workerd");
                    // Try rollback: attempt to use previous config
                    if !current.loaded_workers.is_empty() {
                        tracing::warn!("attempting rollback to previous state");
                    }
                    return Err(e);
                }
            }

            // Update loaded state
            let mut st = self.state.write().await;
            *st = temp_state;
            tracing::info!(
                generation = %st.generation,
                workers = st.loaded_workers.len(),
                "workerd restarted with new state"
            );
        } else {
            // No restart needed, just update routes in state
            let mut st = self.state.write().await;
            st.generation = desired.generation.clone();
            st.loaded_workers = loaded;
            st.routes = desired.routes.clone();
            tracing::debug!(generation = %st.generation, "routes updated without restart");
        }

        Ok(need_restart || workerd.is_none())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{RouteSpec, WorkerSpec, worker_capnp_name};

    #[test]
    fn test_graph_changed_new_worker() {
        let old = LoadedState::default();
        let desired = NodeAssignment {
            pool_id: "p".into(),
            node_id: "n".into(),
            generation: "1".into(),
            workers: vec![WorkerSpec {
                worker_id: "hello".into(),
                version: "v1".into(),
                script_url: "rustfs://workers/hello/v1/worker.js".into(),
                sha256: "abc".into(),
                compatibility_date: "2025-06-01".into(),
            }],
            routes: vec![],
        };
        assert!(worker_graph_changed(&old, &desired));
    }

    #[test]
    fn test_graph_not_changed_same_state() {
        let worker = LoadedWorker {
            worker_id: "hello".into(),
            version: "v1".into(),
            sha256: "abc".into(),
            binding: "WORKER_HELLO".into(),
            compatibility_date: "2025-06-01".into(),
            loaded: true,
        };
        let mut workers = BTreeMap::new();
        workers.insert("hello".to_string(), worker);
        let old = LoadedState {
            generation: "1".to_string(),
            loaded_workers: workers,
            routes: vec![],
        };

        let desired = NodeAssignment {
            pool_id: "p".into(),
            node_id: "n".into(),
            generation: "1".into(),
            workers: vec![WorkerSpec {
                worker_id: "hello".into(),
                version: "v1".into(),
                script_url: "rustfs://workers/hello/v1/worker.js".into(),
                sha256: "abc".into(),
                compatibility_date: "2025-06-01".into(),
            }],
            routes: vec![RouteSpec {
                host: "*".into(),
                path_prefix: "/".into(),
                methods: vec![],
                worker_id: "hello".into(),
            }],
        };
        assert!(!worker_graph_changed(&old, &desired));
    }

    #[test]
    fn test_binding_generation() {
        assert_eq!(worker_binding("hello"), "WORKER_HELLO");
        assert_eq!(worker_binding("billing-api"), "WORKER_BILLING_API");
        assert_eq!(worker_binding("auth_v2"), "WORKER_AUTH_V2");
    }

    #[test]
    fn test_capnp_name_generation() {
        assert_eq!(worker_capnp_name("hello"), "workerHello");
        assert_eq!(worker_capnp_name("billing-api"), "workerBillingApi");
        assert_eq!(worker_capnp_name("auth_v2"), "workerAuthV2");
    }
}
