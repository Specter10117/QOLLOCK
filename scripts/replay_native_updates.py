"""Replay native history against current mod sources; no network or game writes."""

import argparse
from collections import Counter
from functools import lru_cache
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET

try:
    import upstream_sync as sync
except ModuleNotFoundError:
    from scripts import upstream_sync as sync

ROOT = Path(__file__).resolve().parents[1]


class NativeHistory:
    def __init__(self, repository):
        self.repository = Path(repository).resolve()

    def git(self, *arguments):
        return subprocess.check_output(["git", "-C", str(self.repository), *arguments], stderr=subprocess.PIPE)

    @lru_cache(maxsize=None)
    def index(self, revision):
        result = {}
        for line in self.git("ls-tree", "-r", "-z", revision, "--", sync.PREFIX).split(b"\0"):
            if not line:
                continue
            metadata, name = line.split(b"\t", 1)
            _, kind, blob = metadata.split()
            if kind == b"blob":
                result[name.decode()[len(sync.PREFIX):]] = blob.decode()
        if not any(path.startswith("styles/") for path in result) or not any(
                path.startswith("layout/") for path in result):
            raise ValueError("Expected complete native layout and style trees at " + revision)
        return result

    @lru_cache(maxsize=None)
    def blob(self, identity):
        data = self.git("cat-file", "blob", identity)
        if sync.git_blob(data) != identity:
            raise ValueError("Native blob identity mismatch")
        return data

    def revisions(self, reference, count, paths):
        # Explicit ref: the local checkout need not be up to date with its fetched remote.
        return self.git("log", "--format=%H", f"--max-count={count}", reference, "--",
                        *(sync.PREFIX + path for path in sorted(paths))).decode().splitlines()


def select_cases(manifest, revisions, index, limit):
    """Distinct file/blob states, spread across files rather than 200 copies of one."""
    by_file = {path: [] for path in manifest["files"]}
    seen = {(path, entry["blob"]) for path, entry in manifest["files"].items()}
    for revision in revisions:
        listing = index(revision)
        for path in by_file:
            identity = listing.get(path)
            if (path, identity) not in seen:
                seen.add((path, identity))
                by_file[path].append({"path": path, "revision": revision, "blob": identity})
    selected = []
    while len(selected) < limit and any(by_file.values()):
        for cases in by_file.values():
            if cases and len(selected) < limit:
                selected.append(cases.pop(0))
    return selected


def equivalent(kind, first, second):
    if kind == "css":
        return sync.normalized(first) == sync.normalized(second)
    # Formatting/header changes may be harmless, but tags, attributes, text and
    # child order must survive a rollback/restore round trip.
    def signature(node):
        return (node.tag, node.attrib, (node.text or "").strip(), (node.tail or "").strip(),
                [signature(child) for child in node])
    return signature(ET.fromstring(first)) == signature(ET.fromstring(second))


def replay_case(manifest, case, reader, workspace):
    path = case["path"]
    entry = manifest["files"][path]
    destination = workspace / entry["destination"]
    original = destination.read_bytes() if destination.is_file() else None
    isolated = {"commit": manifest["commit"], "files": {path: entry}}
    changes, writes, updated, _ = sync.plan(isolated, {path: case["blob"]}, reader, workspace)
    change = changes[0]
    result = {**case, "status": change["status"], "reason": change["reason"]}
    if "pending_blob" in updated["files"][path]:
        # Refusals must retain both the original file and the applied base.
        assert not writes, "Pending native changes wrote source files"
        assert updated["files"][path]["blob"] == entry["blob"], "Pending change advanced its base"
        result["roundtrip"] = "not applicable: pending review"
        return result
    try:
        for relative, data in writes.items():
            (workspace / relative).write_bytes(data)
        # Equality is evidence, not an unconditional merge oracle: local edits
        # identical to the visited native revision coalesce into its new base.
        restoration, restored, accepted, _ = sync.plan(updated, {path: entry["blob"]}, reader, workspace)
        if "pending_blob" in accepted["files"][path]:
            result["roundtrip"] = "manual review on restore"
            result["restore_reason"] = restoration[0]["reason"]
        else:
            final = restored.get(entry["destination"], destination.read_bytes())
            result["roundtrip"] = "preserved" if equivalent(entry["kind"], original, final) else "changed on restore; ownership review"
            if result["roundtrip"] != "preserved":
                clean = lambda data: [line for line in data.decode("utf-8-sig").splitlines() if line.strip()]
                result["roundtrip_diff"] = "\n".join(difflib.unified_diff(clean(original), clean(final),
                    fromfile="original working source", tofile="restored applied native base", n=2))
    finally:
        if original is not None:
            destination.write_bytes(original)
    return result


