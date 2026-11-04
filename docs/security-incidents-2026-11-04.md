# Security incident review, 4 November 2026

Reviewed the 92 incidents supplied from [pwn.watch](https://pwn.watch/) against
`Techfolk-AS/.github`, starting at commit `bcf651f`. All 92 linked incident JSON
records were retrieved on 4 November 2026. The row numbers below match the supplied
list. This is a point-in-time audit, not a complete organization asset inventory.

## Outcome

| Result | Incidents |
| --- | ---: |
| Runtime patched in repository | 1 |
| Bun present, HTTP/3 server exposure absent | 1 |
| Linux kernel patch status requires provider verification | 5 |
| Developer-tool mitigation and version follow-up | 1 |
| No product evidence in this checkout | 84 |
| Total | 92 |

Incident 49 applies even though the supplied heading names Node.js. Its full
record also lists Bun before 1.4.4. This update changes `packageManager`, both
Bun workflow pins, and the local setup instructions from 1.4.2 to 1.4.4.
The [incident details](https://pwn.watch/i/nodejs-october-2026-security-releases)
list that fixed Bun version; the [Bun 1.4.4 release notes](https://bun.sh/blog/bun-v1.4.4)
include Brotli among the security fixes. The [Node.js vendor advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)
describes CVE-2026-111497 and the fixed Node release lines.

The checked-in scripts parse local configuration and run `gh` subprocesses. They
do not directly fetch HTTP responses, decompress Brotli, or accept network
requests. The Bun update also covers the package manager used to install their
dependencies. No claim of an observed exploit or compromise is made.

## Evidence and limits

- Reviewed all 20 tracked files before adding this report, including all seven
  workflow files, the workflow template, scripts, manifest, and lockfile.
- `package.json` has three runtime dependencies, `ini` 7.0.0, `semver` 7.8.5, and
  `yaml` 2.9.1, plus four development dependencies. All seven direct versions are
  exact pins. `bun.lock` is the only dependency lockfile.
- Trivy 0.75.0 scanned all 30 packages reported from `bun.lock`, including
  development dependencies, using its downloaded vulnerability database.
  It reported zero package vulnerabilities. This does not inspect the Bun
  executable, hosted runner kernels, or firmware.
- `@types/node`, `@types/bun`, `bun-types`, and `undici-types` are type declarations.
  Their version numbers are not installed Node or Bun runtime versions.
- No Dockerfile, container image, Compose file, Terraform file, Helm chart,
  Kubernetes deployment, or machine/device provisioning definition is tracked.
- Every workflow job requests `ubuntu-latest`. The read-only repository runners
  API returned `total_count: 0` and no registered self-hosted runners. GitHub
  documents that it maintains and upgrades standard [hosted runner machines](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners).
  Neither the kernel patch level nor the runner-bundled Node executable used by
  JavaScript actions was verified during this review.
- The local shell reports Node 26.13.0, above the fixed 26.12.1 release. The
  globally installed Bun remains 1.4.2. Developers must upgrade it to 1.4.4 before
  their next local run; the repository's `packageManager` field does not replace
  an installed executable. Validation used a separate official Bun 1.4.4 binary
  downloaded into a temporary directory and checked against its release-asset
  SHA-256 digest.
- Other organization repositories, production hosts, network appliances,
  desktop applications, browser extensions, and mobile devices were not
  inventoried. A row marked "No repo evidence" means no matching dependency,
  service, provisioning, or use was found in this checkout. It does not certify
  that the organization has no such asset.

## Mitigations and remaining verification

Incident 57 concerns HTTP/3 servers. The repository starts no network listener,
so the [researcher's Bun mitigation](https://foxio.io/blog/header-accordions-qpack-amplification-attacks-against-http-3-servers)
is already met. Keep Bun HTTP/3 servers unexposed if these tools are extended.
The Bun 1.4.4 upgrade is not treated as proof of a QPACK fix.

Incident 9 concerns the assistant desktop environment as well as developer
installations. The [original EMBRACE research](https://forever.security/blog/embrace-hacking-5-ai-assistants-embedded-browsers-technical)
reported unresolved local-file browser issues in Codex and VS Code on
29 October 2026. Do not open HTML from unreviewed projects in their embedded
browsers. No local HTML was opened during this review, and this checkout contains
no tracked HTML or preview workflow. Installed desktop versions and their current
patch status were not verified or changed. Check those applications separately;
Copilot's reported fixed version is 1.1.29 and Cursor's reported fix shipped on
1 October 2026.

For incidents 48, 63, 65, 76, and 90, obtain the hosted runner provider's current
kernel and host patch status. Use the distribution's CVE/backport status rather
than comparing an Ubuntu kernel number directly with upstream release numbers.
For incident 49, that provider check also includes the Node binaries supplied to
JavaScript actions. No kernel, hypervisor, firmware, or runner installation was
changed from a workflow job.

The runtime pins take effect when this branch is merged and the workflows run
again. Existing jobs and separately installed tools are not upgraded by these
commits.

## Validation

Using the official Bun 1.4.4 executable:

- `bun install --frozen-lockfile --ignore-scripts` succeeded without dependency or
  lockfile changes.
- `bun test` passed all 58 tests with 110 assertions.
- `bun run typecheck` passed.
- All workflow YAML parsed, and both `oven-sh/setup-bun` pins matched
  `packageManager: bun@1.4.4`.
- `git diff --check` passed.

The dependency scan used:

```sh
trivy fs --scanners vuln --include-dev-deps \
  --skip-dirs node_modules --skip-dirs .git --format json .
```

No new tests were added for the version-pin change.

## Incident-by-incident disposition

Each product link opens the supplied incident, including affected versions,
checks, and advisory links. Evidence below is limited to this repository and the
read-only runner query described above.

| # | Product / incident | Result | Evidence or action |
| --- | --- | --- | --- |
| 1 | [ClickHouse Server](https://pwn.watch/i/clickhouse-server-unauth-rce-cve-2026-116366) | No repo evidence | No ClickHouse service, dependency, or image is declared. |
| 2 | [LMDeploy](https://pwn.watch/i/lmdeploy-update-weights-pickle-rce-cve-2026-119706) | No repo evidence | No LMDeploy dependency or API server is declared. |
| 3 | [pgAdmin 4](https://pwn.watch/i/pgadmin-4-9-19-import-export-rce-login-bypass-cve-2026-116241) | No repo evidence | No pgAdmin installation or deployment is declared. |
| 4 | [Thales Sentinel Keys Server](https://pwn.watch/i/thales-sentinel-keys-server-unauth-rce-cve-2026-78403) | No repo evidence | No Windows licensing-server provisioning is declared. |
| 5 | [LM Studio](https://pwn.watch/i/lm-studio-model-downloader-path-traversal-cve-2026-119979) | No repo evidence | No desktop-app provisioning or model downloader is declared. |
| 6 | [Progress WS_FTP Server](https://pwn.watch/i/progress-ws-ftp-server-cve-2026-84295-90868-oct-2026) | No repo evidence | No WS_FTP installation or Windows server is declared. |
| 7 | [Rancher and Fleet](https://pwn.watch/i/rancher-fleet-oct-2026-security-release-cluster-admin-escalation) | No repo evidence | No Rancher, Fleet, Helm, or Kubernetes deployment is declared. |
| 8 | [Android telephony](https://pwn.watch/i/android-sms-of-death-wap-push-dos-cve-2026-58882) | No repo evidence | No Android application, device inventory, or device-management policy exists here. |
| 9 | [EMBRACE embedded browsers](https://pwn.watch/i/embrace-ai-assistant-embedded-browsers-oct-2026) | Developer follow-up | Developer-tool concern in this desktop session. See the developer-tool mitigation and verification limits. |
| 10 | [Kubeflow Pipelines](https://pwn.watch/i/kubeflow-pipelines-volume-artifact-path-traversal-cve-2026-118758) | No repo evidence | No Kubeflow dependency, pipeline server, or deployment is declared. |
| 11 | [Telegram for Android](https://pwn.watch/i/telegram-android-voice-call-mediastate-rce-oct-2026) | No repo evidence | No Telegram installation or Android device-management policy is declared. |
| 12 | [ZITADEL](https://pwn.watch/i/zitadel-login-v2-account-takeover-cve-2026-119127-oct-2026) | No repo evidence | No ZITADEL service, client configuration, or deployment is declared. |
| 13 | [Cisco Catalyst SD-WAN](https://pwn.watch/i/cisco-sd-wan-keydrift-uat-11473-cve-2026-20127) | No repo evidence | No Cisco SD-WAN controller, manager, or validator is declared. |
| 14 | [Drupal Commerce Core](https://pwn.watch/i/drupal-commerce-core-access-bypass-cve-2026-118539) | No repo evidence | No Composer manifest, Drupal site, or commerce module exists here. |
| 15 | [FreeSWITCH](https://pwn.watch/i/freeswitch-api-chat-rce-cve-2026-116779) | No repo evidence | No FreeSWITCH service or SIP configuration is declared. |
| 16 | [Juniper Session Smart](https://pwn.watch/i/juniper-session-smart-router-cve-2026-103409) | No repo evidence | No Juniper router or conductor provisioning is declared. |
| 17 | [Langflow OSS](https://pwn.watch/i/langflow-oss-multiple-rce-cve-2026-110186-oct-2026) | No repo evidence | No Langflow dependency, server, or deployment is declared. |
| 18 | [Sophos UTM](https://pwn.watch/i/sophos-utm-email-proxy-preauth-rce-cve-2026-118633) | No repo evidence | No Sophos appliance or email-proxy configuration is declared. |
| 19 | [Cisco ASA and FTD](https://pwn.watch/i/cisco-asa-ftd-ssl-vpn-dos-zero-day-cve-2026-76418) | No repo evidence | No Cisco firewall or SSL VPN configuration is declared. |
| 20 | [Jenkins core](https://pwn.watch/i/jenkins-core-security-advisory-2026-10-28) | No repo evidence | CI is defined as GitHub Actions workflows; no Jenkins server is declared. |
| 21 | [WordPress core](https://pwn.watch/i/wordpress-7-1-4-security-release-oct-2026) | No repo evidence | No WordPress site, PHP dependency manifest, or deployment exists here. |
| 22 | [Bitcoin Core](https://pwn.watch/i/bitcoin-core-ai-found-node-crash-bugs-oct-2026) | No repo evidence | No Bitcoin node or Bitcoin Core dependency is declared. |
| 23 | [EPICS Base](https://pwn.watch/i/epics-base-7-0-11-critical-memory-bugs-oct-2026) | No repo evidence | No EPICS dependency or control-system deployment is declared. |
| 24 | [Veeam products](https://pwn.watch/i/veeam-october-2026-security-updates-cve-2026-108142) | No repo evidence | No Veeam backup server, agent, or deployment is declared. |
| 25 | [WatchGuard Fireware](https://pwn.watch/i/watchguard-fireware-2026-4-security-update-oct-2026) | No repo evidence | No WatchGuard firewall or VPN-client provisioning is declared. |
| 26 | [Avada theme](https://pwn.watch/i/avada-theme-form-upload-rce-cve-2026-115346) | No repo evidence | No WordPress site or Avada theme is declared. |
| 27 | [Firefox and Firefox ESR](https://pwn.watch/i/firefox-159-esr-153-6-security-release-oct-2026) | No repo evidence | No Firefox provisioning or browser-test workflow is declared. |
| 28 | [TeamViewer](https://pwn.watch/i/teamviewer-15-83-security-update-oct-2026) | No repo evidence | No TeamViewer client, host, or add-on provisioning is declared. |
| 29 | [Dahua Easy4IP](https://pwn.watch/i/dahua-cameras-easy4ip-p2p-hijacking-ukraine-oct-2026) | No repo evidence | No camera, recorder, or Easy4IP configuration is declared. |
| 30 | [Atlantis](https://pwn.watch/i/atlantis-0-49-0-security-fixes-fork-bypass-rce-oct-2026) | No repo evidence | No Atlantis deployment, Terraform configuration, or Atlantis webhook exists here. |
| 31 | [Tailscale and headscale](https://pwn.watch/i/tailscale-tailworm-ssh-forwarding-privesc) | No repo evidence | No Tailscale client, SSH, serve, connector, or headscale deployment is declared. |
| 32 | [Postiz](https://pwn.watch/i/postiz-account-takeover-file-read-cve-2026-115933) | No repo evidence | No Postiz dependency or self-hosted service is declared. |
| 33 | [Electrum](https://pwn.watch/i/electrum-malicious-server-rbf-fee-bump-theft) | No repo evidence | No Electrum wallet or wallet provisioning is declared. |
| 34 | [Echo Proxy middleware](https://pwn.watch/i/labstack-echo-proxy-websocket-auth-bypass-ghsa-cxf3-9h37-7rr8) | No repo evidence | No Go module or Echo dependency exists here. |
| 35 | [Laravel TokenGuard](https://pwn.watch/i/laravel-tokenguard-auth-bypass-cve-2026-114509) | No repo evidence | No Composer manifest or Laravel application exists here. |
| 36 | [Pillow](https://pwn.watch/i/pillow-fpx-heap-overflow-cve-2026-112398) | No repo evidence | The Python test uses the standard library; no Pillow dependency exists in the checkout or Bun lockfile. |
| 37 | [Ruby regex compiler](https://pwn.watch/i/ruby-regexp-compilation-fixes-gitlab-cves) | No repo evidence | No Ruby application, Gemfile, or Ruby runtime provisioning is declared. |
| 38 | [Microsoft Authenticator for Android](https://pwn.watch/i/microsoft-authenticator-android-authmask-cve-2026-80097) | No repo evidence | No Android app or device-management policy is declared. |
| 39 | [Time4Popcorn](https://pwn.watch/i/popcorn-time-time4popcorn-updater-cve-2026-30612) | No repo evidence | No Time4Popcorn installation or provisioning is declared. |
| 40 | [Arista VeloCloud Orchestrator](https://pwn.watch/i/arista-velocloud-orchestrator-cve-2026-114625) | No repo evidence | No VeloCloud appliance or on-premises deployment is declared. |
| 41 | [Aruba AOS-8 and AOS-10](https://pwn.watch/i/hpe-aruba-aos-critical-rce-oct-2026) | No repo evidence | No Aruba wireless controller, gateway, or access-point configuration is declared. |
| 42 | [Okta Access Gateway](https://pwn.watch/i/okta-access-gateway-cve-2026-115547-115546) | No repo evidence | No Okta on-premises gateway deployment is declared. |
| 43 | [x402 SDKs](https://pwn.watch/i/x402-sdk-critical-flaws-v12) | No repo evidence | No @x402 package, Python x402 package, or Go x402 module exists here. |
| 44 | [Windows Secure Boot / BlackX](https://pwn.watch/i/blackx-uefi-bootkit-baton-drop-secure-boot-bypass) | No repo evidence | Workflows request Ubuntu; no Windows boot-manager or Secure Boot provisioning is declared. |
| 45 | [Fortinet October hardening release](https://pwn.watch/i/fortinet-ai-found-flaws-hardening-release-oct-2026) | No repo evidence | No FortiOS, FortiManager, FortiAnalyzer, FortiMail, or FortiAuthenticator deployment is declared. |
| 46 | [GitLab CE/EE](https://pwn.watch/i/gitlab-cve-2026-110264-regex-rce) | No repo evidence | Repository hosting and CI use GitHub; no self-managed GitLab deployment is declared. |
| 47 | [Keycloak](https://pwn.watch/i/keycloak-cve-2026-18963-reset-credentials-takeover) | No repo evidence | No Keycloak service, Java dependency manifest, or deployment is declared. |
| 48 | [Linux kernel ZDI reports](https://pwn.watch/i/linux-kernel-zdi-reports-leaked-to-lkml) | Provider verification | Ubuntu runners use Linux. GitHub owns kernel updates; loaded modules and vendor backports were not verified. |
| 49 | [Node2Shell / HTTP2Shell / Brotli](https://pwn.watch/i/nodejs-october-2026-security-releases) | Patched in repository | Bun runtime pins changed from 1.4.2 to 1.4.4. Local Node 26.13.0 exceeds the fixed 26.12.1 release. Runner-bundled Node remains provider verification. |
| 50 | [iOS / Coruna / DarkSword](https://pwn.watch/i/deadtag-coruna-darksword-iphone-exploits) | No repo evidence | No iOS application, device inventory, or mobile-device policy is declared. |
| 51 | [ISC BIND 9](https://pwn.watch/i/isc-bind-cve-2026-94300) | No repo evidence | No named service or BIND DNS-server configuration is declared. |
| 52 | [jackson-databind](https://pwn.watch/i/jackson-databind-ptv-bypass-cve-2026-110879) | No repo evidence | No Maven, Gradle, or Jackson dependency exists here. |
| 53 | [Oracle E-Business Suite](https://pwn.watch/i/oracle-ebs-tcf-sqli-rce-cve-2026-101767) | No repo evidence | No Oracle EBS installation or deployment is declared. |
| 54 | [Google Chrome](https://pwn.watch/i/chrome-156-security-update-oct-2026) | No repo evidence | No Chrome provisioning or browser-test workflow is declared. |
| 55 | [SiteGuard Server Edition](https://pwn.watch/i/eg-secure-solutions-siteguard-server-edition-cve-2026-106931) | No repo evidence | No SiteGuard deployment or configuration is declared. |
| 56 | [Siemens Software Center](https://pwn.watch/i/siemens-software-center-cve-2026-110936) | No repo evidence | No Siemens desktop software provisioning is declared. |
| 57 | [HTTP/3 QPACK Header Accordions](https://pwn.watch/i/http3-qpack-header-accordions) | No server exposure | Bun is used for CLI scripts only. No HTTP/3 server, listener, ingress, or UDP service is declared; retain that mitigation. |
| 58 | [Wasmtime and Cranelift](https://pwn.watch/i/wasmtime-cranelift-sandbox-escapes-cve-2026-115889-115893) | No repo evidence | No Wasmtime dependency, Cargo manifest, or WebAssembly runtime provisioning exists here. |
| 59 | [npm open / OpenCode / MCP Inspector](https://pwn.watch/i/opencode-mcp-oauth-rce-windows) | No repo evidence | No open, opencode-ai, or @modelcontextprotocol/inspector package is in bun.lock; no Windows or WSL job is declared. |
| 60 | [PHP2Shell](https://pwn.watch/i/php2shell-cve-2026-109618-109619) | No repo evidence | No PHP application, PHP runtime pin, or PHP web server is declared. |
| 61 | [Plex Media Server](https://pwn.watch/i/plex2shell-cve-2026-96652) | No repo evidence | No Plex service or image is declared. |
| 62 | [Fortinet path traversal](https://pwn.watch/i/fortinet-multiple-products-cve-2025-61624) | No repo evidence | No Fortinet appliance or service deployment is declared. |
| 63 | [Linux kernel Infinity Core](https://pwn.watch/i/linux-kernel-infinity-core-lpes-cve-2026-98260) | Provider verification | Ubuntu runner kernels are provider-owned; versions and vendor backports were not verified. |
| 64 | [EDK II PXE firmware](https://pwn.watch/i/edk2-pxe-icmp-preboot-rce-cve-2026-97631) | No repo evidence | No firmware build, UEFI image, PXE boot setup, or machine provisioning is declared. Provider firmware is not inventoried here. |
| 65 | [Linux IPv4 TCP use-after-free](https://pwn.watch/i/linux-kernel-ipv4-tcp-uaf-cve-2026-98432) | Provider verification | Ubuntu runner kernels are provider-owned; versions and vendor backports were not verified. |
| 66 | [Atlassian products](https://pwn.watch/i/atlassian-multiple-products-cve-2026-21589) | No repo evidence | No Atlassian server or product deployment is declared. |
| 67 | [Drupal Field UI](https://pwn.watch/i/drupal-core-field-ui-rce-cve-2026-108097) | No repo evidence | No Drupal application, Composer manifest, or Field UI module exists here. |
| 68 | [Next.js / sharp / librsvg](https://pwn.watch/i/nextjs-october-2026-rce-security-release) | No repo evidence | No next, sharp, or librsvg dependency, web application, or image-optimization server exists here. |
| 69 | [AhsayCBS](https://pwn.watch/i/ahsay-ahsaycbs-cve-2026-105134) | No repo evidence | No Ahsay backup server or deployment is declared. |
| 70 | [Cisco Secure Email Gateway](https://pwn.watch/i/cisco-secure-email-gateway-cve-2026-76519) | No repo evidence | No Cisco email gateway or configuration is declared. |
| 71 | [PAN-OS code injection](https://pwn.watch/i/palo-alto-networks-pan-os-cve-2026-0322) | No repo evidence | No Palo Alto firewall or PAN-OS provisioning is declared. |
| 72 | [Adobe Commerce / Magento BlockStrap](https://pwn.watch/i/adobe-commerce-magento-blockstrap-cve-2026-103849) | No repo evidence | No Adobe Commerce, Magento, or B2B application exists here. |
| 73 | [Esri ArcGIS Server](https://pwn.watch/i/esri-arcgis-server-sqli-cve-2026-10757) | No repo evidence | No ArcGIS server or deployment is declared. |
| 74 | [FortiSandbox](https://pwn.watch/i/fortinet-fortisandbox-cve-2026-107656) | No repo evidence | No FortiSandbox appliance or PaaS integration is declared. |
| 75 | [GoAhead](https://pwn.watch/i/goahead-6-1-1-tls-auth-cgi-flaws-oct-2026) | No repo evidence | No GoAhead server, embedded firmware, or CGI application is declared. |
| 76 | [Linux PwnEscape](https://pwn.watch/i/pwnescape-cve-2026-99999) | Provider verification | Runner host virtualization and host kernel patches are provider-owned; the checkout cannot verify host backports. |
| 77 | [Bricksforge](https://pwn.watch/i/bricksforge-wordpress-rce-cve-2026-85097) | No repo evidence | No WordPress application or Bricksforge plugin exists here. |
| 78 | [SonicWall SMA1000](https://pwn.watch/i/sonicwall-sma1000-ssrf-cve-2026-102255) | No repo evidence | No SonicWall remote-access appliance is declared. |
| 79 | [Citrix NetScaler memory-buffer issue](https://pwn.watch/i/citrix-netscaler-cve-2026-88779) | No repo evidence | No NetScaler ADC or gateway deployment is declared. |
| 80 | [Zammad](https://pwn.watch/i/zammad-gmbh-zammad-cve-2026-102490) | No repo evidence | No Zammad helpdesk application or deployment is declared. |
| 81 | [Synology DSM](https://pwn.watch/i/synology-dsm-cerber-c3rb3r-ransomware-cve-2026-13639-13684) | No repo evidence | No Synology NAS or DSM provisioning is declared. |
| 82 | [Ivanti Connect Secure](https://pwn.watch/i/ivanti-connect-secure-cve-2026-104935) | No repo evidence | No Ivanti VPN appliance or provisioning is declared. |
| 83 | [FortiMail file-write issue](https://pwn.watch/i/fortimail-cve-2026-104286) | No repo evidence | No FortiMail email gateway or deployment is declared. |
| 84 | [Citrix NetScaler RCE chain](https://pwn.watch/i/citrix-netscaler-rce-zero-days-cve-2026-88771-88772) | No repo evidence | No NetScaler ADC, gateway, or SAML configuration is declared. |
| 85 | [Nextcloud Collabora CODE Server](https://pwn.watch/i/nextcloud-collabora-built-in-code-server-cve-2026-110447) | No repo evidence | No Nextcloud installation or richdocumentscode app is declared. |
| 86 | [BeyondTrust Remote Support](https://pwn.watch/i/beyondtrust-remote-support-cve-2026-102764) | No repo evidence | No BeyondTrust Remote Support service or provisioning is declared. |
| 87 | [SGLang / Workers AI GLM-5.3](https://pwn.watch/i/cloudflare-workers-ai-glm-5-3-sglang-kv-cache-cross-tenant-leak) | No repo evidence | No SGLang inference engine, disaggregated serving configuration, or Workers AI model integration exists here. |
| 88 | [VMware ESX / ESXi logging](https://pwn.watch/i/vmware-esx-insufficient-logging-cve-2026-41709-cisa-kev) | No repo evidence | No ESX, ESXi, vSphere, VCF, or hypervisor provisioning is declared. The cloud provider's hypervisor is not inventoried here. |
| 89 | [PAN-OS GlobalProtect auth bypass](https://pwn.watch/i/palo-alto-networks-pan-os-cve-2026-0257) | No repo evidence | No PAN-OS firewall or GlobalProtect VPN configuration is declared. |
| 90 | [Linux Fragnesia](https://pwn.watch/i/linux-fragnesia-lpe-cve-2026-46300-cisa-kev) | Provider verification | Ubuntu runner kernels are provider-owned; versions, configuration, and vendor backports were not verified. |
| 91 | [Magento CMS-block loader campaign](https://pwn.watch/i/magento-cms-block-loader-deepveindrilling-oct-2026) | No repo evidence | No Adobe Commerce or Magento application exists here. |
| 92 | [Fearless Wallet extension](https://pwn.watch/i/fearless-wallet-extension-key-leak) | No repo evidence | No wallet extension, browser profile, or extension provisioning is declared. |
