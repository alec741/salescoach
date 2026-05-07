#!/usr/bin/env python
"""Generate polished PDF coaching reports from local Markdown and JSONL outputs."""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import inch
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        HRFlowable,
        PageBreak,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        Table,
        TableStyle,
    )
except ImportError as exc:  # pragma: no cover - exercised by local environment setup
    raise SystemExit(
        "Missing PDF dependency: reportlab. Install it with `python -m pip install -r requirements.txt`."
    ) from exc

try:
    from pypdf import PdfReader, PdfWriter
except ImportError:  # pragma: no cover
    PdfReader = None
    PdfWriter = None


ROOT = Path(__file__).resolve().parents[2]
PAGE_WIDTH, PAGE_HEIGHT = letter
MARGIN = 0.55 * inch
AVAILABLE_WIDTH = PAGE_WIDTH - (2 * MARGIN)

NAVY = colors.HexColor("#152238")
MIDNIGHT = colors.HexColor("#0D1728")
INK = colors.HexColor("#1E293B")
MUTED = colors.HexColor("#64748B")
GREEN = colors.HexColor("#17885F")
TEAL = colors.HexColor("#0A7A80")
GOLD = colors.HexColor("#B98218")
RED = colors.HexColor("#C2413A")
BLUE = colors.HexColor("#315CA8")
PAPER = colors.HexColor("#FBFCF8")
CARD_BG = colors.white
LIGHT_BG = colors.HexColor("#F3F6F8")
TABLE_LINE = colors.HexColor("#D9E2EA")
WARNING_BG = colors.HexColor("#FFF4D8")
SUCCESS_BG = colors.HexColor("#E7F6EE")
DANGER_BG = colors.HexColor("#FDE9E7")
BLUE_BG = colors.HexColor("#EAF1FF")


def register_report_fonts() -> tuple[str, str, str]:
    """Use a modern Windows UI font when available, with PDF-safe fallbacks."""
    candidates = [
        (
            "SegoeUI",
            Path("C:/Windows/Fonts/segoeui.ttf"),
            Path("C:/Windows/Fonts/segoeuib.ttf"),
            Path("C:/Windows/Fonts/segoeuii.ttf"),
        ),
        (
            "Arial",
            Path("C:/Windows/Fonts/arial.ttf"),
            Path("C:/Windows/Fonts/arialbd.ttf"),
            Path("C:/Windows/Fonts/ariali.ttf"),
        ),
    ]
    for family, regular, bold, italic in candidates:
        if regular.exists() and bold.exists():
            try:
                pdfmetrics.registerFont(TTFont(family, str(regular)))
                pdfmetrics.registerFont(TTFont(f"{family}-Bold", str(bold)))
                if italic.exists():
                    pdfmetrics.registerFont(TTFont(f"{family}-Italic", str(italic)))
                else:
                    pdfmetrics.registerFont(TTFont(f"{family}-Italic", str(regular)))
                return family, f"{family}-Bold", f"{family}-Italic"
            except Exception:
                continue
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


FONT_REGULAR, FONT_BOLD, FONT_ITALIC = register_report_fonts()

SCORE_FIELDS = [
    ("opening", "Opening"),
    ("qualification", "Qualification"),
    ("discovery", "Discovery"),
    ("quantification", "Quantification"),
    ("solution_to_pain", "Solution-to-pain"),
    ("feature_dump_control", "Feature-dump control"),
    ("close_or_next_step", "Close / next step"),
    ("compliance", "Compliance"),
]

