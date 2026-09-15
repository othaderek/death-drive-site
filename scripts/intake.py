#!/usr/bin/env python3
"""Repeatable asset intake for files dropped into the project folder.

    python3 scripts/intake.py           # scan, stage new archives, build missing derivatives, sync media.json, write report
    python3 scripts/intake.py --scan    # inventory and report only; changes no content or derivatives
    python3 scripts/intake.py --prune   # additionally delete derivatives that no mapping references

What it does
- Walks the intake root (content/asset-sources.json -> "intakeRoot", normally the folder
  that contains this implementation). Code projects, build output and design/reference
  packages are recognised and skipped.
- ZIP archives are inspected in place. Members that already exist as loose files (same
  SHA-256) are recorded as duplicates; genuinely new members are extracted with path
  checks into assets/intake/staging/ (Git-ignored). Originals are never moved or edited.
- Every mapped asset in content/asset-sources.json is located by path, or by SHA-256 if it
  was moved/renamed, and turned into web derivatives with scripts/prepare-assets.py.
- content/media.json is synchronised (existing "approved" decisions are preserved).
- docs/ASSET-MAPPING.md records source -> derivative -> page placement, plus unassigned,
  duplicate, private and skipped files. assets/intake/inventory.json holds the full list.

Mapping decisions (which frame belongs to which project, alt text, order, hero) are made
by the maintainer after reviewing the images.
"""
from __future__ import annotations
import argparse, hashlib, importlib.util, io, json, os, re, shutil, sys, unicodedata, zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('prepare_assets', ROOT / 'scripts/prepare-assets.py')
prepare_assets = importlib.util.module_from_spec(spec); spec.loader.exec_module(prepare_assets)
from PIL import Image, ImageOps  # noqa: E402  (prepare-assets already verified Pillow is installed)

CONFIG = ROOT / 'content/asset-sources.json'
MEDIA = ROOT / 'content/media.json'
WEB = ROOT / 'assets/web'
INTAKE = ROOT / 'assets/intake'
STAGING = INTAKE / 'staging'
CACHE = INTAKE / 'cache.json'
INVENTORY = INTAKE / 'inventory.json'
REPORT = ROOT / 'docs/ASSET-MAPPING.md'

RASTER = {'.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.heic', '.heif', '.gif', '.bmp'}
VECTOR = {'.eps', '.ai', '.svg', '.pdf'}
VIDEO = {'.mov', '.mp4', '.m4v', '.mxf', '.avi'}
TEXT = {'.txt', '.md', '.rtf', '.doc', '.docx', '.pages', '.csv'}
IGNORED_FILES = {'.DS_Store', 'Thumbs.db', 'desktop.ini'}
# Implementation folders that are code, content or build output rather than an asset drop.
IMPLEMENTATION_DIRS = {'src', 'scripts', 'tests', 'content', 'docs', 'assets', 'references', 'artifacts',
                       'node_modules', 'dist'}
GENERIC_FOLDERS = {'website', 'ddp-assets', 'ddp assets', '04 finals', 'assets', 'stills', 'images', 'staging', 'export', 'exports'}

def natural_key(value: str):
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r'(\d+)', value)]

def norm(value: str) -> str:
    value = unicodedata.normalize('NFKC', value)
    return re.sub(r'[^a-z0-9]+', '', value.lower())

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''): digest.update(chunk)
    return digest.hexdigest()

def load_json(path: Path, default):
    try: return json.loads(path.read_text())
    except FileNotFoundError: return default

def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')

def is_reference_dir(path: Path) -> bool:
    return 'design-package' in path.name.lower() or any(p.name.endswith('prototype.html') for p in path.glob('*.html'))

def classify(rel: str, suffix: str) -> str:
    lowered = rel.lower()
    if suffix in VIDEO: return 'video'
    if suffix in TEXT: return 'project-information'
    if suffix == '.zip': return 'archive'
    if '/collateral/' in lowered: return 'private-collateral'  # business cards carry personal phone numbers
    if 'brandguide' in lowered.replace(' ', '').replace('_', ''): return 'brand-guide'
    if '/logo suite/' in lowered: return 'brand-logo' if suffix in RASTER else 'brand-master'
    if '/iconography/' in lowered or '/patterns/' in lowered: return 'brand-graphic' if suffix in RASTER else 'brand-master'
    if suffix in RASTER: return 'still'
    if suffix in VECTOR: return 'vector-or-document'
    return 'other'

