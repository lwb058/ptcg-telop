"""
Input: contextlib, io, json, os, pathlib, pathlib.Path, struct, tempfile, unittest, unittest.mock
Output: png_bytes, Response, ImportDiagnosticsTests
Pos: Application code

🔄 Self-reference: When this file changes, update this header
"""

# [INPUT]: unittest、メモリ上の API 応答、一時ディレクトリ、CHS 共通層・二つの CLI に依存する。
# [OUTPUT]: Python 例外の stderr 伝達、資料／画像の境界、DB の原子的保存、単一 JSON と終了コードの検証を提供する。
# [POS]: python/ の CHS 回帰検証。外部通信とユーザー DB への書き込みを遮断し、実際の失敗地点を注入する。
# [PROTOCOL]: 変更時はこのヘッダーを更新し、その後 CLAUDE.md を確認する。

import contextlib
import io
import json
import os
from pathlib import Path
import struct
import tempfile
import unittest
from unittest import mock
import zlib

import card_utils_chs as cards
import extract_deck_cards_chs as deck
import get_single_card_chs as single
import import_diagnostics as diagnostics


def png_bytes():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b''))


class Response:
    status_code = 200
    encoding = None

    def __init__(self, data=None, content=None, interrupt=False):
        self.data, self.content, self.interrupt = data, content, interrupt
        self.closed = False

    def raise_for_status(self):
        pass

    def json(self):
        if isinstance(self.data, Exception):
            raise self.data
        return self.data

    def iter_content(self, chunk_size=8192):
        yield self.content
        if self.interrupt:
            raise cards.requests.exceptions.ChunkedEncodingError('图片下载中断')

    def close(self):
        self.closed = True


class ImportDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.temp = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.db = self.temp / 'database_chs.json'
        self.images = self.temp / 'images'
        self.images.mkdir()
        self.err = io.StringIO()
        self.out = io.StringIO()
        self.stack.enter_context(contextlib.redirect_stderr(self.err))
        self.stack.enter_context(contextlib.redirect_stdout(self.out))
        self.stack.enter_context(mock.patch.object(cards, 'CARD_IMG_DIR', str(self.images)))
        self.stack.enter_context(mock.patch.object(cards, 'DATABASE_FILE', str(self.db)))
        self.stack.enter_context(mock.patch.object(cards, 'CARD_PACKS_FILE', str(self.temp / 'packs.json')))
        self.stack.enter_context(mock.patch.object(cards, '_SET_NAME_CACHE', {}))
        self.stack.enter_context(mock.patch.object(cards.requests, 'get', side_effect=AssertionError('Live network forbidden')))
        self.stack.enter_context(mock.patch.object(cards.requests, 'post', side_effect=AssertionError('Live network forbidden')))
        self.stack.enter_context(mock.patch.object(deck.time, 'sleep'))
        self.stack.enter_context(mock.patch.dict(os.environ, {'PTCG_DIAGNOSTIC_ID': 'test-中文', 'PTCG_ATTEMPT_TYPE': 'deck'}))
        diagnostics.reset()

    def events(self):
        return [json.loads(line[len(diagnostics.EVENT_PREFIX):]) for line in self.err.getvalue().splitlines()
                if line.startswith(diagnostics.EVENT_PREFIX)]

    def cli(self, callback):
        with self.assertRaises(SystemExit) as exit_result:
            diagnostics.run_cli(callback)
        result = json.loads(self.out.getvalue())
        self.assertEqual(len(self.out.getvalue().splitlines()), 1)
        return exit_result.exception.code, result

    def info(self, name='皮卡丘'):
        return {'name': name, 'image_url': 'https://tcg.mik.moe/static/img/TEST/001.png'}

    def put_image(self, card_id='TEST-001'):
        (self.images / (card_id + '.png')).write_bytes(png_bytes())

    def test_network_exception_keeps_type_stack_and_timeout(self):
        error = cards.requests.exceptions.SSLError('TLS 握手失败')
        with mock.patch.object(cards.requests, 'post', side_effect=error) as request:
            self.assertIsNone(cards.get_card_details('TEST/001'))
        request.assert_called_once()
        self.assertEqual(request.call_args.kwargs['timeout'], (10, 30))
        event = next(item for item in self.events() if item['event'] == 'failed')
        self.assertEqual((event['stage'], event['cardId'], event['errorType']), ('card.fetch', 'TEST-001', 'SSLError'))
        self.assertIn('TLS 握手失败', event['traceback'])
        self.assertEqual(event['diagnosticId'], 'test-中文')

    def test_json_failure_recorded_at_deck_parse(self):
        response = Response(data=json.JSONDecodeError('坏 JSON', 'x', 0))
        with mock.patch.object(cards.requests, 'post', return_value=response):
            self.assertIsNone(deck.fetch_deck_by_code('CODE'))
        events = [item for item in self.events() if item['event'] == 'failed']
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['stage'], 'deck.parse')
        self.assertEqual(events[0]['errorType'], 'JSONDecodeError')
        self.assertTrue(response.closed)

    def test_transform_exception_recorded_at_card(self):
        value = {'code': 200, 'data': {'name': '皮卡丘', 'setCode': 'TEST', 'cardIndex': '001'}}
        with mock.patch.object(cards, '_transform_api_data', side_effect=TypeError('意外属性类型')):
            self.assertIsNone(cards.get_card_details('TEST-001', json.dumps(value)))
        event = next(item for item in self.events() if item['event'] == 'failed')
        self.assertEqual(event['stage'], 'card.transform')
        self.assertIn('TypeError', event['traceback'])

    def test_database_replace_failure_preserves_old_bytes(self):
        before = '{"OLD": {"name": "原卡"}}'
        self.db.write_text(before, encoding='utf-8')
        with mock.patch.object(cards.os, 'replace', side_effect=PermissionError('数据库不可写')):
            self.assertFalse(cards.save_database({'NEW': self.info()}, str(self.db)))
        self.assertEqual(self.db.read_text(encoding='utf-8'), before)
        self.assertEqual(list(self.temp.glob('.chs-db-*.tmp')), [])
        event = next(item for item in self.events() if item['event'] == 'failed')
        self.assertEqual((event['stage'], event['errorType']), ('database.save', 'PermissionError'))

    def test_database_success_is_boolean_and_readable(self):
        self.assertTrue(cards.save_database({'TEST-001': self.info()}, str(self.db)))
        self.assertEqual(cards.load_database(str(self.db))['TEST-001']['name'], '皮卡丘')

    def test_corrupt_database_is_failed_and_not_rewritten(self):
        self.db.write_bytes(b'{broken')
        code, output = self.cli(lambda: single.main(argv=['TEST-001', '--database-path', str(self.db)]))
        self.assertEqual(code, 1)
        self.assertEqual(output['status'], 'failed')
        self.assertFalse(output['databaseSaved'])
        self.assertEqual(self.db.read_bytes(), b'{broken')
        self.assertTrue(any(item['stage'] == 'database.load' and item['event'] == 'failed' for item in self.events()))

    def test_interrupted_download_does_not_leave_valid_cache(self):
        response = Response(content=png_bytes()[:30], interrupt=True)
        with mock.patch.object(cards.requests, 'get', return_value=response) as request:
            self.assertFalse(cards.download_card_image('TEST-001', self.info()['image_url']))
        self.assertFalse(cards.card_image_available('TEST-001', self.info()))
        self.assertEqual(list(self.images.iterdir()), [])
        self.assertEqual(request.call_args.kwargs['timeout'], (10, 30))
        self.assertTrue(response.closed)
        event = next(item for item in self.events() if item['event'] == 'failed')
        self.assertEqual(event['errorType'], 'ChunkedEncodingError')
        self.assertIn('图片下载中断', event['traceback'])

    def test_invalid_existing_cache_is_repaired_atomically(self):
        image = self.images / 'TEST-001.png'
        image.write_bytes(png_bytes()[:-12])
        self.assertFalse(cards.card_image_available('TEST-001', self.info()))
        with mock.patch.object(cards.requests, 'get', return_value=Response(content=png_bytes())):
            self.assertTrue(cards.download_card_image('TEST-001', self.info()['image_url']))
        self.assertEqual(image.read_bytes(), png_bytes())
        self.assertTrue(cards.card_image_available('TEST-001', self.info()))

    def test_invalid_remote_image_is_not_cached(self):
        with mock.patch.object(cards.requests, 'get', return_value=Response(content=b'<html>error</html>')):
            self.assertFalse(cards.download_card_image('TEST-001', self.info()['image_url']))
        self.assertEqual(list(self.images.iterdir()), [])
        self.assertIn('invalid, or incomplete', self.err.getvalue())

    def test_keep_checks_and_downloads_missing_image(self):
        database = {'TEST-001': self.info()}
        with mock.patch.object(cards, 'get_card_details') as fetch:
            with mock.patch.object(cards.requests, 'get', return_value=Response(content=png_bytes())):
                info, status = cards.add_card_to_database('TEST/001', overwrite=False, db_instance=database)
        fetch.assert_not_called()
        self.assertEqual(status, 'skipped')
        self.assertTrue(cards.card_image_available('TEST-001', info))

    def test_refresh_failure_uses_valid_cached_data_with_warning(self):
        database = {'TEST-001': self.info()}
        self.put_image()
        with mock.patch.object(cards.requests, 'post', side_effect=cards.requests.exceptions.ConnectTimeout('连接超时')):
            info, status = cards.add_card_to_database('TEST/001', db_instance=database)
        self.assertEqual(status, 'stale')
        self.assertIs(info, database['TEST-001'])
        self.assertTrue(any(item['stage'] == 'card.refresh' and item['event'] == 'warning' for item in self.events()))

    def test_deck_missing_data_retains_complete_expectations_and_valid_cache(self):
        self.db.write_text(json.dumps({'OLD-001': self.info('旧卡')}), encoding='utf-8')
        source = [{'setCode': 'TEST', 'cardIndex': '001', 'quantity': 2},
                  {'setCode': 'TEST', 'cardIndex': '002'}]
        def retrieve(card_id, **kwargs):
            if card_id == 'TEST-001':
                kwargs['db_instance'][card_id] = self.info()
                return self.info(), 'updated'
            return None, 'failed'
        with mock.patch.object(deck, 'fetch_deck_by_code', return_value=source):
            with mock.patch.object(deck, 'add_card_to_database', side_effect=retrieve):
                with mock.patch.object(deck, 'card_image_available', return_value=True):
                    code, output = self.cli(lambda: deck.main(argv=['CODE', '--database-path', str(self.db)]))
        self.assertEqual(code, 1)
        self.assertEqual(output['cards'], ['TEST-001', 'TEST-001', 'TEST-002'])
        self.assertEqual(output['missingCards'], ['TEST-002'])
        self.assertTrue(output['databaseSaved'])
        saved = json.loads(self.db.read_text(encoding='utf-8'))
        self.assertIn('OLD-001', saved)
        self.assertIn('TEST-001', saved)
        self.assertNotIn('TEST-002', saved)

    def test_only_missing_image_exits_zero_with_warning(self):
        value = {'code': 200, 'data': {'name': '皮卡丘', 'cardType': 'Pokemon',
                                      'setCode': 'TEST', 'cardIndex': '001'}}
        with mock.patch.object(cards.requests, 'post', return_value=Response(data=value)):
            with mock.patch.object(cards.requests, 'get', side_effect=cards.requests.exceptions.ReadTimeout('读取超时')):
                code, output = self.cli(lambda: single.main(argv=['TEST/001', '--database-path', str(self.db)]))
        self.assertEqual(code, 0)
        self.assertEqual(output['status'], 'warning')
        self.assertEqual(output['missingCards'], [])
        self.assertEqual(output['missingImages'], ['TEST-001'])
        self.assertTrue(output['databaseSaved'])
        self.assertTrue(any(item['event'] == 'failed' and item['errorType'] == 'ReadTimeout' for item in self.events()))

    def test_save_failure_prevents_success(self):
        self.put_image()
        with mock.patch.object(single, 'add_card_to_database', return_value=(self.info(), 'updated')):
            with mock.patch.object(single, 'save_database', return_value=False):
                code, output = self.cli(lambda: single.main(argv=['TEST-001']))
        self.assertEqual(code, 1)
        self.assertFalse(output['databaseSaved'])
        self.assertEqual(output['status'], 'failed')

    def test_single_cached_success_is_one_json_with_normalized_id(self):
        self.db.write_text(json.dumps({'TEST-001': self.info()}), encoding='utf-8')
        self.put_image()
        code, output = self.cli(lambda: single.main(argv=['TEST/001', '--keep']))
        self.assertEqual((code, output['status']), (0, 'success'))
        self.assertEqual(output['cards'], ['TEST-001'])
        self.assertTrue(output['databaseSaved'])

    def test_bad_input_and_missing_file_are_machine_readable(self):
        code, output = self.cli(lambda: single.main(argv=['TEST/001', '--file', str(self.temp / 'missing.json')]))
        self.assertEqual(code, 1)
        self.assertEqual(output['missingCards'], ['TEST-001'])
        self.assertTrue(any(item.get('errorType') == 'FileNotFoundError' for item in self.events()))

    def test_cli_uncaught_exception_has_trace_and_final_result(self):
        def throw():
            diagnostics.emit('card.transform', 'started', card_id='TEST-001')
            raise RuntimeError('内部异常 中文')
        code, output = self.cli(throw)
        self.assertEqual((code, output['status']), (1, 'failed'))
        failure = next(item for item in self.events() if item.get('unhandled'))
        self.assertIn('RuntimeError: 内部异常 中文', failure['traceback'])
        self.assertEqual(failure['stage'], 'card.transform')
        self.assertEqual(failure['cardId'], 'TEST-001')

    def test_deck_invalid_row_cannot_silently_disappear(self):
        with mock.patch.object(deck, 'fetch_deck_by_code', return_value=[{'setCode': 'TEST'}]):
            code, output = self.cli(lambda: deck.main(argv=['CODE']))
        self.assertEqual(code, 1)
        self.assertEqual(output['status'], 'failed')
        self.assertTrue(any('missing setCode or cardIndex' in item.get('message', '') for item in self.events()))

    def test_whitespace_name_is_not_usable(self):
        self.assertFalse(cards.card_data_available({'name': '   '}))
        self.assertFalse(cards.card_data_available({'name': []}))

    def test_existing_dot_set_codes_remain_supported(self):
        self.assertEqual(cards.normalize_card_id('CS6.5C/020'), 'CS6.5C-020')
        self.assertEqual(cards.normalize_card_id('CSM2.1C-075'), 'CSM2.1C-075')
        for identifier in ['../TEST/001', 'TEST/../001', 'TEST-001/002']:
            with self.assertRaises(ValueError):
                cards.normalize_card_id(identifier)

    def test_corrupt_cached_image_url_is_missing_image_only(self):
        self.db.write_text(json.dumps({'TEST-001': {'name': '皮卡丘', 'image_url': []}}), encoding='utf-8')
        code, output = self.cli(lambda: single.main(argv=['TEST-001', '--keep']))
        self.assertEqual((code, output['status']), (0, 'warning'))
        self.assertEqual(output['missingCards'], [])
        self.assertEqual(output['missingImages'], ['TEST-001'])


if __name__ == '__main__':
    unittest.main()