SCORE_LABELS = dict(SCORE_FIELDS)
SELLING_SEQUENCE = [
    "qualification",
    "quantification",
    "discovery",
    "solution_to_pain",
    "close_or_next_step",
    "feature_dump_control",
    "opening",
]
COACHING_TARGET = 8.0
LEVERAGE_WEIGHTS = {
    "qualification": 1.25,
    "quantification": 1.25,
    "discovery": 1.15,
    "solution_to_pain": 1.1,
    "close_or_next_step": 1.0,
    "feature_dump_control": 0.85,
    "opening": 0.8,
}
FOCUS_COPY = {
    "opening": {
        "headline": "Set a cleaner opening agenda before discovery.",
        "behavior": "Open with the inbound reason, confirm owner/decision-maker status, and earn permission to ask fit questions before explaining product.",
    },
    "qualification": {
        "headline": "Tighten ICP and Contractor A/B qualification before solutioning.",
        "behavior": "By minute 5, identify whether the buyer is no-financing, dealer-fee financing, adjacent, or poor-fit before explaining Enhancify.",
    },
    "discovery": {
        "headline": "Diagnose current process, desired outcome, and status-quo consequence before product explanation.",
        "behavior": "Ask current situation, desired situation, and consequence questions before describing how the platform works.",
    },
    "quantification": {
        "headline": "Quantify the financing gap before presenting Enhancify.",
        "behavior": "Ask one math question before solutioning: out of 10 estimates, how many stall because of price or financing, and what is that worth per month?",
    },
    "solution_to_pain": {
        "headline": "Turn diagnosed pain into one concise solution narrative.",
        "behavior": "Before each product point, name the exact pain it solves and confirm the buyer sees the connection.",
    },
    "feature_dump_control": {
        "headline": "Reduce product detail with shorter confirmation loops.",
        "behavior": "After each relevant product point, pause and ask whether that fits their sales process instead of continuing the explanation.",
    },
    "close_or_next_step": {
        "headline": "Convert diagnosed pain into a clear decision or calendar-controlled next step.",
        "behavior": "End with a direct close ask or a dated next step tied to the decision maker, decision criteria, and timing.",
    },
    "compliance": {
        "headline": "Tighten high-risk financing expectation language immediately.",
        "behavior": "Use approved language on marketplace status, soft pull, final lender approval, hard inquiry, customer-received funds, and no guaranteed rates, approvals, amounts, or timelines.",
    },
}
COMBINED_FOCUS_COPY = {
    ("qualification", "quantification"): {
        "headline": "Tighten qualification and quantify the financing gap before solutioning.",
        "behavior": "Confirm Contractor A/B fit, current financing setup, lost-job volume, dealer-fee cost, and decision timing before explaining the platform.",
    },
    ("discovery", "quantification"): {
        "headline": "Diagnose and quantify pain before presenting Enhancify.",
        "behavior": "Get the current process, the consequence of staying there, and one clear business-impact number before solutioning.",
    },
    ("quantification", "solution_to_pain"): {
        "headline": "Use quantified pain to create a tighter solution narrative.",
        "behavior": "State the ROI problem in the buyer's words, then map only the smallest set of Enhancify capabilities to that pain.",
    },
    ("qualification", "discovery"): {
        "headline": "Qualify fit and diagnose the current selling motion before solutioning.",
        "behavior": "Confirm segment, timing, financing process, and desired outcome before moving into product mechanics.",
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate PDF coaching reports.")
    parser.add_argument("--date", help="Report date, e.g. 2026-05-06.")
    parser.add_argument(
        "--variant",
        default=None,
        help="Report variant under reports/daily/<date>/, e.g. codex or codex-over-10min.",
    )
    parser.add_argument("--report-dir", help="Override source report directory.")
    parser.add_argument("--scorecards", help="Override scorecard JSONL path.")
    parser.add_argument("--out-dir", help="Override PDF output directory.")
    parser.add_argument(
        "positionals",
        nargs="*",
        help="Optional positional fallback: <date> <variant>. Useful when npm strips option names on Windows.",
    )
    parser.add_argument(
        "--no-combined",
        action="store_true",
        help="Deprecated compatibility flag. Combined packets are skipped by default.",
    )
    parser.add_argument(
        "--no-scorecards",
        action="store_true",
        help="Deprecated compatibility flag. Call scorecard PDFs are skipped by default.",
    )
    parser.add_argument(
        "--include-combined",
        action="store_true",
        help="Also generate a combined packet PDF. Not part of default daily delivery.",
    )
    parser.add_argument(
        "--include-call-scorecards",
        action="store_true",
        help="Also generate call-scorecards.pdf. Individual call coaching is intended for Slack/UI, not daily rep PDFs.",
    )
    parser.add_argument(
        "--include-all-reps",
        action="store_true",
        help="Bypass the sales-rep allowlist from config/sales-filter.json.",
    )
    args = parser.parse_args()
    positionals = [value for value in args.positionals if value != "--"]
    if positionals and not args.date:
        args.date = positionals[0]
    if len(positionals) > 1 and args.variant is None:
        args.variant = positionals[1]
    if len(positionals) > 2 and not args.out_dir:
        args.out_dir = positionals[2]
    return args


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def remove_if_unwanted(path: Path) -> None:
    try:
        if path.exists():
            path.unlink()
    except PermissionError:
        # The PDF is likely open in a viewer or held by OneDrive. The manifest remains the source of truth.
        pass


def latest_date_dir() -> str:
    daily = ROOT / "reports" / "daily"
    dates = sorted(path.name for path in daily.iterdir() if path.is_dir() and re.match(r"\d{4}-\d{2}-\d{2}", path.name))
    if not dates:
        raise SystemExit("No report dates found under reports/daily.")
    return dates[-1]


def default_variant(date: str) -> str:
    day_dir = ROOT / "reports" / "daily" / date
    for candidate in ["codex-over-10min", "codex"]:
        if (day_dir / candidate).is_dir():
            return candidate
    return ""


def resolve_paths(args: argparse.Namespace) -> dict[str, Path | str | None]:
    date = args.date or latest_date_dir()
    variant = args.variant if args.variant is not None else default_variant(date)

    if args.report_dir:
        report_dir = Path(args.report_dir)
        if not report_dir.is_absolute():
            report_dir = ROOT / report_dir
    else:
        report_dir = ROOT / "reports" / "daily" / date
        if variant:
            report_dir = report_dir / variant

    if args.scorecards:
        scorecards = Path(args.scorecards)
        if not scorecards.is_absolute():
            scorecards = ROOT / scorecards
    elif variant == "codex-over-10min":
        scorecards = ROOT / "data" / "coach" / "codex-review" / f"{date}-over-10min" / "codex-scorecards.jsonl"
    elif variant == "codex":
        scorecards = ROOT / "data" / "coach" / "codex-review" / date / "codex-scorecards.jsonl"
    else:
        scorecards = None

    if args.out_dir:
        out_dir = Path(args.out_dir)
        if not out_dir.is_absolute():
            out_dir = ROOT / out_dir
    else:
        out_dir = ROOT / "output" / "pdf" / "daily" / date
        if variant:
            out_dir = out_dir / variant

    return {
        "date": date,
        "variant": variant,
        "report_dir": report_dir,
        "scorecards": scorecards,
        "out_dir": out_dir,
    }


def clean_text(value: Any) -> str:
    text = "" if value is None else str(value)
    replacements = {
        "\u2010": "-",
        "\u2011": "-",
        "\u2012": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\u2018": "'",
        "\u2019": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u2026": "...",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    return text


def esc(value: Any) -> str:
    return html.escape(clean_text(value), quote=False)


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "DecodedTitle",
            parent=base["Title"],
            fontName=FONT_BOLD,
            fontSize=24,
            leading=29,
            textColor=NAVY,
            alignment=TA_LEFT,
            spaceAfter=8,
        ),
        "hero_title": ParagraphStyle(
            "DecodedHeroTitle",
            parent=base["Title"],
            fontName=FONT_BOLD,
            fontSize=22,
            leading=25,
            textColor=colors.white,
            alignment=TA_LEFT,
            spaceAfter=4,
        ),
        "hero_subtitle": ParagraphStyle(
            "DecodedHeroSubtitle",
            parent=base["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=9,
            leading=12,
            textColor=colors.HexColor("#D7E3F3"),
            spaceAfter=3,
        ),
        "hero_meta": ParagraphStyle(
            "DecodedHeroMeta",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=7.4,
            leading=9.4,
            textColor=colors.HexColor("#B7C9DD"),
            alignment=TA_RIGHT,
            spaceAfter=0,
        ),
        "hero_chip": ParagraphStyle(
            "DecodedHeroChip",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=8.2,
            leading=10.2,
            textColor=colors.white,
            alignment=TA_RIGHT,
            spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "DecodedSubtitle",
            parent=base["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=10,
            leading=14,
            textColor=MUTED,
            spaceAfter=16,
            splitLongWords=0,
        ),
        "h1": ParagraphStyle(
            "DecodedH1",
            parent=base["Heading1"],
            fontName=FONT_BOLD,
            fontSize=16,
            leading=19.5,
            textColor=NAVY,
            spaceBefore=12,
            spaceAfter=6,
        ),
        "h2": ParagraphStyle(
            "DecodedH2",
            parent=base["Heading2"],
            fontName=FONT_BOLD,
            fontSize=13,
            leading=17,
            textColor=TEAL,
            spaceBefore=10,
            spaceAfter=6,
        ),
        "h3": ParagraphStyle(
            "DecodedH3",
            parent=base["Heading3"],
            fontName=FONT_BOLD,
            fontSize=10.5,
            leading=13,
            textColor=NAVY,
            spaceBefore=7,
            spaceAfter=4,
        ),
        "card_title": ParagraphStyle(
            "DecodedCardTitle",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=10.6,
            leading=13.2,
            textColor=NAVY,
            spaceAfter=5,
            splitLongWords=0,
        ),
        "callout_title": ParagraphStyle(
            "DecodedCalloutTitle",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=10.8,
            leading=13.4,
            textColor=NAVY,
            spaceAfter=5,
            splitLongWords=0,
        ),
        "body": ParagraphStyle(
            "DecodedBody",
            parent=base["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=9.2,
            leading=12.5,
            textColor=INK,
            spaceAfter=5,
            splitLongWords=0,
        ),
        "bullet": ParagraphStyle(
            "DecodedBullet",
            parent=base["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=8.8,
            leading=11.6,
            textColor=INK,
            leftIndent=9,
            firstLineIndent=-7,
            bulletIndent=0,
            spaceAfter=4,
            splitLongWords=0,
        ),
        "small": ParagraphStyle(
            "DecodedSmall",
            parent=base["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=7.5,
            leading=9.4,
            textColor=INK,
            splitLongWords=0,
        ),
        "muted": ParagraphStyle(
            "DecodedMuted",
            parent=base["BodyText"],
            fontName=FONT_REGULAR,
            fontSize=7.6,
            leading=9.5,
            textColor=MUTED,
            splitLongWords=0,
        ),
        "small_bold": ParagraphStyle(
            "DecodedSmallBold",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=7.4,
            leading=9.2,
            textColor=NAVY,
            splitLongWords=0,
        ),
        "score_chip_value": ParagraphStyle(
            "DecodedScoreChipValue",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=7.6,
            leading=8.8,
            alignment=TA_CENTER,
            textColor=NAVY,
            spaceAfter=0,
            splitLongWords=0,
        ),
        "label": ParagraphStyle(
            "DecodedLabel",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=6.7,
            leading=8.4,
            textColor=MUTED,
            alignment=TA_CENTER,
            spaceAfter=0,
            splitLongWords=0,
        ),
        "table_header": ParagraphStyle(
            "DecodedTableHeader",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=7.1,
            leading=8.8,
            textColor=colors.white,
            splitLongWords=0,
        ),
        "metric": ParagraphStyle(
            "DecodedMetric",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=16.5,
            leading=18.5,
            alignment=TA_CENTER,
            textColor=NAVY,
        ),
        "metric_label": ParagraphStyle(
            "DecodedMetricLabel",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=6.7,
            leading=8.2,
            alignment=TA_CENTER,
            textColor=MUTED,
            splitLongWords=0,
        ),
        "section_kicker": ParagraphStyle(
            "DecodedSectionKicker",
            parent=base["BodyText"],
            fontName=FONT_BOLD,
            fontSize=7,
            leading=9,
            textColor=TEAL,
            spaceAfter=3,
        ),
    }


STYLES = make_styles()


def paragraph(text: Any, style: str = "body") -> Paragraph:
    return Paragraph(esc(text), STYLES[style])


def bullet(text: Any, style: str = "body") -> Paragraph:
    bullet_style = style if style != "body" else "bullet"
    return Paragraph(esc(text), STYLES[bullet_style], bulletText="-")


def section_rule() -> HRFlowable:
    return HRFlowable(width="100%", thickness=0.7, color=TABLE_LINE, spaceBefore=8, spaceAfter=8)


def score_color(score: float) -> colors.Color:
    if score >= 7.5:
        return GREEN
    if score >= 6:
        return GOLD
    return RED


def score_band(score: float) -> str:
    if score >= 7.5:
        return "Strong"
    if score >= 6:
        return "Watch"
    return "Priority"


def score_background(score: float) -> colors.Color:
    if score >= 7.5:
        return SUCCESS_BG
    if score >= 6:
        return WARNING_BG
    return DANGER_BG


def format_score(value: Any, digits: int = 1) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if abs(number - round(number)) < 0.001:
        return str(int(round(number)))
    return f"{number:.{digits}f}".rstrip("0").rstrip(".")


def truncate(value: Any, max_chars: int) -> str:
    text = clean_text(value).strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3].rstrip() + "..."


def human_date(date: str) -> str:
    try:
        parsed = datetime.strptime(date, "%Y-%m-%d")
        return parsed.strftime("%B %-d, %Y")
    except ValueError:
        try:
            parsed = datetime.strptime(date, "%Y-%m-%d")
            return parsed.strftime("%B %#d, %Y")
        except ValueError:
            return clean_text(date)


def report_scope_label(variant: str) -> str:
    if "over-10" in variant:
        return "Long-call review"
    if variant == "codex":
        return "Daily sales review"
    return "Sales coaching review"


def hero_block(title: str, subtitle: str, meta: str, eyebrow: str = "REPORT", context: str = "") -> Table:
    left = [paragraph(title, "hero_title"), paragraph(subtitle, "hero_subtitle")]
    right = [
        paragraph(eyebrow, "hero_chip"),
        *([paragraph(context, "hero_meta")] if context else []),
        paragraph(meta, "hero_meta"),
    ]
    table = Table(
        [[left, right], ["", ""]],
        colWidths=[AVAILABLE_WIDTH * 0.58, AVAILABLE_WIDTH * 0.42],
        rowHeights=[None, 4],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MIDNIGHT),
                ("BACKGROUND", (0, 1), (0, 1), GREEN),
                ("BACKGROUND", (1, 1), (1, 1), TEAL),
                ("BOX", (0, 0), (-1, 0), 0, MIDNIGHT),
                ("LEFTPADDING", (0, 0), (-1, 0), 18),
                ("RIGHTPADDING", (0, 0), (-1, 0), 18),
                ("TOPPADDING", (0, 0), (-1, 0), 14),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 14),
                ("LEFTPADDING", (0, 1), (-1, 1), 0),
                ("RIGHTPADDING", (0, 1), (-1, 1), 0),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 0),
                ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
            ]
        )
    )
    return table


