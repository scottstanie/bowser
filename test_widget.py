#!/usr/bin/env python3
"""Test script to verify the Bowser widget can be imported and created.
Run this to test basic widget functionality before using in Jupyter.
"""

import sys
from pathlib import Path

# Add src to path for testing
sys.path.insert(0, str(Path(__file__).parent / "src"))


def test_widget_import():
    """Test that widget can be imported."""
    print("Testing widget import...")
    try:
        from bowser.widget import BowserWidget

        print("✅ BowserWidget imported successfully")
        return True
    except ImportError as e:
        print(f"❌ Failed to import BowserWidget: {e}")
        if "anywidget" in str(e):
            print("   Install anywidget with: pip install anywidget")
        return False


def test_widget_creation():
    """Test that widget can be created without starting server."""
    print("\nTesting widget creation...")
    try:
        from bowser.widget import BowserWidget

        # Create widget without starting server (by mocking the server)
        class MockServer:
            def __init__(self, *args, **kwargs):
                self.url = "http://127.0.0.1:8000"

            def start(self):
                pass

            def stop(self):
                pass

        # Temporarily replace BowserServer
        import bowser.widget

        original_server = bowser.widget.BowserServer
        bowser.widget.BowserServer = MockServer

        try:
            widget = BowserWidget(stack_file=None, rasters_file="nonexistent.json")
            print("✅ BowserWidget created successfully")
            print(f"   Server URL: {widget.server_url}")
            return True
        finally:
            bowser.widget.BowserServer = original_server

    except Exception as e:
        print(f"❌ Failed to create BowserWidget: {e}")
        return False


def test_widget_assets():
    """Test that widget assets exist."""
    print("\nTesting widget assets...")
    try:
        # Create a temporary widget to test asset discovery
        widget_js = Path(__file__).parent / "src" / "bowser" / "dist" / "widget.js"
        static_js = Path(__file__).parent / "src" / "bowser" / "static" / "widget.js"

        if widget_js.exists():
            print(f"✅ Widget JS found at: {widget_js}")
            # Check size (should be > 500KB)
            size_kb = widget_js.stat().st_size / 1024
            print(f"   Size: {size_kb:.1f} KB")
            if size_kb < 500:
                print("⚠️  Widget JS seems small, might be incomplete")
        else:
            print(f"❌ Widget JS not found at: {widget_js}")

        if static_js.exists():
            print(f"✅ Static widget JS found at: {static_js}")
        else:
            print(f"⚠️  Static widget JS not found at: {static_js}")

        return widget_js.exists()

    except Exception as e:
        print(f"❌ Error checking assets: {e}")
        return False


def test_render_function():
    """Test that the render function exists in the built widget.js."""
    print("\nTesting render function...")
    try:
        widget_js = Path(__file__).parent / "src" / "bowser" / "dist" / "widget.js"
        if not widget_js.exists():
            print("❌ widget.js not found")
            return False

        content = widget_js.read_text()
        if "export" in content and "render" in content:
            print("✅ Render function export found in widget.js")
            return True
        else:
            print("❌ Render function export not found in widget.js")
            return False

    except Exception as e:
        print(f"❌ Error checking render function: {e}")
        return False


def main():
    """Run all tests."""
    print("🧪 Testing Bowser widget functionality...\n")

    tests = [
        test_widget_import,
        test_widget_creation,
        test_widget_assets,
        test_render_function,
    ]

    passed = 0
    for test in tests:
        if test():
            passed += 1

    print(f"\n📊 Results: {passed}/{len(tests)} tests passed")

    if passed == len(tests):
        print("\n🎉 All widget tests passed!")
        print("\nThe widget should now work in Jupyter. Try:")
        print("```python")
        print("from bowser.widget import BowserWidget")
        print("widget = BowserWidget(stack_file='your_data.zarr')")
        print("widget")
        print("```")
        return 0
    else:
        print("\n❌ Some tests failed.")
        print("Make sure to run: ./build-widget.sh")
        print("And install dependencies: pip install anywidget traitlets")
        return 1


if __name__ == "__main__":
    sys.exit(main())
