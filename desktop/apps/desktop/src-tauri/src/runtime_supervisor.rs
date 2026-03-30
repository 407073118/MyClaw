use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

pub const RUNTIME_BINARY_PREFIX: &str = "myclaw-runtime";
const RUNTIME_HOST: &str = "127.0.0.1";
const RUNTIME_PORT: u16 = 43110;
const RUNTIME_WAIT_TIMEOUT: Duration = Duration::from_secs(20);
const RUNTIME_WAIT_INTERVAL: Duration = Duration::from_millis(200);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct RuntimeSupervisor {
    child: Option<Child>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeCommandSpec {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: Option<PathBuf>,
}

pub fn workspace_root_from_manifest_dir(manifest_dir: &Path) -> PathBuf {
    manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.to_path_buf())
}

pub fn build_dev_runtime_command(manifest_dir: &Path) -> RuntimeCommandSpec {
    let workspace_root = workspace_root_from_manifest_dir(manifest_dir);
    let runtime_dir = workspace_root.join("apps").join("runtime");

    RuntimeCommandSpec {
        program: PathBuf::from("pnpm"),
        args: vec![
            "--dir".to_string(),
            runtime_dir.to_string_lossy().into_owned(),
            "dev".to_string(),
        ],
        cwd: Some(workspace_root),
    }
}

pub fn resolve_packaged_runtime_binary(exe_path: &Path) -> Option<PathBuf> {
    let exe_dir = exe_path.parent()?;
    let mut candidate_dirs = vec![
        exe_dir.to_path_buf(),
        exe_dir.join("binaries"),
        exe_dir.join("resources"),
        exe_dir.join("Resources"),
    ];

    if let Some(parent) = exe_dir.parent() {
        candidate_dirs.push(parent.join("binaries"));
        candidate_dirs.push(parent.join("resources"));
        candidate_dirs.push(parent.join("Resources"));
    }

    for dir in candidate_dirs {
        if let Some(path) = find_runtime_binary_in_dir(&dir) {
            return Some(path);
        }
    }

    None
}

pub fn start_runtime_sidecar() -> Result<RuntimeSupervisor, String> {
    if is_runtime_healthy() {
        return Ok(RuntimeSupervisor { child: None });
    }

    let command_spec = if cfg!(debug_assertions) {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        build_dev_runtime_command(&manifest_dir)
    } else {
        let exe_path = std::env::current_exe()
            .map_err(|error| format!("failed to resolve desktop executable path: {error}"))?;
        let runtime_binary = resolve_packaged_runtime_binary(&exe_path).ok_or_else(|| {
            format!(
                "runtime sidecar not found near desktop executable: {}",
                exe_path.display()
            )
        })?;
        RuntimeCommandSpec {
            program: runtime_binary,
            args: Vec::new(),
            cwd: None,
        }
    };

    let child = spawn_runtime(&command_spec)?;
    wait_for_runtime_health()?;

    Ok(RuntimeSupervisor { child: Some(child) })
}

pub fn stop_runtime_sidecar(mut supervisor: RuntimeSupervisor) {
    if let Some(mut child) = supervisor.child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn spawn_runtime(spec: &RuntimeCommandSpec) -> Result<Child, String> {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    let workspace_root = spec
        .cwd
        .clone()
        .or_else(|| std::env::current_dir().ok());

    if let Some(cwd) = &spec.cwd {
        command.current_dir(cwd);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        // Hide the sidecar console window on Windows startup.
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .env("RUNTIME_PORT", RUNTIME_PORT.to_string())
        .env(
            "MYCLAW_WORKSPACE_ROOT",
            workspace_root
                .unwrap_or_else(|| PathBuf::from("."))
                .to_string_lossy()
                .into_owned(),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
        .spawn()
        .map_err(|error| format!("failed to spawn runtime command {:?}: {error}", spec.program))
}

fn wait_for_runtime_health() -> Result<(), String> {
    let deadline = Instant::now() + RUNTIME_WAIT_TIMEOUT;
    while Instant::now() <= deadline {
        if is_runtime_healthy() {
            return Ok(());
        }
        sleep(RUNTIME_WAIT_INTERVAL);
    }

    Err(format!(
        "runtime sidecar did not become healthy in {:?}",
        RUNTIME_WAIT_TIMEOUT
    ))
}

fn is_runtime_healthy() -> bool {
    let socket_address = format!("{RUNTIME_HOST}:{RUNTIME_PORT}");
    let mut stream = match TcpStream::connect(socket_address) {
        Ok(stream) => stream,
        Err(_) => return false,
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));

    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }

    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }

    response.contains("200") && response.contains("\"status\":\"ok\"")
}

