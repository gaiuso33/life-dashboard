"""Makes the picture fixtures the photo tests use. Run: python3 e2e/fixtures/make-photos.py (needs Pillow). The results are committed."""
from pathlib import Path
from PIL import Image, ImageDraw

here = Path(__file__).parent

def picture(size, color, stripe):
    im = Image.new('RGB', size, color)
    d = ImageDraw.Draw(im)
    d.rectangle([0, size[1] // 3, size[0], size[1] // 3 * 2], fill=stripe)
    return im

# Bigger than the app keeps (longest side 1280), with the hidden details a phone camera adds: where it was taken and the phone model.
front = picture((2400, 1800), (200, 30, 30), (240, 200, 200))
exif = Image.Exif()
exif[0x010F] = 'TestPhoneMaker'
exif[0x0110] = 'TestPhone 9'
exif.get_ifd(0x8825).update({1: 'N', 2: (6.0, 27.0, 0.0), 3: 'E', 4: (3.0, 23.0, 0.0)})
front.save(here / 'photo-front.jpg', quality=70, exif=exif)

# Portrait, smaller than the limit (must not be enlarged).
picture((600, 800), (30, 60, 200), (200, 210, 250)).save(here / 'photo-side.jpg', quality=70)

# Not a picture, whatever its name says.
(here / 'not-a-photo.jpg').write_text('this is only text, not a picture\n')
