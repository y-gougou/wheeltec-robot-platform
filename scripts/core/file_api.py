#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Filesystem helpers for web file listing, previews, and downloads."""

from __future__ import print_function

import csv
import os
from collections import deque


class CsvPreviewError(Exception):
    pass


def list_csv_files(data_dir):
    if not data_dir or not os.path.isdir(data_dir):
        return []
    entries = []
    for name in sorted(os.listdir(data_dir), reverse=True):
        fp = os.path.join(data_dir, name)
        if os.path.isfile(fp) and name.endswith(".csv"):
            entries.append({
                "name": name,
                "size": os.path.getsize(fp),
                "mtime": os.path.getmtime(fp),
            })
    return entries


def safe_child_file(data_dir, name):
    if not data_dir or not name or ".." in name or "/" in name or "\\" in name:
        return None
    fp = os.path.join(data_dir, name)
    if not os.path.isfile(fp):
        return None
    return fp


def safe_csv_path(filepath):
    if not filepath or "\x00" in filepath:
        return None
    fp = os.path.abspath(filepath)
    if not os.path.isfile(fp) or not fp.endswith(".csv"):
        return None
    return fp


def _to_float(value):
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _read_csv_profile(fp, max_points=500):
    rows = deque(maxlen=max_points)
    columns = []
    run_ids = set()
    fault_labels = set()
    fault_names = set()
    first_ts = None
    last_ts = None
    row_count = 0

    with open(fp, "r") as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames or []
        if not columns:
            raise CsvPreviewError("csv has no header")
        for row in reader:
            row_count += 1
            sampled = {"__row_number": row_count}
            for key, value in row.items():
                numeric = _to_float(value)
                sampled[key] = numeric if numeric is not None else value
            rows.append(sampled)

            run_id = row.get("run_id")
            if run_id:
                run_ids.add(run_id)
            fault_label = row.get("fault_label")
            if fault_label not in (None, ""):
                fault_labels.add(str(fault_label))
            fault_name = row.get("fault_name")
            if fault_name:
                fault_names.add(fault_name)

            ts = _to_float(row.get("timestamp"))
            if ts is not None:
                if first_ts is None:
                    first_ts = ts
                last_ts = ts

    rows = list(rows)

    return {
        "columns": columns,
        "rows": rows,
        "row_count": row_count,
        "sampled_points": len(rows),
        "run_ids": sorted(run_ids),
        "fault_labels": sorted(fault_labels),
        "fault_names": sorted(fault_names),
        "duration_sec": (last_ts - first_ts) if first_ts is not None and last_ts is not None else None,
        "start_time": first_ts,
        "end_time": last_ts,
    }


def preview_csv_file(data_dir, name, max_points=500):
    if not data_dir or not os.path.isdir(data_dir):
        raise CsvPreviewError("data dir not found: %s" % (data_dir or ""))
    fp = safe_child_file(data_dir, name)
    if not fp or not name.endswith(".csv"):
        raise CsvPreviewError("file not found: %s" % (name or ""))
    try:
        profile = _read_csv_profile(fp, max_points=max_points)
    except CsvPreviewError:
        raise
    except Exception as e:
        raise CsvPreviewError("csv parse failed: %s" % e)
    profile.update({
        "name": name,
        "size": os.path.getsize(fp),
        "mtime": os.path.getmtime(fp),
    })
    return profile


def preview_csv_path(filepath, max_points=500):
    fp = safe_csv_path(filepath)
    if not fp:
        raise CsvPreviewError("file not found: %s" % (filepath or ""))
    try:
        profile = _read_csv_profile(fp, max_points=max_points)
    except CsvPreviewError:
        raise
    except Exception as e:
        raise CsvPreviewError("csv parse failed: %s" % e)
    profile.update({
        "name": os.path.basename(fp),
        "path": fp,
        "dir": os.path.dirname(fp),
        "size": os.path.getsize(fp),
        "mtime": os.path.getmtime(fp),
    })
    return profile


def summarize_csv_dir(data_dir):
    summary = {
        "dir": data_dir,
        "file_count": 0,
        "total_rows": 0,
        "total_duration_sec": 0.0,
        "classes": {},
        "runs": [],
    }
    if not data_dir or not os.path.isdir(data_dir):
        return summary

    for entry in list_csv_files(data_dir):
        fp = safe_child_file(data_dir, entry["name"])
        if not fp:
            continue
        try:
            profile = _read_csv_profile(fp, max_points=1)
        except Exception:
            continue

        fault_name = profile["fault_names"][0] if profile["fault_names"] else "unknown"
        fault_label = profile["fault_labels"][0] if profile["fault_labels"] else "unknown"
        run_id = profile["run_ids"][0] if profile["run_ids"] else entry["name"].rsplit(".", 1)[0]
        rows = int(profile["row_count"] or 0)
        duration = float(profile["duration_sec"] or 0.0)
        key = "%s:%s" % (fault_label, fault_name)

        cls = summary["classes"].setdefault(key, {
            "fault_label": fault_label,
            "fault_name": fault_name,
            "files": 0,
            "runs": 0,
            "rows": 0,
            "duration_sec": 0.0,
        })
        cls["files"] += 1
        cls["runs"] += 1
        cls["rows"] += rows
        cls["duration_sec"] += duration

        summary["file_count"] += 1
        summary["total_rows"] += rows
        summary["total_duration_sec"] += duration
        summary["runs"].append({
            "name": entry["name"],
            "run_id": run_id,
            "fault_label": fault_label,
            "fault_name": fault_name,
            "rows": rows,
            "duration_sec": duration,
            "size": entry["size"],
            "mtime": entry["mtime"],
        })

    summary["classes"] = sorted(summary["classes"].values(), key=lambda item: str(item["fault_label"]))
    return summary