def copy_sources(root, workspace):
    # Copy working bytes, preserving current fixes; exclude Git, installed game
    # content, ignored scratch files and generated archives. Never run a builder.
    files = subprocess.check_output(["git", "-C", str(root), "ls-files", "--cached", "--others",
                                     "--exclude-standard", "-z"]).decode().split("\0")
    digest = hashlib.sha256()
    for relative in sorted(set(files)):
        source = root / relative
        if not relative or not source.is_file() or source.is_symlink() or source.suffix.lower() == ".vpk":
            continue
        target = workspace / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        digest.update(relative.encode() + b"\0" + hashlib.sha256(target.read_bytes()).digest())
    return digest.hexdigest()


def node_tests(workspace, output, name, tests=None, trace=False):
    command = ["node", "--test", "--test-concurrency=4"]
    environment = os.environ.copy()
    if trace:
        command += ["--require", str(workspace / "scripts/native_test_reads.cjs")]
        environment["QOL_NATIVE_TEST_READS"] = str(output / "reads")
    command += tests if tests is not None else [str(file.relative_to(workspace))
                                               for file in sorted((workspace / "tests").glob("*.test.js"))]
    result = subprocess.run(command, cwd=workspace, env=environment, capture_output=True)
    (output / (name + ".log")).write_bytes(result.stdout + result.stderr)
    return {"exit_code": result.returncode, "log": name + ".log", "files": len(command) - 3 - (2 if trace else 0)}


def dependency_inventory(output, manifest, expected_tests=()):
    by_test = {}
    for file in sorted((output / "reads").glob("*.json")):
        record = json.loads(file.read_text(encoding="utf-8"))
        by_test.setdefault(record["test"], set()).update(record["reads"])
    missing = set(expected_tests) - by_test.keys()
    if missing:
        raise ValueError("Incomplete test-read inventory: " + ", ".join(sorted(missing)))
    watched = {entry["destination"] for entry in manifest["files"].values()}
    return {test: {"reads": sorted(reads), "watched": sorted(reads & watched)}
            for test, reads in sorted(by_test.items()) if reads}


