"""Portable history-replay invariants; large real-history runs are opt-in."""

from copy import deepcopy
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch

from scripts import replay_native_updates as replay


class HistoryReplayTests(unittest.TestCase):
    def test_incomplete_observation_is_rejected_instead_of_skipping_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "reads").mkdir()
            (root / "reads/one.json").write_text(json.dumps({"test": "tests/a.test.js", "reads": []}))
            with self.assertRaisesRegex(ValueError, "Incomplete.*tests/b.test.js"):
                replay.dependency_inventory(root, {"files": {}}, ["tests/a.test.js", "tests/b.test.js"])

    def test_selection_deduplicates_blobs_and_spreads_coverage_across_files(self):
        manifest = {"files": {"styles/a.css": {"blob": "a0"}, "styles/b.css": {"blob": "b0"}}}
        indexes = {"r1": {"styles/a.css": "a1", "styles/b.css": "b1"},
                   "r2": {"styles/a.css": "a1", "styles/b.css": "b1"},
                   "r3": {"styles/a.css": "a2", "styles/b.css": "b0"}}
        cases = replay.select_cases(manifest, list(indexes), indexes.__getitem__, 3)
        self.assertEqual([(case["path"], case["blob"]) for case in cases],
                         [("styles/a.css", "a1"), ("styles/b.css", "b1"), ("styles/a.css", "a2")])

    def test_missing_historical_file_is_one_distinct_removal(self):
        manifest = {"files": {"layout/a.xml": {"blob": "current"}}}
        cases = replay.select_cases(manifest, ["old", "older"], lambda _: {}, 200)
        self.assertEqual(cases, [{"path": "layout/a.xml", "revision": "old", "blob": None}])

    def test_xml_equivalence_ignores_formatting_but_detects_lost_binding_and_child_order(self):
        source = b'<root><Panel id="a" text="{s:value}"/><Panel id="b"/></root>'
        self.assertTrue(replay.equivalent("xml", source,
                        b'<root>\n <Panel text="{s:value}" id="a"/>\n <Panel id="b"/>\n</root>'))
        self.assertFalse(replay.equivalent("xml", source, source.replace(b'{s:value}', b'0')))
        self.assertFalse(replay.equivalent("xml", source,
                         b'<root><Panel id="b"/><Panel id="a" text="{s:value}"/></root>'))

    def test_roundtrip_preserves_custom_css_and_restores_workspace(self):
        current = b'.native { width: 90px; }\n' + b'\n'.join(
            b'.gap%d { opacity: 1; }' % n for n in range(8)) + b'\n'
        old = current.replace(b'90px', b'74px')
        local = current + b'.mod { opacity: 0.5; }\n'
        self.replay(current, old, local, "preserved")

    def test_conflicts_remain_pending_without_changing_source_or_manifest(self):
        self.replay(b'.native { width: 90px; }\n', b'.native { width: 74px; }\n',
                    b'.native { width: 50px; }\n', "not applicable: pending review")

    def test_shared_native_edits_are_reported_for_ownership_review(self):
        current = b'.native { width: 90px; }\n' + b'\n'.join(
            b'.gap%d { opacity: 1; }' % n for n in range(8)) + b'\n'
        old = current.replace(b'90px', b'74px')
        self.replay(current, old, old + b'.mod { opacity: 0.5; }\n',
                    "changed on restore; ownership review")

    def test_failed_raw_css_test_restores_the_original_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            destination = root / "base.css"
            destination.write_bytes(b'original')
            manifest = {"files": {"styles/a.css": {"kind": "css", "destination": "base.css"}}}
            case = {"path": "styles/a.css", "blob": "historical"}
            inventory = {"tests/contract.test.js": {"watched": ["base.css"]}}
            def fail(workspace, output, name, tests):
                self.assertEqual(destination.read_bytes(), b'historical bytes')
                self.assertEqual(tests, ["tests/contract.test.js"])
                raise RuntimeError("test runner unavailable")
            with patch.object(replay, "node_tests", side_effect=fail):
                with self.assertRaisesRegex(RuntimeError, "unavailable"):
                    replay.historical_css_tests(manifest, case, lambda _: b'historical bytes',
                                                root, root, inventory, 1)
            self.assertEqual(destination.read_bytes(), b'original')

    def test_raw_xml_is_never_substituted_for_an_override(self):
        manifest = {"files": {"layout/a.xml": {"kind": "xml", "destination": "override.xml"}}}
        with patch.object(replay, "node_tests") as run:
            result = replay.historical_css_tests(manifest, {"path": "layout/a.xml", "blob": "old"},
                lambda _: self.fail("native XML must not be read here"), Path.cwd(), Path.cwd(), {}, 1)
            self.assertIsNone(result)
            run.assert_not_called()

    def replay(self, current, old, local, expected):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "base.css").write_bytes(local)
            blob = replay.sync.git_blob
            blobs = {blob(current): current, blob(old): old}
            manifest = {"commit": "a" * 40, "files": {"styles/a.css": {
                "blob": blob(current), "kind": "css", "destination": "base.css",
                "local_sha256": replay.sync.local_digest(local)}}}
            before = deepcopy(manifest)
            result = replay.replay_case(manifest,
                {"path": "styles/a.css", "revision": "old", "blob": blob(old)}, blobs.__getitem__, root)
            self.assertEqual(result["roundtrip"], expected)
            self.assertEqual((root / "base.css").read_bytes(), local)
            self.assertEqual(manifest, before)

    def test_corrupt_native_blob_is_rejected(self):
        history = replay.NativeHistory(Path.cwd())
        with patch.object(history, "git", return_value=b"different bytes"):
            with self.assertRaisesRegex(ValueError, "identity mismatch"):
                history.blob("a" * 40)


if __name__ == "__main__":
    unittest.main()
