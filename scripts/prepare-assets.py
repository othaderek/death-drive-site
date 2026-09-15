#!/usr/bin/env python3
"""Create separate web derivatives from an explicitly selected still.

Nothing is published, approved, or inserted into project content automatically.
Originals are never overwritten. Untagged color needs an explicit sRGB assertion.
Optional tool only; the website itself has no Python or Pillow dependency.

scripts/intake.py drives this module for the whole asset drop. The only pixel
operations are: an explicit crop box (used to remove screen-capture letterbox or
pillarbox bars), ICC conversion to sRGB, and Lanczos downscaling. No grading,
sharpening, denoising, grain or generated detail is ever applied.
"""
from __future__ import annotations
import argparse, hashlib, io, json, re, sys
from pathlib import Path
try:
    from PIL import Image, ImageChops, ImageCms, ImageOps
except ImportError:
    raise SystemExit('Install the optional image tool: python3 -m pip install Pillow')

ROOT = Path(__file__).resolve().parents[1]
BAR_MAX_VALUE = 10   # a bar line is essentially pure black...
BAR_MAX_MEAN = 4     # ...and uniform, not merely dark picture content
SMALL_EDGE = 12      # screenshot edge lines may be trimmed per side

def _is_bar(strip: Image.Image) -> bool:
    histogram = strip.histogram()
    total = sum(histogram)
    if sum(v * n for v, n in enumerate(histogram)) / total > BAR_MAX_MEAN: return False
    return sum(histogram[BAR_MAX_VALUE + 1:]) <= total * .005

def _bar_run(strips) -> int:
    run = 0
    for strip in strips:
        if not _is_bar(strip): break
        run += 1
    return run