def project_guess(rel: str, projects: list[dict]) -> tuple[str | None, str | None]:
    folders = [f for f in PurePosixPath(rel).parts[:-1] if f.lower() not in GENERIC_FOLDERS]
    for folder in reversed(folders):
        for project in projects:
            if norm(folder) in {norm(project['title']), norm(project['slug'])}:
                return project['id'], folder
    return None, (folders[-1] if folders else None)

class Cache:
    def __init__(self):
        self.data = load_json(CACHE, {'files': {}, 'archives': {}})
    def file_hash(self, path: Path, key: str) -> str:
        stat = path.stat(); entry = self.data['files'].get(key)
        if entry and entry['size'] == stat.st_size and entry['mtime'] == stat.st_mtime_ns: return entry['sha256']
        value = sha256_file(path)
        self.data['files'][key] = {'size': stat.st_size, 'mtime': stat.st_mtime_ns, 'sha256': value}
        return value
    def save(self): write_json(CACHE, self.data)

def safe_member_path(name: str) -> PurePosixPath | None:
    name = unicodedata.normalize('NFC', name.replace('\\', '/'))
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ('..', '') for part in path.parts) or re.match(r'^[A-Za-z]:', name): return None
    if path.parts and path.parts[0] == '__MACOSX': return None
    if path.name in IGNORED_FILES or path.name.startswith('._'): return None
    return path

