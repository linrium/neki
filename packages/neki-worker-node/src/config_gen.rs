use std::path::Path;

use anyhow::{Context, Result};
use tokio::io::AsyncWriteExt;

use crate::models::{LoadedWorker, worker_capnp_name};

/// Render a workerd config.capnp with:
///   - one router service
///   - one app service per loaded worker
///   - one HTTP socket pointing at the router
pub fn render_config(
    workers: &[&LoadedWorker],
    router_path: &str,
    compatibility_date: &str,
    listen_addr: &str,
    manifest_json: &str,
) -> String {
    let mut services = String::new();
    let mut bindings = String::new();
    let mut worker_defs = String::new();

    // Router service
    services.push_str("    (name = \"router\", worker = .routerWorker),\n");

    // NEKI_MANIFEST json binding for the router (manifest embedded inline)
    let manifest_json_escaped = manifest_json.replace('\\', "\\\\").replace('"', "\\\"");
    bindings.push_str(&format!(
        "    (name = \"NEKI_MANIFEST\", json = \"{}\"),\n",
        manifest_json_escaped
    ));

    // App services
    for w in workers {
        let capnp_name = worker_capnp_name(&w.worker_id);

        // Service entry: name is a string (uppercase OK), worker ref is Cap'n Proto identifier
        services.push_str(&format!(
            "    (name = \"{}\", worker = .{}),\n",
            w.binding, capnp_name
        ));

        // Binding entry: name and service are both string values
        bindings.push_str(&format!(
            "    (name = \"{}\", service = \"{}\"),\n",
            w.binding, w.binding
        ));

        // Worker const definition: Cap'n Proto const name must be camelCase
        let script_rel = format!("workers/{}.js", w.worker_id);
        worker_defs.push_str(&format!(
            "const {} :Workerd.Worker = (\n  serviceWorkerScript = embed \"{}\",\n  compatibilityDate = \"{}\",\n);\n\n",
            capnp_name, script_rel, compatibility_date
        ));
    }

    // Trim trailing newline/commas for clean formatting
    let services = services.trim_end_matches('\n');
    let services = services.trim_end_matches(',').to_string();
    let bindings = bindings.trim_end_matches('\n');
    let bindings = bindings.trim_end_matches(',').to_string();

    format!(
        r#"using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
{services},
  ],

  sockets = [
    (
      name = "http",
      address = "{listen}",
      http = (),
      service = "router"
    ),
  ]
);

const routerWorker :Workerd.Worker = (
  serviceWorkerScript = embed "{router}",
  compatibilityDate = "{compat_date}",
  bindings = [
{bindings},
  ],
);

{worker_defs}
"#,
        services = services,
        bindings = bindings,
        listen = listen_addr,
        router = router_path,
        compat_date = compatibility_date,
        worker_defs = worker_defs,
    )
}

/// Atomically write the config to dest.
pub async fn write_config(content: &str, dest: &Path) -> Result<()> {
    let tmp = dest.with_extension("capnp.tmp");
    if let Some(parent) = tmp.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }

    let mut file = tokio::fs::File::create(&tmp)
        .await
        .with_context(|| format!("failed to create {}", tmp.display()))?;
    file.write_all(content.as_bytes()).await?;
    file.flush().await?;
    drop(file);

    tokio::fs::rename(&tmp, dest)
        .await
        .with_context(|| format!("failed to rename {}", dest.display()))?;

    Ok(())
}

/// Copy the stable router.js to state_dir so embed paths are consistent.
pub async fn install_router(router_src: &Path, router_dest: &Path) -> Result<()> {
    if router_src == router_dest {
        return Ok(());
    }
    if let Some(parent) = router_dest.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    tokio::fs::copy(router_src, router_dest)
        .await
        .with_context(|| format!("failed to copy router {}", router_src.display()))?;
    Ok(())
}
