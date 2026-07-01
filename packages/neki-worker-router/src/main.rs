use std::sync::Arc;

use anyhow::{Context, Result};
use clap::{Args, Parser};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "neki-worker-router")]
#[command(about = "Neki routing gateway for worker-node pods")]
struct Cli {
    #[command(flatten)]
    config: GatewayConfig,
}

#[derive(Debug, Clone, Args)]
struct GatewayConfig {
    /// Address the gateway listens on.
    #[arg(long, env = "NEKI_GATEWAY_LISTEN", default_value = "0.0.0.0:80")]
    listen: String,

    /// Path to a local JSON file containing the routing table (dev mode).
    #[arg(long, env = "NEKI_ROUTING_TABLE_FILE")]
    routing_table_file: Option<String>,

    /// Interval in seconds to refresh the routing table.
    #[arg(long, env = "NEKI_ROUTING_TABLE_REFRESH_SECS", default_value = "5")]
    refresh_secs: u64,
}

/// Global routing table.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct RoutingTable {
    generation: String,
    routes: Vec<GlobalRoute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct GlobalRoute {
    host: String,
    path_prefix: String,
    #[serde(default)]
    methods: Vec<String>,
    worker_id: String,
    targets: Vec<RouteTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RouteTarget {
    node_id: String,
    pod_ip: String,
    port: u16,
    #[serde(default = "default_weight")]
    weight: u32,
    #[serde(default = "default_true")]
    healthy: bool,
}

fn default_weight() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

#[derive(Clone)]
struct GatewayState {
    table: Arc<RwLock<RoutingTable>>,
    client: reqwest::Client,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .init();

    let cli = Cli::parse();

    tracing::info!(listen = %cli.config.listen, "starting neki-worker-router gateway");

    let initial_table = load_routing_table(&cli.config)
        .await
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "failed to load initial routing table, using empty");
            RoutingTable {
                generation: "0".to_string(),
                routes: vec![],
            }
        });
    let table = Arc::new(RwLock::new(initial_table));

    let client = reqwest::Client::builder()
        .build()
        .context("failed to build HTTP client")?;

    let state = GatewayState {
        table: table.clone(),
        client,
    };

    // Start TCP listener
    let listener = tokio::net::TcpListener::bind(&cli.config.listen)
        .await
        .with_context(|| format!("failed to bind {}", cli.config.listen))?;

    tracing::info!(listen = %cli.config.listen, "gateway listening");

    // Refresh loop
    let refresh_cfg = cli.config.clone();
    let refresh_table = table.clone();
    let refresh_handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(refresh_cfg.refresh_secs)).await;
            match load_routing_table(&refresh_cfg).await {
                Ok(new_table) => {
                    let mut t = refresh_table.write().await;
                    if t.generation != new_table.generation {
                        tracing::info!(
                            old_gen = %t.generation,
                            new_gen = %new_table.generation,
                            "routing table updated"
                        );
                        *t = new_table;
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "failed to refresh routing table");
                }
            }
        }
    });

    // Accept loop
    loop {
        tokio::select! {
            result = listener.accept() => {
                let (stream, peer) = result?;
                let state = state.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, peer, state).await {
                        tracing::warn!(error = %e, "connection error");
                    }
                });
            }
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("shutdown signal received");
                break;
            }
        }
    }

    refresh_handle.abort();
    Ok(())
}

async fn load_routing_table(cfg: &GatewayConfig) -> Result<RoutingTable> {
    if let Some(path) = &cfg.routing_table_file {
        let content = tokio::fs::read_to_string(path)
            .await
            .with_context(|| format!("failed to read routing table {}", path))?;
        let table: RoutingTable = serde_json::from_str(&content)
            .with_context(|| format!("failed to parse routing table {}", path))?;
        Ok(table)
    } else {
        // Return empty table as fallback
        Ok(RoutingTable {
            generation: "0".to_string(),
            routes: vec![],
        })
    }
}

