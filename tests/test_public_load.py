import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("public_load", Path(__file__).parents[1] / "scripts/load-test-public.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def args(**overrides):
    values = dict(base_url="https://burgrs.co.uk", users="1,3,5", loops=1, rps=1, timeout=15, max_seconds=180, output="unused.json")
    values.update(overrides)
    return argparse.Namespace(**values)


class FakeResponse:
    def __init__(self, status, body):
        from email.message import Message
        self.status, self.body = status, body
        self.headers = Message()
        self.headers["Cache-Status"] = '"Netlify Durable"; hit; ttl=100'

    def read(self, _limit):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class PublicLoadTests(unittest.TestCase):
    def test_caps_reject_larger_runs(self):
        self.assertEqual(runner.configuration(args()), ([1, 3, 5], 54))
        for invalid in [args(users="6"), args(rps=2), args(loops=2), args(users="3,1"), args(users="1,1"), args(base_url="http://example.org"), args(base_url="https://user:pass@example.org")]:
            with self.assertRaises(ValueError):
                runner.configuration(invalid)

    def test_response_content_and_percentiles(self):
        self.assertTrue(runner.validate("show", b'{"tmdb_id":1396,"name":"Breaking Bad"}'))
        self.assertFalse(runner.validate("show", b'{"tmdb_id":1,"name":"Wrong show"}'))
        self.assertFalse(runner.validate("search", b'{"results":[]}'))
        self.assertEqual(runner.percentile([100, 200, 300, 400, 500], 0.95), 480)
        self.assertIsNone(runner.percentile([], 0.95))

    def test_failures_stop_and_write_report(self):
        with tempfile.TemporaryDirectory() as folder:
            output = str(Path(folder) / "result.json")
            with patch.object(runner.urllib.request, "urlopen", return_value=FakeResponse(500, b'{}')) as fetch:
                report = runner.run(args(users="1", output=output))
            self.assertEqual(fetch.call_count, 2)
            self.assertEqual(report["stop_reason"], "error_threshold")
            self.assertEqual(report["summary"]["failed"], 2)
            self.assertEqual(json.loads(Path(output).read_text())["summary"], report["summary"])
            self.assertTrue(all(call.args[0].method == "GET" for call in fetch.call_args_list))


if __name__ == "__main__":
    unittest.main()
