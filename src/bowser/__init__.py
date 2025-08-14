# Widget functionality (optional import)
try:
    from .widget import BowserWidget, create_widget

    __all__ = ["BowserWidget", "create_widget"]
except ImportError:
    # anywidget not installed - widget functionality not available
    __all__ = []
