#!/bin/bash
set -e

echo "Building Bowser widget assets..."

# Install npm dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

# Build the main application first
echo "Building main application..."
npm run build

# Build the widget with special target
echo "Building widget module..."
BUILD_TARGET=widget npm run build

# Ensure the widget.js file exists and contains our render function
if [ -f "src/bowser/dist/widget.js" ]; then
    if grep -q "render" src/bowser/dist/widget.js && grep -q "export" src/bowser/dist/widget.js; then
        echo "✅ Widget build successful!"
        echo "   Widget assets available at: src/bowser/dist/widget.js"
    else
        echo "❌ Widget build failed - render function not found in widget.js"
        echo "   Checking widget.js content..."
        tail -n 20 src/bowser/dist/widget.js
        exit 1
    fi
else
    echo "❌ Widget build failed - widget.js not found"
    exit 1
fi

# Ensure static directory exists and copy widget assets
mkdir -p src/bowser/static
cp src/bowser/dist/widget.js src/bowser/static/widget.js 2>/dev/null || true
# CSS file might be named style.css from widget build
cp src/bowser/dist/style.css src/bowser/static/widget.css 2>/dev/null || true
cp src/bowser/dist/widget.css src/bowser/static/widget.css 2>/dev/null || true

echo "Widget is ready for use in Jupyter notebooks!"
echo "Install with: pip install -e .[widget]"
