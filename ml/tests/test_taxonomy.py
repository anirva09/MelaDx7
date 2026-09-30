from __future__ import annotations

import pytest

from ml.taxonomy import ClassTaxonomy, TaxonomyError

from .conftest import HAM_CLASSES


def test_ham10000_taxonomy_loads() -> None:
    taxonomy = ClassTaxonomy.from_yaml(HAM_CLASSES)
    assert taxonomy.dataset_id == "HAM10000"
    assert taxonomy.codes == ["akiec", "bcc", "bkl", "df", "mel", "nv", "vasc"]
    concern = [taxonomy.classes[i].code for i in taxonomy.concern_indices()]
    assert concern == ["akiec", "bcc", "mel"]


def test_round_trip() -> None:
    taxonomy = ClassTaxonomy.from_yaml(HAM_CLASSES)
    assert ClassTaxonomy.from_dict(taxonomy.to_dict()) == taxonomy


@pytest.mark.parametrize(
    "classes, message",
    [
        ([{"index": 0, "code": "a", "name": "A"}, {"index": 2, "code": "b", "name": "B"}], "indices"),
        ([{"index": 0, "code": "a", "name": "A"}, {"index": 1, "code": "a", "name": "B"}], "duplicate"),
        (
            [
                {"index": 0, "code": "a", "name": "A", "group": "scary"},
                {"index": 1, "code": "b", "name": "B"},
            ],
            "group",
        ),
        ([{"index": 0, "code": "../x", "name": "A"}, {"index": 1, "code": "b", "name": "B"}], "alphanumeric"),
        ([{"index": 0, "code": "a", "name": "A"}], "two classes"),
    ],
)
def test_invalid_taxonomies_rejected(classes: list[dict[str, object]], message: str) -> None:
    with pytest.raises(TaxonomyError, match=message):
        ClassTaxonomy.from_dict({"dataset_id": "x", "classes": classes})
