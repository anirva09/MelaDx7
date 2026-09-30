"""Class taxonomy: the single source of truth for label names, order and grouping.

Class names are never hard-coded elsewhere in the code base. Training reads them
from a YAML taxonomy file; the trained model card stores a copy; inference and
the web application read them back from the model card.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml

VALID_GROUPS = ("malignant", "premalignant", "benign", "other")

#: Groups whose probabilities are summed into the derived
#: "malignant or pre-malignant classes combined" readout.
CONCERN_GROUPS = ("malignant", "premalignant")


class TaxonomyError(ValueError):
    """Raised when a class taxonomy definition is invalid."""


@dataclass(frozen=True, slots=True)
class ClassSpec:
    index: int
    code: str
    name: str
    group: str = "other"
    description: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class ClassTaxonomy:
    dataset_id: str
    classes: tuple[ClassSpec, ...]

    # ------------------------------------------------------------------ build
    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> ClassTaxonomy:
        raw_classes = data.get("classes")
        if not isinstance(raw_classes, Sequence) or not raw_classes:
            raise TaxonomyError("taxonomy must define a non-empty 'classes' list")
        specs = []
        for item in raw_classes:
            try:
                spec = ClassSpec(
                    index=int(item["index"]),
                    code=str(item["code"]).strip(),
                    name=str(item["name"]).strip(),
                    group=str(item.get("group", "other")).strip(),
                    description=" ".join(str(item.get("description", "")).split()),
                )
            except (KeyError, TypeError) as exc:  # pragma: no cover - defensive
                raise TaxonomyError(f"invalid class entry {item!r}: {exc}") from exc
            specs.append(spec)
        taxonomy = cls(dataset_id=str(data.get("dataset_id", "unknown")), classes=tuple(specs))
        taxonomy.validate()
        return taxonomy

    @classmethod
    def from_yaml(cls, path: str | Path) -> ClassTaxonomy:
        with open(path, encoding="utf-8") as handle:
            return cls.from_dict(yaml.safe_load(handle))

    @classmethod
    def from_codes(cls, codes: Iterable[str], dataset_id: str = "custom") -> ClassTaxonomy:
        """Build a minimal taxonomy from folder names (used for custom datasets/tests)."""
        specs = tuple(
            ClassSpec(index=i, code=code, name=code.replace("_", " ").title()) for i, code in enumerate(codes)
        )
        taxonomy = cls(dataset_id=dataset_id, classes=specs)
        taxonomy.validate()
        return taxonomy

    # --------------------------------------------------------------- checks
    def validate(self) -> None:
        indices = [c.index for c in self.classes]
        if indices != list(range(len(self.classes))):
            raise TaxonomyError(f"class indices must be 0..{len(self.classes) - 1} in order, got {indices}")
        codes = [c.code for c in self.classes]
        if len(set(codes)) != len(codes):
            raise TaxonomyError(f"duplicate class codes: {codes}")
        for spec in self.classes:
            if not spec.code or not spec.code.replace("_", "").replace("-", "").isalnum():
                raise TaxonomyError(f"class code {spec.code!r} must be alphanumeric (plus _ or -)")
            if spec.group not in VALID_GROUPS:
                raise TaxonomyError(
                    f"class {spec.code!r} has invalid group {spec.group!r}; expected one of {VALID_GROUPS}"
                )
        if len(self.classes) < 2:
            raise TaxonomyError("at least two classes are required")

    # ------------------------------------------------------------ accessors
    @property
    def codes(self) -> list[str]:
        return [c.code for c in self.classes]

    @property
    def num_classes(self) -> int:
        return len(self.classes)

    def index_of(self, code: str) -> int:
        for spec in self.classes:
            if spec.code == code:
                return spec.index
        raise KeyError(code)

    def concern_indices(self) -> list[int]:
        """Indices of classes in malignant / pre-malignant groups."""
        return [c.index for c in self.classes if c.group in CONCERN_GROUPS]

    def to_dict(self) -> dict[str, Any]:
        return {"dataset_id": self.dataset_id, "classes": [c.to_dict() for c in self.classes]}
