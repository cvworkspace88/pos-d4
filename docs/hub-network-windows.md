# Hub on the outlet network (Windows)

Tablets find the desktop hub on the outlet Wi-Fi (US-003), from the list, the QR code or a typed
IP:port, and then talk to its API. On Windows two things outside the app decide whether that works:
**Windows Firewall** and the **network profile** (Public or Private). Neither has been tested on a
Windows PC yet. This page says what the hub needs, how to set it up by hand today, and what the
installer must do later.

## What the hub needs from the network

| Traffic | Port | Direction | Used for |
| --- | --- | --- | --- |
| API (HTTP) | TCP `3333` (`apiPort` in `%APPDATA%\POS D4\hub.json`) | Tablets → this PC | Sign-in, orders, the `hub.info` ping behind the offline banner |
| mDNS | UDP `5353`, multicast `224.0.0.251` | Both ways | The "Ditemukan di Wi-Fi" list (`_pos-hub._tcp`, or `HUB_MDNS_TYPE`) |

The database is not on this list: Postgres listens on `127.0.0.1` only, and tablets never reach it.

When only mDNS is blocked, tablets can still pair with the QR code or a typed IP, but the list stays
empty. When TCP `3333` is blocked, nothing works from a tablet: pairing answers "Hub tidak
menjawab…", and the banner turns red. The desktop itself keeps working either way, because it talks to
`127.0.0.1`.

## Windows Firewall

The first time the hub starts listening, Windows shows "Windows Defender Firewall has blocked some
features of this app" for **POS D4**.

- **Allow access** with **Private networks** ticked: tablets can connect.
- **Cancel**, or only **Public networks** ticked while the Wi-Fi is Private: Windows saves a block rule.
  Tablets cannot connect, and the prompt never comes back on its own.

### Setting it up by hand (today)

In an **administrator** PowerShell or Command Prompt:

```
netsh advfirewall firewall add rule name="POS D4 hub API" dir=in action=allow protocol=TCP localport=3333 profile=private,domain
netsh advfirewall firewall add rule name="POS D4 hub mDNS" dir=in action=allow protocol=UDP localport=5353 profile=private,domain
```

- If `apiPort` was changed, use that port instead of `3333`.
- To undo, run `netsh advfirewall firewall delete rule name="POS D4 hub API"`, and the same for
  `"POS D4 hub mDNS"`.
- If the prompt was cancelled earlier, check **Windows Security → Firewall & network protection → Allow
  an app through firewall**. Untick or remove any **POS D4** entry that blocks, then add the rules
  above.

The rules are by port, not by program path, so they survive app updates and reinstalls.

### What the installer must do (installer story, with US-002's open items)

- Add both rules on install and remove them on uninstall, using the same names as above.
  `electron-builder.cjs` → `nsis.include` with a small `.nsh` script that runs `netsh`.
- Adding firewall rules needs administrator rights, but the default NSIS install is per-user with no
  elevation. Decide between a per-machine install (`nsis.perMachine: true`) and an elevated step that
  only adds the rules. Without one of them, the rules fail silently.
- Use `profile=private,domain` and not `any`, so a laptop hub on a café's public Wi-Fi does not open
  its API to strangers.
- If `apiPort` changes after install, the API rule must follow. Either the app re-adds it, or the setup
  screen tells the user to run the command above.

## Network profile: Public vs Private

Windows treats each Wi-Fi or LAN connection as **Public** (the default for a new network) or **Private**.
On Public, Windows blocks incoming connections and network discovery. The rules above use
`private,domain`, so on a Public network they do not apply either, and tablets cannot reach the hub.

**The outlet network must be Private.**

- **Check:** Settings → Network & internet → Wi-Fi (or Ethernet) → the connected network → **Network
  profile type**. Or in PowerShell: `Get-NetConnectionProfile`.
- **Change:** pick **Private network** in the same place. Or, in an administrator PowerShell:
  `Set-NetConnectionProfile -InterfaceAlias "Wi-Fi" -NetworkCategory Private`, using the interface
  name from `Get-NetConnectionProfile`.

Windows remembers the profile per network. A new router or a new Wi-Fi name starts as Public again.

### What the app should do (planned)

- **Warn:** on first-run setup and on the desktop **Perangkat** page, when the network carrying the
  address in the QR code is Public, show a warning. Suggested copy: "Jaringan ini diatur sebagai
  Publik. Tablet tidak bisa terhubung. Ubah ke Pribadi di Pengaturan Windows → Jaringan." The main
  process can read the profile with `Get-NetConnectionProfile`. It must never switch the profile
  itself.
- **Self-check:** add a check on the Perangkat page that calls its own LAN address (not `127.0.0.1`).
  If that fails while `127.0.0.1` answers, the firewall is the likely cause. Show what to do next.

## Other things that stop tablets (not fixable in the app)

- **Router "AP isolation" / "client isolation"** stops Wi-Fi devices from talking to each other.
  Guest networks often have it on. Turn it off, or put the hub PC and the tablets on the staff network,
  not the guest one.
- **Different networks:** tablets on the 5 GHz guest SSID and the PC on the wired staff LAN are often
  separate subnets. mDNS does not cross subnets. The QR code or a typed IP may still work if the router
  routes between them.
- **Windows' own mDNS service** also uses UDP 5353. The hub shares the port, and if it cannot, it logs
  `mDNS unavailable: …` in `api.log` and keeps serving. Pair with the QR code or a typed IP. Untested on
  Windows.
- **Virtual adapters** (WSL, Hyper-V `vEthernet`, VirtualBox, VMware, Docker) are left out of the
  Perangkat page and the QR code, so the QR carries the real Wi-Fi or LAN address. An adapter with an
  unknown name can still appear. The page lists every address, so type the right one on the tablet.
- **Quitting the app:** on Windows the hub stops without sending mDNS goodbyes. Tablets keep listing it
  until the record expires (about two minutes), but their banner turns red within about 20 seconds.

## Checking a new outlet PC

1. Open the desktop app. In **Pengaturan → Perangkat**, note the IP address and port.
2. On the PC, run `Get-NetConnectionProfile`. **NetworkCategory** must be `Private`.
3. Run `netsh advfirewall firewall show rule name="POS D4 hub API"`. The rule must exist and be
   enabled.
4. On a tablet on the same Wi-Fi, open `http://<IP>:<port>/health` in a browser. It must answer.
5. In the tablet app: the hub appears under **Ditemukan di Wi-Fi**, tapping it pairs, and the banner
   stays hidden.
6. Quit the desktop app. Within about 20 seconds the tablet shows the red **Hub offline** banner. Start
   the app again, and the banner clears.

## Troubleshooting

| On the tablet | Check |
| --- | --- |
| List empty, QR / typed IP works | mDNS blocked: the UDP 5353 rule, Public profile, AP isolation, different subnet. Pairing by QR is fine to keep using |
| "Hub tidak menjawab…" for QR and typed IP | TCP rule missing or blocked, Public profile, wrong IP (a virtual adapter's) or port, AP isolation |
| Paired, then red "Hub offline" after Windows updates or a new router | Network profile reset to Public; the PC's IP changed (re-pair from the Perangkat page) |
| Works on the PC's browser (`127.0.0.1`), not from the tablet | Firewall or profile: that is the difference between the two |
