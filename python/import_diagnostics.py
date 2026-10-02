"""
Input: datetime, json, os, sys, time, traceback
Output: configure_streams, emit, started, completed, failed, warning, reset, result, run_cli
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# [INPUT]: 標準ライブラリ、診断番号・試行種別・言語・スクリプト名の環境変数、呼び出し元の例外・処理段階に依存する。
# [OUTPUT]: stderr の PTCG_DIAG JSON イベント、警告の集計、単一 stdout JSON 結果、未捕捉例外の記録を提供する。
# [POS]: 全言語の共通層と実行 CLI の診断境界。永続化と脱敏は extension に委ね、CHS 専用の結果 JSON と他の stdout 契約を分離する。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import datetime
import json
import os
import sys
import time
import traceback

REQUEST_TIMEOUT = (10, 30)
EVENT_PREFIX = "PTCG_DIAG "
_warnings = []
_last_stage = "input"
_last_card_id = None


def configure_streams():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def emit(stage, event, card_id=None, message=None, **fields):
    global _last_stage, _last_card_id
    _last_stage = stage
    if card_id is not None:
        _last_card_id = str(card_id)
    elif not stage.startswith(("card", "image")):
        _last_card_id = None
    entry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "diagnosticId": os.environ.get("PTCG_DIAGNOSTIC_ID", ""),
        "attemptType": os.environ.get("PTCG_ATTEMPT_TYPE", ""),
        "language": os.environ.get("PTCG_LANGUAGE", ""),
        "script": os.environ.get("PTCG_SCRIPT", ""),
        "stage": stage,
        "event": event,
    }
    if card_id is not None:
        entry["cardId"] = str(card_id)
    if message is not None:
        entry["message"] = str(message)[:4000]
        if len(str(message)) > 4000:
            entry["messageTruncated"] = True
    entry.update({key: value for key, value in fields.items() if value is not None})
    # --- 診断の書き込み障害でカード取得を停止しない ---
    try:
        print(EVENT_PREFIX + json.dumps(entry, ensure_ascii=False), file=sys.stderr, flush=True)
    except (OSError, UnicodeError):
        pass


def started(stage, card_id=None, **fields):
    emit(stage, "started", card_id=card_id, **fields)
    return time.monotonic()


def completed(stage, since, card_id=None, **fields):
    emit(stage, "completed", card_id=card_id,
         durationMs=round((time.monotonic() - since) * 1000), **fields)


def failed(stage, error, card_id=None, since=None, **fields):
    try:
        error._ptcg_recorded_stage = stage
    except (AttributeError, TypeError):
        pass
    error_trace = "".join(traceback.format_exception(type(error), error, error.__traceback__))
    response = getattr(error, "response", None)
    emit(stage, "failed", card_id=card_id, message=str(error),
         errorType=type(error).__name__, traceback=error_trace[-12000:],
         tracebackTruncated=True if len(error_trace) > 12000 else None,
         durationMs=round((time.monotonic() - since) * 1000) if since else None,
         httpStatus=getattr(response, "status_code", None), **fields)


def warning(stage, message, card_id=None, **fields):
    item = {"stage": stage, "message": str(message)[:1000]}
    if card_id is not None:
        item["cardId"] = str(card_id)
    if len(_warnings) < 200:
        _warnings.append(item)
    emit(stage, "warning", card_id=card_id, message=message, **fields)


def reset():
    global _last_stage, _last_card_id
    _warnings.clear()
    _last_stage = "input"
    _last_card_id = None


def result(cards=None, missing_cards=None, missing_images=None, database_saved=False, fatal=False):
    missing_cards = list(dict.fromkeys(missing_cards or []))
    missing_images = list(dict.fromkeys(missing_images or []))
    status = "failed" if fatal or missing_cards or not database_saved else (
        "warning" if missing_images or _warnings else "success")
    return {"cards": cards or [], "missingCards": missing_cards,
            "missingImages": missing_images, "warnings": list(_warnings),
            "databaseSaved": bool(database_saved), "status": status}


def run_cli(callback):
    configure_streams()
    reset()
    try:
        output = callback()
    except Exception as error:
        failed(getattr(error, "_ptcg_recorded_stage", _last_stage), error,
               card_id=_last_card_id, unhandled=True)
        output = result(fatal=True)
    except SystemExit as error:
        if not error.code:
            return
        failed("input", error)
        output = result(fatal=True)
    emit("result", output["status"], missingCards=output["missingCards"],
         missingImages=output["missingImages"], databaseSaved=output["databaseSaved"])
    print(json.dumps(output, ensure_ascii=False), flush=True)
    raise SystemExit(1 if output["status"] == "failed" else 0)


def _excepthook(error_type, error, error_trace):
    failed(_last_stage, error, card_id=_last_card_id, unhandled=True)
    sys.__excepthook__(error_type, error, error_trace)


sys.excepthook = _excepthook
