# Security Policy

Iris drives your real, logged-in browser sessions locally. Security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately to **marcovito.dev@gmail.com**, or use GitHub's private
[security advisories](https://github.com/marvitphy/iris/security/advisories/new).

Please include:

- what the issue is and where (file, tool, or flow),
- steps to reproduce,
- the impact you see.

You will get an acknowledgement as soon as possible, and credit in the fix if you want it.

## Scope

Iris runs on your machine and connects to its own Chromium over a localhost CDP port. It never
sends your credentials or page contents to any server. Areas of interest include the local control
server, the CDP connection, the MCP tool surface, and the first-run onboarding that installs the
skill and MCP bundle.
