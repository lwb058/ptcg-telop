"""
Input: contextlib, io, json, os, pathlib, pathlib.Path, subprocess, sys, tempfile, unittest
Output: events, Response, RuntimeDiagnosticsTests
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# [INPUT]: unittest、標準 subprocess、一時 DB、JP/CHT/CHS の取得層と診断イベントに依存する。
# [OUTPUT]: 捕捉・未捕捉例外、ゼロ終了時の失敗、画像・入力欠落、ZIP 生成失敗の現場証拠を通信なしで検証する。
# [POS]: python/ の全言語診断回帰。実 CLI の stdout と終了意味を保持したまま stderr の段階・スタックを検証する。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import card_utils_chs as chs
import card_utils_jp as jp
import card_utils_cht as cht
import extract_deck_cards_jp as deck_jp
import extract_deck_cards_cht as deck_cht
import import_diagnostics as diagnostics

SCRIPT_DIR = Path(__file__).resolve().parent


def events(stderr):
    return [json.loads(line[len(diagnostics.EVENT_PREFIX):])
            for line in stderr.splitlines() if line.startswith(diagnostics.EVENT_PREFIX)]


class Response:
    status_code = 200

    def __init__(self, text=""):
        self.text = text

    def raise_for_status(self):
        pass

    def iter_content(self, chunk_size):
        yield b"image"


class RuntimeDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        diagnostics.reset()
        self.stderr = io.StringIO()
        self.capture = contextlib.redirect_stderr(self.stderr)
        self.capture.__enter__()
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.capture.__exit__, None, None, None)

    def failure(self, stage, error_type, card_id=None):
        matching = [item for item in events(self.stderr.getvalue())
                    if item["event"] == "failed" and item["stage"] == stage
                    and item["errorType"] == error_type]
        self.assertTrue(matching, self.stderr.getvalue())
        item = matching[-1]
        self.assertIn(error_type, item["traceback"])
        if card_id is not None:
            self.assertEqual(item["cardId"], card_id)
        return item

    def test_card_request_caught_errors_keep_none_and_stack(self):
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                error = module.requests.exceptions.ConnectionError("network unavailable")
                with mock.patch.object(module.requests, "get", side_effect=error):
                    self.assertIsNone(module.get_card_details("123"))
                item = self.failure("card.request", "ConnectionError", "123")
                self.assertIn("network unavailable", item["message"])

    def test_http_status_is_preserved(self):
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                response = mock.Mock(status_code=403)
                error = module.requests.exceptions.HTTPError("blocked", response=response)
                with mock.patch.object(module.requests, "get", side_effect=error):
                    self.assertIsNone(module.get_card_details("123"))
                self.assertEqual(self.failure("card.request", "HTTPError", "123")["httpStatus"], 403)

    def test_card_parse_caught_exception_keeps_none(self):
        for module, method in ((jp, "find"), (cht, "select_one")):
            with self.subTest(module=module.__name__):
                soup = mock.MagicMock()
                getattr(soup, method).side_effect = ValueError("changed HTML structure")
                with mock.patch.object(module, "BeautifulSoup", return_value=soup):
                    self.assertIsNone(module.get_card_details("123", html_content="<html/>"))
                self.failure("card.parse", "ValueError", "123")

    def test_parser_initialization_error_is_recorded_and_still_raised(self):
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                with mock.patch.object(module, "BeautifulSoup", side_effect=ValueError("parser unavailable")):
                    with self.assertRaises(ValueError):
                        module.get_card_details("123", html_content="<html/>")
                self.failure("card.parse", "ValueError", "123")

    def test_missing_card_data_records_warning(self):
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                with mock.patch.object(module, "get_card_details", return_value=None):
                    self.assertEqual(module._core_process_card("123", {}), (None, "failed"))
                self.assertTrue(any(item["stage"] == "card.process" and item["event"] == "warning"
                                    and item["cardId"] == "123" for item in events(self.stderr.getvalue())))

    def test_database_read_invalid_json_is_recorded_and_raised(self):
        path = Path(self.temp.name) / "broken.json"
        path.write_text("{broken", encoding="utf-8")
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                with self.assertRaises(json.JSONDecodeError):
                    module.load_database(str(path))
                self.failure("database.read", "JSONDecodeError")

    def test_database_write_caught_error_keeps_legacy_return(self):
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                with mock.patch("builtins.open", side_effect=PermissionError("DB denied")):
                    self.assertIsNone(module.save_database({"123": {"name": "card"}},
                                                         str(Path(self.temp.name) / "cards.json")))
                self.failure("database.save", "PermissionError")

    def test_image_download_caught_error_keeps_return(self):
        for module, language in ((jp, "jp"), (cht, "cht")):
            with self.subTest(module=module.__name__):
                with mock.patch.object(module, "PROJECT_ROOT", self.temp.name), \
                     mock.patch.object(module.requests, "get",
                                       side_effect=module.requests.exceptions.Timeout("image timeout")):
                    self.assertIsNone(module.download_card_image("123", "https://example.test/a.jpg", language))
                self.failure("image.download", "Timeout", "123")

    def test_image_write_error_is_recorded_and_still_raised(self):
        for module, language in ((jp, "jp"), (cht, "cht")):
            with self.subTest(module=module.__name__):
                with mock.patch.object(module, "PROJECT_ROOT", self.temp.name), \
                     mock.patch.object(module.requests, "get", return_value=Response()), \
                     mock.patch("builtins.open", side_effect=PermissionError("image denied")):
                    with self.assertRaises(PermissionError):
                        module.download_card_image("123", "https://example.test/a.jpg", language)
                self.failure("image.save", "PermissionError", "123")

    def test_image_directory_error_is_recorded_and_still_raised(self):
        for module in (jp, cht):
            with self.subTest(module=module.__name__):
                with mock.patch.object(module.os, "makedirs", side_effect=PermissionError("directory denied")):
                    with self.assertRaises(PermissionError):
                        module.download_card_image("123", "https://example.test/a.jpg")
                self.failure("image.save", "PermissionError", "123")

    def test_deck_request_failure_and_missing_html_are_recorded(self):
        for module in (deck_jp, deck_cht):
            with self.subTest(module=module.__name__):
                path = str(Path(self.temp.name) / "cards.json")
                with mock.patch.object(module.requests, "get",
                                       side_effect=module.requests.exceptions.ConnectionError("deck network")):
                    self.assertEqual(module.extract_deck_cards("code", db_path=path), [])
                self.failure("deck.request", "ConnectionError")
                with mock.patch.object(module.requests, "get", return_value=Response("<html/>")):
                    self.assertEqual(module.extract_deck_cards("code", db_path=path), [])
                self.assertTrue(any(item["stage"] == "deck.parse" and item["event"] == "warning"
                                    for item in events(self.stderr.getvalue())))

    def test_deck_bad_quantity_parse_error_is_recorded(self):
        fixtures = (
            (deck_jp, '<form id="inputArea"><input type="hidden" name="deck_pokemon" value="123_bad"/></form>'),
            (deck_cht, '<div class="graphicList"><div class="card"><a href="/detail/123/"><p class="count">bad</p></a></div></div>'),
        )
        for module, html in fixtures:
            with self.subTest(module=module.__name__):
                with mock.patch.object(module.requests, "get", return_value=Response(html)):
                    self.assertEqual(module.extract_deck_cards("code", db_path=str(Path(self.temp.name) / "cards.json")), [])
                self.failure("deck.parse", "ValueError")

    def test_chs_image_check_permission_records_error_but_missing_file_is_normal(self):
        with mock.patch("builtins.open", side_effect=PermissionError("image check denied")):
            self.assertFalse(chs._valid_image("image.png", card_id="SET-001"))
        self.failure("image.check", "PermissionError", "SET-001")
        previous = len(events(self.stderr.getvalue()))
        self.assertFalse(chs._valid_image(str(Path(self.temp.name) / "missing.png")))
        self.assertEqual(len(events(self.stderr.getvalue())), previous)
        self.assertFalse(chs.card_image_available("bad/id", info="invalid info"))
        self.failure("image.check", "AttributeError", "bad/id")

    def run_script(self, language, code):
        env = {**os.environ, "PTCG_DIAGNOSTIC_ID": "diag-fixture",
               "PTCG_LANGUAGE": language, "PTCG_SCRIPT": "fixture.py"}
        return subprocess.run([sys.executable, "-c", code], cwd=SCRIPT_DIR,
                              env=env, capture_output=True, text=True, encoding="utf-8")

    def test_real_single_cli_missing_file_records_error_and_preserves_exit(self):
        for language in ("jp", "cht"):
            with self.subTest(language=language):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT_DIR / f"get_single_card_{language}.py"),
                     "--file", str(Path(self.temp.name) / "missing.html")],
                    capture_output=True, text=True, encoding="utf-8")
                self.assertEqual(result.returncode, 1)
                self.assertIn("does not exist", result.stdout)
                self.assertEqual(events(result.stderr)[-1]["stage"], "input.file")
                self.assertEqual(events(result.stderr)[-1]["errorType"], "FileNotFoundError")

    def test_real_single_cli_exit_zero_caught_db_failure_is_visible(self):
        for language in ("jp", "cht"):
            with self.subTest(language=language):
                path = str(Path(self.temp.name) / f"cards_{language}.json")
                code = f"""
