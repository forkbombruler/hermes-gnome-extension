UUID := hermes-monitor@leo
EXTDIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall pack test clean

install: compile-schemas
	@mkdir -p "$(EXTDIR)"
	@cp -r extension.js prefs.js metadata.json stylesheet.css "$(EXTDIR)/"
	@cp -r schemas icons src "$(EXTDIR)/"
	@echo "✅ Installed to $(EXTDIR)"
	@echo "   Restart GNOME Shell: Alt+F2 → r → Enter"

uninstall:
	@rm -rf "$(EXTDIR)"
	@echo "🗑  Removed $(EXTDIR)"

pack: compile-schemas
	@gnome-extensions pack --force --out-dir=.
	@echo "📦 Package created: $(UUID).shell-extension.zip"

compile-schemas:
	@glib-compile-schemas schemas/
	@echo "✅ Schemas compiled"

test:
	@python3 src/hermes-status.py | python3 -m json.tool > /dev/null && echo "✅ Data provider OK"

clean:
	@rm -f $(UUID).shell-extension.zip
	@rm -f schemas/gschemas.compiled
	@echo "🧹 Cleaned"
