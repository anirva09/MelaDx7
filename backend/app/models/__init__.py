"""ORM models.

Entity relationships::

    users 1---* analyses 1---* predictions *---1 model_versions
      |                           |
      *                           1---* prediction_scores   (one row per class)
    refresh_tokens

* An **analysis** is one uploaded image and its context (owner, stored file, image
  properties, quality checks).
* A **prediction** is the output of one specific model version for that image. An
  analysis may be re-run with a newer model, producing a new prediction while the
  earlier one stays in history - this is what makes results reproducible.
* **prediction_scores** stores the full probability distribution, one row per class.
  ``predictions.predicted_class_code`` and ``confidence`` duplicate the top row on
  purpose, so history filtering/sorting is a single indexed lookup.
* **model_versions** snapshots the model card (classes, preprocessing, calibration),
  so old results always render with the class names of the model that produced them.
"""

from app.models.analysis import Analysis, Prediction, PredictionScore
from app.models.model_version import ModelVersion
from app.models.user import ROLE_ADMIN, ROLE_USER, RefreshToken, User

__all__ = [
    "ROLE_ADMIN",
    "ROLE_USER",
    "Analysis",
    "ModelVersion",
    "Prediction",
    "PredictionScore",
    "RefreshToken",
    "User",
]
