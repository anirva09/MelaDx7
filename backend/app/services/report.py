"""PDF analysis report (ReportLab).

The report records exactly what the model produced and under which conditions
(model version, weights checksum, preprocessing, calibration, timings), and it
states clearly that it is not a medical diagnosis.
"""

from __future__ import annotations

import io
from datetime import datetime
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from PIL import Image as PILImage
from reportlab.graphics.shapes import Drawing, Rect
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import (
    Image,
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.models import Analysis
from ml.inference import LOW_CONFIDENCE_THRESHOLD, LOW_MARGIN_THRESHOLD

DISCLAIMER = (
    "This AI system provides an assistive prediction and visualization. It is not a medical diagnosis "
    "and should not replace evaluation by a qualified healthcare professional."
)
EXPLAINABILITY_NOTE = (
    "The highlighted regions indicate areas that contributed strongly to the model's prediction. They are "
    "model-attribution visualizations and should not be interpreted as definitive clinical evidence. "
    "Heatmap intensity is normalised per image, so colours are relative within this image only."
)
UNCERTAINTY_TEXT = {
    "low_top_probability": f"Top-class probability is below {LOW_CONFIDENCE_THRESHOLD:.0%}.",
    "small_margin_between_top_classes": (
        f"The top two classes differ by less than {LOW_MARGIN_THRESHOLD:.0%} probability."
    ),
}

INK = colors.HexColor("#17212B")
MUTED = colors.HexColor("#5A6776")
RULE = colors.HexColor("#D5DCE3")
ACCENT = colors.HexColor("#0E6E75")
TINT = colors.HexColor("#F2F5F7")
WARN = colors.HexColor("#9A3412")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["BodyText"]
    return {
        "title": ParagraphStyle(
            "title", parent=base, fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK
        ),
        "subtitle": ParagraphStyle("subtitle", parent=base, fontSize=9, leading=12, textColor=MUTED),
        "h2": ParagraphStyle(
            "h2",
            parent=base,
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=INK,
            spaceBefore=10,
            spaceAfter=5,
        ),
        "body": ParagraphStyle(
            "body", parent=base, fontSize=9, leading=12.5, textColor=INK, alignment=TA_LEFT
        ),
        "small": ParagraphStyle("small", parent=base, fontSize=7.5, leading=10, textColor=MUTED),
        "big": ParagraphStyle(
            "big", parent=base, fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=INK
        ),
        "warn": ParagraphStyle(
            "warn", parent=base, fontName="Helvetica-Bold", fontSize=9.5, leading=13, textColor=WARN
        ),
    }


def _fit_image(data: bytes, max_w: float, max_h: float) -> Image:
    with PILImage.open(io.BytesIO(data)) as probe:
        w, h = probe.size
    scale = min(max_w / w, max_h / h)
    return Image(io.BytesIO(data), width=w * scale, height=h * scale)


def _bar(value: float, width: float = 52 * mm, height: float = 3.2 * mm, highlight: bool = False) -> Drawing:
    drawing = Drawing(width, height)
    drawing.add(Rect(0, 0, width, height, fillColor=TINT, strokeColor=None))
    drawing.add(
        Rect(
            0, 0, max(0.5, width * value), height, fillColor=ACCENT if highlight else MUTED, strokeColor=None
        )
    )
    return drawing


def _kv_table(rows: list[tuple[str, str]], styles: dict[str, ParagraphStyle]) -> Table:
    data = [[Paragraph(k, styles["small"]), Paragraph(v, styles["body"])] for k, v in rows]
    table = Table(data, colWidths=[38 * mm, None], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    return table


def build_report(
    analysis: Analysis,
    images: dict[str, bytes],
    *,
    tz: ZoneInfo,
    generated_at: datetime,
) -> bytes:
    prediction = analysis.latest_prediction
    assert prediction is not None
    mv = prediction.model_version
    lookup = mv.class_lookup()
    styles = _styles()
    untrained = not mv.trained
    buffer = io.BytesIO()

    def decorate(canvas: Canvas, doc: SimpleDocTemplate) -> None:
        canvas.saveState()
        width, height = A4
        if untrained:
            canvas.setFont("Helvetica-Bold", 44)
            canvas.setFillColor(colors.Color(0.8, 0.1, 0.1, alpha=0.08))
            canvas.translate(width / 2, height / 2)
            canvas.rotate(35)
            canvas.drawCentredString(0, 0, "UNTRAINED MODEL")
            canvas.rotate(-35)
            canvas.translate(-width / 2, -height / 2)
        canvas.setStrokeColor(RULE)
        canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(
            18 * mm,
            10 * mm,
            f"Not a medical diagnosis. Generated {generated_at.astimezone(tz):%Y-%m-%d %H:%M %Z} "
            f"for analysis {analysis.id}.",
        )
        canvas.drawRightString(width - 18 * mm, 10 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=16 * mm,
        bottomMargin=20 * mm,
        title=f"MelaDx7 analysis {analysis.id}",
        author="MelaDx7",
        subject="AI-assisted skin lesion analysis",
    )
    story: list[object] = [
        Paragraph("MelaDx7 analysis report", styles["title"]),
        Paragraph(
            "AI-assisted dermoscopic image analysis with Grad-CAM explanation. "
            "For research and clinical decision support only.",
            styles["subtitle"],
        ),
        Spacer(1, 5 * mm),
    ]
    if untrained:
        story += [
            Paragraph(
                "UNTRAINED MODEL: this report was produced by a randomly initialised pipeline-verification "
                "model. The prediction and heatmap carry no meaning.",
                styles["warn"],
            ),
            Spacer(1, 3 * mm),
        ]

    # ------------------------------------------------------------ images
    content_w = A4[0] - 36 * mm
    cell_w = (content_w - 8 * mm) / 3
    tiles, captions = [], []
    for key, caption in (
        ("original", "Original image"),
        ("overlay", "Grad-CAM overlay"),
        ("heatmap", "Grad-CAM heatmap"),
    ):
        if key in images:
            tiles.append(_fit_image(images[key], cell_w, 52 * mm))
            captions.append(Paragraph(caption, styles["small"]))
        else:
            tiles.append(Paragraph("Explanation unavailable for this analysis.", styles["small"]))
            captions.append(Paragraph(caption, styles["small"]))
    grid = Table([tiles, captions], colWidths=[cell_w + 8 * mm / 3] * 3, hAlign="LEFT")
    grid.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story += [grid, Spacer(1, 4 * mm)]

    # ------------------------------------------------------------ result
    predicted = lookup[prediction.predicted_class_index]
    story.append(Paragraph("Model output", styles["h2"]))
    story.append(
        Paragraph(
            f"{escape(predicted['name'])} ({escape(predicted['code'])}) &nbsp; {prediction.confidence:.1%}",
            styles["big"],
        )
    )
    story.append(
        Paragraph(
            "Predicted class and its calibrated model probability. A probability is not a measure of "
            "clinical certainty.",
            styles["small"],
        )
    )
    if prediction.uncertain:
        reasons = " ".join(UNCERTAINTY_TEXT.get(r, r) for r in prediction.uncertainty_reasons)
        story.append(Spacer(1, 2 * mm))
        story.append(Paragraph(f"Uncertain prediction. {reasons}", styles["warn"]))
    concern_codes = ", ".join(
        c["code"] for c in mv.classes if c.get("group") in ("malignant", "premalignant")
    )
    story.append(Spacer(1, 2 * mm))
    story.append(
        Paragraph(
            f"Combined probability of malignant or pre-malignant classes ({concern_codes}): "
            f"<b>{prediction.concern_probability:.1%}</b>. This is a sum of model outputs, not a risk score.",
            styles["body"],
        )
    )

    # ----------------------------------------------------- distribution
    rows = [
        [Paragraph("<b>Class</b>", styles["small"]), "", Paragraph("<b>Probability</b>", styles["small"]), ""]
    ]
    for score in sorted(prediction.scores, key=lambda s: s.probability, reverse=True):
        spec = lookup.get(score.class_index, {"name": score.class_code, "code": score.class_code})
        is_top = score.class_index == prediction.predicted_class_index
        rows.append(
            [
                Paragraph(escape(spec["name"]), styles["body"]),
                Paragraph(escape(spec["code"]), styles["small"]),
                _bar(score.probability, highlight=is_top),
                Paragraph(f"{score.probability:.1%}", styles["body"]),
            ]
        )
    dist = Table(rows, colWidths=[68 * mm, 16 * mm, 56 * mm, None], hAlign="LEFT")
    dist.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LINEBELOW", (0, 0), (-1, 0), 0.5, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story += [KeepTogether([Paragraph("Probability distribution", styles["h2"]), dist])]

    # ----------------------------------------------------- explanation
    target = (
        lookup.get(prediction.gradcam_target_index, {}).get("name", "n/a")
        if prediction.gradcam_target_index is not None
        else "n/a"
    )
    status_text = {
        "completed": f"Grad-CAM computed for the predicted class ({target}) at layer {mv.gradcam_layer}.",
        "failed": "Grad-CAM generation failed for this analysis; the prediction is unaffected.",
        "skipped": "Grad-CAM was not generated for this analysis.",
    }[prediction.gradcam_status]
    story += [
        Paragraph("Explanation", styles["h2"]),
        Paragraph(status_text, styles["body"]),
        Spacer(1, 1.5 * mm),
        Paragraph(EXPLAINABILITY_NOTE, styles["small"]),
    ]

    warnings = analysis.quality.get("warnings", [])
    if warnings:
        story += [
            Paragraph("Image quality checks", styles["h2"]),
            *[Paragraph(f"&bull; {w['message']}", styles["body"]) for w in warnings],
        ]

    # ------------------------------------------------ reproducibility
    created_local = analysis.created_at.astimezone(tz)
    details = [
        ("Analysis ID", str(analysis.id)),
        (
            "Analysis timestamp",
            f"{created_local:%Y-%m-%d %H:%M:%S %Z} ({analysis.created_at:%Y-%m-%d %H:%M:%S} UTC)",
        ),
        (
            "Image",
            f"{escape(analysis.original_filename)} &middot; "
            f"{analysis.image_width}&times;{analysis.image_height} px (uploaded as {analysis.source_format}, "
            f"{analysis.source_width}&times;{analysis.source_height} px)",
        ),
        ("Image SHA-256", analysis.image_sha256),
        (
            "Model",
            f"{escape(mv.display_name)} v{escape(mv.version)} ({'trained' if mv.trained else 'UNTRAINED'})",
        ),
        ("Model weights SHA-256", mv.weights_sha256),
        (
            "Training dataset",
            mv.dataset_id if mv.trained else f"none - untrained model (class taxonomy: {mv.dataset_id})",
        ),
        (
            "Preprocessing",
            f"version {mv.preprocessing_version}, {mv.input_size}&times;{mv.input_size} px input",
        ),
        ("Calibration", f"temperature scaling, T = {prediction.temperature:.3f}"),
        (
            "Inference time",
            f"{prediction.inference_ms:.1f} ms"
            + (f"; Grad-CAM {prediction.explain_ms:.1f} ms" if prediction.explain_ms is not None else ""),
        ),
    ]
    story += [KeepTogether([Paragraph("Reproducibility", styles["h2"]), _kv_table(details, styles)])]

    disclaimer = Table(
        [
            [
                Paragraph(
                    f"<b>Medical disclaimer.</b> {DISCLAIMER} "
                    "No treatment recommendation is made or implied.",
                    styles["body"],
                )
            ]
        ],
        colWidths=[content_w],
    )
    disclaimer.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), TINT),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story += [Spacer(1, 6 * mm), disclaimer]
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return buffer.getvalue()