def callout_box(title: str, body: str, accent: colors.Color = GREEN, bg: colors.Color = SUCCESS_BG, width: float = AVAILABLE_WIDTH) -> Table:
    table = Table(
        [[[paragraph(title, "callout_title"), paragraph(body, "body")]]],
        colWidths=[width],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, 0), 3, accent),
                ("BOX", (0, 0), (-1, -1), 0.45, TABLE_LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 12),
                ("RIGHTPADDING", (0, 0), (-1, -1), 12),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def mini_score_bar(score: float, width: float = 115, height: float = 6):
    from reportlab.graphics.shapes import Drawing, Rect

    score = max(0, min(10, float(score or 0)))
    drawing = Drawing(width, height)
    drawing.add(Rect(0, 0, width, height, fillColor=LIGHT_BG, strokeColor=None))
    drawing.add(Rect(0, 0, width * (score / 10), height, fillColor=score_color(score), strokeColor=None))
    return drawing


def score_chip(score: float, width: float = 0.62 * inch) -> Table:
    band = score_band(score)
    table = Table(
        [[paragraph(f"{format_score(score)}/10", "score_chip_value")], [paragraph(band, "label")]],
        colWidths=[width],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), score_background(score)),
                ("BOX", (0, 0), (-1, -1), 0.45, score_color(score)),
                ("LEFTPADDING", (0, 0), (-1, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    return table


def score_legend(width: float = AVAILABLE_WIDTH) -> Table:
    cells = [
        [score_chip(8, width=0.68 * inch), paragraph("Strong: reinforce and share examples.", "small")],
        [score_chip(6.5, width=0.68 * inch), paragraph("Watch: coach for sharper execution.", "small")],
        [score_chip(5, width=0.68 * inch), paragraph("Priority: immediate manager focus.", "small")],
    ]
    table = Table([cells], colWidths=[width / 3] * 3, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.35, TABLE_LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, TABLE_LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    return table


def score_bar_table(scores: dict[str, Any], width: float = AVAILABLE_WIDTH) -> Table:
    label_width = 1.25 * inch
    score_width = 0.66 * inch
    bar_width = max(width - label_width - score_width, 1.3 * inch)
    rows = []
    for key, label in SCORE_FIELDS:
        score = float(scores.get(key, 0) or 0)
        rows.append([paragraph(label, "small"), mini_score_bar(score, bar_width), score_chip(score, score_width)])
    table = Table(rows, colWidths=[label_width, bar_width, score_width], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5),
            ]
        )
    )
    return table


