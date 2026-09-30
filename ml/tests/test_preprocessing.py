from __future__ import annotations

import io

import numpy as np
import pytest
import torch
from PIL import Image

from ml.preprocessing import (
    ImageValidationError,
    PreprocessingSpec,
    assess_quality,
    build_eval_transform,
    decode_image,
    preprocess,
    sanitize_for_storage,
    sniff_format,
)

from .conftest import encode, make_image


class TestSniffing:
    def test_known_formats(self, jpeg_bytes: bytes, png_bytes: bytes, rgb_image: Image.Image) -> None:
        assert sniff_format(jpeg_bytes) == "JPEG"
        assert sniff_format(png_bytes) == "PNG"
        assert sniff_format(encode(rgb_image, "WEBP")) == "WEBP"

    def test_unknown_formats(self, rgb_image: Image.Image) -> None:
        assert sniff_format(b"%PDF-1.7 ...") is None
        assert sniff_format(encode(rgb_image, "GIF")) is None
        assert sniff_format(b"") is None


class TestDecode:
    def test_decodes_jpeg_png_webp(self, jpeg_bytes: bytes, png_bytes: bytes, rgb_image: Image.Image) -> None:
        for data in (jpeg_bytes, png_bytes, encode(rgb_image, "WEBP")):
            decoded = decode_image(data)
            assert decoded.image.mode == "RGB"
            assert decoded.image.size == (320, 240)

    def test_rgba_is_flattened_onto_white(self) -> None:
        rgba = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
        decoded = decode_image(encode(rgba, "PNG"))
        assert decoded.image.mode == "RGB"
        assert decoded.image.getpixel((50, 50)) == (255, 255, 255)

    def test_grayscale_converted(self) -> None:
        gray = Image.new("L", (100, 100), 128)
        assert decode_image(encode(gray, "PNG")).image.mode == "RGB"

    def test_exif_orientation_applied(self, rgb_image: Image.Image) -> None:
        exif = Image.Exif()
        exif[0x0112] = 6  # rotate 90 degrees clockwise when displayed
        data = encode(rgb_image, "JPEG", exif=exif)
        decoded = decode_image(data)
        assert decoded.image.size == (240, 320)

    @pytest.mark.parametrize(
        "payload, code",
        [
            (b"", "empty_file"),
            (b"not an image at all", "unsupported_format"),
            (b"%PDF-1.4\n%...", "unsupported_format"),
        ],
    )
    def test_rejects_non_images(self, payload: bytes, code: str) -> None:
        with pytest.raises(ImageValidationError) as err:
            decode_image(payload)
        assert err.value.code == code

    def test_rejects_gif(self, rgb_image: Image.Image) -> None:
        with pytest.raises(ImageValidationError) as err:
            decode_image(encode(rgb_image, "GIF"))
        assert err.value.code == "unsupported_format"

    def test_rejects_truncated_file(self, jpeg_bytes: bytes) -> None:
        with pytest.raises(ImageValidationError) as err:
            decode_image(jpeg_bytes[: len(jpeg_bytes) // 3])
        assert err.value.code == "corrupted_image"

    def test_rejects_corrupted_png(self, png_bytes: bytes) -> None:
        corrupted = bytearray(png_bytes)
        corrupted[60:120] = b"\x00" * 60
        with pytest.raises(ImageValidationError) as err:
            decode_image(bytes(corrupted))
        assert err.value.code == "corrupted_image"

    def test_rejects_too_small(self) -> None:
        with pytest.raises(ImageValidationError) as err:
            decode_image(encode(make_image(40, 300), "PNG"))
        assert err.value.code == "image_too_small"

    def test_rejects_too_many_pixels(self, png_bytes: bytes) -> None:
        with pytest.raises(ImageValidationError) as err:
            decode_image(png_bytes, max_pixels=10_000)
        assert err.value.code == "image_dimensions_too_large"


class TestSanitize:
    def test_strips_metadata_and_is_reproducible(self, rgb_image: Image.Image) -> None:
        exif = Image.Exif()
        exif[0x010F] = "SecretCameraMaker"
        source = decode_image(encode(rgb_image, "JPEG", exif=exif)).image
        stored, decoded = sanitize_for_storage(source)
        assert b"SecretCameraMaker" not in stored
        again = Image.open(io.BytesIO(stored)).convert("RGB")
        assert np.array_equal(np.asarray(again), np.asarray(decoded))

    def test_caps_long_side(self) -> None:
        big = make_image(3000, 1500)
        _, decoded = sanitize_for_storage(big, max_side=1024)
        assert max(decoded.size) == 1024
        assert decoded.size == (1024, 512)


class TestTransforms:
    def test_preprocess_shape_and_normalization(self, rgb_image: Image.Image) -> None:
        spec = PreprocessingSpec(input_size=224)
        tensor = preprocess(rgb_image, spec)
        assert tensor.shape == (1, 3, 224, 224)
        assert tensor.dtype == torch.float32
        white = preprocess(Image.new("RGB", (300, 300), (255, 255, 255)), spec)[0]
        expected = torch.tensor([(1 - m) / s for m, s in zip(spec.mean, spec.std, strict=True)])
        assert torch.allclose(white[:, 0, 0], expected, atol=1e-5)

    def test_eval_transform_is_deterministic(self, rgb_image: Image.Image) -> None:
        transform = build_eval_transform(PreprocessingSpec(input_size=96))
        assert torch.equal(transform(rgb_image), transform(rgb_image))

    def test_rejects_non_rgb(self) -> None:
        with pytest.raises(ValueError):
            preprocess(Image.new("L", (64, 64)), PreprocessingSpec())

    def test_spec_round_trip_and_version_guard(self) -> None:
        spec = PreprocessingSpec(input_size=300)
        assert PreprocessingSpec.from_dict(spec.to_dict()) == spec
        bad = spec.to_dict() | {"version": "9.9"}
        with pytest.raises(ValueError, match="preprocessing version"):
            PreprocessingSpec.from_dict(bad)


class TestQuality:
    def test_dark_flat_image_flagged(self) -> None:
        report = assess_quality(Image.new("RGB", (300, 300), (10, 10, 10)))
        codes = {w.code for w in report.warnings}
        assert {"underexposed", "low_contrast", "possibly_blurred"} <= codes

    def test_small_image_flagged(self) -> None:
        report = assess_quality(make_image(120, 100))
        assert "low_resolution" in {w.code for w in report.warnings}

    def test_textured_image_passes(self, rgb_image: Image.Image) -> None:
        report = assess_quality(rgb_image)
        assert report.warnings == ()
