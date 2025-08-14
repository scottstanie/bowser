#!/usr/bin/env python3
"""Basic test script to verify widget components work."""

import sys
from pathlib import Path


def test_server_module():
    """Test that server module imports and basic functions work."""
    # Add src to path for testing
    sys.path.insert(0, str(Path(__file__).parent / "src"))
    from bowser.server import BowserServer, _find_available_port

    # Test port finding
    port = _find_available_port(8000)
    assert isinstance(port, int)
    assert port > 0

    # Test server creation (don't start it)
    server = BowserServer(port=0)
    assert server.url.startswith("http://127.0.0.1:")


def test_widget_module():
    """Test that widget module structure is correct."""
    # Check that widget.py exists and has the right structure
    widget_path = Path(__file__).parent / "src" / "bowser" / "widget.py"
    assert widget_path.exists(), "widget.py file not found"

    content = widget_path.read_text()

    # Check for key components
    assert "class BowserWidget" in content, "BowserWidget class not found"
    assert "anywidget.AnyWidget" in content, "anywidget inheritance not found"
    assert "_esm" in content, "ESM property not found"
    assert "server_url" in content, "server_url trait not found"
    assert "dataset" in content, "dataset trait not found"
    assert "time_index" in content, "time_index trait not found"


def test_build_config():
    """Test that vite config and package.json are valid."""
    import json

    # Check package.json exists and is valid
    package_json = Path(__file__).parent / "package.json"
    if package_json.exists():
        with open(package_json) as f:
            pkg = json.load(f)
        assert "scripts" in pkg
        assert "build" in pkg["scripts"]

    # Check vite.config.ts exists
    vite_config = Path(__file__).parent / "vite.config.ts"
    assert vite_config.exists(), "vite.config.ts not found"

    content = vite_config.read_text()
    assert "widget" in content
    assert "src/widget.ts" in content


def test_pyproject_config():
    """Test that pyproject.toml has widget dependencies."""
    pyproject = Path(__file__).parent / "pyproject.toml"
    content = pyproject.read_text()

    assert "[project.optional-dependencies]" in content
    assert "widget = [" in content
    assert "anywidget" in content
    assert "traitlets" in content


def main():
    """Run all tests."""
    print("🧪 Running basic widget component tests...\n")

    tests = [
        test_server_module,
        test_widget_module,
        test_build_config,
        test_pyproject_config,
    ]

    passed = 0
    for test in tests:
        if test():
            passed += 1

    print(f"\n📊 Results: {passed}/{len(tests)} tests passed")

    if passed == len(tests):
        print("🎉 All basic tests passed! The widget implementation looks good.")
        print("\nNext steps:")
        print("1. Run: npm install")
        print("2. Run: ./build-widget.sh")
        print("3. Run: pip install -e .[widget]")
        print("4. Test in a Jupyter notebook")
        return 0
    else:
        print("❌ Some tests failed. Check the errors above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
