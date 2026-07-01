use std::path::Path;
use std::process::Stdio;

use anyhow::{Context, Result};
use tokio::process::{Child, Command};

pub struct WorkerdProcess {
    child: Child,
}

impl WorkerdProcess {
    pub fn spawn(bin: &str, config_path: &Path) -> Result<Self> {
        tracing::info!(bin = bin, config = %config_path.display(), "starting workerd");

        let mut cmd = Command::new(bin);
        cmd.arg("serve").arg(config_path);
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::inherit());
        cmd.stderr(Stdio::inherit());
        cmd.kill_on_drop(true);

        let child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn workerd ({})", bin))?;

        Ok(Self { child })
    }

    /// Stop the workerd process, giving it a chance to drain.
    pub async fn stop(&mut self) -> Result<()> {
        tracing::info!("stopping workerd");
        // Try SIGTERM first
        #[cfg(unix)]
        {
            use nix::sys::signal::{Signal, kill};
            use nix::unistd::Pid;
            let pid = self
                .child
                .id()
                .context("cannot get workerd pid")?;
            let _ = kill(
                Pid::from_raw(pid as i32),
                Some(Signal::SIGTERM),
            );
        }

        // Wait for exit
        match tokio::time::timeout(std::time::Duration::from_secs(10), self.child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                tracing::warn!("workerd did not exit after 10s, killing");
                let _ = self.child.start_kill();
                let _ = self.child.wait().await;
            }
        }

        Ok(())
    }

    pub fn is_running(&mut self) -> bool {
        match self.child.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) => false,
            Err(_) => false,
        }
    }

    #[allow(dead_code)]
    pub fn pid(&self) -> Option<u32> {
        self.child.id()
    }
}
