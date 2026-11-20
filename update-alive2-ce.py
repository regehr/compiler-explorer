#!/usr/bin/env python3
"""Update the Alive2 Compiler Explorer instance to the latest LLVM main and Alive2 master.

Run as yourself (not root); it calls sudo only for the steps that touch /opt and systemd.

Everything is built and tested into a new directory /opt/compiler-explorer/releases/<timestamp>. Only once that
has fully succeeded are /opt/compiler-explorer/latest-llvm and /opt/compiler-explorer/alive2 (symlinks) switched over
to it. If anything fails before that point, the running instance is untouched.
"""

import getpass
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

LLVM_SRC = Path.home() / "llvm-project"
LLVM_BUILD = LLVM_SRC / "build"
ALIVE2_SRC = Path.home() / "alive2"
ALIVE2_BUILD = ALIVE2_SRC / "build"
ALIVE2_REPO = "https://github.com/regehr/alive2.git"

# The Alive2 binaries Compiler Explorer runs, built and installed into each release
ALIVE2_TOOLS = ["alive-tv", "alive-exec"]

# Leave most cores to the running Compiler Explorer instance
JOBS = 16

OPT = Path("/opt/compiler-explorer")
RELEASES = OPT / "releases"

ALIVE_TEST = """
define i32 @src(i32 %x) {
  %y = add i32 %x, 0
  ret i32 %y
}
define i32 @tgt(i32 %x) {
  ret i32 %x
}
"""
ALIVE_EXEC_TEST = """
define i32 @main() {
  %x = add i32 40, 2
  ret i32 %x
}
"""
CLANG_TEST = "#include <stdint.h>\nint32_t f(int32_t x) { return x + 1; }\n"


class Failed(Exception):
    pass


def step(msg):
    print(f"\n==> {msg}", flush=True)


def run(cmd, what, **kwargs):
    try:
        return subprocess.run([str(c) for c in cmd], check=True, **kwargs)
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        raise Failed(f"{what} failed: {e}")


