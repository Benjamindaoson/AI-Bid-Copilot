"""Isolated local DOCX pilot; never prints source content or permits network sockets."""
import hashlib
import json
import os
import socket
import sys
import time


def block_network(*_args, **_kwargs):
    raise RuntimeError("Network access disabled for private DOCX pilot")


socket.socket.connect = block_network
socket.create_connection = block_network
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

from docling.datamodel.base_models import InputFormat
from docling.document_converter import DocumentConverter


source = sys.argv[1]
converter = DocumentConverter(allowed_formats=[InputFormat.DOCX])
samples = []
document = None
for _ in range(3):
    start = time.perf_counter()
    result = converter.convert(source)
    document = result.document.export_to_dict()
    samples.append(round((time.perf_counter() - start) * 1000, 2))

print(json.dumps({
    "sourceSha256": hashlib.sha256(open(source, "rb").read()).hexdigest().upper(),
    "doclingVersion": __import__("importlib.metadata", fromlist=["version"]).version("docling"),
    "texts": len(document.get("texts", [])),
    "tables": len(document.get("tables", [])),
    "tableCells": sum(len(table.get("data", {}).get("table_cells", [])) for table in document.get("tables", [])),
    "pictures": len(document.get("pictures", [])),
    "pageObjects": len(document.get("pages", {})),
    "samplesMs": samples,
    "p50Ms": sorted(samples)[1],
    "p95Ms": max(samples),
    "networkBlocked": True,
    "caveat": "Same-process warm converter; excludes Python interpreter startup and model downloads. No visual fidelity or page mapping verified."
}, ensure_ascii=False, indent=2))
