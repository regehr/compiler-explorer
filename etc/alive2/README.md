# Alive2 Compiler Explorer instance

This fork runs Compiler Explorer as a public front end for `alive-tv`, with LLVM IR as the default language and C/C++
via clang trunk. Execution is off, and every compiler invocation runs inside nsjail.

## Where the configuration lives

| What                     | In the repo                              | Deployed to                                   |
|--------------------------|------------------------------------------|-----------------------------------------------|
| CE properties            | `etc/config/*.alive2.properties`         | read in place (`--env alive2`)                |
| Compilation sandbox      | `etc/nsjail/alive2-compile.cfg`          | read in place                                 |
| systemd unit             | `etc/alive2/compiler-explorer.service`   | `/etc/systemd/system/compiler-explorer.service` |
| nginx site               | `etc/alive2/nginx-site.conf`             | `/etc/nginx/sites-available/compiler-explorer` |
| `alive-tv` compiler type | `lib/compilers/alive-tv.ts`              |                                               |

Avoid `etc/config/*.local.properties`: they are gitignored and override the `alive2` files.

## Host setup (Debian 12)

1. Install LLVM to `/opt/compiler-explorer/latest-llvm` and Alive2 to `/opt/compiler-explorer/alive2`, built against
   that LLVM. Keep `/opt/compiler-explorer` owned by root: the jail only sees system directories and
   `/opt/compiler-explorer`, and CE must not be able to modify the compilers it runs.
2. Build [nsjail](https://github.com/google/nsjail) and install it as `/usr/local/bin/nsjail`. Install `dumb-init` and
   link it to `/usr/local/bin/dumb-init`, the path CE runs inside the jail.
3. Create the unprivileged service user: `useradd --system --user-group --home-dir /var/lib/ce --shell /usr/sbin/nologin ce`.
   CE's only writable state (shortlinks and the compiler cache) is in `/var/lib/ce`, created by the unit's `StateDirectory`.
4. As the repo owner: `npm ci && npm run webpack && npm run ts-compile`. The service runs in production mode, from
   the prebuilt server in `out/dist` and frontend in `out/webpack/static`, and can't write to the checkout to build them.
5. Install the unit and nginx site from `etc/alive2/`, then
   `systemctl daemon-reload && systemctl enable --now compiler-explorer` and `nginx -t && systemctl reload nginx`.

## Updating

```sh
git pull && npm ci && npm run webpack && npm run ts-compile
sudo systemctl restart compiler-explorer
```

Rebuild after any change to code; a change to `etc/config/*.alive2.properties` or `examples/` only needs the restart. Stale files from a previous build can linger in `out/`, so `rm -rf out` first if anything looks odd.

If node is upgraded through nvm, update both node paths in the unit.
