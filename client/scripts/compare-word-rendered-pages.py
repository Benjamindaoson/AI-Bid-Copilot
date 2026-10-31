"""Compare two locally Word-rendered PDFs without logging document text."""
import json
import os
import sys
from PIL import ImageChops, ImageStat
import pypdfium2 as pdfium


before_path, after_path, output_dir = sys.argv[1:4]
os.makedirs(output_dir, exist_ok=True)
before, after = pdfium.PdfDocument(before_path), pdfium.PdfDocument(after_path)
result = {"sourcePages": len(before), "revisionPages": len(after), "changedPages": [], "renderScale": 1.3}
if len(before) != len(after):
    result["status"] = "page-count-mismatch"
else:
    for index in range(len(before)):
        first = before[index].render(scale=1.3).to_pil().convert("RGB")
        second = after[index].render(scale=1.3).to_pil().convert("RGB")
        if first.size != second.size:
            result["changedPages"].append({"page": index + 1, "reason": "page-size-mismatch"})
            continue
        diff = ImageChops.difference(first, second)
        box = diff.getbbox()
        if box:
            mean = ImageStat.Stat(diff).mean
            result["changedPages"].append({"page": index + 1, "bbox": box, "meanRgbDelta": [round(value, 4) for value in mean]})
            if len(result["changedPages"]) <= 3:
                first.save(os.path.join(output_dir, f"source-page-{index + 1}.png"))
                second.save(os.path.join(output_dir, f"revision-page-{index + 1}.png"))
    result["status"] = "compared"
print(json.dumps(result, ensure_ascii=False, indent=2))