def mutation_checks(workspace, output):
    """Exercise the existing contracts with benign changes and real breakages."""
    quickbuy = ["tests/quickbuy_patch_compat.test.js"]
    cases = [
        ("native-size-change", "panorama/styles/base/hud_quickbuy.css", quickbuy, True,
         lambda text: re.sub(r"(#HudMini\s*\{[^}]*?\bwidth:\s*)([\d.]+)(px;)",
                            lambda match: match[1] + str(float(match[2]) + 17) + match[3], text, count=1)),
        ("add-native-state", "panorama/layout/hud_quickbuy.xml", quickbuy, True,
         lambda text: text.replace('classes="gStreetBrawl ', 'classes="QOLReplayExtraState gStreetBrawl ', 1)),
        ("lose-required-state", "panorama/layout/hud_quickbuy.xml", quickbuy, False,
         lambda text: text.replace("gQuickbuyShopShowQueue", "", 1)),
        ("lose-native-card-selector", "panorama/styles/base/hud_quickbuy.css", quickbuy, False,
         lambda text: text.replace("#HudMini #HudMiniContents", "#QOLReplayMissingContents")),
        ("detach-enhanced-card", "panorama/styles/features/ql_feat_native_hud_quickbuy.css", quickbuy, False,
         lambda text: re.sub(r"(#CitadelHudQuickbuy\.enhanced_quickbuy_active #HudMini\s*\{[^}]*horizontal-align:\s*)left",
                            r"\1right", text, count=1)),
        ("lose-sale-binding", "panorama/layout/hud_quickbuy.xml", quickbuy, False,
         lambda text: text.replace('text="{d:sell_queue_size}"', 'text="0"', 1)),
        ("detach-party-count", "panorama/styles/features/ql_feat_native_citadel_party.css",
         ["tests/party_layout_style.test.js"], False,
         lambda text: re.sub(r"(\bwidth:\s*)[\d.]+px;", r"\g<1>1px;", text, count=1)),
        ("native-stamina-resize", "panorama/styles/base/unit_status_v2.css",
         ["tests/unit_status_base.test.js"], True,
         lambda text: re.sub(r"(\.HideName #StaminaContainer\s*\{[^}]*margin-top:\s*)(-?[\d.]+)(px;)",
                            lambda match: match[1] + str(float(match[2]) + 17) + match[3], text, count=1)),
        ("native-hud-panel-addition", "panorama/layout/hud.xml", ["tests/hud_native_contract.test.js"], True,
         lambda text: text.replace("</CitadelHud>", "<CitadelChatWheel />\n</CitadelHud>", 1)),
        ("lose-qollock-bootstrap", "panorama/layout/hud.xml", ["tests/hud_native_contract.test.js"], False,
         lambda text: text.replace("scripts/core/ql_app.vjs_c", "scripts/core/QOLReplayMissingApp.vjs_c", 1)),
        ("native-localization-selector-change", "panorama/styles/base/hero_testing_menu.css",
         ["tests/hero_testing_menu.test.js"], True,
         lambda text: text.replace("Language_english", "QOLReplayDifferentLocaleCondition")),
        ("mod-hides-native-localized-hint", "panorama/styles/features/ql_feat_native_hero_testing_menu.css",
         ["tests/hero_testing_menu.test.js"], False,
         lambda text: text + "\n.hotkey_hint { visibility: collapse; }\n"),
        ("lose-native-localization-import", "panorama/styles/hero_testing_menu.css",
         ["tests/hero_testing_menu.test.js"], False,
         lambda text: text.replace("styles/base/hero_testing_menu.vcss_c", "styles/base/QOLReplayMissingMenu.vcss_c", 1)),
    ]
    results, controls = [], {}
    for name, relative, tests, should_pass, mutate in cases:
        group = tuple(tests)
        if group not in controls:
            control = node_tests(workspace, output, "control-" + str(len(controls)), tests)
            if control["exit_code"]:
                raise ValueError("Unmodified mutation control failed: " + control["log"])
            controls[group] = control["log"]
        path = workspace / relative
        original = path.read_bytes()
        modified = mutate(original.decode("utf-8-sig"))
        if modified == original.decode("utf-8-sig"):
            raise ValueError("Mutation no longer matches its source contract: " + name)
        try:
            path.write_text(modified, encoding="utf-8", newline="\n")
            result = node_tests(workspace, output, "mutation-" + name, tests)
            result.update(name=name, expected="pass" if should_pass else "fail",
                          control_log=controls[group], matched_expectation=(result["exit_code"] == 0) == should_pass)
            results.append(result)
        finally:
            path.write_bytes(original)
    return results


def historical_css_tests(manifest, case, reader, workspace, output, inventory, number):
    entry = manifest["files"][case["path"]]
    if entry["kind"] != "css" or not case["blob"]:
        return None
    tests = sorted(test for test, record in inventory.items() if entry["destination"] in record["watched"])
    if not tests:
        return None
    destination = workspace / entry["destination"]
    original = destination.read_bytes()
    try:
        # Deliberately test the historical native bytes even if the conservative
        # merger refuses them. XML is excluded: raw XML would erase mod children.
        destination.write_bytes(reader(case["blob"]))
        return node_tests(workspace, output, f"file-{number}", tests)
    finally:
        destination.write_bytes(original)


