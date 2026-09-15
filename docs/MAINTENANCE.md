# Content maintenance

## Add a real film

Add an object to `content/projects.json`. Begin as a draft and replace the example values with the project's details.

```json
{
  "id": "your-film",
  "slug": "your-film",
  "kind": "film",
  "title": "Your approved title",
  "format": "Short film",
  "status": "draft",
  "copyApproved": false,
  "logline": "Your approved logline.",
  "hero": {
    "image": "your-film-lead",
    "alt": "An accurate description of the actual frame.",
    "desktopPosition": "50% 45%"
  },
  "gallery": [
    {"image": "your-film-lead", "alt": "An accurate description of the actual frame."}
  ],
  "links": []
}
```

Register each still in `content/asset-sources.json` (media ID → source path, SHA-256, `"crop": "auto"` or an explicit box) and run `npm run intake`: it writes the derivatives to `assets/web/` and the manifest to `content/media.json`, and regenerates `docs/ASSET-MAPPING.md`. Only set `media.approved: true` after approving the actual image, its project assignment, and its release/publication rights; intake preserves that decision on reruns.

A public project requires `status: "published"` and `copyApproved: true`. Draft project pages, titles, hero data and images are excluded from the production build. Do not mark a reference fixture as published; the build rejects `previewOnly` content.

An incomplete draft may be kept in `projects.json`; it is safe to omit missing optional metadata. The local review needs correct image references and alt text for anything it displays.

## Set and reorder the homepage

In `site.json`:

```json
"featured": ["your-film", "your-series"],
"selected": ["your-series", "your-film"]
```

The first published featured project is the initial hero. Other entries are reached manually. Controls disappear when there is only one feature. `selected` determines the below-the-fold ordering; the films/series collection order follows `projects.json`.

On touch screens, swipe left or right across the featured image to advance or go back. Short taps, vertical drags, multi-touch gestures and panning a zoomed page do not advance the carousel. Arrow controls also remain available. There is no automatic cycling.

Change `hero.desktopPosition` to two percentages to move the desktop crop, and `hero.cardPosition` to steer the 16:10 thumbnail used in Selected work and the Films/Series indexes. A deliberately supplied `hero.mobileImage` can select a separate approved crop; optional `mobilePosition` is also available. The default mobile layout preserves the landscape image above the title. All gallery and lightbox images preserve their aspect ratio and complete frame.

## Reorder stills

Reorder the project's `gallery` array. The first item spans the desktop gallery width. Following items share a two-column grid; mobile uses one column. No hand-written page changes are needed.

### Link a film or music video

Add `"watchUrl": "https://youtu.be/VIDEO_ID"` to its entry in `content/projects.json`. This adds a watch link beside the title and makes the first gallery image a video link with a play control. The corner control still opens that first image full screen, and every still remains in the gallery viewer. The destination opens as a normal link without an embedded player. Keep social and other links in the existing `links` array; omit `watchUrl` when no viewing link has been supplied.

## Add a series and an episode

A series uses `kind: "series"` with its own ID, slug, artwork and approved description. An episode uses `kind: "episode"` and `series: "the-parent-series-id"`. Its other content fields match a film. An episode is not exported unless its parent series is also published.

Generated routes:

```text
/films/your-film/
/series/your-series/
/series/your-series/your-episode/
```

No episode numbers, release dates or viewing URLs are inferred. Array order controls presentation without implying a release sequence.

## Add a music video

Music videos use the **Music Videos** navigation section and `/music-videos/` index. Set `kind: "music-video"`, `format: "Music video"`, and the song title as `title`. Supply `artist` for the band name and `artistSlug` for its URL component. For example, Wakelee / Bangkok becomes `/music-videos/wakelee/bangkok/`. IDs include both artist and song (e.g. `wakelee-bangkok`) so different bands can use the same song title.

The index groups videos by artist and sorts songs alphabetically within each artist. Videos without a supplied artist appear after the named artists, without guessing a band name; No Fly List uses `/music-videos/no-fly-list/`. Each song owns its cover, gallery order, alt text, metadata and optional viewing links. It no longer appears in Films, but may still be selected or featured on the homepage.

Keep supplied files organized as `DDP-ASSETS/<Band>/<Song>/`. Original filenames and folders are retained. Register their source mappings and use the normal intake process above. Adding files alone inventories them; creating the project entry and selecting its frames makes its gallery available in review. The same publication settings apply to music videos as films.

## Optional metadata

Supply only approved fields: `year`, `runtime`, `productionStatus`, `credits: [{"role": "…", "name": "…"}]`, and `links: [{"label": "…", "url": "https://…"}]`. Leave unknown fields out. External HTTPS destinations are ordinary links, not automatic player embeds. A missing logline, credit, date or link produces no “undefined” label or fabricated substitute.

## Company content and branding

Edit `site.about` (an array of paragraphs), `site.description`, `site.tagline`, `site.emails`, and `site.links`. Contact emails appear in array order, one per line. Keep `site.emails` empty when no contact address is available.

The logo settings are `site.logo` (Primary, white), `site.favicon` (Monogram on black, 32/180/512 px) and `site.shareImage` (social image for pages without a still). Intake creates these from `DDP Assets/04 Finals/Logo Suite/`. To change a variant, update its entry in `content/asset-sources.json` and rerun intake. The manifest supports SVG, PNG and ICO files. Check SVG files for scripts and external references before using them.

## Validate before publishing

```sh
npm test
npm run check
npm run preview
```

Review the actual imagery, crops, mobile page, copy, metadata, navigation and contact information. Only after explicit publication approval set `site.launchApproved: true` and `site.brandingApproved: true`. Then run `npm run release:check`. This does not deploy; see deployment instructions for a separately authorized launch.