async fn handle_connection(
    mut stream: tokio::net::TcpStream,
    peer: std::net::SocketAddr,
    state: GatewayState,
) -> Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut buf = vec![0u8; 65536];
    let n = stream.read(&mut buf).await?;
    if n == 0 {
        return Ok(());
    }

    let raw = String::from_utf8_lossy(&buf[..n]).to_string();
    let (method, path, host) = parse_request_line(&raw);

    tracing::debug!(
        peer = %peer,
        method = %method,
        path = %path,
        host = %host,
        "incoming request"
    );

    let table = state.table.read().await;
    let route = match_request(&table, &host, &method, &path);

    let target = match route {
        Some(r) => select_target(&r),
        None => {
            let resp = r#"{"error":"no route matched"}"#;
            let http_resp = format!(
                "HTTP/1.1 404 Not Found\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                resp.len(),
                resp
            );
            stream.write_all(http_resp.as_bytes()).await?;
            return Ok(());
        }
    };

    let target = match target {
        Some(t) => t,
        None => {
            let resp = r#"{"error":"no healthy target available"}"#;
            let http_resp = format!(
                "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                resp.len(),
                resp
            );
            stream.write_all(http_resp.as_bytes()).await?;
            return Ok(());
        }
    };

    // Forward the raw request to the selected target
    let upstream = format!("http://{}:{}{}", target.pod_ip, target.port, path);
    tracing::info!(
        peer = %peer,
        method = %method,
        path = %path,
        host = %host,
        target_node = %target.node_id,
        upstream = %upstream,
        "forwarding request"
    );

    drop(table);

    let resp = state.client.post(&upstream).body(raw).send().await;
    match resp {
        Ok(r) => {
            let status = r.status();
            let headers = r.headers().clone();
            let body = r.bytes().await.unwrap_or_default();
            let mut http_resp = format!("HTTP/1.1 {}\r\n", status);
            for (k, v) in &headers {
                http_resp.push_str(&format!("{}: {}\r\n", k, v.to_str().unwrap_or("")));
            }
            http_resp.push_str(&format!("Content-Length: {}\r\n", body.len()));
            http_resp.push_str("Connection: close\r\n\r\n");
            stream.write_all(http_resp.as_bytes()).await?;
            stream.write_all(&body).await?;
        }
        Err(e) => {
            tracing::warn!(error = %e, "upstream request failed");
            let resp = format!(r#"{{"error":"upstream failed","detail":"{}"}}"#, e);
            let http_resp = format!(
                "HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                resp.len(),
                resp
            );
            stream.write_all(http_resp.as_bytes()).await?;
        }
    }

    Ok(())
}

fn parse_request_line(raw: &str) -> (String, String, String) {
    let mut method = "GET".to_string();
    let mut path = "/".to_string();
    let mut host = String::new();

    for line in raw.lines() {
        if line.starts_with("GET ")
            || line.starts_with("POST ")
            || line.starts_with("PUT ")
            || line.starts_with("DELETE ")
            || line.starts_with("PATCH ")
            || line.starts_with("HEAD ")
            || line.starts_with("OPTIONS ")
        {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                method = parts[0].to_string();
                path = parts[1].to_string();
            }
        }
        let lower = line.to_lowercase();
        if lower.starts_with("host:") {
            host = line[5..].trim().to_string();
            // Strip port if present
            if let Some(idx) = host.find(':') {
                host.truncate(idx);
            }
        }
    }

    (method, path, host)
}

fn match_request<'a>(
    table: &'a RoutingTable,
    host: &str,
    method: &str,
    path: &str,
) -> Option<&'a GlobalRoute> {
    let mut routes: Vec<&GlobalRoute> = table.routes.iter().collect();

    // Sort by path prefix length descending
    routes.sort_by(|a, b| b.path_prefix.len().cmp(&a.path_prefix.len()));

    for route in routes {
        if !route.host.is_empty() && route.host != "*" && route.host != host {
            continue;
        }
        if !route.methods.is_empty() && !route.methods.iter().any(|m| m == method) {
            continue;
        }
        if !route.path_prefix.is_empty() && route.path_prefix != "/" && route.path_prefix != "/*" {
            let prefix = route.path_prefix.trim_end_matches('/');
            if !path.starts_with(prefix) {
                continue;
            }
        }
        return Some(route);
    }

    None
}

fn select_target(route: &GlobalRoute) -> Option<&RouteTarget> {
    let healthy: Vec<&RouteTarget> = route.targets.iter().filter(|t| t.healthy).collect();
    if healthy.is_empty() {
        return None;
    }
    // Simple weighted round-robin: pick first healthy target (can be extended)
    healthy.first().copied()
}
