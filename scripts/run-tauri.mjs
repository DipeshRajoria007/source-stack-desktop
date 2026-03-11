import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

const env = { ...process.env };
const home = env.HOME || env.USERPROFILE || homedir();
const isWindows = process.platform === "win32";
const cargoExe = isWindows ? "cargo.exe" : "cargo";
const tauriCmd = isWindows ? "tauri.cmd" : "tauri";
const tauriCliScript = join(
  process.cwd(),
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);
const localBinDir = join(process.cwd(), "node_modules", ".bin");
const localTauriCmd = join(process.cwd(), "node_modules", ".bin", tauriCmd);
const tauriExecutable = existsSync(localTauriCmd) ? localTauriCmd : tauriCmd;

const candidateDirs = [
  localBinDir,
  env.PNPM_HOME || "",
  join(home, ".cargo", "bin"),
  env.CARGO_HOME ? join(env.CARGO_HOME, "bin") : "",
].filter(Boolean);

const currentPath = env.PATH || "";
for (const dir of candidateDirs) {
  if (!currentPath.split(delimiter).includes(dir)) {
    env.PATH = `${dir}${delimiter}${env.PATH || ""}`;
  }
}

if (!env.CARGO) {
  for (const dir of candidateDirs) {
    const candidate = join(dir, cargoExe);
    if (existsSync(candidate)) {
      env.CARGO = candidate;
      break;
    }
  }
}

const child = existsSync(tauriCliScript)
  ? spawn(process.execPath, [tauriCliScript, ...process.argv.slice(2)], {
      stdio: "inherit",
      env,
      shell: false,
    })
  : spawn(tauriExecutable, process.argv.slice(2), {
      stdio: "inherit",
      env,
      // Windows command shims like `tauri.cmd` need a shell to spawn correctly.
      shell: isWindows,
    });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
