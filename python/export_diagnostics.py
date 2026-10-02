"""
Input: io, json, sys, zipfile, import_diagnostics
Output: main
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# -*- coding: utf-8 -*-
# [INPUT]: 標準入力の三つの UTF-8 文書、標準ライブラリの JSON・ZIP API、import_diagnostics の例外イベントに依存する。
# [OUTPUT]: 固定された三つの診断文書を含む ZIP を標準出力のバイナリーとして返し、生成失敗の段階・例外スタックを stderr に記録して非零終了する。
# [POS]: extension/import_diagnostics.js 専用のアーカイブ生成器。ファイルパスや環境設定を受け付けず、既に匿名化された内容だけを圧縮する。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import io
import json
import sys
import zipfile
import import_diagnostics as diagnostics

MAX_INPUT_BYTES = 32 * 1024 * 1024
MAX_CONTENT_BYTES = 12 * 1024 * 1024
MEMBERS = ("summary.txt", "environment.json", "events.jsonl")


def main():
    """固定メンバーをメモリー内で生成し、ホストのファイルを読み取らない。"""
    raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
    if len(raw) > MAX_INPUT_BYTES:
        raise ValueError("Diagnostics input exceeds the size limit")
    content = json.loads(raw.decode("utf-8"))
    if not isinstance(content, dict) or set(content) != set(MEMBERS):
        raise ValueError("Diagnostics must contain exactly the three allowed documents")
    if any(not isinstance(content[name], str) for name in MEMBERS):
        raise ValueError("Diagnostics document content must be text")
    encoded = {name: content[name].encode("utf-8") for name in MEMBERS}
    if sum(len(value) for value in encoded.values()) > MAX_CONTENT_BYTES:
        raise ValueError("Diagnostics content exceeds the size limit")
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name in MEMBERS:
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            output.writestr(info, encoded[name])
    sys.stdout.buffer.write(archive.getvalue())
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        diagnostics.failed("archive.generate", error)
        sys.exit(1)
