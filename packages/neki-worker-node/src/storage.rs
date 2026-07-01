use std::path::Path;

use anyhow::{Context, Result, bail};
use aws_config::BehaviorVersion;
use aws_credential_types::Credentials;
use aws_sdk_s3::Client;
use aws_sdk_s3::config::Builder as S3ConfigBuilder;
use aws_types::region::Region;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;

use crate::config::RustfsConfig;

/// Parsed rustfs:// reference.
pub struct ScriptRef {
    pub bucket: String,
    pub key: String,
}

pub fn parse_script_url(url: &str) -> Result<ScriptRef> {
    let scheme = "rustfs://";
    let rest = url
        .strip_prefix(scheme)
        .with_context(|| format!("expected {} prefix, got: {}", scheme, url))?;

    let (bucket, key) = rest
        .split_once('/')
        .with_context(|| format!("invalid rustfs URL, missing key: {}", url))?;

    if bucket.is_empty() || key.is_empty() {
        bail!("invalid rustfs URL, empty bucket or key: {}", url);
    }

    Ok(ScriptRef {
        bucket: bucket.to_string(),
        key: key.to_string(),
    })
}

pub struct RustfsDownloader {
    client: Client,
}

impl RustfsDownloader {
    pub async fn new(cfg: &RustfsConfig) -> Self {
        let credentials = Credentials::new(
            cfg.rustfs_access_key.clone(),
            cfg.rustfs_secret_key.clone(),
            None,
            None,
            "neki-worker-node",
        );

        let config = aws_config::defaults(BehaviorVersion::latest())
            .region(Region::new(cfg.rustfs_region.clone()))
            .credentials_provider(credentials)
            .endpoint_url(cfg.rustfs_endpoint.clone())
            .load()
            .await;

        let s3_config = S3ConfigBuilder::from(&config)
            .force_path_style(true)
            .build();

        Self {
            client: Client::from_conf(s3_config),
        }
    }

    /// Download a script to a temporary file, verify sha256, and atomically
    /// rename to the destination path.
    pub async fn download_and_verify(
        &self,
        script_url: &str,
        expected_sha256: &str,
        dest: &Path,
    ) -> Result<()> {
        let script_ref = parse_script_url(script_url)?;

        tracing::info!(
            bucket = %script_ref.bucket,
            key = %script_ref.key,
            dest = %dest.display(),
            "downloading worker script"
        );

        let resp = self
            .client
            .get_object()
            .bucket(&script_ref.bucket)
            .key(&script_ref.key)
            .send()
            .await
            .with_context(|| {
                format!(
                    "failed to download s3://{}/{}",
                    script_ref.bucket, script_ref.key
                )
            })?;

        let tmp = dest.with_extension("js.tmp");
        if let Some(parent) = tmp.parent() {
            tokio::fs::create_dir_all(parent).await.ok();
        }

        let mut file = tokio::fs::File::create(&tmp).await.with_context(|| {
            format!("failed to create temp file {}", tmp.display())
        })?;

        let mut hasher = Sha256::new();
        let mut body = resp.body;
        let mut size: u64 = 0;
        while let Some(chunk) = body.next().await {
            let chunk = chunk.context("failed to read script body")?;
            hasher.update(&chunk);
            file.write_all(&chunk).await?;
            size += chunk.len() as u64;
        }
        file.flush().await?;
        drop(file);

        let actual_sha = hex::encode(hasher.finalize());
        if actual_sha != expected_sha256 {
            tokio::fs::remove_file(&tmp).await.ok();
            bail!(
                "sha256 mismatch for {}: expected {}, got {}",
                script_url,
                expected_sha256,
                actual_sha
            );
        }

        tracing::info!(size, sha256 = %actual_sha, "script verified");

        tokio::fs::rename(&tmp, dest)
            .await
            .with_context(|| format!("failed to rename {} to {}", tmp.display(), dest.display()))?;

        Ok(())
    }
}
