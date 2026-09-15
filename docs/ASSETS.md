# Assets

## Source and website images

Original files are stored in `DDP-ASSETS/` or the parent asset-drop directory. They are excluded from version control. The website uses optimized files from `assets/web/`.

| Project | Images |
| --- | ---: |
| Domestic | 9 |
| Babygirl | 9 |
| The Executive Assistant | 8 |
| Tips Up! | 11 |
| No Fly List | 9 |
| Wakelee — Bangkok | 6 |
| Wakelee — Gary's Outcome | 5 |
| Midnight Programming | 1 title artwork |

The company logo, monogram favicon and social preview come from the supplied logo suite. Our Father has no image assigned.

## Intake

Map source files in `content/asset-sources.json`, then run:

```sh
npm run intake:scan
npm run intake
```

The scan inventories new, duplicate and unassigned files. Intake locates mapped sources by path or SHA-256, writes missing image versions and updates `content/media.json`. Local inventory and placement reports are excluded from version control.

Originals are not edited. Image preparation converts embedded color profiles to sRGB, removes recorded letterbox or pillarbox borders and creates smaller WebP versions. It does not upscale images or apply visual effects. Title artwork keeps its full composition. The image metadata includes dimensions and crop coordinates.

## Placement

`content/projects.json` controls gallery order, cover selections, focal points and image descriptions. The first gallery image spans the desktop layout. Homepage and collection covers use the selected focal point; galleries preserve the full frame.

Logo minimum width is 144 px. The site uses system fonts; the supplied brand-font files are not distributed.

## Version control and deployment

Track `assets/web/` and the content JSON needed to build the site. Keep archives, originals, business-card collateral and local reports outside the repository. Only `dist/` is deployed.
