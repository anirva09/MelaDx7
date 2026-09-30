"""Safe image decoding, validation and sanitisation.

Every image that enters the system - uploads through the API as well as dataset
files during training - goes through :func:`decode_image`, so validation rules
are identical in research and production code paths.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

#: Formats accepted from users, keyed by the Pillow format name.
SUPPORTED_FORMATS: dict[str, str] = {
    "JPEG": "image/jpeg",
    "PNG": "image/png",
    "WEBP": "image/webp",
}

#: Hard cap on decoded pixels; protects against decompression-bomb images.
DEFAULT_MAX_PIXELS = 50_000_000
DEFAULT_MIN_SIDE = 64
#: Stored images are capped at this long side (inference runs on the stored copy).
DEFAULT_STORAGE_MAX_SIDE = 2048


class ImageValidationError(ValueError):
    """An image failed validation. ``code`` is a stable machine-readable reason."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def sniff_format(data: bytes) -> str | None:
    """Identify the container format from magic bytes (never trust the filename)."""
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


@dataclass(frozen=True, slots=True)
class DecodedImage:
    image: Image.Image  # RGB, EXIF orientation applied
    source_format: str
    original_width: int
    original_height: int


def decode_image(
    data: bytes,
    *,
    max_pixels: int = DEFAULT_MAX_PIXELS,
    min_side: int = DEFAULT_MIN_SIDE,
) -> DecodedImage:
    """Decode untrusted bytes into an RGB image, or raise :class:`ImageValidationError`."""
    if not data:
        raise ImageValidationError("empty_file", "The uploaded file is empty.")

    fmt = sniff_format(data)
    if fmt is None:
        raise ImageValidationError(
            "unsupported_format",
            "Unsupported file type. Upload a JPEG, PNG or WebP image.",
        )

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            probe = Image.open(io.BytesIO(data))
            if probe.format != fmt:
                raise ImageValidationError(
                    "unsupported_format", "File contents do not match a supported image format."
                )
            width, height = probe.size
            if width * height > max_pixels:
                raise ImageValidationError(
                    "image_dimensions_too_large",
                    f"Image is too large ({width}x{height} px). "
                    f"The maximum is {max_pixels // 1_000_000} megapixels.",
                )
            probe.verify()  # structural integrity check; invalidates `probe`

            image = Image.open(io.BytesIO(data))
            image.load()  # full decode - catches truncated pixel data
    except ImageValidationError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageValidationError(
            "image_dimensions_too_large", "Image dimensions exceed the safety limit."
        ) from exc
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError) as exc:
        raise ImageValidationError(
            "corrupted_image", "The image could not be decoded. It may be corrupted or truncated."
        ) from exc

    if getattr(image, "is_animated", False) and getattr(image, "n_frames", 1) > 1:
        raise ImageValidationError("animated_image", "Animated images are not supported.")

    oriented: Image.Image = ImageOps.exif_transpose(image) or image
    rgb = to_rgb(oriented)
    if min(rgb.size) < min_side:
        raise ImageValidationError(
            "image_too_small",
            f"Image is too small ({rgb.width}x{rgb.height} px). Both sides must be at least {min_side} px.",
        )
    return DecodedImage(image=rgb, source_format=fmt, original_width=width, original_height=height)


def to_rgb(image: Image.Image) -> Image.Image:
    """Convert any mode to RGB; transparency is flattened onto white."""
    if image.mode == "RGB":
        return image
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return image.convert("RGB")


def sanitize_for_storage(
    image: Image.Image,
    *,
    max_side: int = DEFAULT_STORAGE_MAX_SIDE,
    quality: int = 95,
) -> tuple[bytes, Image.Image]:
    """Re-encode an RGB image as metadata-free JPEG.

    Returns the encoded bytes *and* the image decoded back from those bytes.
    Inference must run on the returned image so that any stored analysis can be
    reproduced exactly from the stored file. EXIF (including GPS and device data)
    is dropped because the image is rebuilt from pixel data only.
    """
    work = image
    if max(work.size) > max_side:
        work = work.copy()
        work.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    work.save(buffer, format="JPEG", quality=quality, subsampling=0, optimize=True)
    encoded = buffer.getvalue()
    decoded = Image.open(io.BytesIO(encoded))
    decoded.load()
    return encoded, decoded.convert("RGB")


def encode_png(image: Image.Image) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def load_image_file(path: str) -> Image.Image:
    """Load a dataset image from disk with the same validation as uploads."""
    with open(path, "rb") as handle:
        return decode_image(handle.read()).image