def design_card(title: str, children: list[Any], width: float = AVAILABLE_WIDTH, accent: colors.Color = BLUE, bg: colors.Color = CARD_BG) -> Table:
    table = Table([[[paragraph(title, "card_title"), *children]]], colWidths=[width], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, 0), 2.4, accent),
                ("BOX", (0, 0), (-1, -1), 0.45, TABLE_LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 11),
                ("RIGHTPADDING", (0, 0), (-1, -1), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]
        )
    )
    return table


def make_table(rows: list[list[Any]], col_widths: list[float] | None = None, small: bool = True) -> Table:
    if not rows:
        rows = [[""]]
    style_name = "small" if small else "body"
    data = []
    for row_index, row in enumerate(rows):
        cell_style = "table_header" if row_index == 0 else style_name
        data.append([Paragraph(esc(cell), STYLES[cell_style]) for cell in row])
    max_cols = max(len(row) for row in data)
    for row in data:
        while len(row) < max_cols:
            row.append(Paragraph("", STYLES[style_name]))

    if col_widths is None:
        col_widths = [AVAILABLE_WIDTH / max_cols] * max_cols

    table = Table(data, colWidths=col_widths, repeatRows=1 if len(rows) > 1 else 0, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), MIDNIGHT),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), FONT_BOLD),
                ("GRID", (0, 0), (-1, -1), 0.3, TABLE_LINE),
                ("BOX", (0, 0), (-1, -1), 0.55, TABLE_LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("BACKGROUND", (0, 1), (-1, -1), CARD_BG),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
            ]
        )
    )
    return table


