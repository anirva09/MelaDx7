"""Prepare the HAM10000 dataset into the folder layout used for training.

Download HAM10000 yourself from an official source and accept its licence
(CC BY-NC 4.0 - non-commercial use, attribution to Tschandl et al. 2018):

* Harvard Dataverse: https://doi.org/10.7910/DVN/DBW86T
* ISIC Archive collection "HAM10000"

Then run (from the repository root)::

    python -m ml.datasets.prepare_ham10000 \
        --metadata data/raw/HAM10000_metadata.csv \
        --images data/raw/HAM10000_images_part_1 data/raw/HAM10000_images_part_2 \
        --output data/processed

The ISIC Archive export of the HAM10000 collection (``metadata.csv`` with ``isic_id`` and
``diagnosis_1..3`` columns instead of ``image_id`` / ``dx``) is detected automatically and
converted with :data:`ISIC_ARCHIVE_DX`. Synthetic and non-dermoscopic images are excluded.

Outputs ``data/processed/{train,validation,test}/<dx>/<image_id>.jpg`` plus a
``split_manifest.csv`` and ``split_summary.json`` for reproducibility. The split is
grouped by ``lesion_id`` (see :mod:`ml.datasets.splits`).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from ml.datasets.splits import grouped_stratified_split
from ml.taxonomy import ClassTaxonomy

DEFAULT_CLASSES = Path(__file__).resolve().parents[1] / "configs" / "classes" / "ham10000.yaml"
REQUIRED_COLUMNS = {"lesion_id", "image_id", "dx"}


# ISIC Archive re-annotates the seven HAM10000 categories with a diagnosis hierarchy. The
# mapping below reproduces the published HAM10000 class counts on the original 10,015
# training images (nv 6705, mel 1113, bkl 1099, bcc 514, akiec 327, vasc 142, df 115):
# "akiec" (actinic keratoses and intraepithelial carcinoma) is split in the archive into
# "Solar or actinic keratosis" (130) and "Squamous cell carcinoma, NOS" (197).
ISIC_ARCHIVE_DX = {
    "Nevus": "nv",
    "Melanoma, NOS": "mel",
    "Pigmented benign keratosis": "bkl",
    "Basal cell carcinoma": "bcc",
    "Squamous cell carcinoma, NOS": "akiec",
    "Solar or actinic keratosis": "akiec",
    "Dermatofibroma": "df",
}
ISIC_VASCULAR = "Benign soft tissue proliferations - Vascular"
ISIC_COLUMNS = {"isic_id", "lesion_id", "diagnosis_2", "diagnosis_3"}


def convert_isic_archive(
    rows: list[dict[str, str]],
) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    """Convert ISIC Archive metadata rows to ``image_id/lesion_id/dx`` rows.

    Returns ``(usable_rows, excluded)`` where ``excluded`` lists images dropped because
    they are synthetic/manipulated or not dermoscopic.
    """
    usable: list[dict[str, str]] = []
    excluded: list[dict[str, str]] = []
    for row in rows:
        if row.get("image_manipulation") or row.get("image_type", "dermoscopic") != "dermoscopic":
            excluded.append(
                {
                    "image_id": row["isic_id"],
                    "reason": row.get("image_manipulation") or row.get("image_type") or "unknown",
                }
            )
            continue
        d2, d3 = row["diagnosis_2"], row["diagnosis_3"]
        if d2 == ISIC_VASCULAR:
            dx = "vasc"
        elif d3 in ISIC_ARCHIVE_DX:
            dx = ISIC_ARCHIVE_DX[d3]
        else:
            raise SystemExit(f"{row['isic_id']}: unmapped diagnosis {d2!r} / {d3!r}")
        usable.append({"image_id": row["isic_id"], "lesion_id": row["lesion_id"], "dx": dx})
    return usable, excluded


def read_metadata(path: Path) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        fields = set(reader.fieldnames or [])
        rows = [dict(row) for row in reader]
    if fields >= ISIC_COLUMNS:
        return convert_isic_archive(rows)
    missing = REQUIRED_COLUMNS - fields
    if missing:
        raise SystemExit(f"metadata file is missing columns: {sorted(missing)}")
    return rows, []


def check_images(rows: list[dict[str, str]], images: dict[str, Path]) -> dict[str, Any]:
    """Open every image, and find byte-identical files that carry different labels/lesions."""
    from PIL import Image

    corrupt: list[str] = []
    by_hash: dict[str, list[str]] = {}
    for row in rows:
        path = images[row["image_id"]]
        try:
            with Image.open(path) as img:
                img.verify()
        except Exception:  # noqa: BLE001 - any decode failure marks the file unusable
            corrupt.append(row["image_id"])
            continue
        by_hash.setdefault(hashlib.sha256(path.read_bytes()).hexdigest(), []).append(row["image_id"])
    by_id = {r["image_id"]: r for r in rows}
    duplicates = [ids for ids in by_hash.values() if len(ids) > 1]
    conflicting = [
        ids
        for ids in duplicates
        if len({by_id[i]["dx"] for i in ids}) > 1 or len({by_id[i]["lesion_id"] for i in ids}) > 1
    ]
    return {
        "checked": len(rows),
        "corrupt": corrupt,
        "duplicate_file_groups": duplicates,
        "duplicates_with_conflicting_lesion_or_label": conflicting,
    }


def index_images(dirs: list[Path]) -> dict[str, Path]:
    found: dict[str, Path] = {}
    for directory in dirs:
        if not directory.is_dir():
            raise SystemExit(f"image directory not found: {directory}")
        for path in directory.iterdir():
            if path.suffix.lower() in {".jpg", ".jpeg", ".png"}:
                found[path.stem] = path
    return found


def place(src: Path, dst: Path, mode: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() or dst.is_symlink():
        dst.unlink()
    if mode == "symlink":
        os.symlink(src.resolve(), dst)
    elif mode == "hardlink":
        os.link(src, dst)
    else:
        shutil.copy2(src, dst)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--images", type=Path, nargs="+", required=True)
    parser.add_argument("--output", type=Path, default=Path("data/processed"))
    parser.add_argument("--classes", type=Path, default=DEFAULT_CLASSES)
    parser.add_argument("--val-fraction", type=float, default=0.15)
    parser.add_argument("--test-fraction", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--mode", choices=["symlink", "hardlink", "copy"], default="copy")
    args = parser.parse_args(argv)

    taxonomy = ClassTaxonomy.from_yaml(args.classes)
    rows, excluded = read_metadata(args.metadata)
    images = index_images(args.images)

    unknown = {r["dx"] for r in rows} - set(taxonomy.codes)
    if unknown:
        raise SystemExit(f"metadata contains diagnoses not in the taxonomy: {sorted(unknown)}")
    missing = [r["image_id"] for r in rows if r["image_id"] not in images]
    if missing:
        raise SystemExit(
            f"{len(missing)} images listed in the metadata were not found "
            f"(first: {missing[:3]}). Check the --images directories."
        )

    integrity = check_images(rows, images)
    if integrity["corrupt"]:
        raise SystemExit(f"unreadable images: {integrity['corrupt'][:5]} ...")
    if integrity["duplicates_with_conflicting_lesion_or_label"]:
        raise SystemExit(
            "identical files with different lesion/label would leak across splits: "
            f"{integrity['duplicates_with_conflicting_lesion_or_label'][:3]}"
        )
    # identical files of the same lesion are grouped together by lesion_id already

    splits = grouped_stratified_split(
        [r["dx"] for r in rows],
        [r["lesion_id"] for r in rows],
        val_fraction=args.val_fraction,
        test_fraction=args.test_fraction,
        seed=args.seed,
    )

    manifest_rows = []
    summary: dict[str, object] = {
        "dataset_id": taxonomy.dataset_id,
        "seed": args.seed,
        "strategy": "StratifiedGroupKFold grouped by lesion_id",
        "requested_fractions": {"validation": args.val_fraction, "test": args.test_fraction},
        "total_images": len(rows),
        "excluded": excluded,
        "class_counts_total": dict(Counter(r["dx"] for r in rows)),
        "integrity": integrity,
        "splits": {},
    }
    for split_name, indices in splits.items():
        counts: Counter[str] = Counter()
        lesions = set()
        for i in indices:
            row = rows[int(i)]
            src = images[row["image_id"]]
            dst = args.output / split_name / row["dx"] / f"{row['image_id']}{src.suffix.lower()}"
            place(src, dst, args.mode)
            counts[row["dx"]] += 1
            lesions.add(row["lesion_id"])
            manifest_rows.append(
                {
                    "image_id": row["image_id"],
                    "lesion_id": row["lesion_id"],
                    "dx": row["dx"],
                    "split": split_name,
                }
            )
        summary["splits"][split_name] = {  # type: ignore[index]
            "images": len(indices),
            "lesions": len(lesions),
            "fraction": round(len(indices) / len(rows), 4),
            "class_counts": {code: counts.get(code, 0) for code in taxonomy.codes},
        }

    args.output.mkdir(parents=True, exist_ok=True)
    with open(args.output / "split_manifest.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=["image_id", "lesion_id", "dx", "split"])
        writer.writeheader()
        writer.writerows(sorted(manifest_rows, key=lambda r: (r["split"], r["image_id"])))
    (args.output / "split_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
