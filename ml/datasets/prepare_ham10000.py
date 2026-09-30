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

Outputs ``data/processed/{train,validation,test}/<dx>/<image_id>.jpg`` plus a
``split_manifest.csv`` and ``split_summary.json`` for reproducibility. The split is
grouped by ``lesion_id`` (see :mod:`ml.datasets.splits`).
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
from collections import Counter
from pathlib import Path

from ml.datasets.splits import grouped_stratified_split
from ml.taxonomy import ClassTaxonomy

DEFAULT_CLASSES = Path(__file__).resolve().parents[1] / "configs" / "classes" / "ham10000.yaml"
REQUIRED_COLUMNS = {"lesion_id", "image_id", "dx"}


def read_metadata(path: Path) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"metadata file is missing columns: {sorted(missing)}")
        return [dict(row) for row in reader]


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
    rows = read_metadata(args.metadata)
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
