"""MelaDx7 machine-learning package.

Sub-packages mirror the model lifecycle:

    datasets -> preprocessing -> models -> training -> evaluation
             -> inference -> explainability

Everything the web backend needs is exposed through :mod:`ml.inference`, so the
network architecture can be swapped (via the model card) without touching the API.
"""

__version__ = "1.0.0"