def scan(intake_root: Path, projects: list[dict], cache: Cache, extract: bool) -> dict:
    files, archives, skipped = [], [], []
    def rel(path: Path) -> str: return path.relative_to(intake_root).as_posix()
    for current, dirs, names in os.walk(intake_root):
        here = Path(current)
        keep = []
        for d in sorted(dirs):
            full = here / d
            if d.startswith('.') and d != '.':
                continue
            if full == ROOT or here == ROOT and d not in IMPLEMENTATION_DIRS:
                keep.append(d); continue
            if here == ROOT and d in IMPLEMENTATION_DIRS:
                continue
            if (full / 'package.json').exists():
                skipped.append({'path': rel(full), 'reason': 'separate code project'}); continue
            if is_reference_dir(full):
                skipped.append({'path': rel(full), 'reason': 'design/reference package (not production assets)'}); continue
            keep.append(d)
        dirs[:] = keep
        for name in sorted(names, key=natural_key):
            path = here / name
            if name in IGNORED_FILES or name.startswith('._'): continue
            suffix = path.suffix.lower()
            # The implementation's own files are not assets; media or archives dropped beside them are.
            if here == ROOT and suffix not in RASTER | VECTOR | VIDEO | {'.zip'}: continue
            if suffix == '.zip':
                archives.append(path); continue
            files.append({'path': rel(path), 'size': path.stat().st_size, 'sha256': cache.file_hash(path, rel(path)),
                          'kind': classify('/' + rel(path), suffix), 'suffix': suffix, 'origin': 'loose'})
    # Previously staged archive members are part of the inventory too.
    if STAGING.exists():
        for path in sorted(STAGING.rglob('*')):
            if path.is_file() and path.name not in IGNORED_FILES:
                files.append({'path': rel(path), 'size': path.stat().st_size, 'sha256': cache.file_hash(path, rel(path)),
                              'kind': classify('/' + rel(path), path.suffix.lower()), 'suffix': path.suffix.lower(), 'origin': 'staged'})
    known = {f['sha256'] for f in files}
    archive_reports = []
    for archive in archives:
        key = rel(archive); stat = archive.stat()
        report = {'path': key, 'size': stat.st_size, 'status': '', 'members': 0, 'duplicates': 0, 'extracted': 0}
        try:
            with zipfile.ZipFile(archive) as zf:
                names = [i for i in zf.infolist() if not i.is_dir()]
                lowered = [i.filename.lower() for i in names]
                if any(n.endswith('package.json') or n.endswith('.mjs') for n in lowered):
                    report['status'] = 'skipped: contains a code project'; archive_reports.append(report); continue
                if any(n.endswith('prototype.html') for n in lowered) or 'design-package' in archive.name.lower():
                    report['status'] = 'skipped: design/reference package'; archive_reports.append(report); continue
                cached = cache.data['archives'].get(key)
                fresh = not (cached and cached['size'] == stat.st_size and cached['mtime'] == stat.st_mtime_ns)
                member_hashes = {} if fresh else cached['members']
                archive_sha = cached['sha256'] if not fresh else sha256_file(archive)
                target = STAGING / f"{re.sub(r'[^A-Za-z0-9]+', '-', archive.stem).strip('-').lower()}-{archive_sha[:8]}"
                for info in names:
                    member = safe_member_path(info.filename)
                    if member is None:
                        continue
                    report['members'] += 1
                    if info.filename not in member_hashes:
                        digest = hashlib.sha256()
                        with zf.open(info) as handle:
                            for chunk in iter(lambda: handle.read(1 << 20), b''): digest.update(chunk)
                        member_hashes[info.filename] = digest.hexdigest()
                    value = member_hashes[info.filename]
                    if value in known:
                        report['duplicates'] += 1; continue
                    destination = target.joinpath(*member.parts)
                    if not str(destination.resolve()).startswith(str(STAGING.resolve()) + os.sep):
                        continue
                    if extract and not destination.exists():
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        with zf.open(info) as src, destination.open('wb') as dst: shutil.copyfileobj(src, dst)
                        report['extracted'] += 1
                        files.append({'path': rel(destination), 'size': info.file_size, 'sha256': value,
                                      'kind': classify('/' + rel(destination), destination.suffix.lower()),
                                      'suffix': destination.suffix.lower(), 'origin': f'extracted from {key}'})
                    known.add(value)
                cache.data['archives'][key] = {'size': stat.st_size, 'mtime': stat.st_mtime_ns, 'sha256': archive_sha, 'members': member_hashes}
                new = report['members'] - report['duplicates']
                report['status'] = 'all members already present as loose files' if new == 0 else (
                    f"{report['extracted']} new member(s) staged" if extract else f'{new} new member(s) not yet staged (--scan)')
        except zipfile.BadZipFile:
            report['status'] = 'unreadable ZIP'
        archive_reports.append(report)
    by_hash: dict[str, list[str]] = {}
    for f in files:
        by_hash.setdefault(f['sha256'], []).append(f['path'])
        f['project'], f['folder'] = project_guess(f['path'], projects)
    for f in files:
        f['duplicates'] = [p for p in by_hash[f['sha256']] if p != f['path']]
    return {'files': files, 'archives': archive_reports, 'skipped': skipped}