def metric_row(metrics: list[tuple[str, str]], width: float = AVAILABLE_WIDTH) -> Table:
    cells = []
    for label, value in metrics:
        cells.append([Paragraph(esc(value), STYLES["metric"]), Paragraph(esc(clean_text(label).upper()), STYLES["metric_label"])])
    table = Table([cells], colWidths=[width / len(cells)] * len(cells), hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.45, TABLE_LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.35, TABLE_LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def parse_markdown_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    table_lines = []
    index = start
    while index < len(lines) and lines[index].strip().startswith("|"):
        table_lines.append(lines[index].strip())
        index += 1

    rows: list[list[str]] = []
    for line in table_lines:
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    return rows, index


def markdown_to_flowables(markdown_text: str) -> list[Any]:
    output: list[Any] = []
    lines = clean_text(markdown_text).splitlines()
    paragraph_buffer: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_buffer:
            output.append(paragraph(" ".join(part.strip() for part in paragraph_buffer), "body"))
            paragraph_buffer.clear()

    index = 0
    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()

        if not stripped:
            flush_paragraph()
            output.append(Spacer(1, 5))
            index += 1
            continue

        if stripped.startswith("|"):
            flush_paragraph()
            rows, index = parse_markdown_table(lines, index)
            output.append(make_table(rows, small=True))
            output.append(Spacer(1, 8))
            continue

        if stripped.startswith("### "):
            flush_paragraph()
            output.append(section_rule())
            output.append(paragraph(stripped[4:], "h3"))
            index += 1
            continue

        if stripped.startswith("## "):
            flush_paragraph()
            output.append(paragraph(stripped[3:], "h2"))
            index += 1
            continue

        if stripped.startswith("# "):
            flush_paragraph()
            output.append(paragraph(stripped[2:], "title"))
            index += 1
            continue

        if stripped.startswith("- "):
            flush_paragraph()
            output.append(bullet(stripped[2:]))
            index += 1
            continue

        paragraph_buffer.append(stripped)
        index += 1

    flush_paragraph()
    return output


def footer(title: str):
    def draw(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(TABLE_LINE)
        canvas.line(MARGIN, 0.42 * inch, PAGE_WIDTH - MARGIN, 0.42 * inch)
        canvas.setFont(FONT_REGULAR, 7)
        canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN, 0.25 * inch, clean_text(title)[:95])
        canvas.drawRightString(PAGE_WIDTH - MARGIN, 0.25 * inch, f"Page {doc.page}")
        canvas.restoreState()

    return draw


def build_pdf(path: Path, title: str, story: list[Any]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(path),
        pagesize=letter,
        rightMargin=MARGIN,
        leftMargin=MARGIN,
        topMargin=0.62 * inch,
        bottomMargin=0.58 * inch,
        title=clean_text(title),
        author="Decoded Coach",
    )
    doc.build(story, onFirstPage=footer(title), onLaterPages=footer(title))
    return page_count(path)


def page_count(path: Path) -> int:
    if PdfReader is None:
        return 0
    return len(PdfReader(str(path)).pages)


def read_jsonl(path: Path | None) -> list[dict[str, Any]]:
    if not path or not path.exists():
        return []
    rows = []
    for line in read_text(path).splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def normalize_match(value: Any) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return text.lower()


def matches_fragment(value: Any, fragments: list[str]) -> bool:
    normalized = normalize_match(value)
    return bool(normalized) and any(normalize_match(fragment) in normalized for fragment in fragments)


def load_sales_rep_filter() -> dict[str, Any]:
    path = ROOT / "config" / "sales-filter.json"
    if not path.exists():
        return {}
    return json.loads(read_text(path))


def filter_scorecards_by_rep(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    config = load_sales_rep_filter()
    include_names = config.get("includeRepNameMatches") or []
    exclude_names = config.get("excludeRepNameMatches") or []
    include_ids = set(config.get("includeRepUserIds") or [])
    exclude_ids = set(config.get("excludeRepUserIds") or [])

    if not include_names and not exclude_names and not include_ids and not exclude_ids:
        return rows, [], {"mode": "no_rep_filter_configured"}

    included = []
    excluded = []
    for row in rows:
        rep_name = row.get("rep_name") or ""
        rep_id = row.get("rep_id") or ""
        if rep_id in exclude_ids or matches_fragment(rep_name, exclude_names):
            excluded.append({"row": row, "reason": "excluded_rep"})
            continue

        is_allowed = rep_id in include_ids or matches_fragment(rep_name, include_names)
        if (include_names or include_ids) and not is_allowed:
            excluded.append({"row": row, "reason": "not_in_sales_rep_allowlist"})
            continue

        included.append(row)

    return included, excluded, {
        "mode": "sales_rep_allowlist",
        "includeRepNameMatches": include_names,
        "excludeRepNameMatches": exclude_names,
        "excludedRows": len(excluded),
    }


def sanitize_slug(value: Any) -> str:
    normalized = normalize_match(value)
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return slug or "unknown"


def load_lead_cache() -> dict[str, Any]:
    path = ROOT / "data" / "coach" / "lead-cache.json"
    if not path.exists():
        return {}
    data = json.loads(read_text(path))
    return data if isinstance(data, dict) else {}


def looks_like_phone(value: str) -> bool:
    compact = re.sub(r"[^0-9]", "", value or "")
    return len(compact) >= 10 and len(compact) >= len(re.sub(r"[^A-Za-z0-9]", "", value or "")) - 2


def lead_display_name(row: dict[str, Any], lead_cache: dict[str, Any]) -> str:
    lead = lead_cache.get(row.get("lead_id")) or {}
    custom = lead.get("custom") or {}
    company = clean_text(custom.get("Company Name") or lead.get("name") or "").strip()
    contact = clean_text(row.get("contact_name") or custom.get("Contact Name") or custom.get("Primary Contact") or "").strip()

    if company and looks_like_phone(company):
        company = ""

    if company and contact and normalize_match(contact) not in normalize_match(company):
        return f"{company} - {contact}"
    if company:
        return company
    if contact:
        return contact
    return "Unnamed prospect"


def enrich_scorecards(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    lead_cache = load_lead_cache()
    enriched = []
    for row in rows:
        copy = dict(row)
        copy["_display_name"] = lead_display_name(copy, lead_cache)
        enriched.append(copy)
    return enriched


def score_table(scores: dict[str, Any]) -> Table:
    headers = [label for _, label in SCORE_FIELDS]
    values = [f"{float(scores.get(key, 0)):g}/10" for key, _ in SCORE_FIELDS]
    return make_table([headers, values], small=True)


def average(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0


def group_scorecards_by_rep(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row.get("rep_name") or "Unknown"].append(row)
    return dict(sorted(grouped.items(), key=lambda item: item[0].lower()))


def dimension_averages(rows: list[dict[str, Any]]) -> dict[str, float]:
    return {
        key: average([float(row.get("scores", {}).get(key, 0) or 0) for row in rows])
        for key, _ in SCORE_FIELDS
    }


def most_common_text(values: list[Any], fallback: str = "No pattern identified.") -> str:
    counter = Counter(clean_text(value).strip() for value in values if clean_text(value).strip())
    if not counter:
        return fallback
    return counter.most_common(1)[0][0]


def compliance_should_drive_focus(scores: dict[str, float], flags: Counter[str], calls: int) -> bool:
    compliance_score = float(scores.get("compliance", 0) or 0)
    flag_count = sum(flags.values())
    return compliance_score <= 5.5 or (compliance_score <= 6.0 and flag_count >= max(3, calls * 0.75))


def leverage_deficit(scores: dict[str, float], key: str) -> float:
    score = float(scores.get(key, 0) or 0)
    return max(0, COACHING_TARGET - score) * LEVERAGE_WEIGHTS.get(key, 1)


def choose_coaching_focus(scores: dict[str, float], flags: Counter[str] | None = None, calls: int = 1) -> dict[str, Any]:
    flags = flags or Counter()
    if compliance_should_drive_focus(scores, flags, calls):
        return {
            "dimensions": ["compliance"],
            "headline": FOCUS_COPY["compliance"]["headline"],
            "behavior": FOCUS_COPY["compliance"]["behavior"],
            "rationale": "Compliance is the coaching focus because the score or repeated flags indicate material risk.",
        }

    ranked = sorted(
        SELLING_SEQUENCE,
        key=lambda key: (-leverage_deficit(scores, key), SELLING_SEQUENCE.index(key)),
    )
    primary = ranked[0] if ranked else "quantification"
    secondary = ranked[1] if len(ranked) > 1 else None
    primary_deficit = leverage_deficit(scores, primary)
    secondary_deficit = leverage_deficit(scores, secondary) if secondary else 0

    pair = tuple(sorted([primary, secondary], key=lambda key: SELLING_SEQUENCE.index(key))) if secondary else None
    if pair in COMBINED_FOCUS_COPY and secondary_deficit >= primary_deficit - 0.35:
        copy = COMBINED_FOCUS_COPY[pair]
        dimensions = list(pair)
    else:
        copy = FOCUS_COPY[primary]
        dimensions = [primary]

    low_label = ", ".join(f"{SCORE_LABELS[dimension]} {format_score(scores.get(dimension, 0))}/10" for dimension in dimensions)
    return {
        "dimensions": dimensions,
        "headline": copy["headline"],
        "behavior": copy["behavior"],
        "rationale": f"Highest leverage score gap: {low_label}. Compliance remains a watchout, not the primary coaching lever, unless risk is severe.",
    }


def summarize_rep(rep_name: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    scores = dimension_averages(rows)
    lowest = sorted(((key, label, scores[key]) for key, label in SCORE_FIELDS), key=lambda item: item[2])[:2]
    flags = Counter(
        clean_text(flag).strip()
        for row in rows
        for flag in (row.get("compliance_flags") or [])
        if clean_text(flag).strip()
    )
    best = max(rows, key=lambda row: float(row.get("overall_score", 0) or 0))
    weakest = min(rows, key=lambda row: float(row.get("overall_score", 0) or 0))
    focus = choose_coaching_focus(scores, flags, len(rows))
    return {
        "rep_name": rep_name,
        "rows": rows,
        "calls": len(rows),
        "avg_overall": average([float(row.get("overall_score", 0) or 0) for row in rows]),
        "scores": scores,
        "lowest": lowest,
        "flags": flags,
        "focus": focus,
        "focus_dimensions": focus["dimensions"],
        "segments": Counter(clean_text(row.get("lead_segment")).strip() for row in rows if clean_text(row.get("lead_segment")).strip()),
        "opportunity": focus["headline"],
        "next_focus": focus["behavior"],
        "strength": most_common_text([row.get("top_strength") for row in rows]),
        "call_pattern": most_common_text([row.get("biggest_coaching_opportunity") for row in rows]),
        "best": best,
        "weakest": weakest,
    }


def variant_context(variant: str) -> tuple[str, str]:
    if "over-10" in variant:
        return (
            "Long-Call Coaching Review",
            "Focused on discovery depth, quantified pain, solution control, close quality, and compliance precision.",
        )
    if variant == "codex":
        return (
            "Daily Sales Coaching Report",
            "Team performance snapshot, rep coaching priorities, and compliance watchouts.",
        )
    return ("Sales Coaching Review", "Coaching priorities and compliance watchouts from scored sales conversations.")


def team_focus(rows: list[dict[str, Any]]) -> str:
    if not rows:
        return "No sales-rep calls are available for this report."
    flags = Counter(
        clean_text(flag).strip()
        for row in rows
        for flag in (row.get("compliance_flags") or [])
        if clean_text(flag).strip()
    )
    focus = choose_coaching_focus(dimension_averages(rows), flags, len(rows))
    return f"{focus['headline']} {focus['rationale']}"


def top_flags(rows: list[dict[str, Any]], limit: int = 5) -> list[tuple[str, int]]:
    flags = Counter(
        clean_text(flag).strip()
        for row in rows
        for flag in (row.get("compliance_flags") or [])
        if clean_text(flag).strip()
    )
    return flags.most_common(limit)


def rep_priority_card(summary: dict[str, Any], width: float) -> Table:
    flag_count = sum(summary["flags"].values())
    lowest = ", ".join(f"{label} {format_score(score)}" for _, label, score in summary["lowest"])
    band = score_band(summary["avg_overall"])
    children: list[Any] = [
        metric_row([
            ("Avg", f"{format_score(summary['avg_overall'])}/10"),
            ("Calls", str(summary["calls"])),
            ("Flags", str(flag_count)),
        ], width=width - 20),
        Spacer(1, 5),
        paragraph(f"Lowest dimensions: {lowest}", "small"),
        paragraph(f"Leverage focus: {summary['opportunity']}", "body"),
        paragraph(f"Next-call move: {summary['next_focus']}", "small"),
    ]
    if summary["flags"]:
        children.append(paragraph("Top compliance flags", "h3"))
        for flag, count in summary["flags"].most_common(2):
            children.append(bullet(f"{truncate(flag, 115)} ({count})"))
    else:
        children.append(paragraph("No compliance flags in reviewed calls.", "small"))
    return design_card(f"{summary['rep_name']} - {band}", children, width=width, accent=score_color(summary["avg_overall"]))


def manager_story_from_scorecards(rows: list[dict[str, Any]], date: str, variant: str, excluded: list[dict[str, Any]]) -> list[Any]:
    _, subtitle = variant_context(variant)
    grouped = group_scorecards_by_rep(rows)
    summaries = [summarize_rep(rep, rep_rows) for rep, rep_rows in grouped.items()]
    priority_summaries = sorted(summaries, key=lambda summary: summary["avg_overall"])
    avg_score = average([float(row.get("overall_score", 0) or 0) for row in rows])
    flag_count = sum(len(row.get("compliance_flags") or []) for row in rows)

    story: list[Any] = [
        hero_block(
            "Enhancify Manager Coaching Report",
            subtitle,
            human_date(date),
            eyebrow="MANAGER REPORT",
            context="Daily team coaching summary",
        ),
        Spacer(1, 12),
        metric_row([
            ("Calls reviewed", str(len(rows))),
            ("Sales reps", str(len(grouped))),
            ("Team average", f"{format_score(avg_score)}/10"),
            ("Compliance flags", str(flag_count)),
        ]),
        Spacer(1, 12),
        callout_box("Manager move for tomorrow", team_focus(rows), GREEN, SUCCESS_BG),
        Spacer(1, 10),
        score_legend(),
        Spacer(1, 10),
    ]

    half_width = (AVAILABLE_WIDTH - 10) / 2
    score_card = design_card("Team score profile", [score_bar_table(dimension_averages(rows), width=half_width - 20)], width=half_width, accent=TEAL)
    flag_children: list[Any] = []
    flags = top_flags(rows)
    if flags:
        for flag, count in flags:
            flag_children.append(bullet(f"{truncate(flag, 130)} ({count})", "small"))
    else:
        flag_children.append(paragraph("No compliance flags in reviewed calls.", "body"))
    flag_card = design_card("Compliance watchlist", flag_children, width=half_width, accent=GOLD)
    story.append(two_column(score_card, flag_card, half_width))
    story.append(PageBreak())
    story.append(paragraph("Rep Coaching Priorities", "h1"))
    story.append(paragraph("Sorted by coaching priority. Use each card for the one-on-one opening: lowest dimension, next-call move, and compliance watchouts.", "subtitle"))

    for index in range(0, len(priority_summaries), 2):
        left = rep_priority_card(priority_summaries[index], half_width)
        right = rep_priority_card(priority_summaries[index + 1], half_width) if index + 1 < len(priority_summaries) else Spacer(1, 1)
        story.append(two_column(left, right, half_width))
        story.append(Spacer(1, 8))

    story.append(PageBreak())
    story.append(paragraph("Rep Detail Appendix", "h1"))
    for index, summary in enumerate(summaries):
        if index:
            story.append(PageBreak())
        story.extend(rep_detail_flowables(summary))
        story.append(Spacer(1, 10))
    return story


def two_column(left: Any, right: Any, width: float) -> Table:
    table = Table([[left, right]], colWidths=[width, width], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def rep_detail_flowables(summary: dict[str, Any]) -> list[Any]:
    flag_count = sum(summary["flags"].values())
    scores = [float(row.get("overall_score", 0) or 0) for row in summary["rows"]]
    segment_text = ", ".join(f"{segment} ({count})" for segment, count in summary["segments"].most_common())
    flow: list[Any] = [
        section_rule(),
        paragraph(summary["rep_name"], "h1"),
        metric_row([
            ("Calls", str(summary["calls"])),
            ("Average", f"{format_score(summary['avg_overall'])}/10"),
            ("Range", f"{format_score(min(scores))}-{format_score(max(scores))}"),
            ("Flags", str(flag_count)),
        ]),
        Spacer(1, 7),
        score_bar_table(summary["scores"]),
        Spacer(1, 7),
        callout_box("Primary coaching opportunity", summary["opportunity"], BLUE, BLUE_BG),
        Spacer(1, 6),
        paragraph(f"Why this is the focus: {summary['focus']['rationale']}", "body"),
        paragraph(f"Next-call focus: {summary['next_focus']}", "body"),
        paragraph(f"Strength to reinforce: {summary['strength']}", "body"),
        paragraph(f"Repeated call-level pattern: {summary['call_pattern']}", "muted"),
        paragraph(f"Lead segment mix: {segment_text}", "muted"),
        paragraph("Compliance flags", "h3"),
    ]
    if summary["flags"]:
        for flag, count in summary["flags"].most_common():
            flow.append(bullet(f"{flag} ({count})", "body"))
    else:
        flow.append(paragraph("No compliance flags in reviewed calls.", "body"))
    return flow


def rep_story_from_scorecards(summary: dict[str, Any], date: str, variant: str) -> list[Any]:
    scores = [float(row.get("overall_score", 0) or 0) for row in summary["rows"]]
    flag_count = sum(summary["flags"].values())
    story: list[Any] = [
        hero_block(
            "Enhancify Rep Coaching Brief",
            summary["rep_name"],
            f"{human_date(date)} | {report_scope_label(variant)}",
            eyebrow="REP REPORT",
            context="Individual coaching summary",
        ),
        Spacer(1, 12),
        metric_row([
            ("Calls reviewed", str(summary["calls"])),
            ("Average score", f"{format_score(summary['avg_overall'])}/10"),
            ("Score range", f"{format_score(min(scores))}-{format_score(max(scores))}"),
            ("Compliance flags", str(flag_count)),
        ]),
        Spacer(1, 10),
        score_legend(),
        Spacer(1, 12),
        callout_box("Highest-leverage improvement", summary["opportunity"], GREEN, SUCCESS_BG),
        Spacer(1, 10),
    ]
    half_width = (AVAILABLE_WIDTH - 10) / 2
    story.append(two_column(
        design_card("Score profile", [score_bar_table(summary["scores"], width=half_width - 20)], half_width, TEAL),
        design_card("Next call plan", [
            paragraph(f"Next-call move: {summary['next_focus']}", "body"),
            paragraph(f"Why this is the focus: {summary['focus']['rationale']}", "small"),
            paragraph(f"Strength to reinforce: {summary['strength']}", "body"),
            paragraph(f"Most coachable call: {truncate(summary['weakest'].get('concise_call_readout'), 220)}", "small"),
        ], half_width, BLUE),
        half_width
    ))
    story.append(Spacer(1, 10))
    story.append(paragraph("Compliance Watch", "h1"))
    if summary["flags"]:
        for flag, count in summary["flags"].most_common():
            story.append(bullet(f"{flag} ({count})", "body"))
    else:
        story.append(paragraph("No compliance flags in reviewed calls.", "body"))
    return story


def scorecard_story(rows: list[dict[str, Any]], title: str, date: str, variant: str) -> list[Any]:
    story: list[Any] = [
        hero_block(
            "Enhancify Call Review Packet",
            "Specific call scorecards for QA, manager review, and on-demand coaching.",
            f"{human_date(date)} | {len(rows)} calls scored",
            eyebrow="CALL REVIEW",
            context="On-demand call scorecards",
        ),
        Spacer(1, 12),
    ]

    if not rows:
        story.append(paragraph("No scorecards were found for this report set.", "body"))
        return story

    avg_score = sum(float(row.get("overall_score", 0)) for row in rows) / len(rows)
    reps = sorted({row.get("rep_name", "Unknown") for row in rows})
    flag_count = sum(len(row.get("compliance_flags") or []) for row in rows)
    story.append(metric_row([("Calls", str(len(rows))), ("Reps", str(len(reps))), ("Average", f"{avg_score:.1f}/10"), ("Flags", str(flag_count))]))
    story.append(Spacer(1, 10))
    story.append(score_legend())
    story.append(Spacer(1, 12))
    story.append(callout_box(
        "Call-level review use case",
        "Use this optional packet for specific call review and QA. Daily rep coaching should stay focused on the aggregated rep summary.",
        BLUE,
        BLUE_BG,
    ))
    story.append(PageBreak())

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row.get("rep_name", "Unknown")].append(row)

    for rep_index, rep_name in enumerate(sorted(grouped)):
        rep_rows = sorted(grouped[rep_name], key=lambda row: float(row.get("overall_score", 0)), reverse=True)
        if rep_index:
            story.append(PageBreak())
        rep_avg = sum(float(row.get("overall_score", 0)) for row in rep_rows) / len(rep_rows)
        story.append(paragraph(rep_name, "h1"))
        story.append(paragraph(f"{len(rep_rows)} calls | Average score: {rep_avg:.1f}/10", "subtitle"))

        for row in rep_rows:
            story.extend(call_card(row))
            story.append(Spacer(1, 10))

    return story


def call_card(row: dict[str, Any]) -> list[Any]:
    flags = row.get("compliance_flags") or []
    score = float(row.get("overall_score", 0) or 0)
    display_name = row.get("_display_name") or "Unnamed prospect"
    story: list[Any] = []
    story.append(design_card(
        f"{display_name} - {score_band(score)}",
        [
            metric_row([
                ("Overall", f"{format_score(score)}/10"),
                ("Duration", f"{format_score(row.get('duration_minutes'))} min"),
                ("Flags", str(len(flags))),
            ], width=AVAILABLE_WIDTH - 20),
            Spacer(1, 6),
            paragraph(f"Segment: {row.get('lead_segment', 'unknown')}", "muted"),
            score_bar_table(row.get("scores") or {}),
            Spacer(1, 6),
            callout_box("Coaching opportunity", row.get("biggest_coaching_opportunity", ""), BLUE, BLUE_BG, width=AVAILABLE_WIDTH - 20),
            Spacer(1, 4),
            paragraph(f"Strength: {row.get('top_strength', '')}", "small"),
            paragraph(f"Next-call focus: {row.get('next_call_focus', '')}", "small"),
            paragraph(f"Readout: {row.get('concise_call_readout', '')}", "small"),
        ],
        accent=score_color(score),
        bg=CARD_BG,
    ))
    story.append(paragraph("Compliance flags", "h3"))
    if flags:
        for flag in flags:
            story.append(bullet(flag))
    else:
        story.append(paragraph("No compliance flags.", "body"))
    return story


def make_detail_table(label: str, value: Any) -> Table:
    table = Table(
        [[Paragraph(esc(label), STYLES["small_bold"]), Paragraph(esc(value), STYLES["small"])]],
        colWidths=[1.35 * inch, AVAILABLE_WIDTH - 1.35 * inch],
        hAlign="LEFT",
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, 0), LIGHT_BG),
                ("BACKGROUND", (1, 0), (1, 0), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.3, TABLE_LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def build_markdown_pdf(markdown_path: Path, pdf_path: Path, title: str) -> int:
    story = markdown_to_flowables(read_text(markdown_path))
    return build_pdf(pdf_path, title, story)


def merge_pdfs(paths: list[Path], output: Path) -> int:
    if PdfReader is None or PdfWriter is None:
        raise SystemExit("Missing pypdf. Install it with `python -m pip install pypdf` or use --no-combined.")
    writer = PdfWriter()
    for path in paths:
        reader = PdfReader(str(path))
        for page in reader.pages:
            writer.add_page(page)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        writer.write(handle)
    return page_count(output)


def main() -> int:
    args = parse_args()
    resolved = resolve_paths(args)
    date = str(resolved["date"])
    variant = str(resolved["variant"] or "")
    report_dir = Path(resolved["report_dir"])
    scorecards_path = resolved["scorecards"]
    out_dir = Path(resolved["out_dir"])

    out_dir.mkdir(parents=True, exist_ok=True)
    rep_out_dir = out_dir / "rep-summaries"
    rep_out_dir.mkdir(parents=True, exist_ok=True)
    for stale_pdf in rep_out_dir.glob("*.pdf"):
        remove_if_unwanted(stale_pdf)
    if not args.include_call_scorecards:
        remove_if_unwanted(out_dir / "call-scorecards.pdf")
    if not args.include_combined:
        remove_if_unwanted(out_dir / "daily-coaching-packet.pdf")

    raw_scorecard_rows = read_jsonl(scorecards_path if isinstance(scorecards_path, Path) else None)
    if args.include_all_reps:
        scorecard_rows = raw_scorecard_rows
        excluded_rows = []
        filter_info = { "mode": "include_all_reps" }
    else:
        scorecard_rows, excluded_rows, filter_info = filter_scorecards_by_rep(raw_scorecard_rows)
    scorecard_rows = enrich_scorecards(scorecard_rows)

    outputs: dict[str, Any] = {
        "date": date,
        "variant": variant,
        "source_report_dir": str(report_dir.relative_to(ROOT) if report_dir.is_relative_to(ROOT) else report_dir),
        "output_dir": str(out_dir.relative_to(ROOT) if out_dir.is_relative_to(ROOT) else out_dir),
        "raw_scorecards": len(raw_scorecard_rows),
        "included_scorecards": len(scorecard_rows),
        "excluded_scorecards": len(excluded_rows),
        "rep_filter": filter_info,
    }

    generated_paths: list[Path] = []

    if scorecard_rows:
        manager_pdf = out_dir / "manager-summary.pdf"
        outputs["manager_summary_pdf"] = {
            "path": str(manager_pdf.relative_to(ROOT)),
            "pages": build_pdf(manager_pdf, f"Manager Summary - {date}", manager_story_from_scorecards(scorecard_rows, date, variant, excluded_rows)),
        }
        generated_paths.append(manager_pdf)

        rep_pdfs = []
        for rep_name, rep_rows in group_scorecards_by_rep(scorecard_rows).items():
            summary = summarize_rep(rep_name, rep_rows)
            pdf_path = rep_out_dir / f"{sanitize_slug(rep_name)}.pdf"
            pages = build_pdf(pdf_path, f"{rep_name} - Coaching Brief", rep_story_from_scorecards(summary, date, variant))
            rep_pdfs.append({"path": str(pdf_path.relative_to(ROOT)), "pages": pages})
            generated_paths.append(pdf_path)
        outputs["rep_summary_pdfs"] = rep_pdfs

        if args.include_call_scorecards and not args.no_scorecards:
            scorecards_pdf = out_dir / "call-scorecards.pdf"
            pages = build_pdf(
                scorecards_pdf,
                f"Call Scorecards - {date}",
                scorecard_story(scorecard_rows, "Call Scorecards", date, variant),
            )
            outputs["call_scorecards_pdf"] = {
                "path": str(scorecards_pdf.relative_to(ROOT)),
                "pages": pages,
                "scorecards": len(scorecard_rows),
            }
            generated_paths.append(scorecards_pdf)
    else:
        if not report_dir.exists():
            raise SystemExit(f"No scorecards found and report directory not found: {report_dir}")

        manager_md = report_dir / "manager-summary.md"
        if manager_md.exists():
            manager_pdf = out_dir / "manager-summary.pdf"
            outputs["manager_summary_pdf"] = {
                "path": str(manager_pdf.relative_to(ROOT)),
                "pages": build_markdown_pdf(manager_md, manager_pdf, f"Manager Summary - {date}"),
            }
            generated_paths.append(manager_pdf)

        rep_pdfs = []
        rep_markdown_paths = [
            markdown_path
            for markdown_path in sorted(report_dir.glob("*.md"))
            if markdown_path.name != "manager-summary.md"
        ]
        rep_summary_dir = report_dir / "rep-summaries"
        if rep_summary_dir.exists():
            rep_markdown_paths.extend(sorted(rep_summary_dir.glob("*.md")))

        for markdown_path in rep_markdown_paths:
            pdf_path = rep_out_dir / f"{markdown_path.stem}.pdf"
            pages = build_markdown_pdf(markdown_path, pdf_path, markdown_path.stem.replace("-", " ").title())
            rep_pdfs.append({"path": str(pdf_path.relative_to(ROOT)), "pages": pages})
            generated_paths.append(pdf_path)
        outputs["rep_summary_pdfs"] = rep_pdfs
        outputs["fallback"] = "markdown_rendering_no_scorecards"

    if generated_paths and args.include_combined and not args.no_combined:
        combined_pdf = out_dir / "daily-coaching-packet.pdf"
        outputs["combined_packet_pdf"] = {
            "path": str(combined_pdf.relative_to(ROOT)),
            "pages": merge_pdfs(generated_paths, combined_pdf),
        }

    manifest = out_dir / "manifest.json"
    write_json(manifest, outputs)
    outputs["manifest"] = str(manifest.relative_to(ROOT))
    print(json.dumps(outputs, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"PDF generation failed: {exc}", file=sys.stderr)
        raise
