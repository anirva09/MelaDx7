# Dataset

## What was used

The **HAM10000** collection exported from the ISIC Archive (Tschandl, Rosendahl and Kittler,
*Sci. Data* 5, 180161, 2018; https://doi.org/10.7910/DVN/DBW86T; licence **CC BY-NC**,
non-commercial use, attribution required). The export has 11,720 dermoscopic JPEG images and a
`metadata.csv` in the ISIC Archive format (`isic_id`, `lesion_id`, `diagnosis_1..3`, ...).

Audit of that export, before any training:

| Check | Result |
|---|---|
| Images vs. metadata rows | 11,720 = 11,720, no image without a row, no row without an image |
| Duplicate image IDs / duplicate files (SHA-256) | none |
| Unreadable or corrupt images | none |
| Missing `lesion_id` | none (8,838 distinct lesions) |
| Original HAM10000 training release | IDs ISIC_0024306 to ISIC_0034320 = 10,015 images, per-class counts identical to the published release (nv 6705, mel 1113, bkl 1099, bcc 514, akiec 327, vasc 142, df 115) |
| Additional images | 1,705 (the ISIC 2018 Task 3 validation and test images) |
| Excluded | `ISIC_0035068`: flagged `synthetic` in the metadata. No synthetic image is used anywhere |

**Images used: 11,719** in 7 classes.

## Label mapping

The ISIC Archive re-annotates the seven HAM10000 categories as a diagnosis hierarchy.
`ml.datasets.prepare_ham10000` detects that format and maps it (`ISIC_ARCHIVE_DX`):

| Archive diagnosis | Code |
|---|---|
| Nevus | nv |
| Melanoma, NOS | mel |
| Pigmented benign keratosis | bkl |
| Basal cell carcinoma | bcc |
| Squamous cell carcinoma, NOS + Solar or actinic keratosis | akiec |
| Dermatofibroma | df |
| Benign soft tissue proliferations - Vascular | vasc |

The akiec mapping (the archive splits HAM10000's "actinic keratoses and intraepithelial
carcinoma" into two diagnoses) is the one non-trivial decision; it reproduces the published
327 akiec images on the original release (197 + 130). An unknown diagnosis stops the script.

## Split

Grouped by `lesion_id` (several images show one lesion), stratified by class, seed 42,
`StratifiedGroupKFold`, so no lesion appears in more than one split. The script fails if
leakage is detected or if identical files carry different lesions or labels.

| Split | Images | Lesions | akiec | bcc | bkl | df | mel | nv | vasc |
|---|---|---|---|---|---|---|---|---|---|
| train | 8,369 | 6,311 | 270 | 444 | 955 | 114 | 932 | 5525 | 129 |
| validation | 1,675 | 1,263 | 54 | 89 | 191 | 23 | 187 | 1105 | 26 |
| test | 1,675 | 1,263 | 54 | 89 | 192 | 23 | 186 | 1106 | 25 |
| **Total** | **11,719** | | 378 | 622 | 1338 | 160 | 1305 | 7736 | 180 |

The split is reproducible: `data/processed/split_manifest.csv` (image, lesion, class, split)
and `split_summary.json` are written next to the images.

## Reproduce

```bash
python -m ml.datasets.prepare_ham10000 \
  --metadata path/to/metadata.csv --images path/to/ISIC-images --output data/processed
```

The same command accepts the original Harvard Dataverse layout (`HAM10000_metadata.csv` with
`image_id`, `dx`, `lesion_id`). **No image or weights file derived from this data is committed
to git**; `data/` and `models/` are ignored.

## Known weaknesses of the data

Few centres, predominantly lighter skin types, a large majority of nevi (66%), and one or a few
images for most lesions. Labels come from histopathology (53%), serial imaging, expert consensus
and confocal microscopy, so they are not all equally certain.
