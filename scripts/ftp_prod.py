#!/usr/bin/env python3
"""Pull or push the globalstatus.app production tree over FTP.

Credentials are never stored in the repo. Resolution order:
  1. GLOBALSTATUS_FTP_HOST / USER / PASS / PORT / PASV
  2. ~/.config/globalstatus/netrc  (machine host login user password pass)
  3. GLOBALSTATUS_NETRC path

A login must land in / for globalstatus.app. Church folders are refused.
"""
from __future__ import annotations

import argparse
import ftplib
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / "globalstatus"
DEFAULT_PORT = 21
SKIP_NAMES = {".", "..", ".ftpquota"}
SKIP_UPLOAD_PREFIXES = (".well-known/", "cgi-bin/")
SKIP_UPLOAD_NAMES = {".ftpquota", "scan.lock", "mil.lock", "stop.flag"}
TIMEOUT = 60


def die(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(1)


def load_netrc(path: Path) -> tuple[str | None, str | None, str | None]:
    if not path.is_file():
        return None, None, None
    host = user = password = None
    for line in path.read_text().splitlines():
        parts = line.split()
        for i, part in enumerate(parts):
            if part == "machine" and i + 1 < len(parts):
                host = parts[i + 1]
            elif part == "login" and i + 1 < len(parts):
                user = parts[i + 1]
            elif part == "password" and i + 1 < len(parts):
                password = parts[i + 1]
    return host, user, password


def credentials() -> tuple[str, str, str, int]:
    host = os.environ.get("GLOBALSTATUS_FTP_HOST")
    user = os.environ.get("GLOBALSTATUS_FTP_USER")
    password = os.environ.get("GLOBALSTATUS_FTP_PASS")
    port_raw = os.environ.get("GLOBALSTATUS_FTP_PORT")
    netrc = os.environ.get("GLOBALSTATUS_NETRC")
    paths = []
    if netrc:
        paths.append(Path(netrc))
    paths.append(Path.home() / ".config/globalstatus/netrc")
    for path in paths:
        n_host, n_user, n_pass = load_netrc(path)
        host = host or n_host
        user = user or n_user
        password = password or n_pass
        if password:
            break
    try:
        port = int(port_raw) if port_raw else DEFAULT_PORT
    except ValueError:
        die(f"GLOBALSTATUS_FTP_PORT must be an integer, got {port_raw!r}")
    if not (host and user and password):
        die(
            "Set GLOBALSTATUS_FTP_HOST, GLOBALSTATUS_FTP_USER and GLOBALSTATUS_FTP_PASS,\n"
            "or put a netrc at ~/.config/globalstatus/netrc:\n"
            "  machine <host> login <user> password <password>"
        )
    return host, user, password, port


def connect(host: str, user: str, password: str, port: int = DEFAULT_PORT) -> ftplib.FTP:
    ftp = ftplib.FTP()
    ftp.connect(host, port, timeout=TIMEOUT)
    ftp.login(user, password)
    pasv = os.environ.get("GLOBALSTATUS_FTP_PASV", "1").strip().lower()
    ftp.set_pasv(pasv not in {"0", "false", "no", "off"})
    ftp.encoding = "latin-1"
    pwd = ftp.pwd()
    listing = []
    try:
        ftp.retrlines("NLST", listing.append)
    except ftplib.error_perm:
        pass
    blob = (pwd + " " + " ".join(listing)).lower()
    if "cathedral" in blob or "baptist" in blob or "church" in blob:
        ftp.quit()
        die("FTP folder looks like the church site. Stopped. Do not upload.")
    if pwd not in ("/", ""):
        print(f"warning: pwd is {pwd!r}, expected /", file=sys.stderr)
    print(f"ftp {host}:{port} pwd={pwd or '/'}")
    return ftp


def parse_mlsd(ftp: ftplib.FTP, remote: str) -> list[tuple[str, dict]]:
    entries = []
    try:
        for name, facts in ftp.mlsd(remote or "/"):
            if name in SKIP_NAMES:
                continue
            entries.append((name, facts))
        return entries
    except ftplib.error_perm:
        pass
    lines: list[str] = []
    ftp.dir(remote or "/", lines.append)
    out = []
    for line in lines:
        parts = line.split(maxsplit=8)
        if len(parts) < 9:
            continue
        name = parts[8]
        if name in SKIP_NAMES:
            continue
        kind = "dir" if line.startswith("d") else "file"
        out.append((name, {"type": kind, "size": parts[4]}))
    return out


def is_dir(facts: dict) -> bool:
    kind = (facts.get("type") or "").lower()
    return kind in {"dir", "cdir", "pdir"} and kind != "file"


def join_remote(remote: str, name: str) -> str:
    if not remote or remote == "/":
        return f"/{name}"
    return f"{remote.rstrip('/')}/{name}"


def download_file(ftp: ftplib.FTP, remote: str, local: Path, size: int | None, retries: int = 4) -> None:
    local.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for attempt in range(1, retries + 1):
        try:
            with local.open("wb") as fh:
                ftp.retrbinary(f"RETR {remote}", fh.write)
            if size and local.stat().st_size != int(size):
                raise IOError(f"size mismatch {local.stat().st_size} != {size}")
            return
        except Exception as err:
            last_err = err
            time.sleep(min(2 * attempt, 8))
            try:
                ftp.voidcmd("NOOP")
            except Exception:
                pass
    raise last_err


def pull(ftp: ftplib.FTP, remote: str, local: Path, stats: dict) -> None:
    local.mkdir(parents=True, exist_ok=True)
    for name, facts in parse_mlsd(ftp, remote):
        rpath = join_remote(remote, name)
        lpath = local / name
        if is_dir(facts):
            print(f"dir  {rpath}")
            pull(ftp, rpath, lpath, stats)
            continue
        size = facts.get("size")
        size_i = int(size) if size and str(size).isdigit() else None
        if lpath.exists() and size_i is not None and lpath.stat().st_size == size_i:
            stats["skip"] += 1
            continue
        print(f"get  {rpath}")
        download_file(ftp, rpath, lpath, size_i)
        stats["get"] += 1


def should_upload(rel: Path) -> bool:
    posix = rel.as_posix()
    if posix.startswith(SKIP_UPLOAD_PREFIXES):
        return False
    if rel.name in SKIP_UPLOAD_NAMES:
        return False
    if rel.suffix.lower() == ".md":
        return False
    return True


def ensure_remote_dir(ftp: ftplib.FTP, remote: str, cache: set[str]) -> None:
    if remote in ("", "/",) or remote in cache:
        return
    parent = remote.rsplit("/", 1)[0] or "/"
    ensure_remote_dir(ftp, parent if parent else "/", cache)
    try:
        ftp.mkd(remote)
    except ftplib.error_perm:
        pass
    cache.add(remote)


def store_file(ftp: ftplib.FTP, local: Path, remote: str, dry: bool) -> None:
    if dry:
        print(f"put  {remote} ({local.stat().st_size})")
        return
    with local.open("rb") as fh:
        ftp.storbinary(f"STOR {remote}", fh)
    print(f"put  {remote}")


def push(ftp: ftplib.FTP, local: Path, dry: bool, with_data: bool) -> None:
    dirs: set[str] = {"/"}
    count = 0
    for path in sorted(local.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(local)
        if not should_upload(rel):
            continue
        if not with_data and rel.parts and rel.parts[0] == "data":
            continue
        remote = "/" + rel.as_posix()
        parent = "/" + rel.parent.as_posix() if rel.parent.as_posix() != "." else "/"
        if not dry:
            ensure_remote_dir(ftp, parent, dirs)
        store_file(ftp, path, remote, dry)
        count += 1
    print(f"{'would upload' if dry else 'uploaded'} {count} files")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["pull", "push", "ls"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--with-data", action="store_true", help="also upload data/ scan caches")
    args = parser.parse_args()
    host, user, password, port = credentials()
    ftp = connect(host, user, password, port)
    try:
        if args.command == "ls":
            ftp.retrlines("LIST")
            return
        if args.command == "pull":
            stats = {"get": 0, "skip": 0}
            pull(ftp, "/", LOCAL, stats)
            print(f"done get={stats['get']} skip={stats['skip']} -> {LOCAL}")
            return
        push(ftp, LOCAL, dry=args.dry_run, with_data=args.with_data)
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


if __name__ == "__main__":
    main()
