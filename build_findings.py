#!/usr/bin/env python3
"""Build findings.json for the review page from a findings YAML file.

Usage:
    pip install pyyaml
    python3 build_findings.py path/to/fast_abdomen_ct.yaml            # writes findings.json
    python3 build_findings.py path/to/file.yaml --plain-labels         # label sentences "Sentence 2", "Sentence 3"...

By default each sentence of a definition after the first is labelled by its wording:
"Excludes" if it mentions excluding, "Includes" if it mentions including, otherwise "Detail".
These labels are a reading aid; the YAML itself stores the definition as one paragraph.
Use --plain-labels to number the sentences instead.

Existing notes keep working after a rebuild as long as finding ids stay the same.
Notes point at fields by position (for example the 2nd definition sentence), and each
note also stores the text it was written about, so reviewers can still read the original.
"""
import argparse
import json
import re
import sys

import yaml


def label(i, sentence, plain):
    if i == 0 and not sentence.startswith("This definition"):
        return "Definition"
    if plain:
        return f"Sentence {i + 1}"
    inc = re.search(r"\binclud", sentence)
    exc = re.search(r"\bexclud", sentence)
    if inc and exc:
        return "Includes · Excludes"
    if exc:
        return "Excludes"
    if inc:
        return "Includes"
    return "Detail"


def is_general(q):
    return q["id"].startswith("any_")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("yaml_path")
    ap.add_argument("-o", "--out", default="findings.json")
    ap.add_argument("--plain-labels", action="store_true")
    args = ap.parse_args()

    with open(args.yaml_path, encoding="utf-8") as f:
        y = yaml.safe_load(f)

    cats, seen = [], set()
    for name, c in (y.get("categories") or {}).items():
        qs = []
        for q in c.get("questions") or []:
            qid = q["id"]
            if qid in seen:
                sys.exit(f"Duplicate finding id: {qid}")
            seen.add(qid)
            definition = (q.get("definition") or "").strip()
            sentences = [s.strip() for s in re.split(r"(?<=\.)\s+(?=[A-Z])", definition) if s.strip()]
            qs.append({
                "id": qid,
                "question": q.get("question", ""),
                "variants": q.get("variants") or [],
                "definition": definition,
                "defs": [{"label": label(i, s, args.plain_labels), "text": s} for i, s in enumerate(sentences)],
                "include_terms": q.get("include_terms") or [],
                "exclude_terms": q.get("exclude_terms") or [],
                "severity_scale": q.get("severity_scale"),
                "answer_rule": q.get("answer_rule"),
            })
        # Show the compartment-general question ("Is there any abnormality of ...?") first.
        qs.sort(key=lambda q: not is_general(q))
        cats.append({
            "name": name,
            "description": c.get("description", ""),
            "cross_cutting": bool(c.get("cross_cutting")),
            "questions": qs,
        })

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"modality": y.get("modality", ""), "categories": cats}, f, ensure_ascii=False)
    print(f"Wrote {args.out}: {len(cats)} categories, {len(seen)} findings")


if __name__ == "__main__":
    main()
