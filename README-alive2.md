Running Alive2 on Compiler Explorer
===================================

This page assumes an Ubuntu 18.04 machine, but the instructions will
likely work on similar OSes.

1. Build an Alive2 with translation validation enabled. The only build
   product you need is the alive-tv executable. Double check that it
   works properly before proceeding.

2. Clone [this repo](https://github.com/regehr/compiler-explorer/tree/alive2-compiler)
   and make sure its rereqs are installed.

3. Edit `etc/config/llvm.defaults.properties` so that
   `compiler.alive.exe` points to your `alive-tv` executable, and also
   (if you want) so that the other `.exe` variables point to the
   appropriate tools.

4. Optionally, redirect traffic from the default CE port to the default http port.
   As root, some variation on these commands should work:

```
iptables -A INPUT -i eth0 -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -i eth0 -p tcp --dport 10240 -j ACCEPT
iptables -A PREROUTING -t nat -i eth0 -p tcp --dport 80 -j REDIRECT --to-port 10240
```

If desired, make these changes persistent:
```
apt-get install iptables-persistent
```

5. Bring up CE as normal.
   