#!/usr/bin/env python3
"""Dependency-free structural checks for the 0816 ROS package."""

import json
import pathlib
import sys
import xml.etree.ElementTree as ET


ROOT = pathlib.Path(__file__).resolve().parents[1]


def fail(message):
    print("ERROR:", message)
    return 1


def main():
    errors = 0
    required = [
        "CMakeLists.txt",
        "package.xml",
        "include/wheeltec_robot.h",
        "src/wheeltec_robot.cpp",
        "src/current_reader_node.cpp",
        "launch/web_control.launch",
        "web/dist/index.html",
        "desktop/package-lock.json",
    ]
    for relative in required:
        if not (ROOT / relative).is_file():
            errors += fail("missing %s" % relative)

    header = (ROOT / "include/wheeltec_robot.h").read_text(encoding="utf-8")
    if "int serial_buf_len_;\n};\n#endif" not in header.replace("\r\n", "\n"):
        errors += fail("wheeltec_robot class is not closed before #endif")

    for path in list((ROOT / "launch").rglob("*.launch")) + [ROOT / "package.xml"]:
        try:
            ET.parse(str(path))
        except Exception as exc:
            errors += fail("invalid XML %s: %s" % (path.relative_to(ROOT), exc))

    ignored_parts = {"node_modules", "dist", "build", "python", ".toolchain"}
    for path in ROOT.rglob("*.json"):
        if any(part in ignored_parts for part in path.parts):
            continue
        try:
            json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception as exc:
            errors += fail("invalid JSON %s: %s" % (path.relative_to(ROOT), exc))

    if errors:
        print("Repository verification failed with %d error(s)." % errors)
        return 1
    print("Repository structure: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