fn find_runtime_binary_in_dir(dir: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.metadata().map(|meta| meta.len() == 0).unwrap_or(false) {
            continue;
        }

        if is_runtime_binary_name(path.file_name().and_then(|name| name.to_str())) {
            return Some(path);
        }
    }

    None
}

fn is_runtime_binary_name(file_name: Option<&str>) -> bool {
    let Some(file_name) = file_name else {
        return false;
    };

    if !file_name.starts_with(RUNTIME_BINARY_PREFIX) {
        return false;
    }

    let suffix = std::env::consts::EXE_SUFFIX;
    if suffix.is_empty() {
        return !file_name.ends_with(".dll")
            && !file_name.ends_with(".dylib")
            && !file_name.ends_with(".so");
    }

    file_name.ends_with(suffix)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn derives_workspace_root_from_src_tauri_manifest_dir() {
        let manifest_dir = PathBuf::from("F:/repo/apps/desktop/src-tauri");
        let workspace = workspace_root_from_manifest_dir(&manifest_dir);

        assert_eq!(workspace, PathBuf::from("F:/repo"));
    }

    #[test]
    fn builds_dev_runtime_command_pointing_to_runtime_package() {
        let manifest_dir = PathBuf::from("F:/repo/apps/desktop/src-tauri");
        let spec = build_dev_runtime_command(&manifest_dir);

        assert_eq!(spec.program, PathBuf::from("pnpm"));
        assert_eq!(spec.args.len(), 3);
        assert_eq!(spec.args[0], "--dir".to_string());
        assert_eq!(PathBuf::from(&spec.args[1]), PathBuf::from("F:/repo/apps/runtime"));
        assert_eq!(spec.args[2], "dev".to_string());
        assert_eq!(
            spec.cwd.expect("dev runtime command should include cwd"),
            PathBuf::from("F:/repo")
        );
    }

    #[test]
    fn resolves_packaged_runtime_binary_from_binaries_directory() {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("current time should be after epoch")
            .as_nanos();
        let temp_root = std::env::temp_dir().join(format!("myclaw-runtime-supervisor-{ts}"));
        let exe_dir = temp_root.join("install");
        let binaries_dir = exe_dir.join("binaries");
        fs::create_dir_all(&exe_dir).expect("should create exe dir");
        fs::create_dir_all(&binaries_dir).expect("should create binaries dir");

        let desktop_exe = exe_dir.join("MyClaw_desktop.exe");
        fs::write(&desktop_exe, b"desktop").expect("should create desktop exe");

        let runtime_sidecar = binaries_dir.join("myclaw-runtime-x86_64-pc-windows-msvc.exe");
        fs::write(&runtime_sidecar, b"runtime").expect("should create runtime sidecar");

        let resolved = resolve_packaged_runtime_binary(&desktop_exe);
        assert_eq!(resolved, Some(runtime_sidecar));

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn resolves_packaged_runtime_binary_from_resources_directory() {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("current time should be after epoch")
            .as_nanos();
        let temp_root = std::env::temp_dir().join(format!("myclaw-runtime-supervisor-{ts}"));
        let exe_dir = temp_root.join("bin");
        let resources_dir = temp_root.join("resources");
        fs::create_dir_all(&exe_dir).expect("should create exe dir");
        fs::create_dir_all(&resources_dir).expect("should create resources dir");

        let desktop_exe = exe_dir.join("MyClaw_desktop.exe");
        fs::write(&desktop_exe, b"desktop").expect("should create desktop exe");

        let runtime_sidecar = resources_dir.join("myclaw-runtime-x86_64-pc-windows-msvc.exe");
        fs::write(&runtime_sidecar, b"runtime").expect("should create runtime sidecar");

        let resolved = resolve_packaged_runtime_binary(&desktop_exe);
        assert_eq!(resolved, Some(runtime_sidecar));

        let _ = fs::remove_dir_all(&temp_root);
    }
}
