use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Desired worker assignment for a node.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeAssignment {
    pub pool_id: String,
    pub node_id: String,
    pub generation: String,
    pub workers: Vec<WorkerSpec>,
    pub routes: Vec<RouteSpec>,
}

/// Immutable worker version spec.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerSpec {
    pub worker_id: String,
    pub version: String,
    /// rustfs://<bucket>/<key> reference.
    pub script_url: String,
    pub sha256: String,
    #[serde(default = "default_compatibility_date")]
    pub compatibility_date: String,
}

fn default_compatibility_date() -> String {
    "2025-06-01".to_string()
}

/// Route spec mapping host + path prefix + methods to a worker.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RouteSpec {
    pub host: String,
    pub path_prefix: String,
    #[serde(default)]
    pub methods: Vec<String>,
    pub worker_id: String,
}

/// Local manifest served by the supervisor API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub generation: String,
    pub node_id: String,
    pub pool_id: String,
    pub routes: Vec<ManifestRoute>,
    pub workers: Vec<ManifestWorker>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestRoute {
    pub host: String,
    pub path_prefix: String,
    pub methods: Vec<String>,
    pub binding: String,
    pub worker_id: String,
    pub worker_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestWorker {
    pub worker_id: String,
    pub version: String,
    pub sha256: String,
    pub binding: String,
    pub loaded: bool,
}

/// In-memory state of what is actually loaded on this node.
#[derive(Debug, Clone)]
pub struct LoadedState {
    pub generation: String,
    pub loaded_workers: BTreeMap<String, LoadedWorker>,
    pub routes: Vec<RouteSpec>,
}

impl Default for LoadedState {
    fn default() -> Self {
        Self {
            generation: "0".to_string(),
            loaded_workers: BTreeMap::new(),
            routes: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoadedWorker {
    pub worker_id: String,
    pub version: String,
    pub sha256: String,
    pub binding: String,
    pub compatibility_date: String,
    pub loaded: bool,
}

/// Worker graph change detection: returns true if workerd restart is needed.
pub fn worker_graph_changed(old: &LoadedState, desired: &NodeAssignment) -> bool {
    if old.generation != desired.generation {
        // Check if the set of workers or their specs changed.
        let old_count = old.loaded_workers.len();
        let new_count = desired.workers.len();
        if old_count != new_count {
            return true;
        }

        for w in &desired.workers {
            match old.loaded_workers.get(&w.worker_id) {
                None => return true,
                Some(existing) => {
                    if existing.version != w.version
                        || existing.sha256 != w.sha256
                        || existing.compatibility_date != w.compatibility_date
                    {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Derive a valid JavaScript identifier binding from a worker ID.
/// e.g. "hello" -> "WORKER_HELLO", "billing-api" -> "WORKER_BILLING_API"
pub fn worker_binding(worker_id: &str) -> String {
    let sanitized: String = worker_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
        .collect();
    format!("WORKER_{}", sanitized)
}

/// Derive a camelCase Cap'n Proto const name from a worker ID.
/// e.g. "hello" -> "workerHello", "billing-api" -> "workerBillingApi"
/// Cap'n Proto requires declaration names to start with a lowercase letter
/// and must not contain underscores.
pub fn worker_capnp_name(worker_id: &str) -> String {
    let mut result = String::from("worker");
    let mut capitalize_next = true;
    for c in worker_id.chars() {
        if c.is_ascii_alphanumeric() {
            if capitalize_next {
                result.extend(c.to_uppercase());
                capitalize_next = false;
            } else {
                result.push(c.to_ascii_lowercase());
            }
        } else {
            capitalize_next = true;
        }
    }
    result
}
