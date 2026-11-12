<div align="center">

# <img src="https://raw.githubusercontent.com/omnigent-ai/omnigent/main/docs/images/omnigent-logo.svg" alt="" height="38" valign="middle" /> Omnigent

### The open-source meta-harness for all your AI agents.

Omnigent is an open-source **meta-harness** that gives you a common orchestration layer over Claude Code, Codex, Cursor, OpenCode, Hermes, Pi, and the agents you write yourself: swap or combine harnesses without rewriting, enforce policies and sandboxing, and collaborate in real time from any device — terminal, browser, phone, or the native desktop app.

[![PyPI version](https://img.shields.io/pypi/v/omnigent.svg)](https://pypi.org/project/omnigent/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://github.com/omnigent-ai/omnigent/blob/main/LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/omnigent)
![Status: alpha](https://img.shields.io/badge/status-alpha-orange.svg)

[omnigent.ai](https://omnigent.ai) · **[⬇️ Download the macOS desktop app](https://omnigent.ai/quickstart/install#install-the-desktop-app)**

</div>

<p align="center">
  <img src="https://raw.githubusercontent.com/omnigent-ai/omnigent/main/docs/images/omnigent-desktop.png" alt="The Omnigent desktop app: starting a new session, with pinned and project-grouped sessions in the sidebar" width="720" />
</p>

---

## Why Omnigent?

Omnigent lets you:

- **📱 Work with agents from any device, including your phone.** Sessions
  follow you: start in your terminal, continue in the browser, pick it up on
  your phone. Messages, sub-agents, terminals, and files stay in sync.

- **🤖 Supervise multiple agents.** Mix Claude Code, Codex, Cursor, OpenCode,
  Hermes, Pi, and custom agents (defined in YAML) together in the same
  session. Ask one agent to review another's work, or split a task across
  agents that are each good at different things.

- **🔌 Use any model.** A first-party API key, a Claude/ChatGPT subscription,
  or any compatible gateway. All first-class.

- **🤝 Collaborate.** Share a session so teammates can chat with your agent
  and watch it work live, co-drive it on your machine, or fork the
  conversation to continue on their own.

- **☁️ Run agents in cloud sandboxes.** No laptop required: run sessions in
  disposable [Modal](https://modal.com), [Daytona](https://www.daytona.io),
  [Blaxel](https://blaxel.ai),
  [Islo](https://islo.dev), [E2B](https://e2b.dev),
  [Gensee](https://gensee.ai),
  [CoreWeave](https://docs.coreweave.com/products/sandboxes),
  [Kubernetes](https://kubernetes.io), [OpenShell](https://github.com/NVIDIA/OpenShell),
  [Boxlite](https://github.com/boxlite-ai/boxlite),
  [microsandbox](https://github.com/superradcompany/microsandbox), or
  [Databricks](https://www.databricks.com) sandboxes, launched from the
  CLI or provisioned by the server per session (*managed hosts*).

- **🛡️ Govern your agents.** Create
  [policies](#6-govern-your-agents-with-policies) to pause for your approval
  before risky actions, cap spend, or limit which tools an agent reaches.
  They apply to the whole server, one agent, or a single chat.

---

> **Custom fork:** this is [MrStrenggeheim/omnigent](https://github.com/MrStrenggeheim/omnigent), maintained on `custom` and based on upstream `v0.20.0`.
> Use the source or Docker instructions below to get our workspace changes; upstream installers and downloads install the official distribution.
> [Fork guide and custom features](docs/custom-fork.md) · [Contributor setup](CONTRIBUTING.md#development-setup)

## Quick start

### 1. Run this fork locally

Use Linux, macOS or WSL2 (clone into the Linux filesystem).
Install Git, [uv](https://docs.astral.sh/uv/getting-started/installation/), Node.js **22.13+** and **pnpm 11.15.1** first.
For native agent terminals, also install `tmux` and, on Linux, `bubblewrap`.
Install and sign in to whichever agent harness you want to use; these credentials are your own.

```bash
git clone --branch custom https://github.com/MrStrenggeheim/omnigent.git
cd omnigent
OMNIGENT_SKIP_WEB_UI=true uv sync --locked --no-dev
pnpm install --frozen-lockfile --filter web
pnpm --dir web run build
source .venv/bin/activate
omnigent start --server "" --no-open
```

Open the local URL printed by the command and create a chat.
The empty `--server` explicitly selects a local instance, even if you previously configured a remote server.
The backend and both SDKs come from this checkout; the frontend is built from this branch.
The basic recipe needs neither Rust nor Ruby/iOS tools.

From the activated environment, use `omnigent server status` to check the server or `omnigent stop` to stop it after running work finishes.
In another terminal, activate `.venv` again or prefix commands with `uv run --no-sync` from the checkout.
User data stays in `~/.omnigent`, outside Git.

#### Run the server with Docker

From the same clone, with Docker Compose installed:

```bash
cd deploy/docker
./bootstrap.sh
docker compose up --build -d
docker compose logs -f omnigent
```

Open `http://localhost:8000` and create the initial admin account.
This builds our fork from the checkout instead of pulling upstream's `latest` image.
Data is kept in named Docker volumes.
For a remote server, set its public URL and HTTPS using the [existing deployment guide](deploy/docker/README.md).

On each computer whose files and agents you want to use, complete the local dependency/build steps above, activate `.venv`, then connect it to your server:

```bash
omnigent host --server https://your-server.example
```

Follow the sign-in instructions printed by the command.
The server holds conversations; the connected host supplies that computer's files and agent execution.
Stop the Docker server with `docker compose down`; add no volume-removal flag when keeping your data.

For updates, see the [fork guide](docs/custom-fork.md#configuration-and-updates).
Optional provider integrations remain available through the existing Python extras; install only the ones you need.

### 2. Start your first agent

`omnigent` picks a model with you and starts a session in your terminal. It
also launches a local web UI at `http://localhost:6767` that shows the same
session in the browser, or on a phone on your network (step 4). The
[desktop app](https://omnigent.ai/docs/interact/desktop) wraps that same UI
in a native window and adds OS notifications (with a configurable sound) and a dock badge —
[download it for macOS](https://omnigent.ai/quickstart/install#install-the-desktop-app).

> [!NOTE]
> The install puts two names for the same CLI on your PATH: `omnigent` and
> the shorter `omni`. They're interchangeable.

> [!TIP]
> On first run, Omnigent picks up model credentials already in your
> environment (an `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, or a `claude` /
> `codex` CLI you're logged into) and offers one as the default.

```bash
omnigent
```

Or launch a specific agent runtime:

```bash
omnigent claude                      # Claude Code, in a session your team can join
omnigent codex                       # Codex
omnigent cursor                      # Cursor
omnigent agy                         # Antigravity
omnigent opencode                    # OpenCode
omnigent hermes                      # Hermes Agent (Nous Research)
omnigent pi                          # Pi
omnigent copilot                     # GitHub Copilot (SDK harness, via `omnigent run`)
```

`omnigent agy` requires agy 1.1.13 or newer. When `GEMINI_API_KEY` is set,
direct Gemini API authentication takes precedence over agy's saved OAuth login.

To configure native agy credentials, run `omni setup` →
**Antigravity** → **Configure native agy API key / gateway** → **Add a credential**
and choose the option matching your connection:

- **Gemini — API key** for a Google AI Studio key.
- **Gemini API gateway — URL + key** for an external gateway implementing native
  Gemini requests and `x-goog-api-key` authentication. Supply its API root, such
  as `https://gateway.example/gemini`, without `/v1beta` or a model operation.
- **Databricks — profile** for a Databricks workspace with native Gemini API
  access. Omnigent manages profile authentication and model-name mapping; no
  workspace URL or token needs to be pasted into the gateway form.

OpenAI Responses and Chat Completions endpoints are **not supported by native
agy**, even when they serve Gemini models. A separate protocol adapter would be
required. The first Gemini credential becomes the default; select **Make default
for Gemini** when switching, then start a fresh `omni agy` session.

See the [native agy gateway guide](docs/native-agy-gateways.md) for compatibility
requirements, model and authentication behavior, troubleshooting, and smoke
steps. These settings configure native agy; the Antigravity Python SDK retains
its separate key/Vertex setup.

Using OpenClaw? See the [OpenClaw integration guide](docs/openclaw.md) to import
its coding agents or drive a live OpenClaw Gateway session over ACP.

<details>
<summary>Grok Build and Devin</summary>

Two more coding agents are built in but have no `omnigent <name>` launcher of
their own, because each ships a CLI that holds its own login. Install the vendor
CLI, log in with it, then name the harness:

```bash
# Grok Build (xAI)
curl -fsSL https://x.ai/cli/install.sh | bash
grok login --device-auth              # xAI OAuth
omnigent run --harness grok           # 'grok-build' also works

# Devin (Cognition)
curl -fsSL https://cli.devin.ai/install.sh | bash
devin auth login
omnigent run --harness devin
```

Both speak the [Agent Client Protocol](https://agentclientprotocol.com) over
stdio, and Omnigent stores no credential for either — each CLI reads back the
login it wrote to disk. That also means `--model` is refused rather than
silently dropped: both run their account-default model. To pin one, configure an
`acp:` agent whose command passes the vendor's own model flag.

Use the vendor login rather than an API key. A builtin ACP row has no
`env_passthrough` of its own, and `XAI_API_KEY` is not in the host-to-runner
credential allowlist, so exporting it in your shell does not reach the agent.
If you need the key route, pass it explicitly with
`OMNIGENT_RUNNER_ENV_PASSTHROUGH=XAI_API_KEY`, or configure an `acp:` agent that
declares the passthrough.

</details>

#### 🐙 Polly and 🟠🔵 Debby

Two example agents ship with the repo, and they make good first sessions:

```bash
omnigent run examples/polly/
omnigent run examples/debby/
omnigent run examples/deep-research/

# ...or on a different harness (sub-agents keep their own):
omnigent run examples/polly/ --harness <harness>
omnigent run examples/debby/ --harness <harness>
```

**🐙 Polly** is a multi-agent coding orchestrator who writes no code herself.
She's the tech lead: she plans, delegates the work to coding sub-agents
(Claude Code, Codex, or Pi) in parallel git worktrees, then routes each diff
to a reviewer from a different vendor than the one that wrote it. You merge.

**🟠🔵 Debby** is a brainstorming partner with two heads, one Claude and one GPT.
Every question you ask goes to both heads, and she lays the two answers out
side by side. Type `/debate` and the heads critique each other for a few
rounds before converging. (She needs both a Claude and an OpenAI credential;
see step 3.)

**🔎 Deep Research** is a single agent that answers a question with a cited,
cross-checked report. It plans sub-queries, searches the live web and reads
full pages through an MCP search server, and verifies each claim across
independent sources. It's also the simplest example to copy from: one agent
plus one `tools/mcp/*.yaml` server, no sub-agents.

**Prefer the browser?** One command starts the local server and registers this
machine as a host:

```bash
omnigent start   # starts the local server and registers this machine as a host
```

Open the server URL it prints, hit **New Chat**, pick your machine, and go.
Check status with `omnigent server status`; stop everything with
`omnigent stop`.

Integrations can open the new-chat composer with text already filled in using
`/?prompt=Explain%20this%20code`. Build links with
`URLSearchParams` to preserve newlines, Unicode, and characters such as `&` and
`+`. For a deployment under `/tools/omnigent`, use
`/tools/omnigent/?prompt=Explain%20this%20code`.

The text is an editable draft: the user chooses a host and agent and presses
Send to start the session. The prompt parameter is removed from the current URL
after loading, while other query parameters and the fragment are retained.

To suppress the automatic browser tab, use `omni host --no-open` or set
`OMNIGENT_HOST_NO_OPEN=1` in your shell. Both also apply to `omni host
--background` and `omni start`. Sign-in may still open a browser; use
`--non-interactive` in scripts to fail if sign-in is required.

A session can also start itself: the **Automations** page runs an agent on a
recurring schedule. See the [automations guide](https://github.com/omnigent-ai/omnigent/blob/main/docs/AUTOMATIONS.md)
for the schedule format, the REST API, and the current limits.

<details>
<summary>Customize automatic session titles</summary>

Set additional natural-language requirements for the isolated title generator:

```bash
omnigent config set --global \
  'session_title_instructions=Prefix titles with the current date as lowercase mon-dd. Use PR-number-short-name for pull requests, issue-number-short-description for issues, and a short snake_case activity otherwise.'
```

The title generator receives the current date as `YYYY-MM-DD`, then applies
these requirements to the first user message. The setting is server-owned and
does not alter an agent's portable instructions. Default generated titles are
limited to 100 characters; custom title requirements may use up to 200.
Default titles over 100 characters are rejected, leaving the first-message
fallback title in place. Custom titles over 200 characters are truncated with
a trailing ellipsis. Manually assigned titles are also limited to 200
characters. The setting applies after the local Omnigent server restarts, both
to new sessions and to later agent-initiated renames through `sys_session_rename`.
Agent proposals are formatted using the same title requirements; if formatting
fails, the existing title is preserved. Manual renames remain unchanged.
For longer instructions, edit `~/.omnigent/config.yaml` directly and use a YAML
block scalar:

```yaml
session_title_instructions: |
  Prefix every title with the current date as lowercase mon-dd.
  For pull requests use mon-dd-PR-number-short-name.
  For issues use mon-dd-issue-number-short-description.
  For other work use mon-dd-short_snake_case_activity.
```

Server operators can set the same key in the YAML passed to
`omnigent server --config`.

Claude Code sessions generate titles with the `haiku` model alias. If that
model answers the message instead of returning a title, set
`OMNIGENT_BACKGROUND_TITLE_CLAUDE_MODEL` to another Claude model alias, such as
`sonnet`, in the environment of the `omnigent` or `omnigent host` process that
runs the session.

</details>

### 3. Choose & switch models

```bash
omnigent setup
```

Add a credential, set a default, or remove one, grouped by agent. Omnigent
works with four kinds of credentials:

| | Kind | What it is |
|---|---|---|
| 🔑 | **API key** | A first-party vendor key for Anthropic, OpenAI, and similar providers |
| 🎟️ | **Subscription** | A Claude Pro/Max or ChatGPT plan, via the official `claude` / `codex` CLIs |
| 🌐 | **Gateway** | Any OpenAI- or Anthropic-compatible `base_url` and key (OpenRouter, LiteLLM, Ollama, vLLM, Azure) |
| 🧱 | **Databricks** | A Databricks workspace profile (requires the `databricks` extra) |

Defaults are per agent, so a Claude default and a Codex default coexist. You
can also switch models in the middle of a session with the `/model` command.

<details>
<summary>Gateway base URLs (OpenRouter, Ollama)</summary>

When you add a **Gateway** credential, `omnigent setup` asks for a base URL
and a key. The base URL depends on which agent you point it at:

| Provider | For | Base URL | Key |
|---|---|---|---|
| **OpenRouter** | Claude Code | `https://openrouter.ai/api` | your OpenRouter key (`sk-or-…`) |
| **OpenRouter** | Codex / OpenAI agents | `https://openrouter.ai/api/v1` | your OpenRouter key (`sk-or-…`) |
| **Ollama** (local) | Codex / OpenAI agents | `http://localhost:11434/v1` | any value (Ollama ignores it) |

For Claude Code, point at OpenRouter's Anthropic-compatible endpoint
(`…/api`, **not** `…/api/v1`). For Codex and the OpenAI-agents harness, use
the OpenAI-compatible `…/api/v1`.

</details>

### 4. Deploy a server (and use it from your phone📱)

Run Omnigent on a server with a stable URL
([`deploy/README.md`](https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md) is the full guide) and your sessions
become reachable from anywhere, including your phone. The web UI is built for
mobile, so you get the same chat, sub-agents, terminals, and files, in sync
with your laptop.

One `docker compose up` runs the server on any host you have (a VPS, a home
server); **Render** and **Railway** deploy with one click; **Fly.io**, **Hugging
Face Spaces**, **Modal**, **Cloudflare** (serverless, scale-to-zero), and
**Databricks Apps** (backed by Lakebase Postgres and Unity Catalog Volumes) are
covered too — and a **Cloudflare quick tunnel** (public) or **Tailscale**
(private) reaches a server running on your own laptop without a deploy. The
server can also provision a cloud sandbox per session (*managed hosts*), so no
laptop has to stay online. The full menu of targets, the database options, the
sandbox setup, and
[branding/white-labeling](https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md#branding-white-labeling)
live in
[`deploy/README.md`](https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md).

Once the server is up, sign in and register your laptop as a host:

```bash
omnigent login https://your-host    # sign in once; run / attach / host reuse the token
omnigent host  https://your-host    # new sessions can now run on this machine
```

> [!TIP]
> On your own network you don't need a deploy. Open your machine's LAN
> address on your phone (e.g. `http://192.168.x.x:6767`).

### 5. Collaborate with your team

Omnigent supports **multi-user accounts**, controlled by one environment
variable:

```bash
OMNIGENT_AUTH_ENABLED=1 omnigent server --background
```

The **Docker deploy in [step 4](#4-deploy-a-server-and-use-it-from-your-phone)
turns it on for you** (`OMNIGENT_AUTH_ENABLED` defaults to `1` there).

#### Invite your teammates

Open the web UI (`http://localhost:6767` locally, or your host's URL) and
sign in as `admin`; first run prints the password and saves it locally. Then
open **Admin → Members → Invite** to create a single-use invite link, no
email server needed. Send it over; your teammate opens it, sets a password,
and they're in. Signup is invite-only.

<!-- TODO: screenshot of Admin → Members → Invite. -->

> [!NOTE]
> Teammates need to be able to reach the server. A local server is only
> reachable on your network; for anyone off it, deploy an always-on host
> (see [step 4](#4-deploy-a-server-and-use-it-from-your-phone)).

#### Code together

- **Share a live session.** Hit **Share** in the web UI and send the link;
  teammates watch your agent work and chat with it in real time.
- **Share with everyone who can sign in.** Admins can allow public Edit in
  **Settings > Sharing > Maximum public permission**. Owners then choose
  **Share > General access > Edit**. The default stays Read.
- **Leave a shared session.** Done with a session someone shared with you?
  Pick **Leave session** from its sidebar row menu to drop it from your
  sidebar. Nothing is deleted — the owner keeps it and can share it again.
- **Co-drive.** A teammate co-attaches to your running session; their
  messages execute on **your** machine. Great for pairing or handing the
  keyboard to a domain expert mid-investigation.

  ```bash
  omnigent attach <session_id>
  ```

- **Fork.** Clone a conversation onto your own machine and continue
  independently from the fork point.

  ```bash
  omnigent run --fork <session_id>
  ```

> [!TIP]
> Want your team to sign in with the logins they already have (**Google,
> GitHub, Okta, Microsoft**)? Set `OMNIGENT_OIDC_ISSUER` plus a client ID
> and secret on your deployed server and restart. The full walkthrough,
> domain allowlists, and the proxy-only `header` auth mode are covered in
> [`deploy/README.md#auth`](https://github.com/omnigent-ai/omnigent/blob/main/deploy/README.md#auth).

### 6. Govern your agents with policies

**Policies** decide what an agent may do: run shell commands, edit files,
spend tokens. They check every action and either allow it, block it, or pause
to ask you first.

- **In the web UI**: open a session's info panel to browse the available
  policies and toggle them on or off.
- **In chat**: ask. *"Add a policy that asks me before running shell
  commands."* The agent sets it up for you.

Want defaults that apply to everyone, or to a specific agent? Define them in
your server config or an agent's YAML:

```yaml
policies:
  approve_shell:
    type: function
    handler: omnigent.policies.builtins.safety.ask_on_os_tools   # ask before shell / file writes
  cap_calls:
    type: function
    handler: omnigent.policies.builtins.safety.max_tool_calls_per_session
    factory_params:
      limit: 50                    # cap how many tools one session can call
  budget:
    type: function
    handler: omnigent.policies.builtins.cost.cost_budget
    factory_params:
      max_cost_usd: 5.00           # hard spend cap...
      ask_thresholds_usd: [3.00]   # ...with a soft warning on the way
```

Policies stack across three levels, **server-wide** (admin), **per-agent**
(developer), and **per-session** (you), with the stricter session rules
checked first. Spend caps and access limits ship as builtins.

See the [policy guide](https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md) for the full catalog and trust model.

---

## Write your own agent

For centrally managed remote tools, reusable account connections, and a gateway
with session policies around built-in or external backends, see the
[MCP registry and gateway prototype](examples/mcp-registry/README.md).
Direct MCP requests use the caller's connected account. A shared session's runner
uses its authenticated account (normally the owner), while policies evaluate the
turn's initiating user. Databricks connections ask for a workspace URL before
OAuth. KMS limits serialized grants to 4096 bytes; use Vault for larger grants.

An agent is a short YAML file: your prompt, your tools — local Python
functions, MCP servers, and sub-agents a supervisor can delegate to. You don't
have to write it by hand: agents can build agents, so describe the agent you
want in any Omnigent chat and it authors the file for you.

```yaml
name: my_agent
prompt: You are a helpful data analyst.

executor:
  harness: claude-sdk          # or: claude-native, codex, codex-native, cursor,
                               # cursor-native, hermes, hermes-native, opencode,
                               # pi, pi-native, openai-agents

tools:
  # A local Python function (schema auto-generated from the signature)
  word_count:
    type: function
    callable: mypackage.mymodule.word_count

  # Tools from an MCP server (a local command, or a remote URL)
  docs:
    type: mcp
    url: https://example.com/mcp

  # A sub-agent the supervisor can delegate to
  researcher:
    type: agent
    prompt: Search for relevant information and summarize it.
    tools:
      word_count: inherit
```

Run it with:

```bash
omnigent run path/to/my_agent.yaml
```

The same file can declare sub-agents and reviewers. For a fuller example, see
Polly at [`examples/polly/`](https://github.com/omnigent-ai/omnigent/tree/main/examples/polly/), and the
[Agent YAML spec](https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md) for the full schema.

---

## Telemetry

Omnigent collects anonymized usage data (telemetry) by default. This data
contains no sensitive or personally identifiable information. If you're using
Omnigent through a managed service or distribution, please consult your managed
service agreement to determine any data collection that may impact your use of
the service. To opt out, follow our instructions in
[Usage Telemetry](https://omnigent.ai/docs/deploy/telemetry).

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](https://github.com/omnigent-ai/omnigent/blob/main/CONTRIBUTING.md) for how to set up your environment, run the checks, and open a pull request.

Adding or changing support for a harness (Claude, Codex, Cursor, OpenCode,
Hermes, Pi, ...)? Run the [harness test bench](https://github.com/omnigent-ai/omnigent/tree/main/tests/harness_bench)
to check its capability matrix against observed behavior.


### Contributors

Thanks to all of our amazing contributors!

<a href="https://github.com/omnigent-ai/omnigent/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=omnigent-ai/omnigent" />
</a>
