use std::path::PathBuf;

use anyhow::{Context, Result, bail};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::Builder as S3ConfigBuilder;
use aws_sdk_s3::primitives::ByteStream;
use aws_types::region::Region;
use clap::{Args, Parser, Subcommand};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Parser)]
#[command(name = "neki-controlplane")]
#[command(about = "Neki control-plane utilities")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Work with the RustFS object store.
    Rustfs(RustfsCommand),
}

#[derive(Debug, Args)]
struct RustfsCommand {
    #[command(subcommand)]
    command: RustfsSubcommand,
}

#[derive(Debug, Subcommand)]
enum RustfsSubcommand {
    /// Upload a worker JavaScript bundle to RustFS and print its immutable spec.
    UploadWorker(UploadWorkerArgs),
}

#[derive(Debug, Args)]
struct UploadWorkerArgs {
    /// Local JavaScript worker file to upload.
    #[arg(long)]
    file: PathBuf,

    /// Stable worker ID used in object keys and control-plane specs.
    #[arg(long)]
    worker_id: String,

    /// Worker version. Defaults to the first 16 hex chars of the file sha256.
    #[arg(long)]
    version: Option<String>,

    /// RustFS S3 endpoint.
    #[arg(
        long,
        env = "RUSTFS_ENDPOINT",
        default_value = "http://rustfs-svc.rustfs.svc.cluster.local:9000"
    )]
    endpoint: String,

    /// RustFS access key.
    #[arg(long, env = "RUSTFS_ACCESS_KEY", default_value = "neki-rustfs")]
    access_key: String,

    /// RustFS secret key.
    #[arg(long, env = "RUSTFS_SECRET_KEY", default_value = "neki-rustfs-secret")]
    secret_key: String,

    /// RustFS region.
    #[arg(long, env = "RUSTFS_REGION", default_value = "us-east-1")]
    region: String,

    /// Bucket used for worker bundles.
    #[arg(long, env = "RUSTFS_WORKERS_BUCKET", default_value = "workers")]
    bucket: String,

    /// Object key. Defaults to workers/<worker-id>/<version>/worker.js.
    #[arg(long)]
    key: Option<String>,

    /// Create the bucket if it does not already exist.
    #[arg(long, default_value_t = true)]
    create_bucket: bool,

    /// Content type stored with the object.
    #[arg(long, default_value = "application/javascript; charset=utf-8")]
    content_type: String,
}

#[derive(Debug, Serialize)]
struct UploadedWorker {
    worker_id: String,
    version: String,
    bucket: String,
    key: String,
    script_url: String,
    sha256: String,
    size_bytes: usize,
    endpoint: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Command::Rustfs(command) => match command.command {
            RustfsSubcommand::UploadWorker(args) => upload_worker(args).await,
        },
    }
}

async fn upload_worker(args: UploadWorkerArgs) -> Result<()> {
    validate_worker_id(&args.worker_id)?;

    let bytes = tokio::fs::read(&args.file)
        .await
        .with_context(|| format!("failed to read {}", args.file.display()))?;
    let sha256 = sha256_hex(&bytes);
    let version = args
        .version
        .as_ref()
        .cloned()
        .unwrap_or_else(|| sha256.chars().take(16).collect());
    let key = args
        .key
        .as_ref()
        .cloned()
        .unwrap_or_else(|| format!("workers/{}/{}/worker.js", args.worker_id, version));

    let client = rustfs_client(&args).await;

    if args.create_bucket {
        ensure_bucket(&client, &args.bucket).await?;
    }

    client
        .put_object()
        .bucket(&args.bucket)
        .key(&key)
        .content_type(&args.content_type)
        .body(ByteStream::from(bytes.clone()))
        .send()
        .await
        .with_context(|| format!("failed to upload s3://{}/{}", args.bucket, key))?;

    let uploaded = UploadedWorker {
        worker_id: args.worker_id,
        version,
        bucket: args.bucket.clone(),
        script_url: format!("rustfs://{}/{}", args.bucket, key),
        key,
        sha256,
        size_bytes: bytes.len(),
        endpoint: args.endpoint,
    };

    println!("{}", serde_json::to_string_pretty(&uploaded)?);
    Ok(())
}

async fn rustfs_client(args: &UploadWorkerArgs) -> Client {
    let credentials = Credentials::new(
        args.access_key.clone(),
        args.secret_key.clone(),
        None,
        None,
        "neki-controlplane",
    );

    let config = aws_config::defaults(BehaviorVersion::latest())
        .region(Region::new(args.region.clone()))
        .credentials_provider(credentials)
        .endpoint_url(args.endpoint.clone())
        .load()
        .await;

    let s3_config = S3ConfigBuilder::from(&config)
        .force_path_style(true)
        .build();

    Client::from_conf(s3_config)
}

async fn ensure_bucket(client: &Client, bucket: &str) -> Result<()> {
    match client.head_bucket().bucket(bucket).send().await {
        Ok(_) => Ok(()),
        Err(_) => {
            client
                .create_bucket()
                .bucket(bucket)
                .send()
                .await
                .with_context(|| format!("failed to create bucket {}", bucket))?;
            Ok(())
        }
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn validate_worker_id(worker_id: &str) -> Result<()> {
    if worker_id.is_empty() {
        bail!("worker ID must not be empty");
    }

    let valid = worker_id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_');

    if !valid {
        bail!("worker ID may only contain ASCII letters, digits, '-' and '_'");
    }

    Ok(())
}
