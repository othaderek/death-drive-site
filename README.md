# Death Drive Pictures

Website for Death Drive Pictures: films, series, music videos, project galleries, viewing links and contact information. Built with static HTML, CSS and JavaScript, with a dependency-free Node.js build.

## Local development

Requires Node.js 22 or later. Run from this directory; no dependency installation is needed for the website build.

```sh
npm run dev
```

Open <http://127.0.0.1:4321>. Refresh after content or stylesheet changes. Restart the server after changing the page templates or build scripts.

The local preview includes draft projects. To use another port, run `npm run dev -- --port 4323`.

### View on another device

Connect both devices to the same local network. Start the server with `--host` set to this computer's Wi-Fi IPv4 address and choose a port. For example:

```sh
npm run dev -- --host 192.168.1.100 --port 4324
```

Replace the example address with the computer's actual address, then open that address and port on the other device using `http://`. Keep the computer awake while the server is running.

## Content and source

| Location | Contents |
| --- | --- |
| `content/site.json` | Company copy, ordered contact emails, social links and homepage order |
| `content/projects.json` | Project titles, descriptions, credits, viewing links and image selections |
| `content/media.json` | Image dimensions, responsive versions and publication settings |
| `content/asset-sources.json` | Source-image mappings and crop settings |
| `assets/web/` | Optimized images used by the website |
| `src/` | Page templates, styles, interactions and content validation |
| `scripts/` | Build, preview and image-intake tools |
| `tests/` | Content, build, interaction and image tests |

Original images, archives, local settings and test reports are excluded from version control. The image-intake tools need Python 3 and Pillow; the website build does not.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Serve the local preview with draft projects |
| `npm run build:review` | Build the local preview in `.preview/` |
| `npm run build` | Build published content in `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm test` | Run content, build and carousel tests |
| `npm run test:images` | Run image-processing tests |
| `npm run check` | Validate content and build `dist/` |
| `npm run release:check` | Check publication settings and build `dist/` |
| `npm run intake:scan` | Inventory source assets |
| `npm run intake` | Process mapped source images |

## Publishing

Cloudflare Pages should build this directory with `npm run release:check` and publish `dist/`. Draft projects and unapproved media are excluded from that output.

See [content maintenance](docs/MAINTENANCE.md), [asset processing](docs/ASSETS.md), [deployment](docs/DEPLOYMENT.md) and [site status](docs/COMPLETION.md).
