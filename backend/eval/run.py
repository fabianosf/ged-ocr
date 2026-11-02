import argparse
import json
import math
import os
from pathlib import Path
from unittest.mock import patch


def counter(actual, expected):
    return {
        "correct": int(type(actual) is type(expected) and actual == expected),
        "total": 1, "nulls": int(actual is None),
    }


def equal(actual, expected):
    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            equal(actual[key], value) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(
            equal(left, right) for left, right in zip(actual, expected, strict=True)
        )
    return actual == expected


def score(actual, expected):
    fields, tables = {}, {}
    for key, value in expected.items():
        predicted = actual.get(key)
        if isinstance(value, list):
            rows = predicted if isinstance(predicted, list) else []
            cells = {"correct": 0, "total": 0, "nulls": 0}
            columns = {}
            for index in range(max(len(rows), len(value))):
                row = rows[index] if index < len(rows) else {}
                truth = value[index] if index < len(value) else {}
                for column in row.keys() | truth.keys():
                    counts = counter(row.get(column), truth.get(column))
                    if column not in truth or column not in row:
                        counts["correct"] = 0
                    target = columns.setdefault(column, {"correct": 0, "total": 0, "nulls": 0})
                    for metric in cells:
                        cells[metric] += counts[metric]
                        target[metric] += counts[metric]
            tables[key] = {
                **counter(rows, value), "correct": int(equal(predicted, value)),
                "cells": cells, "columns": columns,
                "expected_rows": len(value), "predicted_rows": len(rows),
            }
        else:
            fields[key] = counter(predicted, value)
            if key not in actual:
                fields[key]["correct"] = 0
    return {"fields": fields, "tables": tables}


def estimate_tokens(payload, content):
    # Text-only estimate; image cost is reported separately by the caller.
    text = json.dumps(payload, ensure_ascii=False)
    for message in payload.get("messages", []):
        if isinstance(message.get("content"), list):
            for part in message["content"]:
                if part.get("type") == "image_url":
                    text = text.replace(part["image_url"]["url"], "")
    return math.ceil((len(text) + len(content)) / 4)


def with_rates(report):
    if "total" in report:
        report["accuracy"] = report["correct"] / report["total"] if report["total"] else None
        report["null_rate"] = report["nulls"] / report["total"] if report["total"] else None
    for value in list(report.values()):
        if isinstance(value, dict):
            with_rates(value)
    return report


def run(folder, manifest, *, synthetic=False, image_tokens=1000):
    import django

    django.setup()
    import requests

    from documents.pipeline import detect_type, extract, prepare_image, run_ocr
    from documents.schema import values_only
    from documents.services.discovery import discover
    from documents.services.schema_builder import build_schema

    root = Path(folder).resolve()
    truth = json.loads(Path(manifest).read_text())
    types = sorted(truth["types"], key=lambda item: item["id"])[:100]
    original_post = requests.post
    tokens = {"provider_reported": 0, "estimated": 0, "calls": 0}
    reports = []

    def measured_post(*args, **kwargs):
        response = original_post(*args, **kwargs)
        response.raise_for_status()
        answer = response.json()
        tokens["calls"] += 1
        usage = answer.get("usage", {})
        if "total_tokens" in usage:
            tokens["provider_reported"] += usage["total_tokens"]
        else:
            tokens["estimated"] += estimate_tokens(
                kwargs["json"], answer["choices"][0]["message"]["content"],
            ) + image_tokens
        return response

    for index, item in enumerate(truth["documents"]):
        photo = (root / item["file"]).resolve()
        if not photo.is_relative_to(root):
            raise ValueError("Photo path must remain inside the evaluation folder.")
        image = prepare_image(str(photo))
        if synthetic:
            actual = item["synthetic_prediction"]
        else:
            with patch("documents.pipeline.requests.post", side_effect=measured_post):
                ocr = run_ocr(image)
                type_id = detect_type(image, ocr, [
                    {key: value[key] for key in ("id", "nome", "descricao")} for value in types
                ]) if types else None
                schema = (
                    next(value["esquema"] for value in types if value["id"] == type_id)
                    if type_id is not None else build_schema(discover(image, ocr))
                )
                actual = values_only(extract(image, ocr, schema), schema)
        reports.append({"sample": index + 1, **with_rates(score(actual, item["expected"]))})
    return {
        "mode": "synthetic-metrics-only" if synthetic else "pipeline",
        "documents": reports, "tokens": tokens,
        "estimate": "ceil(text characters / 4) + image_tokens per call without provider usage",
        "image_tokens_per_call": image_tokens,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument("manifest")
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument("--image-tokens", type=int, default=1000)
    args = parser.parse_args()
    if args.image_tokens < 0:
        parser.error("--image-tokens must be nonnegative")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    print(json.dumps(run(
        args.folder, args.manifest, synthetic=args.synthetic, image_tokens=args.image_tokens,
    ), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
