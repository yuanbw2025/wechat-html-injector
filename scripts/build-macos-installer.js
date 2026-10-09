import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
if (process.platform !== "darwin")
  throw new Error("macOS pkgbuild is required");
const repo = path.resolve(new URL("..", import.meta.url).pathname);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "draft-installer-"));
try {
  const payload = path.join(
    temporary,
    "root",
    "usr",
    "local",
    "share",
    "yunzhongshu",
  );
  const scripts = path.join(temporary, "scripts");
  await fs.mkdir(payload, { recursive: true });
  await fs.mkdir(scripts);
  await fs.copyFile(
    path.join(repo, "native-host/host.js"),
    path.join(payload, "host.js"),
  );
  await fs.copyFile(
    path.join(repo, "native-host/macos-postinstall.sh"),
    path.join(scripts, "postinstall"),
  );
  await fs.chmod(path.join(scripts, "postinstall"), 0o755);
  await new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/pkgbuild",
      [
        "--root",
        path.join(temporary, "root"),
        "--scripts",
        scripts,
        "--identifier",
        "com.yunzhongshu.clipbridge",
        "--version",
        "6.0.0",
        "--install-location",
        "/",
        path.join(repo, "native-host/macos-installer.pkg"),
      ],
      { stdio: "inherit" },
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`pkgbuild exited ${code}`)),
    );
  });
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
