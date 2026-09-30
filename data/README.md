# Data

Nothing in this folder is committed. Two kinds of data live here:

* `raw/` - the dataset exactly as downloaded (e.g. HAM10000).
* `processed/` - the training layout created by `ml.datasets.prepare_ham10000`:

```
data/processed/
  train/<class_code>/*.jpg
  validation/<class_code>/*.jpg
  test/<class_code>/*.jpg
  split_manifest.csv      image_id, lesion_id, dx, split
  split_summary.json      per-split counts, seed, strategy
```

* `uploads/` - images uploaded to the running application (local storage backend).

See `docs/training.md` for download links, licence terms and the exact commands.
