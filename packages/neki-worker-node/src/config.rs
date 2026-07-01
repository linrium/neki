use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use clap::{Args, Parser};

#[derive(Debug, Clone, Parser)]
#[command(name = "neki-worker-node")]
#[command(about = "Neki worker-node Rust supervisor")]
pub struct SupervisorConfig {
    /// Pool this node belongs to.
    #[arg(long, env = "NEKI_POOL_ID", default_value = "default")]
    pub pool_id: String,

    /// Unique node identifier, typically the pod name.
    #[arg(long, env = "NEKI_NODE_ID", default_value = "local")]
    pub node_id: String,

    /// Directory for generated runtime files (scripts, config.capnp).
    #[arg(long, env = "NEKI_STATE_DIR", default_value = "/var/lib/neki/workerd")]
    pub state_dir: PathBuf,

    /// Address for the supervisor manifest API.
    #[arg(long, env = "NEKI_MANIFEST_LISTEN", default_value = "127.0.0.1:9000")]
    pub manifest_listen: String,

    /// Address workerd should listen on for HTTP traffic.
    #[arg(long, env = "NEKI_WORKERD_LISTEN", default_value = "0.0.0.0:8080")]
    pub workerd_listen: String,

    /// Path to the workerd binary.
    #[arg(long, env = "NEKI_WORKERD_BIN", default_value = "workerd")]
    pub workerd_bin: String,

    /// Path to the stable router.js bundled in the image.
    #[arg(long, env = "NEKI_ROUTER_JS", default_value = "/opt/neki/router.js")]
    pub router_js: PathBuf,

    /// Path to a local JSON file describing the node assignment (dev mode).
    /// When set, the supervisor reads desired state from this file instead of
    /// polling a remote control plane.
    #[arg(long, env = "NEKI_ASSIGNMENT_FILE")]
    pub assignment_file: Option<PathBuf>,

    /// Reconcile interval in seconds when no watch mechanism is used.
    #[arg(long, env = "NEKI_RECONCILE_INTERVAL_SECS", default_value = "10")]
    pub reconcile_interval_secs: u64,

    /// Compatibility date passed to workerd workers.
    #[arg(long, env = "NEKI_COMPATIBILITY_DATE", default_value = "2025-06-01")]
    pub compatibility_date: String,

    /// Pod IP reported to the control plane and routing table.
    #[arg(long, env = "NEKI_POD_IP")]
    pub pod_ip: Option<String>,

    /// External port reported to the routing table.
    #[arg(long, env = "NEKI_POD_PORT", default_value = "8080")]
    pub pod_port: u16,

    #[command(flatten)]
    pub rustfs: RustfsConfig,
}

#[derive(Debug, Clone, Args)]
pub struct RustfsConfig {
    /// RustFS S3 endpoint.
    #[arg(
        long,
        env = "RUSTFS_ENDPOINT",
        default_value = "http://rustfs-svc.rustfs.svc.cluster.local:9000"
    )]
    pub rustfs_endpoint: String,

    /// RustFS access key.
    #[arg(long, env = "RUSTFS_ACCESS_KEY", default_value = "neki-rustfs")]
    pub rustfs_access_key: String,

    /// RustFS secret key.
    #[arg(long, env = "RUSTFS_SECRET_KEY", default_value = "neki-rustfs-secret")]
    pub rustfs_secret_key: String,

    /// RustFS region.
    #[arg(long, env = "RUSTFS_REGION", default_value = "us-east-1")]
    pub rustfs_region: String,

    /// Bucket used for worker bundles.
    #[arg(long, env = "RUSTFS_WORKERS_BUCKET", default_value = "workers")]
    pub rustfs_workers_bucket: String,
}

impl SupervisorConfig {
    pub fn workers_dir(&self) -> PathBuf {
        self.state_dir.join("workers")
    }

    pub fn config_path(&self) -> PathBuf {
        self.state_dir.join("config.capnp")
    }

    pub fn router_dest(&self) -> PathBuf {
        self.state_dir.join("router.js")
    }

    pub fn validate(&self) -> Result<()> {
        if self.manifest_listen.is_empty() {
            bail!("manifest listen address must not be empty");
        }
        Ok(())
    }
}

pub fn parse() -> Result<SupervisorConfig> {
    let config = SupervisorConfig::parse();
    config.validate().context("invalid configuration")?;
    Ok(config)
}