def detect_bars(image: Image.Image) -> list[int]:
    """Return a crop box [left, top, right, bottom] that removes only uniform black bars.

    Wide bars are removed symmetrically (the smaller side wins), so dark picture
    content at one edge is never mistaken for a pillarbox. Thin screenshot edge
    lines (<= SMALL_EDGE px) are removed per side.
    """
    rgb = image.convert('RGB')
    r, g, b = rgb.split()
    peak = ImageChops.lighter(ImageChops.lighter(r, g), b)  # brightest channel per pixel
    w, h = peak.size
    top = _bar_run(peak.crop((0, i, w, i + 1)) for i in range(h // 4))
    bottom = _bar_run(peak.crop((0, h - 1 - i, w, h - i)) for i in range(h // 4))
    left = _bar_run(peak.crop((i, 0, i + 1, h)) for i in range(w // 4))
    right = _bar_run(peak.crop((w - 1 - i, 0, w - i, h)) for i in range(w // 4))
    def pair(a: int, b: int) -> tuple[int, int]:
        if a > SMALL_EDGE and b > SMALL_EDGE:
            return min(a, b), min(a, b)
        return (a if a <= SMALL_EDGE else 0), (b if b <= SMALL_EDGE else 0)
    top, bottom = pair(top, bottom); left, right = pair(left, right)
    return [left, top, w - right, h - bottom]

def derivative_digest(source_bytes: bytes, crop: list[int] | None) -> str:
    digest = hashlib.sha256(source_bytes)
    if crop: digest.update(('crop:' + ','.join(map(str, crop))).encode())
    return digest.hexdigest()[:10]

def prepare(source: Path, image_id: str, output: Path, widths: list[int], assume_srgb: bool = False,
            crop: list[int] | None = None, quality: int = 88, lossless: bool = False, exist_ok: bool = False) -> dict:
    if not source.is_file(): raise ValueError(f'Missing source: {source}')
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', image_id): raise ValueError('Use a lowercase hyphenated image ID.')
    if any(w < 1 for w in widths): raise ValueError('Widths must be positive.')
    source_bytes = source.read_bytes()
    # A content hash prevents silently overwriting derivatives from another master or crop.
    digest = derivative_digest(source_bytes, crop)
    manifest_path = output / f'{image_id}-{digest}.json'
    if exist_ok and manifest_path.exists():
        return json.loads(manifest_path.read_text())
    with Image.open(io.BytesIO(source_bytes)) as opened:
        if getattr(opened, 'n_frames', 1) != 1: raise ValueError('Animated assets need manual review.')
        profile_bytes = opened.info.get('icc_profile')
        image = ImageOps.exif_transpose(opened).copy()
    if image.mode not in ('RGB','RGBA','CMYK','L','LA','P'):
        raise ValueError(f'{image.mode} is not a supported web-ready still. Export an approved SDR, 8-bit image first.')
    if crop:
        l, t, r, b = crop
        if not (0 <= l < r <= image.width and 0 <= t < b <= image.height):
            raise ValueError(f'Crop box {crop} is outside the {image.width}x{image.height} source.')
        image = image.crop((l, t, r, b))
    has_alpha = image.mode in ('RGBA','LA') or (image.mode == 'P' and 'transparency' in image.info)
    alpha = image.convert('RGBA').getchannel('A') if has_alpha else None
    if alpha is not None and alpha.getextrema() == (255, 255):
        alpha = None  # Fully opaque screen captures do not need an alpha channel.
    source_mode = 'CMYK' if image.mode == 'CMYK' else 'RGB'
    working = image.convert(source_mode)
    srgb = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
    if profile_bytes:
        try:
            source_profile = ImageCms.ImageCmsProfile(io.BytesIO(profile_bytes))
            working = ImageCms.profileToProfile(working, source_profile, srgb, outputMode='RGB', renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC)
        except Exception as error:
            raise ValueError(f'Cannot safely convert the embedded color profile: {error}') from error
        color_note = 'Embedded profile converted to sRGB for web delivery; visually review the derivative.'
    elif assume_srgb and source_mode != 'CMYK':
        working = working.convert('RGB')
        color_note = 'Source was untagged; sRGB explicitly asserted by the operator.'
    else:
        raise ValueError('No usable ICC profile. Confirm an sRGB export; only then use --assume-srgb. Do not guess a CMYK profile.')
    if alpha is not None: working.putalpha(alpha)
    w,h=working.size
    max_width=min(max(widths),w)
    selected=sorted(set([x for x in widths if x<=max_width]+[max_width]))
    plans=[(width, output/f'{image_id}-{digest}-{width}.webp') for width in selected]
    if manifest_path.exists() or any(dest.exists() for _,dest in plans):
        raise ValueError('These derivatives already exist. Review them or choose a new output directory; originals and derivatives are never overwritten.')
    output.mkdir(parents=True,exist_ok=True)
    sources=[]
    for width,dest in plans:
        resized=working.resize((width,max(1,round(h*width/w))),Image.Resampling.LANCZOS) if width<w else working.copy()
        # Strip all inherited EXIF/XMP/private metadata, retaining only the new color profile.
        clean=Image.new(resized.mode,resized.size);clean.paste(resized)
        options={'lossless':True,'quality':100,'method':6} if lossless else {'quality':quality,'method':6}
        clean.save(dest,'WEBP',icc_profile=srgb.tobytes(),**options)
        sources.append({'src':'/media/'+dest.name,'width':width})
    manifest={image_id:{'src':sources[-1]['src'],'width':max_width,'height':max(1,round(h*max_width/w)),'sources':sources,'full':sources[-1]['src'],'approved':False}}
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Source preserved: {source.name}',file=sys.stderr)
    print(color_note,file=sys.stderr)
    print(f'Created {len(sources)} WebP derivatives. Approval remains FALSE. Merge {manifest_path.name} into content/media.json after review.',file=sys.stderr)
    return manifest

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source',type=Path);parser.add_argument('--id',required=True)
    parser.add_argument('--output',type=Path,default=ROOT/'assets/web')
    parser.add_argument('--widths',default='480,960,1440,1920,2400')
    parser.add_argument('--assume-srgb',action='store_true')
    parser.add_argument('--trim-bars',action='store_true',help='Remove uniform black letterbox/pillarbox bars only.')
    args=parser.parse_args()
    try:
        widths=[int(w.strip()) for w in args.widths.split(',')]
        crop=None
        if args.trim_bars:
            with Image.open(args.source) as im: crop=detect_bars(ImageOps.exif_transpose(im))
        result=prepare(args.source.resolve(),args.id,args.output.resolve(),widths,args.assume_srgb,crop=crop)
        print(json.dumps(result,indent=2))
    except (ValueError,OSError) as error:
        print(f'Image preparation failed: {error}',file=sys.stderr);raise SystemExit(1)

if __name__=='__main__': main()
