# Deployment

## Repository

The production repository is [othaderek/death-drive-site](https://github.com/othaderek/death-drive-site), connected to the `death-drive-site` Cloudflare Pages project. This directory, which contains `package.json`, is the repository root. Keep the parent asset-drop directory outside the repository.

The repository should contain the source, content JSON, optimized images in `assets/web/`, scripts, tests and maintenance documentation. The ignore rules exclude originals, archives, private collateral, local settings, preview builds and test output.

Before committing, inspect the file list and staged changes. Use the repository owner's existing Git author details and a commit message describing the change.

## Publication settings

For each project included in the release:

- Set `status` to `published` and `copyApproved` to `true`.
- Set `approved` to `true` for its selected images in `content/media.json`.
- Publish the parent series when publishing an episode.

In `content/site.json`, check the domain, contact emails, logo, favicon and homepage order. Set `launchApproved` and `brandingApproved` to `true` for the release.

```sh
npm test
npm run release:check
npm run preview
```

Review `dist/` before uploading it. The local `.preview/` directory includes drafts and is not the deployment output.

## Cloudflare Pages

Pushes to `main` automatically start a production deployment. Pages builds the committed source and publishes the resulting `dist/` directory. See the [Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/).

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm run release:check` |
| Build output directory | `dist` |
| Node.js version | 22 (`NODE_VERSION` and `.nvmrc`) |

If the repository contains this project in a subdirectory, use that subdirectory as the root. The output contains an `index.html` for each route, a `404.html`, image assets, a sitemap and `_headers`. No application server is required. See [static HTML deployment](https://developers.cloudflare.com/pages/framework-guides/deploy-anything/).

## Domain cutover

Test the Pages deployment URL first, including direct project links, contact links, YouTube links, mobile navigation and image galleries.

Check the existing Cloudflare project and DNS records before assigning `deathdrivepictures.com` and `www.deathdrivepictures.com`. Add the domains through Pages' custom-domain settings, then follow the DNS instructions Cloudflare provides. Keep `site.domain` aligned with the chosen primary domain and redirect the alternate hostname. See [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Keep the previous deployment available for rollback. Upload only the contents of `dist/`; original assets, source mappings and local reports do not belong in the deployed directory.