def render_report(report):
    counts = report["counts"]
    lines = ["# Native history replay", "",
             f"Source commit: `{report['source_commit']}`; working-tree digest: `{report['working_tree_sha256']}`.",
             f"Native head: `{report['native_ref']}`.", "",
             f"Replayed {counts['cases']} distinct file states across {counts['files']} watched files.",
             "", report["limits"], "",
             "Pending proposals retain local sources. Historical test failures are compatibility findings,",
             "not a requirement to weaken the tests. Round-trip differences need ownership review:",
             "edits shared by the mod and a visited native version may coalesce into the new base.", "",
             "## Merge and restore outcomes", "", "| Outcome | Cases |", "| --- | ---: |"]
    lines += [f"| {status} | {number} |" for status, number in counts["roundtrips"].items()]
    if report.get("snapshots"):
        lines += ["", "## Whole-source proposals", "",
                  "| Native revision | Proposed files | Pending files | Test files | Test exit | Log |",
                  "| --- | ---: | ---: | ---: | ---: | --- |"]
        for snapshot in report["snapshots"]:
            tests = snapshot["tests"]
            pending = sum(change["status"] == "manual review" for change in snapshot["changes"])
            lines.append(f"| `{snapshot['revision']}` | {len(snapshot['written'])} | {pending} | "
                         + (f"{tests['files']} | {tests['exit_code']} | [log]({tests['log']}) |" if tests else "0 | skipped | |"))
    raw = [case for case in report["cases"] if case.get("raw_css_tests")]
    if raw:
        failed = [case for case in raw if case["raw_css_tests"]["exit_code"]]
        lines += ["", "## Raw historical CSS checks", "",
                  f"Ran affected tests for {len(raw)} individual historical CSS states; {len(failed)} reported failures.",
                  "Raw native XML is excluded because it would remove QOLLOCK's children and includes.", "",
                  "| File | Historical revision | Log |", "| --- | --- | --- |"]
        lines += [f"| `{case['path']}` | `{case['revision']}` | [failure]({case['raw_css_tests']['log']}) |"
                  for case in failed]
    if report.get("mutations"):
        lines += ["", "## Controlled changes", "", "| Scenario | Expected | Observed | Correct | Log |",
                  "| --- | --- | --- | --- | --- |"]
        lines += [f"| {case['name']} | {case['expected']} | {'pass' if case['exit_code'] == 0 else 'fail'} | "
                  f"{case['matched_expectation']} | [log]({case['log']}) |" for case in report["mutations"]]
    for case in report["cases"]:
        if case.get("roundtrip_diff"):
            lines += ["", f"## Ownership review: `{case['path']}`", "", "```diff", case["roundtrip_diff"], "```"]
    return "\n".join(lines) + "\n"


