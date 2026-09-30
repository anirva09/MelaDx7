"""Create an UNTRAINED model artifact for pipeline verification only.

This writes a correctly structured artifact whose weights are randomly initialised
(seeded). Its predictions are meaningless. It exists so developers can exercise
the full upload -> inference -> Grad-CAM -> storage -> report path before a real
model has been trained.

Safeguards:
* the model card has ``"trained": false``;
* the backend refuses to load it unless ``ALLOW_UNTRAINED_MODEL=true``, which is
  rejected when ``ENVIRONMENT=production``;
* the UI and PDF reports display a prominent "untrained model" warning.

Usage::

    python -m ml.scripts.create_untrained_artifact --output models/dev-untrained
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import torch

from ml.inference.artifact import ModelCard, save_model_card, save_weights, utc_now_iso
from ml.models import build_model, get_spec
from ml.preprocessing import PreprocessingSpec
from ml.taxonomy import ClassTaxonomy

DEFAULT_CLASSES = Path(__file__).resolve().parents[1] / "configs" / "classes" / "ham10000.yaml"


def create_untrained_artifact(
    output: Path,
    *,
    architecture: str = "efficientnet_b0",
    classes_file: Path = DEFAULT_CLASSES,
    seed: int = 0,
) -> Path:
    torch.manual_seed(seed)
    spec = get_spec(architecture)
    taxonomy = ClassTaxonomy.from_yaml(classes_file)
    model = build_model(architecture, taxonomy.num_classes, pretrained=False)
    sha = save_weights(model, output)
    card = ModelCard(
        architecture=architecture,
        display_name=spec.display_name,
        version="0.0.0-untrained",
        trained=False,
        created_at=utc_now_iso(),
        taxonomy=taxonomy,
        preprocessing=PreprocessingSpec(input_size=spec.default_input_size),
        weights_sha256=sha,
        temperature=1.0,
        dataset={"note": "No training data. Randomly initialised weights."},
        training={"note": "Not trained. For pipeline verification only.", "seed": seed},
        explainability={"method": "grad-cam", "target_layer": spec.gradcam_layer_name},
        notes="UNTRAINED - randomly initialised weights. Predictions and heatmaps are meaningless.",
    )
    save_model_card(card, output)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--output", type=Path, default=Path("models/dev-untrained"))
    parser.add_argument("--architecture", default="efficientnet_b0")
    parser.add_argument("--classes", type=Path, default=DEFAULT_CLASSES)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args(argv)
    out = create_untrained_artifact(
        args.output, architecture=args.architecture, classes_file=args.classes, seed=args.seed
    )
    print(f"Untrained pipeline-verification artifact written to {out}")
    print("Predictions from this artifact are meaningless. Never use it for evaluation or demos of accuracy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