import sys
from unittest import mock
import get_single_card_{language} as single
import card_utils_{language} as cards
sys.argv = ["single", "123", "--database-path", {path!r}]
with mock.patch.object(cards, "get_card_details", return_value={{"name": "card"}}), \
     mock.patch.object(cards, "download_card_image"), \
     mock.patch("builtins.open", side_effect=PermissionError("save denied")):
    single.main()
"""
                result = self.run_script(language, code)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertIn("Successfully parsed", result.stdout)
                recorded = [item for item in events(result.stderr) if item["event"] == "failed"]
                self.assertEqual(recorded[-1]["stage"], "database.save")
                self.assertEqual(recorded[-1]["errorType"], "PermissionError")
                self.assertEqual(recorded[-1]["language"], language)
                self.assertEqual(recorded[-1]["script"], "fixture.py")
                self.assertIn("save denied", recorded[-1]["traceback"])

    def test_real_deck_partial_result_keeps_legacy_json_and_records_omitted_card(self):
        fixtures = {
            "jp": '<form id="inputArea"><input type="hidden" name="deck_pokemon" value="123_1-456_1"/></form>',
            "cht": '<div class="graphicList"><div class="card"><a href="/detail/123/"><p class="count">1</p></a><a href="/detail/456/"><p class="count">1</p></a></div></div>',
        }
        for language, html in fixtures.items():
            with self.subTest(language=language):
                code = f"""
