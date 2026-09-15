"""Synthetic test pixels only; never production content."""
import hashlib, importlib.util, json, tempfile, unittest, zipfile
from pathlib import Path
from PIL import Image, ImageCms

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare_assets',ROOT/'scripts/prepare-assets.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class AssetTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.source=self.root/'synthetic-test.png'
        image=Image.new('RGB',(120,80),(80,100,120))
        exif=Image.Exif();exif[0x010E]='PRIVATE_TEST_METADATA'
        image.save(self.source,exif=exif)
    def tearDown(self):self.temp.cleanup()
    def test_untagged_requires_explicit_color_assertion(self):
        with self.assertRaisesRegex(ValueError,'No usable ICC profile'):
            module.prepare(self.source,'fixture',self.root/'out',[60,240])
    def test_original_is_unchanged_and_approval_remains_false(self):
        before=hashlib.sha256(self.source.read_bytes()).hexdigest()
        manifest=module.prepare(self.source,'fixture',self.root/'out',[60,240],True)
        self.assertEqual(before,hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertFalse(manifest['fixture']['approved'])
    def test_dimensions_do_not_upscale_and_private_metadata_is_removed(self):
        manifest=module.prepare(self.source,'fixture',self.root/'out',[60,240],True)['fixture']
        self.assertEqual(manifest['width'],120);self.assertEqual(manifest['height'],80)
        self.assertEqual([s['width'] for s in manifest['sources']],[60,120])
        for image_path in (self.root/'out').glob('*.webp'):
            with Image.open(image_path) as im:
                self.assertNotIn('exif',im.info)
                self.assertNotIn('xmp',im.info)
                self.assertIn('icc_profile',im.info)
    def test_existing_derivatives_cannot_be_overwritten(self):
        module.prepare(self.source,'fixture',self.root/'out',[60,240],True)
        with self.assertRaisesRegex(ValueError,'already exist'):
            module.prepare(self.source,'fixture',self.root/'out',[60,240],True)
    def test_alpha_and_embedded_color_profile(self):
        source=self.root/'rgba.png';profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
        Image.new('RGBA',(100,60),(60,100,120,80)).save(source,icc_profile=profile.tobytes())
        module.prepare(source,'alpha-fixture',self.root/'alpha-out',[50,100])
        for file in (self.root/'alpha-out').glob('*.webp'):
            with Image.open(file) as im:
                self.assertEqual(im.mode,'RGBA');self.assertEqual(im.getpixel((0,0))[3],80)

class BarAndDerivativeTests(unittest.TestCase):
    """Synthetic frames only: letterbox/pillarbox trimming, alpha, idempotence, logos."""
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def frame(self,size=(400,240),bars=(0,0,0,0),dark_left=0):
        image=Image.new('RGB',size,(0,0,0));l,t,r,b=bars
        inner=Image.new('RGB',(size[0]-l-r,size[1]-t-b),(120,90,60))
        if dark_left: inner.paste((3,3,3),(0,0,dark_left,inner.height))  # dark picture content, not a bar
        image.paste(inner,(l,t));return image
    def test_symmetric_pillarbox_and_letterbox_are_removed(self):
        self.assertEqual(module.detect_bars(self.frame(bars=(20,0,20,0))),[20,0,380,240])
        self.assertEqual(module.detect_bars(self.frame(bars=(0,15,0,15))),[0,15,400,225])
    def test_dark_content_on_one_side_is_not_mistaken_for_a_bar(self):
        box=module.detect_bars(self.frame(bars=(20,0,20,0),dark_left=60))
        self.assertEqual(box,[20,0,380,240])  # symmetric rule keeps the dark picture area
        self.assertEqual(module.detect_bars(self.frame(dark_left=80)),[0,0,400,240])
    def test_thin_screenshot_edges_are_trimmed_per_side(self):
        self.assertEqual(module.detect_bars(self.frame(bars=(0,3,0,0))),[0,3,400,240])
    def test_crop_opaque_alpha_and_idempotent_reuse(self):
        source=self.root/'capture.png';profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
        self.frame(bars=(0,20,0,20)).convert('RGBA').save(source,icc_profile=profile.tobytes())
        crop=module.detect_bars(Image.open(source))
        first=module.prepare(source,'still',self.root/'web',[100,400],crop=crop)['still']
        self.assertEqual((first['width'],first['height']),(400,200))
        for file in (self.root/'web').glob('*.webp'):
            with Image.open(file) as im: self.assertEqual(im.mode,'RGB')  # fully opaque alpha dropped
        again=module.prepare(source,'still',self.root/'web',[100,400],crop=crop,exist_ok=True)['still']
        self.assertEqual(first,again)
        with self.assertRaisesRegex(ValueError,'outside'):
            module.prepare(source,'bad',self.root/'web',[100],crop=[0,0,999,999])
    def test_different_crop_gets_a_different_derivative_name(self):
        source=self.root/'a.png';profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB'))
        self.frame().save(source,icc_profile=profile.tobytes())
        a=module.prepare(source,'x',self.root/'web',[100],crop=[0,0,400,240])['x']['src']
        b=module.prepare(source,'x',self.root/'web',[100],crop=[0,10,400,230])['x']['src']
        self.assertNotEqual(a,b)
    def test_logo_is_lossless_and_keeps_transparency(self):
        source=self.root/'logo.png';logo=Image.new('RGBA',(300,150),(0,0,0,0))
        logo.paste((255,255,255,255),(50,50,250,100));logo.save(source)
        module.prepare(source,'logo',self.root/'web',[300],assume_srgb=True,lossless=True)
        with Image.open(next((self.root/'web').glob('logo-*-300.webp'))) as im:
            self.assertEqual(im.mode,'RGBA');self.assertEqual(im.getpixel((10,10))[3],0);self.assertEqual(im.getpixel((100,75)),(255,255,255,255))

intake_spec=importlib.util.spec_from_file_location('intake',ROOT/'scripts/intake.py')
intake=importlib.util.module_from_spec(intake_spec);intake_spec.loader.exec_module(intake)

class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.saved=(intake.STAGING,intake.CACHE);intake.STAGING=self.root/'impl/assets/intake/staging';intake.CACHE=self.root/'cache.json'
        (self.root/'drop/Tips Up!').mkdir(parents=True)
        Image.new('RGB',(64,36),(10,20,30)).save(self.root/'drop/Tips Up!/tips 1.jpg')
        Image.new('RGB',(64,36),(90,20,30)).save(self.root/'drop/Tips Up!/tips 2.jpg')
        self.projects=[{'id':'tips-up','slug':'tips-up','title':'Tips Up!'}]
    def tearDown(self):
        intake.STAGING,intake.CACHE=self.saved;self.temp.cleanup()
    def test_archive_duplicates_are_not_restaged_and_new_members_are(self):
        with zipfile.ZipFile(self.root/'drop.zip','w') as zf:
            zf.write(self.root/'drop/Tips Up!/tips 1.jpg','Website/Tips Up!/tips 1.jpg')
            zf.writestr('Website/Babygirl/new still.jpg',(self.root/'drop/Tips Up!/tips 2.jpg').read_bytes()[:-1]+b'\x00')
            zf.writestr('__MACOSX/._junk','x');zf.writestr('../../escape.txt','nope');zf.writestr('/abs/evil.txt','nope')
        inv=intake.scan(self.root,self.projects,intake.Cache(),extract=True)
        report=inv['archives'][0]
        self.assertEqual(report['duplicates'],1);self.assertEqual(report['extracted'],1)
        staged=[p for p in intake.STAGING.rglob('*') if p.is_file()]
        self.assertEqual([p.name for p in staged],['new still.jpg'])
        self.assertFalse((self.root.parent/'escape.txt').exists());self.assertFalse(Path('/abs/evil.txt').exists())
        again=intake.scan(self.root,self.projects,intake.Cache(),extract=True)['archives'][0]
        self.assertEqual(again['extracted'],0)
    def test_code_and_reference_archives_are_skipped(self):
        with zipfile.ZipFile(self.root/'site.zip','w') as zf: zf.writestr('impl/package.json','{}')
        with zipfile.ZipFile(self.root/'design-package.zip','w') as zf: zf.writestr('x/prototype.html','<html>')
        statuses=sorted(a['status'] for a in intake.scan(self.root,self.projects,intake.Cache(),extract=True)['archives'])
        self.assertEqual(statuses,['skipped: contains a code project','skipped: design/reference package'])
    def test_classification_duplicates_and_project_matching(self):
        (self.root/'drop/Collateral').mkdir();(self.root/'drop/Collateral/card.jpg').write_bytes((self.root/'drop/Tips Up!/tips 1.jpg').read_bytes())
        files={f['path']:f for f in intake.scan(self.root,self.projects,intake.Cache(),extract=False)['files']}
        self.assertEqual(files['drop/Tips Up!/tips 1.jpg']['project'],'tips-up')
        self.assertEqual(files['drop/Collateral/card.jpg']['kind'],'private-collateral')
        self.assertEqual(files['drop/Tips Up!/tips 1.jpg']['duplicates'],['drop/Collateral/card.jpg'])
    def test_brand_canvas_centres_the_unaltered_mark(self):
        saved=intake.WEB;intake.WEB=self.root/'web'
        try:
            mark=self.root/'mark.png';m=Image.new('RGBA',(40,80),(0,0,0,0));m.paste((255,255,255,255),(0,0,40,80));m.save(mark)
            out=intake.make_canvas(mark,'icon',[32,64],.5)['icon']
            self.assertEqual((out['width'],out['height']),(64,64))
            with Image.open(self.root/'web'/out['src'].rsplit('/',1)[1]) as im:
                self.assertEqual(im.getpixel((0,0)),(0,0,0));self.assertEqual(im.getpixel((32,32)),(255,255,255))
                solid=im.convert('L').point(lambda v:255 if v>128 else 0)
                self.assertEqual(solid.getbbox(),(24,16,40,48))  # 40x80 mark on a 160px canvas -> 16x32 at 64px, centred, not stretched
        finally: intake.WEB=saved

if __name__=='__main__':unittest.main(verbosity=2)