def make_canvas(source: Path, image_id: str, sizes: list[int], scale: float, aspect: tuple[int, int] = (1, 1)) -> dict:
    """Place a white brand mark, unaltered and unstretched, centred on a black canvas.

    Used for the favicon/touch icon (square) and the social preview card (1200x630).
    `scale` is the share of the canvas the mark may occupy in its limiting dimension.
    """
    data = source.read_bytes()
    digest = prepare_assets.derivative_digest(data, [int(scale * 1000), *aspect])
    manifest_path = WEB / f'{image_id}-{digest}.json'
    if manifest_path.exists(): return json.loads(manifest_path.read_text())
    with Image.open(io.BytesIO(data)) as opened:
        mark = ImageOps.exif_transpose(opened).convert('RGBA')
    ratio = aspect[0] / aspect[1]
    width = round(max(mark.width / scale, mark.height / scale * ratio))
    height = round(width / ratio)
    canvas = Image.new('RGBA', (width, height), (0, 0, 0, 255))
    canvas.alpha_composite(mark, ((width - mark.width) // 2, (height - mark.height) // 2))
    canvas = canvas.convert('RGB')
    WEB.mkdir(parents=True, exist_ok=True)
    sources = []
    for size in sorted(sizes):
        dest = WEB / f'{image_id}-{digest}-{size}.png'
        if dest.exists(): raise ValueError(f'Refusing to overwrite {dest.name}')
        canvas.resize((size, round(size / ratio)), Image.Resampling.LANCZOS).save(dest, 'PNG', optimize=True)
        sources.append({'src': '/media/' + dest.name, 'width': size})
    largest = sources[-1]
    manifest = {image_id: {'src': largest['src'], 'width': largest['width'], 'height': round(largest['width'] / ratio), 'sources': sources, 'full': largest['src'], 'approved': False}}
    write_json(manifest_path, manifest)
    return manifest

def locate(entry: dict, intake_root: Path, by_hash: dict[str, str], cache: Cache) -> tuple[Path, str]:
    candidate = intake_root / entry['source']
    if candidate.is_file() and (not entry.get('sha256') or cache.file_hash(candidate, entry['source']) == entry['sha256']):
        return candidate, 'path'
    if entry.get('sha256') in by_hash:
        return intake_root / by_hash[entry['sha256']], 'moved (matched by SHA-256)'
    raise ValueError(f"Source not found for {entry['source']} (sha256 {entry.get('sha256', '?')[:12]})")

def usage_map(projects: list[dict], site: dict) -> dict[str, list[str]]:
    usage: dict[str, list[str]] = {}
    add = lambda media_id, where: usage.setdefault(media_id, []).append(where)
    for p in projects:
        label = f"{p['title']} ({p['status']})"
        if p.get('hero', {}).get('image'): add(p['hero']['image'], f'{label}: hero/card')
        if p.get('hero', {}).get('mobileImage'): add(p['hero']['mobileImage'], f'{label}: mobile hero')
        for index, item in enumerate(p.get('gallery') or [], 1): add(item['image'], f'{label}: gallery {index:02d}')
    if site.get('logo'): add(site['logo'], 'Site header logo')
    if site.get('favicon'): add(site['favicon'], 'Favicon / touch icon')
    if site.get('shareImage'): add(site['shareImage'], 'Social preview for pages without a still')
    for index, pid in enumerate(site.get('featured') or [], 1):
        p = next((x for x in projects if x['id'] == pid), None)
        if p and p.get('hero'): add(p['hero']['image'], f'Homepage featured {index:02d}')
    return usage

def write_report(inventory: dict, config: dict, media: dict, projects: list[dict], site: dict, resolved: dict, stale: list[str], intake_root: Path) -> None:
    usage = usage_map(projects, site)
    mapped_hashes = {e.get('sha256') for e in config['assets'].values()}
    files = inventory['files']
    lines = ['# Asset mapping', '',
             'Generated by `npm run intake` (`scripts/intake.py`). Do not edit by hand: change',
             '`content/asset-sources.json`, `content/projects.json` or `content/site.json`, then rerun intake.', '',
             'Sources are paths relative to the intake root (the folder that contains this implementation). Originals are',
             'never modified. Only derivatives in `assets/web/` referenced by a visible project or the branding are copied into a build.', '',
             '## Summary', '',
             f"- Files inventoried: {len(files)} ({sum(1 for f in files if f['kind']=='still')} stills, "
             f"{sum(1 for f in files if f['kind'].startswith('brand'))} brand files, {sum(1 for f in files if f['kind']=='private-collateral')} private collateral files)",
             f"- Mapped to web media: {len(config['assets'])}",
             f"- Archives: {len(inventory['archives'])}; skipped folders: {len(inventory['skipped'])}", '',
             '## Mapped assets', '', '| Media ID | Source | Pixel operations | Web size | Used in |', '| --- | --- | --- | --- | --- |']
    for media_id, entry in config['assets'].items():
        m = media.get(media_id, {})
        ops = []
        crop = entry.get('crop')
        if crop:
            src = resolved.get(media_id, {}).get('size')
            if src and crop != [0, 0, src[0], src[1]]:
                ops.append(f"trim black bars → {crop[2]-crop[0]}×{crop[3]-crop[1]} (box {','.join(map(str, crop))})")
        ops.append({'icon': 'mark centred, unaltered, on black square', 'share': 'mark centred, unaltered, on black 1200×630 card',
                    'logo': 'lossless; sRGB asserted (pure white mark)'}.get(entry.get('role'), 'ICC → sRGB, downscale only'))
        where = '<br>'.join(usage.get(media_id, ['— not placed']))
        lines.append(f"| `{media_id}` | {entry['source']} | {'; '.join(ops)} | {m.get('width','?')}×{m.get('height','?')} ({len(m.get('sources', []))} widths) | {where} |")
    unassigned = [f for f in files if f['kind'] in ('still', 'brand-logo', 'brand-graphic') and f['sha256'] not in mapped_hashes]
    stills = [f for f in unassigned if f['kind'] == 'still']
    lines += ['', '## Unassigned production candidates', '']
    if stills:
        lines += ['Stills found in the drop that are not yet placed on the site:', '']
        lines += [f"- {f['path']} (folder: {f['folder'] or '—'}; project match: {f['project'] or 'none'})" for f in stills]
    else:
        lines.append('- None. Every supplied still is mapped.')
    brand = [f for f in unassigned if f['kind'] != 'still']
    lines += ['', f'Unused brand variants kept as sources only ({len(brand)}): alternate colourways, badge/secondary/wordmark lockups, iconography and patterns. They remain available; none is needed by the current layout.', '']
    lines += ['## Not for the website', '']
    private = [f['path'] for f in files if f['kind'] == 'private-collateral']
    masters = [f['path'] for f in files if f['kind'] in ('brand-master', 'brand-guide', 'vector-or-document')]
    if private: lines.append(f'- Private collateral (business cards include personal phone numbers; matchbook/stickers are print files): {len(private)} files under `…/Collateral/`. Never published.')
    if masters: lines.append(f'- Print/vector masters and brand guide (EPS/PDF): {len(masters)} files. Used as reference only.')
    other = [f['path'] for f in files if f['kind'] in ('video', 'project-information', 'other')]
    lines += [f'- Needs review (video/text/other): {p}' for p in other]
    folders = {str(PurePosixPath(f['path']).parent) for f in files}
    empty = []
    for folder in sorted({str(PurePosixPath(p).parent) for p in folders} | folders):
        base = intake_root / folder
        if base.is_dir():
            empty += [str(child.relative_to(intake_root)) for child in sorted(base.iterdir())
                      if child.is_dir() and not child.name.startswith('.') and not any(x for x in child.rglob('*') if x.is_file() and x.name not in IGNORED_FILES)]
    lines += [f'- Empty folder (no assets supplied): {p}' for p in sorted(set(empty))]
    lines += ['', '## Archives and skipped folders', '']
    lines += [f"- `{a['path']}`: {a['status']} ({a['members']} members, {a['duplicates']} duplicates of loose files)" for a in inventory['archives']]
    lines += [f"- `{s['path']}/`: {s['reason']}" for s in inventory['skipped']]
    dupes = sorted({tuple(sorted([f['path']] + f['duplicates'])) for f in files if f['duplicates']})
    lines += ['', '## Duplicate files (identical SHA-256)', '']
    lines += [f"- {' = '.join(group)}" for group in dupes] or ['- None among loose/staged files.']
    if stale:
        lines += ['', '## Unreferenced derivatives', '', *[f'- assets/web/{name}' for name in stale], '', 'Run `npm run intake -- --prune` to delete them.']
    REPORT.write_text('\n'.join(lines) + '\n')

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--scan', action='store_true', help='Inventory and report only.')
    parser.add_argument('--prune', action='store_true', help='Delete derivatives no mapping references.')
    args = parser.parse_args()
    config = load_json(CONFIG, {'intakeRoot': '..', 'assets': {}})
    intake_root = (ROOT / config.get('intakeRoot', '..')).resolve()
    projects = load_json(ROOT / 'content/projects.json', [])
    site = load_json(ROOT / 'content/site.json', {})
    media = load_json(MEDIA, {})
    cache = Cache()
    inventory = scan(intake_root, projects, cache, extract=not args.scan)
    cache.save()
    by_hash = {}
    for f in inventory['files']: by_hash.setdefault(f['sha256'], f['path'])
    widths = config.get('widths', {})
    resolved, errors = {}, []
    config_changed = False
    for media_id, entry in config['assets'].items():
        try:
            source, how = locate(entry, intake_root, by_hash, cache)
            with Image.open(source) as im:
                upright = ImageOps.exif_transpose(im); size = list(upright.size)
                if entry.get('crop') == 'auto' and not args.scan:
                    entry['crop'] = prepare_assets.detect_bars(upright); config_changed = True  # recorded, so reruns are reproducible
            resolved[media_id] = {'source': source, 'how': how, 'size': size}
            if args.scan: continue
            role = entry.get('role', 'still')
            if role == 'icon':
                manifest = make_canvas(source, media_id, widths.get('icon', [32, 180, 512]), entry.get('scale', .72))
            elif role == 'share':
                manifest = make_canvas(source, media_id, widths.get('share', [1200]), entry.get('scale', .5), (1200, 630))
            else:
                manifest = prepare_assets.prepare(source, media_id, WEB, widths.get(role, [480, 960, 1440, 1920, 2560]),
                                                  assume_srgb=entry.get('assumeSrgb', False), crop=entry.get('crop'),
                                                  quality=entry.get('quality', 88), lossless=role == 'logo', exist_ok=True)
            generated = manifest[media_id]
            previous = media.get(media_id, {})
            generated['approved'] = previous.get('approved', entry.get('approved', False))
            media[media_id] = generated
        except (ValueError, OSError) as error:
            errors.append(f'{media_id}: {error}')
    referenced = set()
    for m in media.values():
        for url in [m.get('src'), m.get('full'), *[s['src'] for s in m.get('sources', [])]]:
            if url: referenced.add(url.rsplit('/', 1)[-1])
    stale = sorted(p.name for p in WEB.glob('*') if p.is_file() and p.name != '.gitkeep' and p.suffix != '.json' and p.name not in referenced)
    # A derivative manifest is kept while any derivative it describes is still referenced.
    stale += sorted(p.name for p in WEB.glob('*.json') if not any(r.startswith(p.stem + '-') for r in referenced))
    cache.save()
    if args.prune and not args.scan:
        for name in stale: (WEB / name).unlink()
        stale = []
    if not args.scan:
        write_json(MEDIA, dict(sorted(media.items())))
        if config_changed: write_json(CONFIG, config)
    inventory['mapped'] = {mid: {'source': str(r['source'].relative_to(intake_root)), 'located': r['how'], 'sourceSize': r['size']} for mid, r in resolved.items()}
    write_json(INVENTORY, inventory)
    write_report(inventory, config, media, projects, site, resolved, stale, intake_root)
    files = inventory['files']
    print(f"Inventoried {len(files)} files, {len(inventory['archives'])} archive(s); mapped {len(resolved)}/{len(config['assets'])} assets.")
    for archive in inventory['archives']: print(f"  archive {archive['path']}: {archive['status']}")
    unmapped = [f for f in files if f['kind'] == 'still' and f['sha256'] not in {e.get('sha256') for e in config['assets'].values()}]
    if unmapped: print(f'  {len(unmapped)} unassigned still(s) — see docs/ASSET-MAPPING.md')
    moved = [mid for mid, r in resolved.items() if r['how'] != 'path']
    if moved: print(f'  located by hash after a move/rename: {", ".join(moved)}')
    if stale: print(f'  {len(stale)} unreferenced derivative file(s); rerun with --prune to delete')
    print(f'Report: {REPORT.relative_to(ROOT)}' + ('' if args.scan else f' · media: {MEDIA.relative_to(ROOT)}'))
    if errors:
        print('Errors:', *errors, sep='\n  ', file=sys.stderr); raise SystemExit(1)

if __name__ == '__main__':
    main()