def git_pull(repo, branch):
    head = run(["git", "-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], f"reading branch of {repo}",
               capture_output=True, text=True).stdout.strip()
    if head != branch:
        raise Failed(f"{repo} is on branch '{head}', expected '{branch}'")
    run(["git", "-C", repo, "pull", "--ff-only", "origin", branch], f"git pull in {repo}")


def point_symlink(name, release):
    """Atomically point /opt/compiler-explorer/<name> at releases/<release>/<name>."""
    link = OPT / name
    if link.exists() and not link.is_symlink():
        # First run only: the old layout had real directories here
        run(["sudo", "mv", "-T", link, OPT / f"{name}.orig"], f"moving old {link} aside")
    tmp = OPT / f".{name}.new"
    run(["sudo", "ln", "-sfn", f"releases/{release}/{name}", tmp], f"creating symlink for {name}")
    run(["sudo", "mv", "-T", tmp, link], f"switching {link}")


def preflight():
    if os.geteuid() == 0:
        raise Failed("run this as your normal user, not root (it uses sudo where needed)")
    me = getpass.getuser()
    not_mine = run(["find", LLVM_BUILD, "!", "-user", me, "-print", "-quit"], "checking build dir ownership",
                   capture_output=True, text=True).stdout.strip()
    if not_mine:
        raise Failed(f"{not_mine} is not owned by {me} (left over from a 'sudo ninja install'?).\n"
                     f"Fix once with: sudo chown -R {me}:{me} {LLVM_SRC}")
    run(["sudo", "-v"], "sudo")


def main():
    start = time.time()
    release = time.strftime("%Y%m%d-%H%M%S")
    rel = RELEASES / release
    me = getpass.getuser()

    step("Preflight checks")
    preflight()

    step("Pulling LLVM main")
    git_pull(LLVM_SRC, "main")

    step("Pulling Alive2 master")
    if not ALIVE2_SRC.exists():
        run(["git", "clone", ALIVE2_REPO, ALIVE2_SRC], "cloning Alive2")
    git_pull(ALIVE2_SRC, "master")

    step("Building LLVM")
    run(["ninja", "-C", LLVM_BUILD, "-j", JOBS], "LLVM build")

    step(f"Installing LLVM into {rel}/latest-llvm")
    run(["sudo", "install", "-d", "-o", me, "-g", me, rel], f"creating {rel}")
    run(["cmake", "--install", LLVM_BUILD, "--prefix", rel / "latest-llvm"], "LLVM install")

    step("Building Alive2 against the new LLVM")
    # LLVM moves to a new directory every run, so start from a clean Alive2 build dir
    shutil.rmtree(ALIVE2_BUILD, ignore_errors=True)
    # Alive2 builds with -Werror, and GCC 12 has false-positive -Wrestrict warnings in libstdc++'s std::string;
    # Alive2 puts our CMAKE_CXX_FLAGS after its own, so -Wno-error wins
    run(["cmake", "-G", "Ninja", "-S", ALIVE2_SRC, "-B", ALIVE2_BUILD, "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TV=1",
         "-DCMAKE_CXX_FLAGS=-Wno-error", f"-DLLVM_DIR={rel}/latest-llvm/lib/cmake/llvm"], "Alive2 configure")
    run(["ninja", "-C", ALIVE2_BUILD, "-j", JOBS, *ALIVE2_TOOLS], "Alive2 build")
    (rel / "alive2" / "build").mkdir(parents=True)
    for tool in ALIVE2_TOOLS:
        shutil.copy2(ALIVE2_BUILD / tool, rel / "alive2" / "build" / tool)

    step("Smoke-testing the new release")
    run([rel / "latest-llvm/bin/clang", "-O2", "-S", "-emit-llvm", "-x", "c", "-", "-o", "/dev/null"],
        "clang smoke test", input=CLANG_TEST, text=True)
    with tempfile.NamedTemporaryFile("w", suffix=".ll") as f:
        f.write(ALIVE_TEST)
        f.flush()
        out = run([rel / "alive2/build/alive-tv", f.name], "alive-tv smoke test", capture_output=True, text=True).stdout
    if "seems to be correct" not in out:
        raise Failed(f"alive-tv smoke test gave unexpected output:\n{out}")
    with tempfile.NamedTemporaryFile("w", suffix=".ll") as f:
        f.write(ALIVE_EXEC_TEST)
        f.flush()
        # alive-exec exits with the interpreted program's return value (42 here), so don't treat that as failure
        try:
            res = subprocess.run([rel / "alive2/build/alive-exec", f.name], capture_output=True, text=True)
        except OSError as e:
            raise Failed(f"alive-exec smoke test failed: {e}")
    if res.returncode != 42 or "Returned #x0000002a / non-poison=true" not in res.stdout:
        raise Failed(f"alive-exec smoke test gave unexpected result (exit {res.returncode}):\n{res.stdout}{res.stderr}")
    run(["sudo", "chown", "-R", "root:root", rel], "making the release root-owned")

    # Point of no return: everything below touches production
    step("Switching production to the new release")
    old_link = OPT / "latest-llvm"
    old_release = Path(os.readlink(old_link)).parent.name if old_link.is_symlink() else None
    # alive2 first: the new Alive2 tools link against its own release's LLVM by absolute path, so the two
    # switches never leave a mismatched pair in service
    point_symlink("alive2", release)
    point_symlink("latest-llvm", release)

    step("Restarting Compiler Explorer (it reads compiler versions, which key its result cache, only at startup)")
    run(["sudo", "systemctl", "restart", "compiler-explorer"], "restarting compiler-explorer")

    step("Removing old releases (keeping this one and the previous one)")
    for d in RELEASES.iterdir():
        if d.name not in (release, old_release):
            run(["sudo", "rm", "-rf", d], f"removing {d}")

    mins = (time.time() - start) / 60
    print(f"\nDone in {mins:.0f} min. Now serving release {release}.")
    if old_release:
        print(f"To roll back: point the latest-llvm and alive2 symlinks in {OPT} at releases/{old_release}/ "
              "and restart compiler-explorer.")


if __name__ == "__main__":
    try:
        main()
    except Failed as e:
        print(f"\n*** Update failed: {e}", file=sys.stderr)
        print("*** The running Compiler Explorer instance was not changed, unless this happened "
              "after 'Switching production' above.", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n*** Interrupted.", file=sys.stderr)
        sys.exit(1)