import sys
from unittest import mock
import extract_deck_cards_{language} as deck
response = mock.Mock(text={html!r}, status_code=200)
sys.argv = ["deck", "code"]
with mock.patch.object(deck, "load_database", return_value={{}}), \
     mock.patch.object(deck, "save_database"), \
     mock.patch.object(deck.requests, "get", return_value=response), \
     mock.patch.object(deck, "_core_process_card", side_effect=[({{"name": "good"}}, "updated"), (None, "failed")]), \
     mock.patch.object(deck.time, "sleep"):
    deck.main()
"""
                result = self.run_script(language, code)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout), {"cards": ["123"]})
                self.assertTrue(any(item["event"] == "warning" and item.get("cardId") == "456"
                                    for item in events(result.stderr)))

    def test_real_uncaught_error_has_hook_stage_card_and_traceback(self):
        result = self.run_script("jp", """
import import_diagnostics as diagnostics
diagnostics.started("card.parse", card_id="123")
raise RuntimeError("uncaught parser error")
""")
        self.assertEqual(result.returncode, 1)
        event = events(result.stderr)[-1]
        self.assertEqual((event["stage"], event["cardId"], event["unhandled"]),
                         ("card.parse", "123", True))
        self.assertIn("RuntimeError: uncaught parser error", event["traceback"])

    def test_real_archive_failure_keeps_stdout_empty_and_records_message(self):
        result = subprocess.run([sys.executable, str(SCRIPT_DIR / "export_diagnostics.py")],
                                input=b"{", capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        event = events(result.stderr.decode("utf-8"))[-1]
        self.assertEqual((event["stage"], event["errorType"]), ("archive.generate", "JSONDecodeError"))
        self.assertIn("Expecting property name", event["message"])
        self.assertIn("JSONDecodeError", event["traceback"])


if __name__ == "__main__":
    unittest.main()