def run(args):
    output = args.output.resolve()
    if output.exists():
        raise ValueError("Choose a new output directory; previous evidence is never overwritten")
    history = NativeHistory(args.native_repo)
    manifest = json.loads((ROOT / "upstream.json").read_text(encoding="utf-8"))
    reference = history.git("rev-parse", "--verify", args.ref + "^{commit}").decode().strip()
    revisions = history.revisions(reference, args.revisions, manifest["files"])
    # Include the exact requested head even when its last change was unrelated.
    revisions = list(dict.fromkeys([reference, *revisions]))
    cases = select_cases(manifest, revisions, history.index, args.cases)
    output.mkdir(parents=True)
    workspace = output / "workspace"
    working_digest = copy_sources(ROOT, workspace)
    report = {"source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT).decode().strip(),
              "working_tree_sha256": working_digest,
              "native_ref": reference, "requested_cases": args.cases, "cases": [], "snapshots": [],
              "limits": "Current mod against historical sources, not a historical client or rendering test."}
    inventory = {}
    if args.snapshots or args.file_tests:
        report["baseline_tests"] = node_tests(workspace, output, "baseline", trace=True)
        expected = [file.relative_to(workspace).as_posix() for file in (workspace / "tests").glob("*.test.js")]
        inventory = dependency_inventory(output, manifest, expected)
        (output / "test-dependencies.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
        if report["baseline_tests"]["exit_code"]:
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            raise ValueError("Current source baseline must pass before interpreting historical failures")
    # Each candidate is validated once, even if many revisions contain its bytes.
    sync.validate_css = lru_cache(maxsize=None)(sync.validate_css)
    for number, case in enumerate(cases, 1):
        try:
            result = replay_case(manifest, case, history.blob, workspace)
            if args.file_tests:
                result["raw_css_tests"] = historical_css_tests(manifest, case, history.blob,
                    workspace, output, inventory, number)
            report["cases"].append(result)
        except Exception as error:
            report["error"] = {"case": case, "message": str(error)}
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            raise
        if number % 25 == 0:
            (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(f"Replayed {number}/{len(cases)} distinct file states", flush=True)
    if args.mutations:
        report["mutations"] = mutation_checks(workspace, output)
    if args.snapshots:
        # Sample the whole history window, rather than only recent no-op commits.
        count = min(args.snapshots, len(revisions))
        selected = list(dict.fromkeys(revisions[round(i * (len(revisions) - 1) / max(1, count - 1))]
                                     for i in range(count)))
        originals = {entry["destination"]: (workspace / entry["destination"]).read_bytes()
                     for entry in manifest["files"].values() if (workspace / entry["destination"]).is_file()}
        for number, revision in enumerate(selected):
            changes, writes, _, _ = sync.plan(manifest, history.index(revision), history.blob, workspace)
            try:
                for relative, data in writes.items():
                    (workspace / relative).write_bytes(data)
                affected = sorted(test for test, record in inventory.items() if set(record["watched"]) & writes.keys())
                tests = node_tests(workspace, output, f"snapshot-{number}", affected) if affected else None
                report["snapshots"].append({"revision": revision, "changes": changes, "written": sorted(writes),
                                            "tests": tests})
                print(f"Snapshot {revision[:8]}: {len(writes)} proposed files, "
                      f"{len(affected)} affected test files, result {tests['exit_code'] if tests else 'no writes'}", flush=True)
            finally:
                for relative, data in originals.items():
                    (workspace / relative).write_bytes(data)
    report["counts"] = {"cases": len(cases), "files": len({case["path"] for case in cases}),
                        "statuses": dict(Counter(case["status"] for case in report["cases"])),
                        "roundtrips": dict(Counter(case["roundtrip"] for case in report["cases"]))}
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "report.md").write_text(render_report(report), encoding="utf-8")
    print(json.dumps(report["counts"]), flush=True)
    return int(any(case["roundtrip"] == "changed on restore; ownership review" for case in report["cases"])
               or any(case.get("raw_css_tests") and case["raw_css_tests"]["exit_code"] for case in report["cases"])
               or any(not mutation["matched_expectation"] for mutation in report.get("mutations", []))
               or report.get("baseline_tests", {}).get("exit_code", 0) != 0
               or any(snapshot["tests"] and snapshot["tests"]["exit_code"] for snapshot in report["snapshots"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-repo", type=Path, required=True, help="Existing fetched GameTracking checkout")
    parser.add_argument("--ref", default="origin/master")
    parser.add_argument("--revisions", type=int, default=40, help="Watched-file history window")
    parser.add_argument("--cases", type=int, default=200, help="Maximum distinct historical file states")
    parser.add_argument("--snapshots", type=int, default=0, help="Whole-source proposals to test (0 skips Node tests)")
    parser.add_argument("--mutations", action="store_true", help="Check benign changes and deliberate contract breakages")
    parser.add_argument("--file-tests", action="store_true", help="Run affected tests against individual raw historical CSS files")
    parser.add_argument("--output", type=Path, required=True, help="New evidence directory, normally under .upstream-review/")
    args = parser.parse_args()
    if args.revisions < 1 or args.cases < 1 or args.snapshots < 0:
        parser.error("revisions/cases must be positive; snapshots must be nonnegative")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
